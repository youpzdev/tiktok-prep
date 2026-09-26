@echo off
title TikTok Prep Tool
cd /d "%~dp0"
py -3 -c "import sys" >nul 2>&1
if not errorlevel 1 goto run_py
python -c "import sys" >nul 2>&1
if not errorlevel 1 goto run_python
echo Python 3 not found. Install Python 3 and try again.
pause
exit /b 1

:run_py
py -3 app.py
goto done

:run_python
python app.py

:done
set "APP_EXIT=%errorlevel%"
if not "%APP_EXIT%"=="0" pause
exit /b %APP_EXIT%
