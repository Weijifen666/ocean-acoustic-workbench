"""Natural-language simulation tools sharing the workbench runtime and job store."""
import asyncio, json, math, re, time, uuid
from pathlib import Path
import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
import acoustic_cookbook, code_sandbox, code_artifacts, models, ray_tracer
import provider_history, context_budget, research_context

def detect_matlab():
    cfg = config()
    candidates_m = [
        cfg.get('matlab_path', ''),
        r"D:\Program Files\MATLAB\R2024b\bin\matlab.exe",
        r"D:\Program Files\MATLAB\R2024a\bin\matlab.exe",
        r"C:\Program Files\MATLAB\R2024b\bin\matlab.exe",
        r"C:\Program Files\MATLAB\R2024a\bin\matlab.exe",
        r"C:\Program Files\MATLAB\R2023b\bin\matlab.exe",
        r"C:\Program Files\MATLAB\R2023a\bin\matlab.exe",
    ]
    for d in [r"D:\Program Files\MATLAB", r"C:\Program Files\MATLAB"]:
        try:
            dp = Path(d)
            if dp.is_dir():
                for sub in dp.iterdir():
                    exe = sub / 'bin' / 'matlab.exe'
                    if exe.is_file() and str(exe) not in candidates_m:
                        candidates_m.append(str(exe))
        except Exception:
            pass

    candidates_tb = [
        cfg.get('toolbox_path', ''),
        r"D:\matlab-project&tool\at-matlab\at",
        r"C:\at",
        r"D:\at",
        str(ROOT.parent / "at"),
        str(ROOT / "at"),
    ]

    detected_matlab = []
    for p in candidates_m:
        if p and Path(p).is_file() and p not in detected_matlab:
            detected_matlab.append(p)

    detected_toolbox = []
    for p in candidates_tb:
        if p and Path(p).is_dir() and p not in detected_toolbox:
            detected_toolbox.append(p)

    return {
        'detected_matlab': detected_matlab,
        'detected_toolbox': detected_toolbox,
        'current_matlab': cfg.get('matlab_path', ''),
        'current_toolbox': cfg.get('toolbox_path', '')
    }


