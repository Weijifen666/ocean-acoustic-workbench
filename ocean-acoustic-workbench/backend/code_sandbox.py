"""
Universal Acoustic Simulation Code Sandbox for Ocean Acoustic Workbench
Allows the Agent to dynamically generate and execute custom Python or MATLAB/AT acoustic simulation scripts.
"""
from __future__ import annotations
import os, sys, json, sqlite3, subprocess, uuid, time, shutil
from pathlib import Path
from datetime import datetime

def run_python_code_sandbox(
    code: str,
    description: str = "动态声学仿真计算",
    db_path: Path | str | None = None,
    runs_dir: Path | str | None = None,
    timeout: int = 60
) -> dict:
    job_id = uuid.uuid4().hex[:12]
    now_str = datetime.now().astimezone().isoformat(timespec='seconds')
    
    if runs_dir is None:
        root = Path(__file__).resolve().parents[1]
        runs_dir = root / '.local/runs'
    else:
        runs_dir = Path(runs_dir)
        
    folder = runs_dir / job_id
    folder.mkdir(parents=True, exist_ok=True)
    
    script_file = folder / "run_sandbox.py"
    script_file.write_text(code, encoding='utf-8')
    
    if db_path is None:
        root = Path(__file__).resolve().parents[1]
        db_path = root / '.local/workbench.sqlite3'
    else:
        db_path = Path(db_path)
        
    plan_meta = {
        'task_type': 'custom_sandbox_code',
        'description': description,
        'script_file': 'run_sandbox.py'
    }
    
    # Register in DB
    try:
        conn = sqlite3.connect(db_path)
        with conn:
            conn.execute(
                "INSERT INTO jobs (id, state, created, updated, plan, error) VALUES (?, ?, ?, ?, ?, NULL)",
                (job_id, 'RUNNING', now_str, now_str, json.dumps(plan_meta, ensure_ascii=False))
            )
        conn.close()
    except Exception:
        pass

    log_file = folder / "run.log"
    with log_file.open("wb") as log:
        log.write(f"任务 ID: {job_id}\n描述: {description}\n执行开始: {now_str}\n\n".encode("utf-8"))
        log.flush()
        
        proc = subprocess.Popen(
            [sys.executable, "run_sandbox.py"],
            cwd=folder,
            stdout=log,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        try:
            ret = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            err_msg = f"执行超时 ({timeout} 秒)"
            _update_db(db_path, job_id, 'FAILED', err_msg)
            return {'job_id': job_id, 'state': 'FAILED', 'error': err_msg, 'artifacts': []}

    artifacts = [p.name for p in folder.glob("*") if p.is_file() and p.name not in ["run_sandbox.py"]]
    png_images = [p.name for p in folder.glob("*.png")]
    
    if ret != 0:
        err_msg = f"代码执行退出码非零 ({ret})，请查看执行日志"
        _update_db(db_path, job_id, 'FAILED', err_msg)
        return {
            'job_id': job_id,
            'state': 'FAILED',
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

    _update_db(db_path, job_id, 'SUCCEEDED', None)

    return {
        'job_id': job_id,
        'state': 'SUCCEEDED',
        'artifacts': artifacts,
        'image_urls': [f"/api/jobs/{job_id}/artifact/{img}" for img in png_images],
        'download_url': f"/api/jobs/{job_id}/download",
        'summary': summary_info,
        'log': log_file.read_text(encoding='utf-8', errors='replace')[-5000:]
    }

def run_matlab_code_sandbox(
    code: str,
    description: str = "动态 MATLAB/AT 声学仿真计算",
    db_path: Path | str | None = None,
    runs_dir: Path | str | None = None,
    timeout: int = 180
) -> dict:
    job_id = uuid.uuid4().hex[:12]
    now_str = datetime.now().astimezone().isoformat(timespec='seconds')
    
    root = Path(__file__).resolve().parents[1]
    if runs_dir is None: runs_dir = root / '.local/runs'
    else: runs_dir = Path(runs_dir)
    folder = runs_dir / job_id
    folder.mkdir(parents=True, exist_ok=True)
    
    config_file = root / '.local/config.json'
    cfg = json.loads(config_file.read_text(encoding='utf-8')) if config_file.exists() else {}
    matlab_exe = cfg.get('matlab_path', r"D:\Program Files\MATLAB\R2024b\bin\matlab.exe")
    toolbox_path = cfg.get('toolbox_path', r"D:\matlab-project&tool\at-matlab\at")
    
    header = f"""
try
    tb = '{toolbox_path}';
    setenv('AT_PATH', tb);
    addpath(tb, fullfile(tb,'bin'), fullfile(tb,'ReadWrite'), fullfile(tb,'Plot'), fullfile(tb,'Misc'));
catch
end
"""
    # Prevent clear from wiping tb
    processed_code = code
    if "clear" in processed_code:
        processed_code = processed_code.replace("clear;", f"clear; tb = '{toolbox_path}';").replace("clear all;", f"clear all; tb = '{toolbox_path}';")
    
    # Prevent unwanted cd calls from breaking isolated execution
    import re
    processed_code = re.sub(r'cd\s*\([^)]*\)\s*;?', '% [cd removed: already in isolated sandbox]', processed_code)
    
    full_code = header + "\n" + processed_code + "\nexit(0);\n"
    script_file = folder / "run_sandbox.m"
    script_file.write_text(full_code, encoding='utf-8')
    
    if db_path is None: db_path = root / '.local/workbench.sqlite3'
    else: db_path = Path(db_path)
    
    plan_meta = {
        'task_type': 'custom_sandbox_code',
        'description': description,
        'language': 'matlab',
        'script_file': 'run_sandbox.m'
    }
    
    try:
        conn = sqlite3.connect(db_path)
        with conn:
            conn.execute(
                "INSERT INTO jobs (id, state, created, updated, plan, error) VALUES (?, ?, ?, ?, ?, NULL)",
                (job_id, 'RUNNING', now_str, now_str, json.dumps(plan_meta, ensure_ascii=False))
            )
        conn.close()
    except Exception:
        pass

    log_file = folder / "run.log"
    with log_file.open("wb") as log:
        log.write(f"任务 ID: {job_id}\n描述: {description}\n执行引擎: MATLAB R2024b + Acoustics Toolbox\n开始时间: {now_str}\n\n".encode("utf-8"))
        log.flush()
        
        proc = subprocess.Popen(
            [matlab_exe, "-wait", "-noFigureWindows", "-batch", "run_sandbox"],
            cwd=folder,
            stdout=log,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        try:
            ret = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            err_msg = f"MATLAB 执行超时 ({timeout} 秒)"
            _update_db(db_path, job_id, 'FAILED', err_msg)
            return {'job_id': job_id, 'state': 'FAILED', 'error': err_msg, 'artifacts': []}

    artifacts = [p.name for p in folder.glob("*") if p.is_file() and p.name not in ["run_sandbox.m"]]
    png_images = [p.name for p in folder.glob("*.png")]
    
    if ret != 0:
        err_msg = f"MATLAB 执行退出码非零 ({ret})，请查看执行日志"
        _update_db(db_path, job_id, 'FAILED', err_msg)
        return {
            'job_id': job_id,
            'state': 'FAILED',
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

    _update_db(db_path, job_id, 'SUCCEEDED', None)

    return {
        'job_id': job_id,
        'state': 'SUCCEEDED',
        'artifacts': artifacts,
        'image_urls': [f"/api/jobs/{job_id}/artifact/{img}" for img in png_images],
        'download_url': f"/api/jobs/{job_id}/download",
        'summary': summary_info,
        'log': log_file.read_text(encoding='utf-8', errors='replace')[-5000:]
    }

def run_code_sandbox(
    code: str,
    language: str = "python",
    description: str = "动态声学仿真计算",
    db_path: Path | str | None = None,
    runs_dir: Path | str | None = None,
    timeout: int = 180
) -> dict:
    if language.lower() in ['matlab', 'm']:
        return run_matlab_code_sandbox(code, description, db_path, runs_dir, timeout)
    return run_python_code_sandbox(code, description, db_path, runs_dir, timeout)

def _update_db(db_path: Path, job_id: str, state: str, error: str | None):
    try:
        now_str = datetime.now().astimezone().isoformat(timespec='seconds')
        conn = sqlite3.connect(db_path)
        with conn:
            conn.execute(
                "UPDATE jobs SET state = ?, error = ?, updated = ? WHERE id = ?",
                (state, error, now_str, job_id)
            )
        conn.close()
    except Exception:
        pass
