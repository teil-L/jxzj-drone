$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidsPath = Join-Path $projectRoot '.demo_pids.json'

function Get-PythonProcessByCommand([string]$match) {
  Get-CimInstance Win32_Process -Filter "name = 'python.exe'" |
    Where-Object { $_.CommandLine -like "*$match*" } |
    Select-Object -First 1
}

function Start-IfMissing([string]$match, [string[]]$launchArgs) {
  $existing = Get-PythonProcessByCommand $match
  if ($existing) { return [int]$existing.ProcessId }

  $proc = Start-Process -FilePath python -ArgumentList $launchArgs -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 2
  return [int]$proc.Id
}

# Always restart backend so latest env vars (e.g., DEEPSEEK_API_KEY) are applied.
$existingBackend = Get-PythonProcessByCommand 'server.py'
if ($existingBackend) {
  Stop-Process -Id ([int]$existingBackend.ProcessId) -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
}
$backendPid = Start-IfMissing 'server.py' @('server.py')
$frontendPid = Start-IfMissing '-m http.server 8000' @('-m','http.server','8000')

@{
  backend_pid = $backendPid
  frontend_pid = $frontendPid
  started_at = (Get-Date).ToString('s')
} | ConvertTo-Json | Set-Content -Path $pidsPath -Encoding UTF8

Write-Host "Backend : http://127.0.0.1:5000/status"
Write-Host "Frontend: http://127.0.0.1:8000/index.html"
Write-Host "PIDs    : backend=$backendPid, frontend=$frontendPid"