async def check_matlab(request: Request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    cfg = config()
    m_path = data.get('matlab_path') or cfg.get('matlab_path', '')
    tb_path = data.get('toolbox_path') or cfg.get('toolbox_path', '')

    exe_p = Path(m_path) if m_path else None
    tb_p = Path(tb_path) if tb_path else None

    matlab_ok = bool(exe_p and exe_p.is_file())
    ver_match = re.search(r'R202\d[ab]', m_path, re.I) if m_path else None
    matlab_ver = ver_match.group(0).upper() if ver_match else ('可用' if matlab_ok else '未检测到')

    kraken_ok = bool(tb_p and (tb_p / 'bin' / 'kraken.exe').is_file())
    bellhop_ok = bool(tb_p and (tb_p / 'bin' / 'bellhop.exe').is_file())
    field_ok = bool(tb_p and (tb_p / 'bin' / 'field.exe').is_file())
    scooter_ok = bool(tb_p and (tb_p / 'bin' / 'scooter.exe').is_file())
    bounce_ok = bool(tb_p and (tb_p / 'bin' / 'bounce.exe').is_file())
    read_ok = bool(tb_p and (tb_p / 'ReadWrite' / 'read_modes.m').is_file())
    shd_ok = bool(tb_p and (tb_p / 'ReadWrite' / 'read_shd.m').is_file())
    env_ok = bool(tb_p and (tb_p / 'tests' / 'Munk' / 'MunkK.env').is_file())

    components = [
        {'id': 'matlab', 'name': 'MATLAB 核心引擎', 'path': m_path, 'ok': matlab_ok, 'desc': f'版本: {matlab_ver}' if matlab_ok else '可执行文件不存在'},
        {'id': 'kraken', 'name': 'KRAKEN 简正波求解器', 'path': str(tb_p / 'bin' / 'kraken.exe') if tb_p else '', 'ok': kraken_ok, 'desc': 'KRAKEN / KRAKENC 二进制求解器'},
        {'id': 'bellhop', 'name': 'BELLHOP 射线求解器', 'path': str(tb_p / 'bin' / 'bellhop.exe') if tb_p else '', 'ok': bellhop_ok, 'desc': '高斯光束与声线追踪求解器'},
        {'id': 'field', 'name': 'FIELD 场分布合成器', 'path': str(tb_p / 'bin' / 'field.exe') if tb_p else '', 'ok': field_ok, 'desc': '声压场与传播损失合成'},
        {'id': 'scooter', 'name': 'SCOOTER 快速场求解器', 'path': str(tb_p / 'bin' / 'scooter.exe') if tb_p else '', 'ok': scooter_ok, 'desc': 'FFP 快速场积分计算'},
        {'id': 'readwrite', 'name': 'AT 数据读写库', 'path': str(tb_p / 'ReadWrite') if tb_p else '', 'ok': read_ok and shd_ok, 'desc': 'read_modes.m, read_shd.m 数据读取函数'},
        {'id': 'testcases', 'name': '基准测试算例', 'path': str(tb_p / 'tests' / 'Munk') if tb_p else '', 'ok': env_ok, 'desc': 'Munk 深海 5000m 环境文件'}
    ]

    all_ok = matlab_ok and kraken_ok and field_ok and read_ok
    return {
        'ok': all_ok,
        'matlab_version': matlab_ver,
        'components': components,
        'summary': 'MATLAB 与 Acoustics Toolbox 计算环境检测全部通过，可执行全套声学仿真。' if all_ok else '部分计算组件缺失，请检查路径配置。'
    }


class Chat(BaseModel):
    model_config = {'extra': 'ignore'}
    message:str=Field(min_length=1,max_length=12000)
    mode:str='chat'
    session:str='default'
    provider:str|None=None
    model:str|None=None
    knowledge_mode:str|None=None
    context_budget:object=None


class PlanRay(BaseModel):
    water_depth_m: float = Field(default=100.0, gt=0, le=10000)
    source_depth_m: float = Field(default=50.0, gt=0, le=10000)
    angles_deg: list[float] = Field(default=[5.0, 15.0, 30.0, 45.0, 60.0])
    range_max_km: float = Field(default=5.0, gt=0.1, le=500)
    sound_speed_mps: float = Field(default=1500.0, gt=500, le=3000)
    launch_direction: str = Field(default='both')

    @model_validator(mode='after')
    def geometry(self):
        ray_tracer.validate_parameters(self.water_depth_m, self.source_depth_m,
            self.angles_deg, self.range_max_km, self.sound_speed_mps, self.launch_direction)
        return self


def execute_ray_job(params: dict) -> dict:
    params = PlanRay(**params).model_dump()
    id = uuid.uuid4().hex[:12]
    folder = run_dir(id)
    folder.mkdir(parents=True, exist_ok=True)
    plan_meta = {
        'task_type': 'shallow_water_ray_tracing',
        'water_depth_m': float(params.get('water_depth_m', 100.0)),
        'source_depth_m': float(params.get('source_depth_m', 50.0)),
        'range_max_km': float(params.get('range_max_km', 5.0)),
        'angles_deg': [float(a) for a in params.get('angles_deg', [5.0, 15.0, 30.0, 45.0, 60.0])],
        'sound_speed_mps': float(params.get('sound_speed_mps', 1500.0)),
        'launch_direction': str(params.get('launch_direction', 'both'))
    }
    with connect() as c:
        c.execute('INSERT INTO jobs(id,state,created,updated,plan,error) VALUES(?,?,?,?,?,NULL)', (id, 'RUNNING', stamp(), stamp(), json.dumps(plan_meta, ensure_ascii=False)))
    log_file = folder / 'run.log'
    log_file.write_text(f"任务 {id}\n浅海射线声学仿真计算\n参数: {json.dumps(plan_meta, ensure_ascii=False)}\n", encoding='utf-8')
    try:
        res = ray_tracer.run_ray_tracing_job(
            water_depth_m=plan_meta['water_depth_m'],
            source_depth_m=plan_meta['source_depth_m'],
            angles_deg=plan_meta['angles_deg'],
            range_max_km=plan_meta['range_max_km'],
            sound_speed_mps=plan_meta['sound_speed_mps'],
            launch_direction=plan_meta['launch_direction'],
            output_dir=folder
        )
        update(id, 'SUCCEEDED')
        return {
            'status': 'success',
            'job_id': id,
            'state': 'SUCCEEDED',
            'plan': plan_meta,
            'summary': json.loads((folder / 'summary.json').read_text(encoding='utf-8')),
            'ray_plot_url': f"/api/jobs/{id}/artifact/ray_trajectories.png",
            'download_url': f"/api/jobs/{id}/download",
            'csv_url': f"/api/jobs/{id}/artifact/reflection_stats.csv"
        }
    except Exception as e:
        update(id, 'FAILED', str(e))
        return {'status': 'error', 'job_id': id, 'state': 'FAILED', 'error': str(e)}


def execute_code_job(code: str, description: str = "动态声学仿真计算", language: str = "python", *, input_csv='', code_artifact=None) -> dict:
    return code_sandbox.run_code_sandbox(
        code=code,
        language=language,
        description=description,
        db_path=DB,
        runs_dir=LOCAL / 'runs',
        input_csv=input_csv,
        code_artifact=code_artifact,
        process_context={'registry':PROCESSES,'lock':STATELOCK,'owner':WORKER_OWNER}
    )


def submit_ray(plan: PlanRay):
    return execute_ray_job(plan.model_dump())


async def submit_code(request: Request):
    data = await request.json()
    if not isinstance(data, dict):raise HTTPException(422, '脚本请求须为 JSON 对象')
    code = data.get('code', '')
    desc = data.get('description', '动态声学仿真计算')
    lang = data.get('language', 'python')
    if not isinstance(code,str) or not code.strip(): raise HTTPException(422, '代码须为非空文本')
    if not isinstance(desc,str) or not isinstance(lang,str):raise HTTPException(422, '脚本说明和语言须为文本')
    try:return await asyncio.to_thread(execute_code_job, code, desc, lang, input_csv=data.get('input_csv', ''))
    except ValueError as exc:raise HTTPException(422,str(exc)) from None


async def run_code_artifact(identity: str, request: Request):
    """Execute only an explicitly selected, saved source revision on this PC.

    This route is registered on the local app, never the public gateway. The
    local Host/Origin middleware remains the execution permission boundary.
    """
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 150000:
            raise HTTPException(413, '运行请求过大；请先保存代码与CSV')
    try:
        body = json.loads(raw)
        if not isinstance(body, dict):
            raise ValueError()
    except (ValueError, UnicodeError):
        raise HTTPException(422, '运行请求须为JSON对象') from None
    repository = code_artifacts.Store(connect)
    try:
        record = repository.read(identity)
    except code_artifacts.ArtifactError as error:
        raise HTTPException(error.status, str(error)) from None
    if type(body.get('expected_revision')) is not int or body['expected_revision'] != record['revision']:
        raise HTTPException(409, '代码已更新；请重新载入并明确选择当前版本后再运行')
    if 'input_csv' in body and body['input_csv'] != record['input_csv']:
        raise HTTPException(409, '运行CSV与已保存版本不一致；请先保存，再运行')
    binding = {'id': identity, 'source_revision': record['revision'],
               'code_sha256': record['code_sha256'], 'input_sha256': record['input_sha256']}
    try:
        result = await asyncio.to_thread(execute_code_job, record['code'], record['title'], record['language'],
                                         input_csv=record['input_csv'], code_artifact=binding)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    response = {**result, 'code_artifact': binding, 'execution_location': 'local',
                'provenance': 'local_process_record', 'physical_accuracy': 'not_established'}
    try:
        response['artifact'] = repository.record_local_run(identity, record['revision'], result['job_id'])
        response['artifact_linked'] = True
    except code_artifacts.ArtifactError as error:
        # The process result remains inspectable even if another editor changed
        # or removed the source while it was running. Never label it as current.
        response.update(artifact_linked=False, artifact_link_error=str(error))
    return response


_NL_NUMBER = r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?'
_NL_FIELDS = {
    'frequency': r'(?:声源)?频率(?:组合)?|frequenc(?:y|ies)',
    'source': r'声源深(?:度)?|源深(?:度)?|发射深度|声源(?!频率)|z_?s\b',
    'receiver': r'接收器深度|接收点深度|接收深(?:度)?|接收',
    'water': r'水深|海底深度|海底\s*z\b',
    'range': r'最大距离|传播距离|距离(?:范围)?|范围|(?<![a-z0-9_])r\s*=',
    'speed': r'(?<!等)声速(?:\s*c)?|(?<![a-z0-9_])c\s*=',
    'angles': r'掠射角|发射角',
    'range_points': r'距离(?:采样)?点数|距离网格点|range_points',
    'depth_points': r'深度(?:采样)?点数|深度网格点|depth_points',
}


def _natural_segments(text):
    # Longer control labels precede "距离"/"深度", so grid counts cannot become
    # an extra physical quantity. All explicit labeled values are validated.
    order = ['range_points', 'depth_points', 'frequency', 'receiver', 'source', 'water', 'range', 'speed', 'angles']
    pattern = '|'.join('(?P<' + key + '>' + _NL_FIELDS[key] + ')' for key in order)
    found = list(re.finditer(pattern, text, re.I))
    segments = {}
    for index, match in enumerate(found):
        fragment = text[match.end():found[index + 1].start() if index + 1 < len(found) else len(text)]
        fragment = re.split(r'[;；。\n]', fragment, maxsplit=1)[0]
        fragment = re.sub(r'^\s*(?:(?:设为|设置为|位于|为|是|在|取)\s*|[:：=]\s*)', '', fragment).strip()
        segments.setdefault(match.lastgroup, []).append(fragment)
    return segments


def _natural_quantities(fragments, kind, label):
    units = {
        'length': r'千米|公里|厘米|毫米|米|km|cm|mm|m',
        'frequency': r'千赫兹|千赫|赫兹|kHz|Hz',
        'speed': r'米\s*/\s*秒|米每秒|m\s*/\s*s',
        'angles': r'°|度',
        'count': r'点|points?',
    }[kind]
    values = []
    for fragment in fragments:
        if not re.match(_NL_NUMBER, fragment, re.I):
            raise ValueError(label + '没有明确数值，未使用默认值替代')
        if label in ('频率', '源深', '掠射角') and re.search(r'\d\s*(?:Hz|kHz|m|米|度)?\s*[-–—~～至到]\s*\d', fragment, re.I):
            raise ValueError(label + '范围未给明确步长，请用逗号列出离散值')
        # A minus between positive endpoints denotes an interval, not a
        # negative second endpoint. A leading negative remains negative.
        fragment = re.sub(r'(?<=[\d米m])\s*[-–—~～至到]\s*(?=\d)', ' ', fragment)
        found = list(re.finditer('(' + _NL_NUMBER + r')\s*(' + units + ')?', fragment, re.I))
        if not found or len(found) > 64:
            raise ValueError(label + '数值格式无效')
        explicit_units = [match.group(2) for match in found if match.group(2)]
        if kind != 'count' and not explicit_units:
            raise ValueError(label + '缺少或不支持单位，请明确使用米/千米、Hz/kHz或度；未猜测参数')
        for match in found:
            suffix = fragment[match.end():].lstrip()
            if (not match.group(2) and re.match(r'[A-Za-z]|千米|公里|厘米|毫米|米|千赫|赫兹|度', suffix)) or (kind == 'length' and re.match(r'/|每秒', suffix)):
                raise ValueError(label + '含不支持的单位，未忽略或替换')
            unit = (match.group(2) or (explicit_units[-1] if explicit_units else '')).lower()
            value = float(match.group(1))
            scale = 1000 if unit in ('km', '千米', '公里', 'khz', '千赫', '千赫兹') else .01 if unit in ('cm', '厘米') else .001 if unit in ('mm', '毫米') else 1
            value *= scale
            if not math.isfinite(value):
                raise ValueError(label + '须为有限数值')
            values.append(value)
    return values


def parse_simulation_intent(text: str) -> dict | None:
    text_lower = text.lower().strip()
    if not any(word in text_lower for word in ['仿真', '模拟', '计算', '运行', '跑', '画', '绘制', '追踪']):
        return None
    # Polite questions remain questions; "请" is not an execution permission.
    if re.match(r'^(?:请问|请教|想问|问一下|能否|能不能|是否|如何|怎么|怎样|什么是|为什么|请(?:解释|说明|介绍))', text_lower):
        return None
    direct = re.search(r'(?:帮我|请|直接|立即|现在|开始)\s*(?:仿真|模拟|计算|运行|绘制|追踪|画|跑)', text_lower)
    if any(word in text_lower for word in ['如何', '怎么', '怎样', '什么是', '为什么', '了解']) and not direct:
        return None
    if re.search(r'(?:不要|别|不必|无需|不用|仅|只)\s*(?:实际)?(?:运行|执行|仿真|模拟|计算)', text_lower):
        return None
    def reject(reason):
        return {'type': 'unsupported', 'reason': reason + '；未启动计算，也未使用默认参数或其他环境替代。'}
    if re.search(r'(?<![a-z0-9_])(?:bellhop(?:3d)?|scooter|ram|simplepe|krakenc|krakel|sparc)(?![a-z0-9_])|抛物方程', text_lower):
        return reject('离线规则解析不能执行指定求解器，请到声场仿真选择对应模型，或配置研究Agent。未将它替换为解析射线或KRAKEN')
    is_ray = any(word in text_lower for word in ['射线', '声线', '掠射角', '反射次数', '海面反射', '海底反射', '轨迹'])
    if is_ray and re.search(r'梯度|munk|折射|声道|kraken|传播损失|声压|振幅|吸收|底质|弹性', text_lower):
        return reject('离线解析射线仅支持等声速平底水层的路径几何，不能用直线反射代替梯度折射、Munk、KRAKEN或声场幅度计算')
    if not is_ray and re.search(r'浅海|pekeris|等声速|自定义|实时|真实海域|南海|东海|黄海|渤海|地中海|印度洋|大西洋|太平洋', text_lower):
        return reject('离线声场入口仅支持Munk 5000m理想深海模板，当前不能忠实执行所述环境；请使用声场表单或研究Agent')

    try:
        fields = _natural_segments(text)
        def numbers(key, kind, label, default):
            return _natural_quantities(fields[key], kind, label) if key in fields else list(default)
        def scalar(key, kind, label, default):
            values = numbers(key, kind, label, [default])
            if len(values) != 1:
                raise ValueError(label + '须明确提供一个值')
            return values[0]
        if is_ray:
            water = scalar('water', 'length', '水深', 100)
            source = scalar('source', 'length', '源深', 50)
            speed = scalar('speed', 'speed', '声速', 1500)
            ranges = numbers('range', 'length', '传播距离', [5000])
            if len(ranges) == 2 and ranges[0] == 0:
                ranges = ranges[1:]
            if len(ranges) != 1:
                raise ValueError('解析射线从0距离起算，请只提供终点或0到终点')
            angle_fragments = fields.get('angles')
            if angle_fragments:
                angles = _natural_quantities(angle_fragments, 'angles', '掠射角')
            else:
                angle_fragments = [match.group(0) for match in re.finditer(_NL_NUMBER + r'\s*(?:°|度)', text)]
                angles = _natural_quantities(angle_fragments, 'angles', '掠射角') if angle_fragments else [5, 15, 30, 45, 60]
            if any(key in fields for key in ['frequency', 'receiver', 'range_points', 'depth_points']):
                raise ValueError('解析路径几何不计算频率相关声场、接收深度或网格，请使用相应声场求解器')
            direction = 'up' if '向上' in text and '向下' not in text else 'down' if '向下' in text and '向上' not in text else 'both'
            return {'type': 'ray', **PlanRay(water_depth_m=water, source_depth_m=source, sound_speed_mps=speed,
                range_max_km=ranges[0] / 1000, angles_deg=sorted(set(angles)), launch_direction=direction).model_dump()}

        if 'water' in fields and scalar('water', 'length', '水深', 5000) != 5000:
            raise ValueError('Munk模板水深固定为5000m，不能替换所请求的其他水深')
        if 'speed' in fields or 'angles' in fields:
            raise ValueError('该入口不能修改Munk剖面声速或发射角，请使用对应声场表单')
        freqs = numbers('frequency', 'frequency', '频率', [])
        if not freqs:
            fragments = [match.group(0) for match in re.finditer(_NL_NUMBER + r'\s*(?:千赫兹|千赫|赫兹|兆赫|吉赫|[a-z]*hz)', text, re.I)]
            freqs = _natural_quantities(fragments, 'frequency', '频率') if fragments else [50]
        sources = numbers('source', 'length', '源深', [1000])
        receiver = scalar('receiver', 'length', '接收深度', 1000)
        ranges = numbers('range', 'length', '传播距离', [1000, 50000])
        if len(ranges) == 1:
            ranges = [1000, ranges[0]]
        if len(ranges) != 2:
            raise ValueError('距离须提供终点或起点与终点')
        if any(not 10 <= value <= 200 for value in freqs):
            raise ValueError('频率须在10–200Hz内，超范围值不会被替换为50Hz')
        if len(set(freqs)) > 4 or len(set(sources)) > 3:
            raise ValueError('最多4个频率、3个源深')
        if any(not 0 < value < 5000 for value in sources) or not 0 < receiver < 5000:
            raise ValueError('Munk源深和接收深度须在0到5000m之间')
        if not .1 <= ranges[0] / 1000 < ranges[1] / 1000 <= 100:
            raise ValueError('距离须满足0.1km≤起点<终点≤100km')
        counts = {}
        for field, label, default in [('range_points', '距离点数', 201), ('depth_points', '深度点数', 251)]:
            value = scalar(field, 'count', label, default)
            if value != int(value) or not 51 <= value <= 501:
                raise ValueError(label + '须为51–501的整数')
            counts[field] = int(value)
        return {'type': 'kraken', 'frequencies_hz': sorted(set(freqs)), 'source_depths_m': sorted(set(sources)),
            'receiver_depth_m': receiver, 'range_min_km': ranges[0] / 1000, 'range_max_km': ranges[1] / 1000,
            **counts, 'template': 'munk_5000m'}
    except (ValueError, TypeError) as error:
        return reject('参数未通过离线解析：' + str(error))


async def wait_for_simulation_jobs(job_ids, timeout=150):
    """Read real states; waiting expiration does not mean solver failure."""
    deadline = time.monotonic() + max(0, timeout)
    results = []
    for jid in job_ids:
        while True:
            info = job(jid)
            if info['state'] not in ('QUEUED', 'RUNNING') or time.monotonic() >= deadline:
                break
            await asyncio.sleep(min(1, max(0, deadline - time.monotonic())))
        item = {'job_id': jid, 'state': info['state'], 'plan': info['plan'], 'error': info.get('error')}
        if info['state'] == 'SUCCEEDED':
            folder = run_dir(jid)
            required = ['summary.json', 'result.json', 'tl_map.png', 'tl_curve.png']
            missing = [name for name in required if not (folder / name).is_file() or not (folder / name).stat().st_size]
            try:
                if missing:
                    raise ValueError('缺少本次产物：' + ', '.join(missing))
                summary = json.loads((folder / 'summary.json').read_text(encoding='utf-8-sig'))
                if not isinstance(summary, dict):
                    raise ValueError('summary.json不是结果对象')
                for name in ['tl_map.png', 'tl_curve.png']:
                    with (folder / name).open('rb') as stream:
                        if stream.read(8) != b'\x89PNG\r\n\x1a\n':
                            raise ValueError(name + '不是PNG')
                item.update(summary=summary, tl_map_url=f'/api/jobs/{jid}/artifact/tl_map.png',
                            tl_curve_url=f'/api/jobs/{jid}/artifact/tl_curve.png',
                            download_url=f'/api/jobs/{jid}/download')
            except (ValueError, OSError, UnicodeError) as error:
                item['output_error'] = str(error)
        results.append(item)
    if results and all(item['state'] == 'SUCCEEDED' and not item.get('output_error') for item in results):
        return {'status': 'success', 'state': 'SUCCEEDED', 'results': results}
    failed = [item for item in results if item['state'] not in ('SUCCEEDED', 'QUEUED', 'RUNNING') or item.get('output_error')]
    if failed:
        return {'status': 'error', 'state': 'FAILED', 'error': '部分任务失败、取消、中断或缺少有效产物；以每个任务记录为准。', 'results': results}
    return {'status': 'pending', 'state': 'RUNNING', 'message': '任务仍在排队或运行；本次等待已结束，未报告计算成功，也未重复提交。', 'results': results}


async def execute_simulation_and_wait(plan_data: dict, timeout: int = 150) -> dict:
    try:
        if not isinstance(plan_data, dict) or set(plan_data) - set(Plan.model_fields) - {'type'}:
            raise ValueError('仅接受已登记的Munk参数，未忽略未知字段')
        if plan_data.get('type', 'kraken') != 'kraken':
            raise ValueError('此入口仅执行Munk KRAKEN')
        p = Plan(**{key: value for key, value in plan_data.items() if key != 'type'})
        p.checked()
        sub = submit(p, Request({'type': 'http', 'headers': []}))
    except Exception as error:
        return {'status': 'error', 'error': '参数校验或任务提交失败：' + str(error), 'results': []}
    ids = sub.get('ids', [])
    if not ids:
        return {'status': 'error', 'error': '任务提交失败，未生成任务标识', 'results': []}
    return await wait_for_simulation_jobs(ids, timeout)


def simulation_succeeded(value):
    """A status word alone cannot establish completion of an inner task."""
    if not isinstance(value, dict) or value.get('error') or value.get('status') not in (None, 'success', 'succeeded'):
        return False
    if 'results' in value:
        rows = value['results']
        return bool(rows) and all(isinstance(row, dict) and row.get('state') == 'SUCCEEDED' and not row.get('error') and not row.get('output_error') for row in rows)
    return value.get('state') == 'SUCCEEDED'


def format_ocean_simulation_reply(intent, result):
    def number(value, digits=2):
        return f'{value:.{digits}f}' if isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) else '未提供'
    headline = '仿真已完成，实际产物已核对' if simulation_succeeded(result) else '仿真仍在排队或运行，尚未完成' if result.get('status') == 'pending' else '仿真未全部成功'
    lines = ['### ' + headline,
        '- 模型：KRAKEN，Munk 5000m理想深海模板；不是指定真实海域。',
        '- 频率：' + ', '.join(f'{value:g} Hz' for value in intent['frequencies_hz']),
        '- 源深：' + ', '.join(f'{value:g} m' for value in intent['source_depths_m']),
        f"- 接收深度：{intent['receiver_depth_m']:g} m；距离：{intent['range_min_km']:g}–{intent['range_max_km']:g} km。",
        '- 未说明的参数使用上述课程示例默认值；它们不代表原题已提供所有物理条件。']
    if result.get('error'):
        lines.append(result['error'])
    for row in result.get('results', []):
        jid, state = row['job_id'], row['state']
        lines += ['', f'#### 任务 {jid} · {state}']
        if state in ('QUEUED', 'RUNNING'):
            lines.append('任务尚未完成。可在“任务与结果”继续查看；本次等待结束不等于计算失败。')
        elif row.get('output_error'):
            lines.append('任务虽标记完成，但产物核对未通过：' + row['output_error'])
        elif state != 'SUCCEEDED':
            lines.append('任务未成功：' + str(row.get('error') or state))
        else:
            summary = row['summary']
            lines += [
                '- 实际接收深度：' + number(summary.get('actual_receiver_depth_m')) + ' m。',
                '- 中位/最小/最大传播损失：' + ' / '.join(number(summary.get(key)) for key in ['tl_median_db', 'tl_min_db', 'tl_max_db']) + ' dB。',
                '- 有效网格比例：' + (number(summary['valid_ratio'] * 100) + '%' if isinstance(summary.get('valid_ratio'), (float, int)) else '未提供') + '。',
                f"![传播损失声场图]({row['tl_map_url']})",
                f"![接收深度传播损失曲线]({row['tl_curve_url']})",
                f"[下载本次实际结果包]({row['download_url']})"]
    lines += ['', '执行成功与彩图不证明收敛或物理精度；未做独立基准和真实海域验证，不从模板名称或曲线起伏推断未经计算的机理。']
    return '\n\n'.join(lines)


