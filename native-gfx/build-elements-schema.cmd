@echo off
setlocal
cd /d "%~dp0"
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars32.bat" >nul
cl /nologo /EHsc /W0 /D_WINDOWS /D_WIN32 elements-schema.cpp /Fe:out\elements-schema.exe /Fo:out\elements-schema.obj
if errorlevel 1 exit /b 1
out\elements-schema.exe > ..\src-tauri\src\elements-schema.json