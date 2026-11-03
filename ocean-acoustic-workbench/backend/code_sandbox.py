"""
Universal Acoustic Simulation Code Sandbox for Ocean Acoustic Workbench
Allows the Agent to dynamically generate and execute custom Python or MATLAB/AT acoustic simulation scripts.
"""
from __future__ import annotations
import os, sys, json, sqlite3, subprocess, uuid, time, shutil, signal
from contextlib import closing,nullcontext
from pathlib import Path
from datetime import datetime


def _runtime():
    return Path(os.environ.get('OCEAN_RUNTIME_DIR', str(Path(__file__).resolve().parents[1] / '.local')))


def _register_job(db_path, job_id, created, plan, process_context=None):
    # Registration must succeed before code starts; otherwise its real outputs
    # would be invisible in the task UI and impossible to inspect or cancel.
    try:
        with closing(sqlite3.connect(db_path, timeout=30)) as conn, conn:
            conn.execute('INSERT INTO jobs(id,state,created,updated,plan,error) VALUES(?,?,?,?,?,NULL)',
                         (job_id, 'RUNNING', created, created, json.dumps(plan, ensure_ascii=False)))
            if process_context:
                conn.execute('UPDATE jobs SET claimed_by=?,claimed_at=? WHERE id=?',
                             (process_context['owner'],created,job_id))
    except sqlite3.Error:
        raise ValueError('任务数据库不可用，尚未执行代码') from None


def _job_state(db_path, job_id):
    with closing(sqlite3.connect(db_path,timeout=30)) as db:
        row=db.execute('SELECT state FROM jobs WHERE id=?',(job_id,)).fetchone()
    if row is None:raise ValueError('任务记录已丢失，未继续执行')
    return row[0]


def _start_process(command,folder,log,db_path,job_id,process_context):
    with process_context['lock'] if process_context else nullcontext():
        # Cancellation may win after registration but before process creation.
        if _job_state(db_path,job_id)!='RUNNING':return None
        proc=subprocess.Popen(command,cwd=folder,stdout=log,stderr=subprocess.STDOUT,
            start_new_session=os.name!='nt',creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
        if process_context:
            process_context['registry'][job_id]=proc
            process_context['started'][job_id]=proc
        return proc


def _guarded_runner(runner,code,description,db_path,runs_dir,timeout,process_context,*,input_csv='',code_artifact=None):
    context={**process_context,'started':{}} if process_context else None
    try:
        valid_csv = isinstance(input_csv,str) and len(input_csv.encode('utf-8'))<=100000
    except UnicodeError:
        valid_csv = False
    if not valid_csv:
        raise ValueError('输入CSV须为100KB以内的文本，尚未执行代码')
    try:return runner(code,description,db_path,runs_dir,timeout,context,input_csv=input_csv,code_artifact=code_artifact)
    finally:
        if context:
            # Keep the guard through final artifact/state writes. A cancelled
            # task must not be deleted while its writer is still unwinding.
            with context['lock']:
                for identity,proc in context['started'].items():
                    if proc.poll() is not None and context['registry'].get(identity) is proc:
                        context['registry'].pop(identity,None)


def _wait_process(proc, timeout):
    try:
        return proc.wait(timeout=timeout), False
    except subprocess.TimeoutExpired:
        if os.name == 'nt':
            subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=subprocess.CREATE_NO_WINDOW)
        else:
            try:os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:pass
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=10)
        return -1, True