async def chat(body:Chat):
    cfg=config();evidence=search(body.message)
    with connect() as c:user_message_id=c.execute('INSERT INTO messages(session,role,text,created) VALUES(?,?,?,?)',(body.session,'user',body.message,stamp())).lastrowid
    provider_turn=None

    sim_intent = parse_simulation_intent(body.message)
    # 模式一：离线自然语言仿真（当未配置 API Key 时，基于声学意图规则解析器自动提取参数并执行仿真）
    if not cfg.get('api_key') and sim_intent:
        if sim_intent.get('type')=='unsupported':
            reply=sim_intent['reason']
            with connect() as c:c.execute('INSERT INTO messages(session,role,text,created) VALUES(?,?,?,?)',(body.session,'assistant',reply,stamp()))
            return {'reply':reply,'model_used':False,'evidence_ids':[]}
        if sim_intent.get('type') == 'ray':
            try:ray_res = execute_ray_job(sim_intent)
            except ValueError as exc:ray_res={'status':'error','error':str(exc)}
            if ray_res.get('status') == 'success':
                jid = ray_res['job_id']
                summ = ray_res['summary']
                results = summ.get('results', {})
                up_rays = results.get('up', [])
                down_rays = results.get('down', [])

                angles = sim_intent['angles_deg']
                H = sim_intent['water_depth_m']
                zs = sim_intent['source_depth_m']
                c = sim_intent['sound_speed_mps']
                rmax = sim_intent['range_max_km']

                lines = [
                    "### 🌊 浅海射线声学仿真已自动解析并执行完成",
                    "**任务拆解与工况参数**：",
                    f"- **海水环境**：等声速水体 $c = {c:g} \\text{{ m/s}}$，水深 $H = {H:g} \\text{{ m}}$（海面 $z=0\\text{{ m}}$，海底 $z={H:g}\\text{{ m}}$）",
                    f"- **声源参数**：深度 $z_s = {zs:g} \\text{{ m}}$，发射掠射角：{', '.join(f'{a:g}°' for a in angles)}",
                    f"- **水平范围**：$r = 0 \\sim {rmax:g} \\text{{ km}}$（{rmax*1000:g} m）",
                    "- **仿真引擎**：等声速平底水层解析几何射线；未运行 BELLHOP，未计算振幅或传播损失。",
                    "",
                    f"#### 📊 声线反射统计与到达特征分析表（$r = {rmax:g}\\text{{ km}}$，任务标识: `{jid}`）",
                    "| 掠射角 $\\theta$ | $\\tan\\theta$ | 总反射次数 | 向上发射 (海面/海底) | 向下发射 (海面/海底) | 末次反射位置 | 距终点余量 | 终点深度 $z$ |",
                    "| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |"
                ]

                for idx, ang in enumerate(angles):
                    u = up_rays[idx] if idx < len(up_rays) else {}
                    d = down_rays[idx] if idx < len(down_rays) else {}
                    tan_th = math.tan(math.radians(ang))
                    tot = u.get('total_bounces', 0)
                    u_sb = f"{u.get('surface_bounces',0)} / {u.get('bottom_bounces',0)}"
                    d_sb = f"{d.get('surface_bounces',0)} / {d.get('bottom_bounces',0)}"
                    last_r = f"{u['last_bounce_r_m']:.1f} m" if u.get('last_bounce_r_m') is not None else '无反射'
                    margin = f"{u['margin_to_rmax_m']:.1f} m" if u.get('margin_to_rmax_m') is not None else '不适用'
                    end_z = f"上{u.get('end_depth_m',0):.1f}m / 下{d.get('end_depth_m',0):.1f}m"
                    lines.append(f"| **{ang:g}°** | {tan_th:.5f} | **{tot} 次** | {u_sb} | {d_sb} | {last_r} | {margin} | {end_z} |")

                lines.extend([
                    "",
                    f"![浅海声线传播轨迹]({ray_res['ray_plot_url']})",
                    "",
                    "💡 **物理机理与特性分析**：",
                    ('1. **几何对称性**：本次声源位于水层中点，向上与向下射线具有中心对称关系。' if abs(zs-H/2)<1e-9 else '1. **非居中声源**：本次声源不在水层中点，不套用上下发射反射次数相同的结论；以实际统计表为准。'),
                    "2. **等声速折射与反射**：等声速介质中折射率恒定，声线严格沿直线传播。海面为自由释放面（声软边界，$V=-1$，反射相位跳变 $\\pi$）；海底为理想镜面全反射，每次反射的掠射角守恒。",
                    "3. **端点约定**：恰在最大距离处触及边界不计作终点前反射；末次反射与余量使用本次计算值，没有反射时标为不适用。",
                    "4. **适用范围**：这是理想镜面反射的路径几何，不包含海底吸收、弹性、声速梯度或幅度计算，不能据此判断实际声能衰减。",
                    "",
                    f"[📥 下载本次完整仿真结果包 (含高分辨率图、CSV与JSON数据)]({ray_res['download_url']})",
                    ""
                ])
                reply = '\n'.join(lines)
                with connect() as c:c.execute('INSERT INTO messages(session,role,text,created) VALUES(?,?,?,?)',(body.session,'assistant',reply,stamp()))
                return {'reply':reply,'model_used':False,'evidence_ids':[e['id'] for e in evidence]}
            else:
                reply = f"❌ 射线仿真执行失败: {ray_res.get('error')}"
                with connect() as c:c.execute('INSERT INTO messages(session,role,text,created) VALUES(?,?,?,?)',(body.session,'assistant',reply,stamp()))
                return {'reply':reply,'model_used':False,'evidence_ids':[]}

        elif sim_intent.get('type') == 'kraken':
            sim_res = await execute_simulation_and_wait(sim_intent)
            reply = format_ocean_simulation_reply(sim_intent, sim_res)
            with connect() as c:
                c.execute('INSERT INTO messages(session,role,text,created) VALUES(?,?,?,?)', (body.session,'assistant',reply,stamp()))
            return {'reply':reply,'model_used':False,'evidence_ids':[e['id'] for e in evidence],
                    'execution_status':sim_res['status'],'results':sim_res.get('results',[])}

    # 模式二：未配置 API Key 且非仿真指令，回退到知识卡检索
    if not cfg.get('api_key'):
        reply=('尚未配置模型 API Key。以下为课程知识卡检索，未调用大模型：\n\n'+'\n\n'.join(f"[{c['id']}] {c['text']}"+(f"\n公式：{c['formula']}" if c['formula'] else '')+f"\n适用条件：{c['conditions']}\n来源：{c['source_id']} "+(f"PDF 第 {c['pdf_page']} 页" if c.get('pdf_page') else c.get('locator','')) for c in evidence)) if evidence else '尚未配置模型 API Key，当前知识库没有找到匹配条目。请尝试声速剖面、源深、模态、传播损失等具体术语，或直接输入例如：“帮我仿真 50Hz 声源 1000m 的声场传播” 或 “用射线声学仿真浅海中的声线传播”。'
        if body.mode=='agent':reply='Agent 模式已接入任务编排与项目读取工具。直接输入仿真需求可自动执行仿真并分析。\n\n'+reply
        used=False
    else:
        tb_path = cfg.get('toolbox_path', r"D:\matlab-project&tool\at-matlab\at")

        # 方案 A: 动态基准 Cookbook 匹配
        exemplar = acoustic_cookbook.match_cookbook_exemplar(body.message)
        cookbook_inject = ""
        if exemplar:
            cookbook_inject = f"\n\n【针对本次任务的官方 Acoustics Toolbox 基准规范与物理典范 ({exemplar['title']})】：\n"
            cookbook_inject += exemplar.get('physics_summary', '') + "\n"
            if exemplar.get('matlab_bellhop_code'):
                cookbook_inject += f"【官方 BELLHOP 规范参考代码】：\n```matlab\n{exemplar['matlab_bellhop_code']}\n```\n"
            if exemplar.get('matlab_kraken_code'):
                cookbook_inject += f"【官方 KRAKEN 规范参考代码】：\n```matlab\n{exemplar['matlab_kraken_code']}\n```\n"

        # 方案 B: 四阶段重构思维链 (CoT) 协议
        sys_prompt = (
            "你是现代海洋声学顶尖智能体学者与仿真专家。依据所附知识库、图谱关系以及官方 Acoustics Toolbox (AT) 规范，严格遵循四阶段思维链 (CoT) 协议解答并执行仿真：\n\n"
            "【阶段一：波导拓扑分类与边界条件形式化】：\n"
            "- 准确识别波导几何与剖面特征（如表面声道正梯度混合层、浅海等速 Pekeris 波导、深海 Munk 声道轴）。\n"
            "- 严格形式化上/下界面声学边界（海面压力释放 Dirichlet 边界 V=-1；海底声学半空间连续性条件及临界掠射角）。\n\n"
            "【阶段二：算法与求解器选型准则】：\n"
            "- 声线轨迹追踪、射线路径、表面声道捕获与泄漏：首选 BELLHOP（生成规范 .env，以 'R' 模式运行 bellhop.exe 生成 .ray 文件，并用 plotray 绘图）。\n"
            "- 浅海简正波离散模态、本征深度函数、相速度、水平波数与截止频率：首选 KRAKEN（生成标准 .env，运行 kraken.exe 生成 .mod，用 read_modes 读取分析）。\n"
            "- 全场声传播损失 (TL) 与声强云图：首选 KRAKEN + field.exe 或 BELLHOP 'C' 模式，使用 plotshd 并反转色标 (caxisrev)。\n\n"
            "【阶段三：极速执行与出版级绘图要求】：\n"
            f"- Acoustics Toolbox 根目录已就绪: {tb_path}，已注入变量 tb 与环境变量 AT_PATH。严禁全盘搜索！\n"
            "- 执行前核对用户的求解器、环境、数值与单位；缺少关键条件先询问，不能为追求首轮执行而猜测或替换。工具返回 pending/FAILED/CANCELLED/INTERRUPTED 时不得声称完成，须给出任务ID与实际状态。\n"
            "- 绘图要求：必须绘制具有科研出版物质量的双栏或多子图图表，包含专业坐标轴单位、网格、边界界面标记线、声源位置、图例及关键物理注释，使用 saveas(gcf, 'xxx.png') 保存。\n\n"
            "【阶段四：严谨理论归因与数学公式解析】：\n"
            "- 仿真完成后，必须在最终回复中结合波动理论给出深入、严谨的物理机制分析，绝不可只发图不解释！\n"
            "- 必须列出核心公式（如 Snell 临界角公式、波动方程特征色散方程、模态截止频率公式），并与仿真结果精确数值对齐！\n"
            + cookbook_inject + "\n"
            + "【相关知识库卡片】：\n"
            + json.dumps(evidence, ensure_ascii=False)
        )
        private_history=provider_history.load(connect,body.session,cfg,before_id=user_message_id)
        # Natural-language mode previously had no explicit token budget control.
        # Preserve that behavior; private history is represented by whole turns.
        msgs=context_budget.build_context(question=body.message,system=sys_prompt,history=private_history,context_budget='unlimited')['messages']
        protocol_start=len(msgs)-1

        tools = [
            {
                'type': 'function',
                'function': {
                    'name': 'run_ray_simulation',
                    'description': '执行等声速平底水层的解析几何射线，统计理想海面与海底反射并生成轨迹图；不计算梯度折射、BELLHOP声场或传播损失。',
                    'parameters': {
                        'type': 'object',
                        'properties': {
                            'water_depth_m': {'type': 'number', 'description': '水深(m)，默认100'},
                            'source_depth_m': {'type': 'number', 'description': '声源深度(m)，默认50'},
                            'angles_deg': {'type': 'array', 'items': {'type': 'number'}, 'description': '发射掠射角列表(度)，如[5, 15, 30, 45, 60]'},
                            'range_max_km': {'type': 'number', 'description': '最大水平距离(km)，默认5'},
                            'sound_speed_mps': {'type': 'number', 'description': '海水声速(m/s)，默认1500'},
                            'launch_direction': {'type': 'string', 'enum': ['both', 'up', 'down'], 'description': '发射方向，默认both'}
                        },
                        'required': ['angles_deg']
                    }
                }
            },
            {
                'type': 'function',
                'function': {
                    'name': 'run_acoustic_code',
                    'description': f'通用海洋声学代码沙箱。支持动态生成并执行 Python 或 MATLAB/AT 仿真代码！Acoustics Toolbox (AT) 路径已配置为: {tb_path}，已添加到 MATLAB 路径并注入变量 tb 与环境变量 AT_PATH。可以直接使用 tb 调用 kraken.exe, field.exe, bellhop.exe 等，或直接使用 read_modes, read_shd, plotray, plotmode, plotshd 等函数。严禁在代码中写全盘搜索 dir("C:\\\\**")！',
                    'parameters': {
                        'type': 'object',
                        'properties': {
                            'language': {'type': 'string', 'enum': ['python', 'matlab'], 'description': '执行语言，可选 python 或 matlab，默认 python。需要调用 AT 工具箱 (如 kraken, bellhop, read_shd) 时请选择 matlab'},
                            'code': {'type': 'string', 'description': '要执行的完整 Python 或 MATLAB 代码。如果使用 matlab，环境已配置 AT 工具箱路径，只需编写执行脚本并将图表保存为当前目录下的 *.png（例如 saveas(gcf, "output.png")）'},
                            'description': {'type': 'string', 'description': '本次计算任务的简要描述'}
                        },
                        'required': ['code', 'description']
                    }
                }
            },
            {
                'type': 'function',
                'function': {
                    'name': 'run_ocean_simulation',
                    'description': '执行理想深海 Munk 简正波声场仿真(调度本机 MATLAB KRAKEN 简正波求解器)。支持输入频率、源深、接收深度和距离，返回计算结果统计与声场图URL。',
                    'parameters': {
                        'type': 'object',
                        'properties': {
                            'frequencies_hz': {'type': 'array', 'items': {'type': 'number'}, 'description': '频率列表(Hz)，范围10-200，如[50]或[50, 100]'},
                            'source_depths_m': {'type': 'array', 'items': {'type': 'number'}, 'description': '声源深度列表(m)，范围0-5000，如[1000]或[500, 1000]'},
                            'receiver_depth_m': {'type': 'number', 'description': '接收深度(m)，默认1000'},
                            'range_min_km': {'type': 'number', 'description': '起始距离(km)，默认1'},
                            'range_max_km': {'type': 'number', 'description': '终止距离(km)，默认50'}
                        },
                        'required': ['frequencies_hz', 'source_depths_m']
                    }
                }
            },
            {'type':'function','function':{'name':'read_project_file','description':'读取已授权项目中的一个文本文件','parameters':{'type':'object','properties':{'path':{'type':'string'}},'required':['path']}}},
            {'type':'function','function':{'name':'list_project_files','description':'列出授权项目文件','parameters':{'type':'object','properties':{}}}}
        ]
        for tool in tools:
            if tool['function']['name'] in ('list_project_files','read_project_file'):
                tool['function']['parameters']['properties'].update(offset={'type':'integer'},**({'limit':{'type':'integer'}} if tool['function']['name']=='list_project_files' else {'max_bytes':{'type':'integer'}}))
        try:
            last_generated_images = []
            submitted_simulations = {}
            async with httpx.AsyncClient(timeout=180) as client:
                for turn in range(10):
                    payload=models.chat_payload(cfg,msgs,tools)
                    r=await client.post(cfg['base_url'].rstrip('/')+'/chat/completions',headers={'Authorization':'Bearer '+cfg['api_key']},json=payload)
                    if r.status_code!=200:raise RuntimeError('模型接口返回 '+str(r.status_code))
                    result=r.json()['choices'][0]['message'];calls=result.get('tool_calls')
                    if not calls:
                        reply=result.get('content') or '模型未返回文字内容'
                        msgs.append({'role':'assistant',**result})
                        provider_turn=msgs[protocol_start:]
                        break
                    msgs.append(result)
                    compute_results = []
                    for call in calls:
                        fname = call.get('function', {}).get('name', '')
                        try:
                            args=json.loads(call['function']['arguments'])
                            fname=call['function']['name']
                            print(f"[Agent Turn {turn+1}] Calling tool: {fname}")
                            if fname=='list_project_files':value=research_context.file_directory(files(),args)
                            elif fname=='read_project_file':value=research_context.file_page(read_file(args['path']),args)
                            elif fname=='run_ray_simulation':
                                value=execute_ray_job(args)
                                if simulation_succeeded(value) and value.get('ray_plot_url'):
                                    last_generated_images.append(value['ray_plot_url'])
                            elif fname=='run_acoustic_code':
                                value=await asyncio.to_thread(execute_code_job,args.get('code',''), args.get('description',''), args.get('language','python'))
                                if simulation_succeeded(value) and value.get('image_urls'):
                                    last_generated_images.extend(value['image_urls'])
                            elif fname=='run_ocean_simulation':
                                key = json.dumps(args, sort_keys=True)
                                if key in submitted_simulations:
                                    value = await wait_for_simulation_jobs(submitted_simulations[key], timeout=0)
                                    value['reused'] = True
                                else:
                                    value = await execute_simulation_and_wait(args)
                                    if value.get('results'):
                                        submitted_simulations[key] = [row['job_id'] for row in value['results']]
                                if simulation_succeeded(value):
                                    for r_sim in value.get('results', []):
                                        if r_sim.get('tl_map_url'): last_generated_images.append(r_sim['tl_map_url'])
                                        if r_sim.get('tl_curve_url'): last_generated_images.append(r_sim['tl_curve_url'])
                            else:value={'error':'不允许的工具'}
                        except Exception as e:value={'error':str(e)}
                        print(f"[Agent Turn {turn+1}] Result summary: {str(value)[:180]}")
                        msgs.append({'role':'tool','tool_call_id':call['id'],'content':json.dumps(value,ensure_ascii=False)})
                        if fname in ['run_acoustic_code', 'run_ray_simulation', 'run_ocean_simulation']:
                            compute_results.append(value)
                    if compute_results and all(simulation_succeeded(value) for value in compute_results):
                        # 仿真已成功完成并生成数据，下一轮强制关闭工具调用，令模型直接输出图表解析与总结
                        tools = None
                        img_note = "\n".join(f"- 图片地址: `{img}`" for img in last_generated_images)
                        msgs.append({
                            'role': 'user',
                            'content': (
                                "【仿真计算已成功完成并生成图表】\n"
                                f"已生成的图像资源：\n{img_note}\n\n"
                                "请根据阶段四【严谨理论归因与数学公式解析】的要求，提供完整的专业学术答复：\n"
                                "1. 深入剖析本任务的物理机制（包含波动方程/Snell定律、反转深度/临界掠射角/模态截止判据、边界条件相移、能量捕获与泄漏机理）；\n"
                                "2. 将理论解析公式与上述仿真结果进行精确量化对齐（列出关键数值对比）；\n"
                                "3. 在回复正文中规范使用 Markdown 图片语法插入生成的图片：`![图表说明](图片真实URL)`；\n"
                                "4. 严禁再次输出任何工具调用标记或重复执行脚本代码，直接输出条理清晰的学术总结！"
                            )
                        })
                else:reply='已达到工具调用轮次上限。'

            # 过滤与清理任何可能泄漏的 DSML 标签
            if '<｜｜DSML｜｜' in reply or '<|DSML|' in reply:
                reply = re.sub(r'<[|｜]{1,2}DSML[|｜]{1,2}[^>]*>', '', reply)
                reply = re.sub(r'</[|｜]{1,2}DSML[|｜]{1,2}[^>]*>', '', reply)
                reply = re.sub(r'parameter name="[^"]*"[^>]*>', '', reply)
                reply = re.sub(r'invoke name="[^"]*"[^>]*>', '', reply)

            if last_generated_images:
                for ph in ['(image_url_placeholder)', '(image_url)', '(placeholder)', '(url)']:
                    if ph in reply:
                        reply = reply.replace(ph, f"({last_generated_images[0]})")
                for img in last_generated_images:
                    if img not in reply:
                        reply += f"\n\n![声学仿真图表]({img})"
            used=True
        except Exception as exc:raise HTTPException(502,str(exc))
    with connect() as c:
        assistant_id=c.execute('INSERT INTO messages(session,role,text,created) VALUES(?,?,?,?)',(body.session,'assistant',reply,stamp())).lastrowid
        if provider_turn:provider_history.save(c,assistant_id,body.session,cfg,provider_turn)
    return {'reply':reply,'model_used':used,'evidence_ids':[e['id'] for e in evidence]}


