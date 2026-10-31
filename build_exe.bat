@echo off
rem Builds MechanicsDSL Studio for Windows 10 and 11.
rem Result: dist\MechanicsDSL Studio\MechanicsDSL Studio.exe, and a zip of that folder for release.
rem Needs Python 3.10 to 3.13 (the window library does not support newer versions yet).
rem PyInstaller and the other build tools go into a separate build environment (.buildenv).
setlocal
cd /d "%~dp0"
if not exist .buildenv (
  where py >nul 2>nul && (py -3.12 -m venv .buildenv || py -3.13 -m venv .buildenv || py -3.11 -m venv .buildenv) || python -m venv .buildenv
)
if not exist .buildenv\Scripts\python.exe goto :fail
call .buildenv\Scripts\activate.bat || goto :fail
python -m pip install --quiet --upgrade pip || goto :fail
python -m pip install --quiet -r requirements.txt pyinstaller pytest || goto :fail
echo Running tests...
python -m pytest -q tests || goto :fail
echo Building...
pyinstaller --noconfirm --clean --windowed --name "MechanicsDSL Studio" --icon assets\app.ico --version-file version_info.txt --add-data "mechanicsdsl_studio\web;mechanicsdsl_studio\web" --collect-submodules mechanics_dsl.codegen --collect-submodules mechanics_dsl.solver --copy-metadata mechanicsdsl-core --exclude-module numba --exclude-module jax --exclude-module torch --exclude-module tensorflow --exclude-module IPython --exclude-module notebook --exclude-module jupyter_client --exclude-module PyQt5 --exclude-module PyQt6 --exclude-module PySide6 --exclude-module tkinter --exclude-module mechanics_dsl.server --exclude-module mechanics_dsl.lsp --exclude-module mechanics_dsl.jupyter "MechanicsDSL Studio.py" || goto :fail
echo Checking the built program...
start "" /wait "dist\MechanicsDSL Studio\MechanicsDSL Studio.exe" --selftest "%~dp0selftest.txt"
if errorlevel 1 (
  type selftest.txt
  goto :fail
)
type selftest.txt
powershell -NoProfile -Command "Compress-Archive -Force -Path 'dist\MechanicsDSL Studio' -DestinationPath 'dist\MechanicsDSL-Studio-1.0.0-windows.zip'" || goto :fail
echo.
echo Built: %~dp0dist\MechanicsDSL Studio\MechanicsDSL Studio.exe
echo Release zip: %~dp0dist\MechanicsDSL-Studio-1.0.0-windows.zip
goto :eof
:fail
echo.
echo The build stopped because a step failed. See the messages above.
exit /b 1
