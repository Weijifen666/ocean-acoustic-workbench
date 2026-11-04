param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$url = 'http://127.0.0.1:8765'
$localDir = Join-Path $appRoot '.local'
$running = $false
try { $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 2; $running = $health.version -in @('0.2.0','0.4.0','0.5.0','0.7.0') } catch {}
if (-not $running) {
    $runtimeFile = Join-Path $appRoot '.local/runtime.json'
    $venvPython = Join-Path $appRoot '.venv/Scripts/python.exe'
    if (Test-Path -LiteralPath $venvPython) { $pythonExe = $venvPython }
    elseif (Test-Path -LiteralPath $runtimeFile) {
        $runtime = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
        $pythonExe = $runtime.python
        $env:PYTHONPATH = $runtime.pythonpath
    } else {
        throw 'Python 环境缺失：请先在项目目录执行 "python -m venv .venv" 和 "pip install -r backend/requirements.txt"，详见 docs/LOCAL_SETUP.md。'
    }
    if (-not (Test-Path -LiteralPath $pythonExe)) { throw "配置的 Python 解释器不存在：$pythonExe" }

    # The server writes logs, the SQLite queue and run artifacts into .local.
    # Create it up front so a fresh clone fails on a clear message instead of
    # an IOException after the process starts.
    if (-not (Test-Path -LiteralPath $localDir)) { New-Item -ItemType Directory -Path $localDir -Force | Out-Null }
    $stdout = Join-Path $localDir 'server.stdout.log'
    $stderr = Join-Path $localDir 'server.stderr.log'

    $env:PYTHONIOENCODING = 'utf-8'
    $entry = Join-Path $appRoot 'backend/app.py'
    $process = Start-Process -FilePath $pythonExe -ArgumentList @('"' + $entry + '"') -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $process.Id | Set-Content (Join-Path $localDir 'server.pid')
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Milliseconds 500
        try { $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 1; $running = $health.version -in @('0.2.0','0.4.0','0.5.0','0.7.0'); if ($running) { break } } catch {}
        if ($process.HasExited) {
            $tail = (Get-Content -LiteralPath $stderr -Tail 15 -ErrorAction SilentlyContinue) -join "`n"
            throw "服务进程已退出。以下是 server.stderr.log 末尾：`n$tail"
        }
    }
    if (-not $running) {
        $tail = (Get-Content -LiteralPath $stderr -Tail 15 -ErrorAction SilentlyContinue) -join "`n"
        throw "服务启动超时（30 秒）。请检查 8765 端口是否被占用，或查看 .local/server.stderr.log：`n$tail"
    }
}
Write-Host "Ocean Acoustics Workbench: $url"
if (-not $NoBrowser) { Start-Process $url }
