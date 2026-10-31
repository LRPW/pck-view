@echo off
setlocal
if not defined VCVARS32 set "VCVARS32=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars32.bat"
call "%VCVARS32%" >nul
if errorlevel 1 exit /b %errorlevel%
cd /d "%~dp0"
set "ROOT=%~dp0..\..\.."
if not exist out mkdir out
cl /nologo /LD /EHsc /MD /O2 /DIMMWRAPPER_EXPORTS /DNDEBUG /DUNICODE /D_UNICODE /I"%ROOT%\AngelicaMedia\Header" /I"%ROOT%\Angelica3D\Header" /I"%ROOT%\AngelicaCommon\Header" /I"%ROOT%\ImmWrapper\Header" /I"%ROOT%\IFC\include" "%ROOT%\ImmWrapper\Source\AMImmEffect.cpp" "%ROOT%\ImmWrapper\Source\AMImmWrapper.cpp" /Foout\ /Fe:out\ImmWrapper.dll /link /IMPLIB:out\ImmWrapper.lib /LIBPATH:"%ROOT%\IFC\lib" /LIBPATH:"%ROOT%\Release" IFC22.lib AngelicaCommon.lib Dbghelp.lib Shlwapi.lib User32.lib Winmm.lib
exit /b %errorlevel%