def update(identity, state, error=None):
    with connect() as db:
        db.execute('UPDATE jobs SET state=?,updated=?,error=? WHERE id=?', (state, stamp(), error, identity))

async def simulation_chat(body: Chat):
    result = await chat(body)
    if result is None:
        reply = '尚未配置模型 API Key。请输入射线或 KRAKEN 仿真需求，或到课程问答查看知识检索结果。'
        with connect() as db:
            db.execute('INSERT INTO messages(session,role,text,created) VALUES(?,?,?,?)', (body.session,'assistant',reply,stamp()))
        return {'reply': reply, 'model_used': False, 'evidence_ids': []}
    return result

def create_router(runtime):
    for name in ('config','connect','stamp','run_dir','DB','LOCAL','ROOT','Plan','submit','job','search','history','files','read_file','PROCESSES','STATELOCK','WORKER_OWNER'):
        globals()[name] = runtime[name]
    router = APIRouter()
    router.add_api_route('/api/simulation/chat', simulation_chat, methods=['POST'])
    router.add_api_route('/api/jobs/ray', submit_ray, methods=['POST'])
    router.add_api_route('/api/jobs/code', submit_code, methods=['POST'])
    router.add_api_route('/api/research/code/artifacts/{identity}/run-local', run_code_artifact, methods=['POST'])
    router.add_api_route('/api/matlab/detect', detect_matlab, methods=['GET'])
    router.add_api_route('/api/matlab/check', check_matlab, methods=['POST'])
    return router