def _run_python_code(
    code: str,
    description: str = "动态声学仿真计算",
    db_path: Path | str | None = None,
    runs_dir: Path | str | None = None,
    timeout: int = 60,
    process_context=None,
    *, input_csv='', code_artifact=None
) -> dict:
    job_id = uuid.uuid4().hex[:12]
    now_str = datetime.now().astimezone().isoformat(timespec='seconds')

    if runs_dir is None:
        runs_dir = _runtime() / 'runs'
    else:
        runs_dir = Path(runs_dir)

    folder = runs_dir / job_id
    folder.mkdir(parents=True, exist_ok=True)

    script_file = folder / "run_sandbox.py"
    script_file.write_bytes(code.encode('utf-8'))
    (folder/'input.csv').write_bytes(input_csv.encode('utf-8'))
    # Keep source bytes and future imports intact. Only the trusted launcher
    # supplies the same explicit CSV names as the browser's Python environment.
    (folder/'sandbox_entry.py').write_text(
        "import runpy\nfrom pathlib import Path\n"
        "_csv = Path('input.csv').read_bytes().decode('utf-8')\n"
        "runpy.run_path('run_sandbox.py', run_name='__main__', "
        "init_globals={'input_csv': _csv, 'INPUT_CSV': _csv})\n", encoding='utf-8')

    if db_path is None:
        db_path = _runtime() / 'workbench.sqlite3'
    else:
        db_path = Path(db_path)

    plan_meta = {
        'task_type': 'custom_sandbox_code',
        'description': description,
        'script_file': 'run_sandbox.py', 'language': 'python', 'input_file': 'input.csv',
        **({'code_artifact': code_artifact} if code_artifact is not None else {})
    }

    _register_job(db_path, job_id, now_str, plan_meta,process_context)

    log_file = folder / "run.log"
    with log_file.open("wb") as log:
        log.write(f"任务 ID: {job_id}\n描述: {description}\n执行开始: {now_str}\n\n".encode("utf-8"))
        log.flush()

        try:
            proc=_start_process([sys.executable,'sandbox_entry.py'],folder,log,db_path,job_id,process_context)
        except OSError:
            state=_update_db(db_path, job_id, 'FAILED', 'Python 进程未能启动',process_context)
            return {'job_id': job_id, 'state': state, 'error': 'Python 进程未能启动', 'artifacts': []}
        if proc is None:return {'job_id':job_id,'state':_job_state(db_path,job_id),'artifacts':[],'error':'任务在进程启动前已停止'}
        ret, timed_out = _wait_process(proc, timeout)
        if timed_out:
            err_msg = f"执行超时 ({timeout} 秒)"
            state=_update_db(db_path, job_id, 'FAILED', err_msg,process_context)
            return {'job_id': job_id, 'state': state, 'error': err_msg, 'artifacts': []}

    artifacts = [p.name for p in folder.glob("*") if p.is_file() and p.name not in ["run_sandbox.py", "sandbox_entry.py", "input.csv"]]
    png_images = [p.name for p in folder.glob("*.png")]

    if ret != 0:
        err_msg = f"代码执行退出码非零 ({ret})，请查看执行日志"
        state=_update_db(db_path, job_id, 'FAILED', err_msg,process_context)
        return {
            'job_id': job_id,
            'state': state,
            'error': err_msg,
            'artifacts': artifacts,
            'log': log_file.read_text(encoding='utf-8', errors='replace')[-5000:]
        }

    # Generate summary if none exists
    summary_path = folder / "summary.json"
    if not summary_path.exists():
        summary_info = {
            'task_type': 'custom_sandbox_code',
            'description': description,
            'executed_at': now_str,
            'artifacts': artifacts,
            'images': png_images
        }
        summary_path.write_text(json.dumps(summary_info, ensure_ascii=False, indent=2), encoding='utf-8')
    else:
        try:
            summary_info = json.loads(summary_path.read_text(encoding='utf-8'))
        except Exception:
            summary_info = {}

    state=_update_db(db_path, job_id, 'SUCCEEDED', None,process_context)

    return {
        'job_id': job_id,
        'state': state,
        'artifacts': artifacts,
        'image_urls': [f"/api/jobs/{job_id}/artifact/{img}" for img in png_images],
        'download_url': f"/api/jobs/{job_id}/download",
        'summary': summary_info,
        'log': log_file.read_text(encoding='utf-8', errors='replace')[-5000:]
    }

