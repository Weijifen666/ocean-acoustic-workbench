import asyncio,json,os,re
from pathlib import Path
from urllib.parse import urlparse
import httpx
from fastapi import HTTPException
ROOT=Path(__file__).resolve().parents[1];LOCAL=Path(os.environ.get('OCEAN_RUNTIME_DIR',str(ROOT/'.local')))
def catalog():return json.loads((ROOT/'backend/data/model_catalog.json').read_text(encoding='utf-8'))
def profiles(config):
    path=LOCAL/'model-profiles.json'
    saved=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    current=config()
    if current.get('provider'):
        saved[current['provider']]={k:current.get(k,'') for k in ['base_url','model','api_key']}
    return saved
def public_profiles(config):
    return {k:{'base_url':v.get('base_url',''),'model':v.get('model',''),'api_key_set':bool(v.get('api_key'))} for k,v in profiles(config).items()}
def store_profile(cfg):
    path=LOCAL/'model-profiles.json';saved=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    saved[cfg['provider']]={k:cfg.get(k,'') for k in ['base_url','model','api_key']}
    path.write_text(json.dumps(saved,ensure_ascii=False,indent=2),encoding='utf-8')
def request_options(provider,model):
    row=next((x for x in catalog()['models'] if x['provider']==provider and x['id']==model),None)
    return dict(row['request_options']) if row else {}
def chat_payload(cfg,messages,tools=None):
    body={'model':cfg['model'],'messages':messages,**request_options(cfg['provider'],cfg['model'])}
    if tools:body['tools']=tools
    return body
def validate_endpoint(provider,base):
    url=urlparse(base)
    if url.scheme!='https' or not url.hostname:raise HTTPException(422,'模型地址必须为有效 HTTPS 地址')
    allowed={'DeepSeek':lambda h:h=='api.deepseek.com','Kimi':lambda h:h in ['api.moonshot.cn','api.moonshot.ai'],'GLM':lambda h:h=='open.bigmodel.cn','Qwen':lambda h:h in ['dashscope.aliyuncs.com','dashscope-us.aliyuncs.com','dashscope-intl.aliyuncs.com'] or h.endswith('.maas.aliyuncs.com')}
    if provider not in allowed or not allowed[provider](url.hostname):raise HTTPException(422,'地址与供应商不匹配，请核对官方 API 域名')
def select_connection(body,config):
    provider=body.get('provider') or config().get('provider')
    known=next((p for p in catalog()['providers'] if p['id']==provider),None)
    if not known:raise HTTPException(422,'请选择已登记的 API 供应商')
    saved=profiles(config).get(provider,{})
    base=body.get('base_url') or saved.get('base_url') or known['base_url']
    model=body.get('model') or saved.get('model')
    key=body.get('api_key') or saved.get('api_key')
    if not key:raise HTTPException(422,'请先填写该供应商的 API Key，或保存该供应商配置')
    if not model:raise HTTPException(422,'请选择具体模型')
    validate_endpoint(provider,base)
    return {'provider':provider,'base_url':base.rstrip('/'),'model':model,'api_key':key}
def raise_remote(response):
    if response.status_code==200:return
    names={401:'密钥无效或地域不匹配',402:'余额或额度不足',403:'账户无权限访问该模型',404:'模型或接口不存在',429:'请求频率或额度受限'}
    raise HTTPException(502,f"供应商返回 HTTP {response.status_code}：{names.get(response.status_code,'请求未成功，请核对官方参数与服务状态')}")
def completion_diagnostic(result,cfg,response_format='json'):
    # Only safe scalar metadata is returned. Never echo provider bodies/reasoning.
    result=result if isinstance(result,dict) else {}
    choices=result.get('choices');choice=choices[0] if isinstance(choices,list) and choices and isinstance(choices[0],dict) else {}
    message=choice.get('message');message=message if isinstance(message,dict) else {}
    model=result.get('model');key=cfg.get('api_key','')
    if not isinstance(model,str) or len(model)>160 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:/-]*',model) or (key and key in model):model=None
    reason=choice.get('finish_reason');reason=reason if reason in ('stop','length','content_filter','tool_calls','function_call','insufficient_system_resource') else None
    return {'response_format':response_format,'response_model':model,'finish_reason':reason,'reasoning_only':bool(message.get('reasoning_content')) and not str(message.get('content') or '').strip()}
def completion_error(message,code,result,cfg,response_format='json'):
    diagnostic=completion_diagnostic(result,cfg,response_format)
    suffix=[]
    if diagnostic['finish_reason']:suffix.append('finish_reason='+diagnostic['finish_reason'])
    if diagnostic['response_model']:suffix.append('实际模型：'+diagnostic['response_model'])
    error=HTTPException(502,message+('（'+'；'.join(suffix)+'）' if suffix else ''),headers={'X-Ocean-Provider-Code':code})
    error.diagnostic=diagnostic
    return error
