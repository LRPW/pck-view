@echo off
setlocal
if not defined VCVARS32 set "VCVARS32=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars32.bat"
if not exist "%VCVARS32%" (echo MSVC environment not found. Set VCVARS32. & exit /b 1)
call "%VCVARS32%" >nul
if errorlevel 1 exit /b %errorlevel%
cd /d "%~dp0"
set "ROOT=%~dp0..\..\.."
if not exist "out" mkdir "out"
if not defined DXSDK_DIR set "DXSDK_DIR=C:\Program Files (x86)\Microsoft DirectX SDK (June 2010)"
set "DXSDK=%DXSDK_DIR%"
if not exist "out\ImmWrapper.lib" call build-wrapper.cmd
if errorlevel 1 exit /b %errorlevel%
cl /nologo /EHsc /MD /O2 /std:c++14 /Zc:forScope- /DDX9 /DGFX_EDITOR /D_SKILLGFXCOMPOSER /DNDEBUG /DUNICODE /D_UNICODE /I"%ROOT%\AngelicaCommon\header" /I"%ROOT%\AngelicaFile\header" /I"%ROOT%\Angelica3D\header" /I"%ROOT%\AngelicaMedia\header" /I"%ROOT%\GfxCommon" /I"%ROOT%\lua5.1" /I"%ROOT%\ImmWrapper\header" /I"%ROOT%\CHBasedCD" /I"%ROOT%\LuaWrapper" /I"%DXSDK%\Include" main.cpp "%ROOT%\GfxCommon\A3DGFXExMan.cpp" "%ROOT%\GfxCommon\A3DGFXInterface.cpp" "%ROOT%\GfxCommon\EC_Model.cpp" "%ROOT%\GfxCommon\EC_ModelMan.cpp" "%ROOT%\GfxCommon\A3DSkillGfxComposer.cpp" "%ROOT%\GfxCommon\A3DSkillGfxEvent.cpp" /Foout\ /Fe:out\native-gfx.exe /link /LIBPATH:"out" /LIBPATH:"%ROOT%\Release" /LIBPATH:"%ROOT%\bin" /LIBPATH:"%ROOT%\fmod\lib" /LIBPATH:"%DXSDK%\Lib\x86" GfxCommon.lib Angelica3D.lib AngelicaCommon.lib AngelicaFile.lib AngelicaMedia.lib AudioEngine.lib LuaWrapper.lib lua5.1.lib d3d9.lib d3dx9.lib dxguid.lib dsound.lib winmm.lib ws2_32.lib imm32.lib shlwapi.lib psapi.lib user32.lib gdi32.lib ole32.lib version.lib zlib.lib ImmWrapper.lib mpg123.lib ogg.lib vorbis.lib  CHBasedCD.lib
if errorlevel 1 exit /b %errorlevel%
rem ImmWrapper.dll is built by build-wrapper.cmd in out/.
if not exist "%ROOT%\IFC\lib\IFC22.dll" (echo Missing IFC\lib\IFC22.dll & exit /b 1)
copy /y "%ROOT%\IFC\lib\IFC22.dll" out\ >nul
copy /y "%ROOT%\zlibwapi.dll" out\ >nul
if defined VCToolsRedistDir copy /y "%VCToolsRedistDir%x86\Microsoft.VC143.CRT\msvcp140.dll" out\ >nul
if defined VCToolsRedistDir copy /y "%VCToolsRedistDir%x86\Microsoft.VC143.CRT\vcruntime140.dll" out\ >nul
if exist "%DXSDK%\Redist\Jun2010_d3dx9_43_x86.cab" expand -F:d3dx9_43.dll "%DXSDK%\Redist\Jun2010_d3dx9_43_x86.cab" out >nul
exit /b 0