def _run_matlab_code(
    code: str,
    description: str = "动态 MATLAB/AT 声学仿真计算",
    db_path: Path | str | None = None,
    runs_dir: Path | str | None = None,
    timeout: int = 180,
    process_context=None,
    *, input_csv='', code_artifact=None
) -> dict:
    job_id = uuid.uuid4().hex[:12]
    now_str = datetime.now().astimezone().isoformat(timespec='seconds')

    root = Path(__file__).resolve().parents[1]
    if runs_dir is None: runs_dir = _runtime() / 'runs'
    else: runs_dir = Path(runs_dir)
    folder = runs_dir / job_id
    folder.mkdir(parents=True, exist_ok=True)

    config_file = Path(os.environ.get('OCEAN_RUNTIME_DIR', str(root / '.local'))) / 'config.json'
    cfg = json.loads(config_file.read_text(encoding='utf-8')) if config_file.exists() else {}
    matlab_exe = cfg.get('matlab_path', '')
    toolbox_path = cfg.get('toolbox_path', '')
    if not Path(matlab_exe).is_file():
        raise ValueError('未找到已配置的 MATLAB 可执行文件，尚未执行代码')
    toolbox_literal = Path(toolbox_path).as_posix().replace("'", "''") if toolbox_path else ''

    header = f"""
if ~isempty('{toolbox_literal}') && isfolder('{toolbox_literal}')
    tb = '{toolbox_literal}';
    setenv('AT_PATH', tb);
    paths = {{tb, fullfile(tb,'bin'), fullfile(tb,'ReadWrite'), fullfile(tb,'Plot'), fullfile(tb,'Misc')}};
    for k = 1:numel(paths)
        if isfolder(paths{{k}}), addpath(paths{{k}}); end
    end
end
fid = fopen('input.csv', 'rb');
if fid < 0, error('Could not open explicit input.csv'); end
input_csv = native2unicode(fread(fid, Inf, '*uint8')', 'UTF-8');
fclose(fid);
INPUT_CSV = input_csv;
run('source.m');
"""
    # Local execution is trusted, not a security sandbox. Preserve the exact
    # source; rewriting clear/cd silently changes the program being verified.
    (folder/'source.m').write_bytes(code.encode('utf-8'))
    (folder/'input.csv').write_bytes(input_csv.encode('utf-8'))
    script_file = folder / "run_sandbox.m"
    script_file.write_text(header, encoding='utf-8')

    if db_path is None: db_path = _runtime() / 'workbench.sqlite3'
    else: db_path = Path(db_path)

    plan_meta = {
        'task_type': 'custom_sandbox_code',
        'description': description,
        'language': 'matlab',
        'script_file': 'source.m', 'input_file': 'input.csv',
        **({'code_artifact': code_artifact} if code_artifact is not None else {})
    }

    _register_job(db_path, job_id, now_str, plan_meta,process_context)

    log_file = folder / "run.log"
    with log_file.open("wb") as log:
        log.write(f"任务 ID: {job_id}\n描述: {description}\n执行引擎: 已配置 MATLAB + Acoustics Toolbox\n开始时间: {now_str}\n\n".encode("utf-8"))
        log.flush()

        try:
            proc=_start_process([matlab_exe,'-wait','-noFigureWindows','-batch','run_sandbox'],folder,log,db_path,job_id,process_context)
        except OSError:
            state=_update_db(db_path, job_id, 'FAILED', 'MATLAB 进程未能启动',process_context)
            return {'job_id': job_id, 'state': state, 'error': 'MATLAB 进程未能启动', 'artifacts': []}
        if proc is None:return {'job_id':job_id,'state':_job_state(db_path,job_id),'artifacts':[],'error':'任务在进程启动前已停止'}
        ret, timed_out = _wait_process(proc, timeout)
        if timed_out:
            err_msg = f"MATLAB 执行超时 ({timeout} 秒)"
            state=_update_db(db_path, job_id, 'FAILED', err_msg,process_context)
            return {'job_id': job_id, 'state': state, 'error': err_msg, 'artifacts': []}

    artifacts = [p.name for p in folder.glob("*") if p.is_file() and p.name not in ["run_sandbox.m", "source.m", "input.csv"]]
    png_images = [p.name for p in folder.glob("*.png")]

    if ret != 0:
        err_msg = f"MATLAB 执行退出码非零 ({ret})，请查看执行日志"
        state=_update_db(db_path, job_id, 'FAILED', err_msg,process_context)
        return {
            'job_id': job_id,
            'state': state,
            'error': err_msg,
            'artifacts': artifacts,
            'log': log_file.read_text(encoding='utf-8', errors='replace')[-5000:]
        }

    summary_path = folder / "summary.json"
    if not summary_path.exists():
        summary_info = {
            'task_type': 'custom_sandbox_code',
            'description': description,
            'language': 'matlab',
            'executed_at': now_str,
            'artifacts': artifacts,
            'images': png_images
        }
        summary_path.write_text(json.dumps(summary_info, ensure_ascii=False, indent=2), encoding='utf-8')
    else:
        try: summary_info = json.loads(summary_path.read_text(encoding='utf-8'))
        except Exception: summary_info = {}

    state=_update_db(db_path, job_id, 'SUCCEEDED', None,process_context)

    return {
        'job_id': job_id,
        'state': state,
        'artifacts': artifacts,
        'image_urls': [f"/api/jobs/{job_id}/artifact/{img}" for img in png_images],
        'download_url': f"/api/jobs/{job_id}/download",
        'summary': summary_info,
        'log': log_file.read_text(encoding='utf-8', errors='replace')[-5000:]
    }