def read_test_completion(response,cfg):
    text=response.text.lstrip('\ufeff').strip()
    if not text:raise completion_error('供应商返回 HTTP 200，但响应为空，未完成模型调用。','PROVIDER_EMPTY_RESPONSE',None,cfg,'empty')
    if len(text)>4194304:raise completion_error('供应商响应超过安全读取上限。','PROVIDER_RESPONSE_TOO_LARGE',None,cfg,'oversized')
    response_format='json'
    if text.startswith(('data:',':')):
        # Tolerate compatible endpoints returning SSE for stream:false, but a
        # keepalive, reasoning-only stream or interrupted stream is no success.
        response_format='event_stream';content='';reasoning=False;finished=False;reason=None;model=None;usage={}
        for frame in re.split(r'\r?\n\r?\n',text):
            data='\n'.join(line[5:].lstrip() for line in frame.splitlines() if line.startswith('data:'))
            if not data:continue
            if data=='[DONE]':finished=True;break
            try:packet=json.loads(data)
            except ValueError:raise completion_error('供应商返回的事件流不是完整 JSON。','PROVIDER_INCOMPLETE_STREAM',None,cfg,response_format)
            if not isinstance(packet,dict) or packet.get('error'):raise completion_error('供应商返回的事件流包含错误。','PROVIDER_INCOMPLETE_STREAM',None,cfg,response_format)
            model=packet.get('model',model);usage=packet.get('usage') or usage
            choices=packet.get('choices') or []
            if not choices:continue
            choice=choices[0]
            if not isinstance(choice,dict):raise completion_error('供应商事件流缺少消息结构。','PROVIDER_MESSAGE_MISSING',None,cfg,response_format)
            reason=choice.get('finish_reason') or reason;delta=choice.get('delta') or {}
            if isinstance(delta,dict):
                if isinstance(delta.get('content'),str):content+=delta['content']
                reasoning=reasoning or bool(delta.get('reasoning_content'))
        result={'model':model,'usage':usage,'choices':[{'message':{'content':content,'reasoning_content':True if reasoning else None},'finish_reason':reason}]}
        if not finished and not reason:raise completion_error('供应商事件流已中断，尚未收到完整回答。','PROVIDER_INCOMPLETE_STREAM',result,cfg,response_format)
    else:
        try:result=json.loads(text)
        except ValueError:
            html=text.startswith('<')
            raise completion_error('供应商返回 HTTP 200，但内容为网页而非模型 JSON。' if html else '供应商返回 HTTP 200，但响应不是完整的 Chat Completions JSON。','PROVIDER_HTML_RESPONSE' if html else 'PROVIDER_JSON_INVALID',None,cfg,'html' if html else 'invalid_json')
    if not isinstance(result,dict) or result.get('error'):raise completion_error('供应商响应包含错误，模型调用未完成。','PROVIDER_ERROR_PAYLOAD',result,cfg,response_format)
    choices=result.get('choices')
    if not isinstance(choices,list) or not choices or not isinstance(choices[0],dict) or not isinstance(choices[0].get('message'),dict):raise completion_error('供应商响应未包含 Chat Completions 的消息结构。','PROVIDER_MESSAGE_MISSING',result,cfg,response_format)
    content=choices[0]['message'].get('content');diagnostic=completion_diagnostic(result,cfg,response_format)
    if not isinstance(content,str) or not content.strip():raise completion_error('供应商只返回了思考内容，没有最终文字回答；本次测试未通过。' if diagnostic['reasoning_only'] else '供应商接受了请求，但没有返回文字回答；本次测试未通过。','PROVIDER_EMPTY_CONTENT',result,cfg,response_format)
    if diagnostic['finish_reason'] in ('length','content_filter'):raise completion_error('供应商返回的测试回答未完成，本次测试未通过。','PROVIDER_INCOMPLETE_COMPLETION',result,cfg,response_format)
    return result,content,diagnostic
async def test_connection(body,config):
    cfg=select_connection(body,config)
    async with httpx.AsyncClient(timeout=180,follow_redirects=False) as client:
        try:
            payload=chat_payload(cfg,[{'role':'user','content':'Reply with OK.'}]);payload.update(max_tokens=256,stream=False)
            if cfg['provider']=='DeepSeek':
                payload['thinking']={'type':'disabled'};payload.pop('reasoning_effort',None)
            r=await asyncio.wait_for(client.post(cfg['base_url']+'/chat/completions',headers={'Authorization':'Bearer '+cfg['api_key']},json=payload),timeout=180)
        except (httpx.TimeoutException,TimeoutError):raise HTTPException(502,'连接供应商超时，尚未收到完整回答；这不表示 API Key 无效。',headers={'X-Ocean-Provider-Code':'PROVIDER_TIMEOUT'})
        except httpx.RequestError:raise HTTPException(502,'供应商连接或响应读取中断，请检查网络后重试；这不表示 API Key 无效。',headers={'X-Ocean-Provider-Code':'PROVIDER_NETWORK'})
    raise_remote(r)
    result,content,diagnostic=read_test_completion(r,cfg)
    # A successful HTTP test proves acceptance of a request; it does not certify agent tools.
    return {'ok':True,'provider':cfg['provider'],'requested_model':cfg['model'],**diagnostic,'reply':content[:200],'usage':result.get('usage',{}),'note':'已收到真实文字回答，当前模型调用已通过；不表示项目工具调用或视觉能力已经验证。'}
async def list_account_models(body,config):
    cfg=select_connection(body,config)
    async with httpx.AsyncClient(timeout=25,follow_redirects=False) as client:
        try:r=await client.get(cfg['base_url']+'/models',headers={'Authorization':'Bearer '+cfg['api_key']})
        except httpx.RequestError:raise HTTPException(502,'无法连接供应商模型列表接口')
    if r.status_code==404:raise HTTPException(502,'该供应商未在此地址提供标准 /models 接口，可使用具体模型测试调用')
    raise_remote(r)
    try:rows=r.json()['data'];ids=[str(x['id']) for x in rows][:500]
    except (KeyError,TypeError,ValueError):raise HTTPException(502,'模型列表格式不兼容')
    return {'ids':ids,'selected_listed':cfg['model'] in ids,'note':'模型列表表示账户接口返回；实际调用仍取决于额度和权限。'}
