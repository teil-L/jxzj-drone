@echo off
chcp 65001 >nul
echo [INFO] Starting demo services...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_demo.ps1"
if errorlevel 1 (
  echo [ERROR] start_demo.ps1 failed.
  pause
  exit /b 1
)
echo [OK] Demo started:
echo      Frontend: http://127.0.0.1:8000/index.html
echo      Backend : http://127.0.0.1:5000/status
echo [TIP] This window will close in 5 seconds...
timeout /t 5 /nobreak >nul