def run_python_code_sandbox(code,description='动态声学仿真计算',db_path=None,runs_dir=None,timeout=60,process_context=None,*,input_csv='',code_artifact=None):
    return _guarded_runner(_run_python_code,code,description,db_path,runs_dir,timeout,process_context,input_csv=input_csv,code_artifact=code_artifact)


def run_matlab_code_sandbox(code,description='动态 MATLAB/AT 声学仿真计算',db_path=None,runs_dir=None,timeout=180,process_context=None,*,input_csv='',code_artifact=None):
    return _guarded_runner(_run_matlab_code,code,description,db_path,runs_dir,timeout,process_context,input_csv=input_csv,code_artifact=code_artifact)


def run_code_sandbox(
    code: str,
    language: str = "python",
    description: str = "动态声学仿真计算",
    db_path: Path | str | None = None,
    runs_dir: Path | str | None = None,
    timeout: int = 180,
    process_context=None,
    *, input_csv='', code_artifact=None
) -> dict:
    if language.lower() in ['matlab', 'm']:
        return run_matlab_code_sandbox(code, description, db_path, runs_dir, timeout,process_context,input_csv=input_csv,code_artifact=code_artifact)
    if language.lower() in ['python', 'py']:
        return run_python_code_sandbox(code, description, db_path, runs_dir, timeout,process_context,input_csv=input_csv,code_artifact=code_artifact)
    raise ValueError('仅支持 Python 或 MATLAB 脚本')

def _update_db(db_path: Path, job_id: str, state: str, error: str | None,process_context=None):
    try:
        now_str = datetime.now().astimezone().isoformat(timespec='seconds')
        with (process_context['lock'] if process_context else nullcontext()), closing(sqlite3.connect(db_path, timeout=30)) as conn, conn:
            conn.execute(
                "UPDATE jobs SET state = ?, error = ?, updated = ? WHERE id = ? AND state='RUNNING'",
                (state, error, now_str, job_id)
            )
            row=conn.execute('SELECT state FROM jobs WHERE id=?',(job_id,)).fetchone()
            if row is None:raise ValueError('任务记录已丢失，请核对现有产物')
            return row[0]
    except sqlite3.Error:
        raise ValueError('任务状态未能保存，请检查数据库与现有任务文件') from None
