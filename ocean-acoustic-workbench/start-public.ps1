param([switch]$NoBrowser, [switch]$CheckOnly, [switch]$VerifySimulation)
$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$runtimeRoot = if ($env:OCEAN_RUNTIME_DIR) { [System.IO.Path]::GetFullPath($env:OCEAN_RUNTIME_DIR) } else { Join-Path $appRoot '.local' }
$connectionFile = Join-Path $runtimeRoot 'public-runtime.json'
if (-not (Test-Path -LiteralPath $connectionFile)) { throw 'Missing private public-runtime.json. See docs/PUBLIC_WORKBENCH_SYNC.md.' }
$publicRuntime = Get-Content -LiteralPath $connectionFile -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $publicRuntime.gateway_secret) { throw 'The private bridge credential is missing.' }
$siteUri = [Uri]$publicRuntime.site_origin
if (-not $siteUri.IsAbsoluteUri -or $siteUri.Scheme -ne 'https' -or $siteUri.UserInfo -or $siteUri.Query -or $siteUri.Fragment -or $siteUri.AbsolutePath -ne '/') { throw 'The public site must be an HTTPS origin.' }
$privateUrl = if ($env:OCEAN_PRIVATE_URL) { $env:OCEAN_PRIVATE_URL } elseif ($publicRuntime.private_url) { [string]$publicRuntime.private_url } else { 'http://127.0.0.1:8765' }
if ($privateUrl -notmatch '^http://(127\.0\.0\.1|localhost):([0-9]{1,5})/?$') { throw 'The private node URL must be an explicit loopback HTTP origin.' }
$privatePort = [int]$Matches[2]
if ($privatePort -lt 1 -or $privatePort -gt 65535 -or $privatePort -eq 8780) { throw 'The private backend port is invalid or conflicts with gateway 8780.' }
$privateUrl = $privateUrl.TrimEnd('/')
$venvPython = Join-Path $appRoot '.venv/Scripts/python.exe'
if (Test-Path -LiteralPath $venvPython) { $pythonExe = $venvPython }
elseif (Test-Path -LiteralPath (Join-Path $runtimeRoot 'runtime.json')) {
    $runtime = Get-Content -LiteralPath (Join-Path $runtimeRoot 'runtime.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $pythonExe = $runtime.python
    if ($runtime.pythonpath) { $env:PYTHONPATH = $runtime.pythonpath }
} else { throw 'Python environment missing. Install backend/requirements.txt in .venv first.' }
if (-not (Test-Path -LiteralPath $pythonExe -PathType Leaf)) { throw 'Configured Python executable not found.' }
$env:OCEAN_RUNTIME_DIR = $runtimeRoot
$env:OCEAN_PRIVATE_URL = $privateUrl
$env:PYTHONIOENCODING = 'utf-8'
function Get-PrivateHealth {
    try {
        $health = Invoke-RestMethod "$privateUrl/api/health" -TimeoutSec 3
        $research = Invoke-RestMethod "$privateUrl/api/research/capabilities" -TimeoutSec 3
        if ($health.version -eq '0.7.0' -and -not $health.public_mode -and $research.scope -eq 'local_research') { return $health }
    } catch {}
    return $null
}
function Get-GatewayHealth {
    try { return Invoke-RestMethod 'http://127.0.0.1:8780/api/health' -Headers @{'x-ocean-gateway'=[string]$publicRuntime.gateway_secret} -TimeoutSec 5 } catch { return $null }
}
function Start-NodeProcess([string]$name, [string[]]$arguments) {
    $process = Start-Process -FilePath $pythonExe -ArgumentList $arguments -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeRoot "$name.stdout.log") -RedirectStandardError (Join-Path $runtimeRoot "$name.stderr.log")
    $process.Id | Set-Content -LiteralPath (Join-Path $runtimeRoot "$name.pid")
    return $process
}
$privateHealth = Get-PrivateHealth
if ($CheckOnly) {
    [pscustomobject]@{site_origin=$siteUri.GetLeftPart([UriPartial]::Authority);private_url=$privateUrl;python_found=$true;credential_present=$true;private_backend_ready=[bool]$privateHealth;gateway_ready=[bool](Get-GatewayHealth);processes_started=$false} | ConvertTo-Json -Compress
    exit 0
}
if (-not $privateHealth) {
    if (Get-NetTCPConnection -LocalPort $privatePort -State Listen -ErrorAction SilentlyContinue) { throw "Port $privatePort is occupied by a different or unready backend. No existing process was stopped." }
    $backendPath = '"' + (Join-Path $appRoot 'backend') + '"'
    $process = Start-NodeProcess 'public-backend' @('-u','-m','uvicorn','app:app','--app-dir',$backendPath,'--host','127.0.0.1','--port',"$privatePort")
    for ($attempt=0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 500
        $privateHealth = Get-PrivateHealth
        if ($privateHealth) { break }
        if ($process.HasExited) { throw 'Private backend exited. Check public-backend.stderr.log.' }
    }
    if (-not $privateHealth) { throw 'Private backend startup timed out. Check public-backend.stderr.log.' }
}
if (-not (Get-GatewayHealth)) {
    if (Get-NetTCPConnection -LocalPort 8780 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8780 is occupied or its bridge credential differs. No existing process was stopped.' }
    $gatewayEntry = '"' + (Join-Path $appRoot 'backend/public_gateway.py') + '"'
    $process = Start-NodeProcess 'gateway' @('-u',$gatewayEntry)
    $gatewayHealth = $null
    for ($attempt=0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 500
        $gatewayHealth = Get-GatewayHealth
        if ($gatewayHealth) { break }
        if ($process.HasExited) { throw 'Public gateway exited. Check gateway.stderr.log.' }
    }
    if (-not $gatewayHealth) { throw 'Public gateway startup timed out. Check gateway.stderr.log.' }
}
$bridgeEntry = Join-Path $appRoot 'backend/cloud_bridge.py'
$bridgeCandidates = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -match '^pythonw?\.exe$' -and $_.CommandLine -and $_.CommandLine.Contains($bridgeEntry) })
# A Windows venv launcher and its real Python child are one logical service.
$candidateIds = @($bridgeCandidates | ForEach-Object { $_.ProcessId })
$existingBridge = @($bridgeCandidates | Where-Object { $candidateIds -notcontains $_.ParentProcessId })
if ($existingBridge.Count -gt 1) { throw 'More than one bridge process exists for this app; inspect its saved PIDs before starting another.' }
if ($existingBridge.Count -eq 0) { $null = Start-NodeProcess 'bridge' @('-u','"' + $bridgeEntry + '"') }
Write-Host "Private backend: $privateUrl"
Write-Host "Scoped gateway: http://127.0.0.1:8780"
Write-Host "Public site: $($siteUri.GetLeftPart([UriPartial]::Authority))"
$publicOnline = $false
for ($attempt=0; $attempt -lt 20; $attempt++) {
    try {
        $options = @{Uri=($publicRuntime.site_origin.TrimEnd('/') + '/api/workbench/capabilities');TimeoutSec=6;Headers=@{'User-Agent'='OceanAcousticWorkbench/0.7 (+https://github.com/Weijifen666/ocean-acoustic-workbench)'}}
        if ($publicRuntime.outbound_proxy) { $options.Proxy=[string]$publicRuntime.outbound_proxy }
        $capabilities = Invoke-RestMethod @options
        if ($capabilities.node_online) { $publicOnline=$true; break }
    } catch {}
    Start-Sleep -Seconds 1
}
if (-not $publicOnline) { throw 'The bridge has not appeared online. Check bridge.stdout.log / bridge.stderr.log; no solver success is assumed.' }
Write-Host 'Public node connected.'
if ($VerifySimulation) {
    $checker = Join-Path (Split-Path $appRoot -Parent) 'scripts/check-public-node.py'
    & $pythonExe $checker --app-root $appRoot --simulate
    if ($LASTEXITCODE -ne 0) { throw 'Public node validation failed; check the saved validation report.' }
}
if (-not $NoBrowser) { Start-Process $publicRuntime.site_origin }
