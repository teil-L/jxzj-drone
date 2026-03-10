$ErrorActionPreference = 'SilentlyContinue'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidsPath = Join-Path $projectRoot '.demo_pids.json'

function Stop-ByPid([int]$pid) {
  if ($pid -gt 0) {
    $p = Get-Process -Id $pid
    if ($p) { Stop-Process -Id $pid -Force }
  }
}

if (Test-Path $pidsPath) {
  $data = Get-Content -Path $pidsPath -Raw | ConvertFrom-Json
  Stop-ByPid ([int]$data.backend_pid)
  Stop-ByPid ([int]$data.frontend_pid)
  Remove-Item $pidsPath -Force
}

Get-CimInstance Win32_Process -Filter "name = 'python.exe'" |
  Where-Object { $_.CommandLine -like '*server.py*' -or $_.CommandLine -like '*-m http.server 8000*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Write-Host 'Demo services stopped.'
