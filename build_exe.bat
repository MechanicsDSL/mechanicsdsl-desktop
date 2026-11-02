@echo off
rem Builds MechanicsDSL Studio for Windows 10 and 11.
rem Result: dist\MechanicsDSL Studio\MechanicsDSL Studio.exe, and a zip of that folder for release.
rem Needs Python 3.10 to 3.13 (the window library does not support newer versions yet).
rem PyInstaller and the other build tools go into a separate build environment (.buildenv).
rem The steps themselves (tests, PyInstaller, self-test, zip) are in build.py.
setlocal
cd /d "%~dp0"
if not exist .buildenv (
  where py >nul 2>nul && (py -3.12 -m venv .buildenv || py -3.13 -m venv .buildenv || py -3.11 -m venv .buildenv) || python -m venv .buildenv
)
if not exist .buildenv\Scripts\python.exe goto :fail
call .buildenv\Scripts\activate.bat || goto :fail
python -m pip install --quiet --upgrade pip || goto :fail
python -m pip install --quiet -r requirements.txt pyinstaller pytest pillow || goto :fail
python build.py || goto :fail
goto :eof
:fail
echo.
echo The build stopped because a step failed. See the messages above.
exit /b 1
