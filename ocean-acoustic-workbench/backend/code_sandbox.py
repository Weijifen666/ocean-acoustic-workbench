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


def _guarded_runner(runner,code,description,db_path,runs_dir,timeout,process_context):
    context={**process_context,'started':{}} if process_context else None
    try:return runner(code,description,db_path,runs_dir,timeout,context)
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
    process_context=None
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
    script_file.write_text(code, encoding='utf-8')

    if db_path is None:
        db_path = _runtime() / 'workbench.sqlite3'
    else:
        db_path = Path(db_path)

    plan_meta = {
        'task_type': 'custom_sandbox_code',
        'description': description,
        'script_file': 'run_sandbox.py'
    }

    _register_job(db_path, job_id, now_str, plan_meta,process_context)

    log_file = folder / "run.log"
    with log_file.open("wb") as log:
        log.write(f"任务 ID: {job_id}\n描述: {description}\n执行开始: {now_str}\n\n".encode("utf-8"))
        log.flush()

        try:
            proc=_start_process([sys.executable,'run_sandbox.py'],folder,log,db_path,job_id,process_context)
        except OSError:
            state=_update_db(db_path, job_id, 'FAILED', 'Python 进程未能启动',process_context)
            return {'job_id': job_id, 'state': state, 'error': 'Python 进程未能启动', 'artifacts': []}
        if proc is None:return {'job_id':job_id,'state':_job_state(db_path,job_id),'artifacts':[],'error':'任务在进程启动前已停止'}
        ret, timed_out = _wait_process(proc, timeout)
        if timed_out:
            err_msg = f"执行超时 ({timeout} 秒)"
            state=_update_db(db_path, job_id, 'FAILED', err_msg,process_context)
            return {'job_id': job_id, 'state': state, 'error': err_msg, 'artifacts': []}

    artifacts = [p.name for p in folder.glob("*") if p.is_file() and p.name not in ["run_sandbox.py"]]
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
    process_context=None
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
    matlab_exe = cfg.get('matlab_path', r"D:\Program Files\MATLAB\R2024b\bin\matlab.exe")
    toolbox_path = cfg.get('toolbox_path', r"D:\matlab-project&tool\at-matlab\at")
    if not Path(matlab_exe).is_file():
        raise ValueError('未找到已配置的 MATLAB 可执行文件，尚未执行代码')
    toolbox_literal = Path(toolbox_path).as_posix().replace("'", "''")

    header = f"""
try
    tb = '{toolbox_literal}';
    setenv('AT_PATH', tb);
    addpath(tb, fullfile(tb,'bin'), fullfile(tb,'ReadWrite'), fullfile(tb,'Plot'), fullfile(tb,'Misc'));
catch
end
"""
    # Prevent clear from wiping tb
    processed_code = code
    if "clear" in processed_code:
        processed_code = processed_code.replace("clear;", f"clear; tb = '{toolbox_literal}';").replace("clear all;", f"clear all; tb = '{toolbox_literal}';")

    # Prevent unwanted cd calls from breaking isolated execution
    import re
    processed_code = re.sub(r'cd\s*\([^)]*\)\s*;?', '% [cd removed: already in isolated sandbox]', processed_code)

    full_code = header + "\n" + processed_code + "\nexit(0);\n"
    script_file = folder / "run_sandbox.m"
    script_file.write_text(full_code, encoding='utf-8')

    if db_path is None: db_path = _runtime() / 'workbench.sqlite3'
    else: db_path = Path(db_path)

    plan_meta = {
        'task_type': 'custom_sandbox_code',
        'description': description,
        'language': 'matlab',
        'script_file': 'run_sandbox.m'
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

    artifacts = [p.name for p in folder.glob("*") if p.is_file() and p.name not in ["run_sandbox.m"]]
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

def run_python_code_sandbox(code,description='动态声学仿真计算',db_path=None,runs_dir=None,timeout=60,process_context=None):
    return _guarded_runner(_run_python_code,code,description,db_path,runs_dir,timeout,process_context)


def run_matlab_code_sandbox(code,description='动态 MATLAB/AT 声学仿真计算',db_path=None,runs_dir=None,timeout=180,process_context=None):
    return _guarded_runner(_run_matlab_code,code,description,db_path,runs_dir,timeout,process_context)


def run_code_sandbox(
    code: str,
    language: str = "python",
    description: str = "动态声学仿真计算",
    db_path: Path | str | None = None,
    runs_dir: Path | str | None = None,
    timeout: int = 180,
    process_context=None
) -> dict:
    if language.lower() in ['matlab', 'm']:
        return run_matlab_code_sandbox(code, description, db_path, runs_dir, timeout,process_context)
    if language.lower() in ['python', 'py']:
        return run_python_code_sandbox(code, description, db_path, runs_dir, timeout,process_context)
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
