"""Agent access to saved code documents; writes never execute or forge results."""
import research_context
from code_artifacts import ArtifactError


def tool_specs():
    text={'type':'string'};integer={'type':'integer'}
    specs=[
        ('list_code_artifacts','List saved code documents; no execution.',{},[]),
        ('read_code_artifact','Page code/CSV via next_offset.',{'id':text,'field':{'type':'string','enum':['code','input_csv']},'offset':integer,'max_bytes':integer},['id']),
        ('write_code_artifact','Save code, not results; expected_revision for edits.',{'id':text,'expected_revision':integer,'title':text,'language':{'type':'string','enum':['python','matlab']},'code':text,'input_csv':text},['title','language','code']),
        ('read_code_result','Read bound results; PNG metadata only.',{'id':text,'field':{'type':'string','enum':['stdout','stderr','file']},'name':text,'offset':integer,'max_bytes':integer},['id']),
    ]
    return [{'type':'function','function':{'name':name,'description':description,'parameters':{'type':'object','properties':properties,'required':required,'additionalProperties':False}}} for name,description,properties,required in specs]


def metadata(value):
    return {**{key:value.get(key) for key in ('id','title','language','revision','code_sha256','input_sha256')},
            'workspace_url':'/#code/'+value['id']}


def text_page(content,args):
    page=research_context.file_page({'kind':'text','content':content},{'offset':args.get('offset',0),'max_bytes':args.get('max_bytes',6000)})
    return {**{key:page[key] for key in ('content','offset','returned_bytes','next_offset','has_more','complete')},
            'total_characters':len(content),'total_bytes':len(content.encode('utf-8'))}


def artifact_metadata(item):
    if item['mime']=='image/png':
        encoded=item.get('base64','')
        size=len(encoded)*3//4-(len(encoded)-len(encoded.rstrip('=')))
    else:size=len(item.get('text','').encode('utf-8'))
    return {'name':item['name'],'mime':item['mime'],'bytes':size}


def execute(store,name,args):
    spec=next((tool['function']['parameters'] for tool in tool_specs() if tool['function']['name']==name),None)
    if spec is None:raise ArtifactError('未知代码工具')
    if not isinstance(args,dict) or set(args)-set(spec['properties']) or any(key not in args for key in spec['required']):raise ArtifactError('代码工具参数不完整或包含未支持字段')
    if name=='list_code_artifacts':return {'artifacts':store.list(),'scope':'local_workstation','execution':False}
    if name=='write_code_artifact':
        identity=args.get('id');body={key:value for key,value in args.items() if key!='id'}
        if identity is not None and 'input_csv' not in body:body['input_csv']=store.read(identity).get('input_csv','')
        value=store.save(body,id=identity)
        return {**metadata(value),'executed':False,'note':'代码文档已保存；未启动Python或MATLAB，代码与CSV更改已清空旧结果。'}
    value=store.read(args['id']);meta=metadata(value)
    if name=='read_code_artifact':
        field=args.get('field','code')
        if field not in ('code','input_csv'):raise ArtifactError('请选择code或input_csv')
        return {**meta,'field':field,**text_page(value.get(field,''),args),'executed':False,'note':'这是保存的代码文档，不是执行回执；按next_offset继续读取。'}
    result=value.get('result');local_run=value.get('last_local_run')
    if not result:return {**meta,'result':None,'last_local_run':local_run,'executed':bool(local_run),'note':'没有浏览器回传结果。本地运行如有记录，按last_local_run的任务ID读取真实任务日志与文件；记录不等于物理精度认证。'}
    field=args.get('field','stdout')
    if field not in ('stdout','stderr','file'):raise ArtifactError('请选择stdout、stderr或file')
    artifacts=[artifact_metadata(item) for item in result.get('artifacts',[])]
    base={**meta,**{key:result.get(key) for key in ('source_revision','status','runtime','seconds','provenance')},'server_verified':False,'last_local_run':local_run,'artifacts':artifacts,'field':field}
    if field=='file':
        file=next((item for item in result.get('artifacts',[]) if item['name']==args.get('name')),None)
        if file is None:raise ArtifactError('输出文件不存在',404)
        if file['mime']=='image/png':return {**base,'note':'PNG只提供文件索引，请在代码工作区查看图像；没有把图片编码作为模型文字上下文。'}
        content=file.get('text','')
    else:content=result.get(field,'')
    return {**base,**text_page(content,args),'note':'浏览器执行回传，服务端未重新执行；不能据此自动认证科学结论。'}
