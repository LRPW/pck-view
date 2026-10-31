# Native GFX backend

Win32 Angelica/GfxCommon worker for the x64 Tauri editor. The host and editor variants of manager, model and skill
composer source files compile and link against the original libraries.

## Build

Run `build.cmd` (VS2022 Community + June 2010 DirectX SDK). Results are written to `out/`. Override `VCVARS32` and
`DXSDK_DIR` for a different toolchain installation. The build uses a release ImmWrapper.dll built by build-wrapper.cmd
against the external IFC/include and IFC/lib SDK. IFC22.dll is staged from the external SDK at IFC/lib/IFC22.dll; no
copy is taken from the game installation.

For deployment place native-gfx.exe and its DLL dependencies beside pckview.exe. Development resolves the worker from
`native-gfx/out/`. Use the release x86 CRT binaries listed in RELEASING.md.

## Integration

Rust commands native_gfx_create/frame/close own independent renderer processes. Original PCKs are mounted before engine
initialization. Frame protocol: GFX1 readiness magic, uint32 frame delta on stdin (0xffffffff restarts), fixed 512x512
BGRA frame on stdout. React displays frames in both standalone GFX preview and IMAGEPICTURE resources, including nested
SUBDIALOG. Pause/restart are available in standalone preview.

Names are transported as GBK hex to avoid loss of Chinese filenames under a different Windows locale. Client root is
currently the opened PCK directory. Native errors are shown instead of silently substituting the browser renderer.

## Limits remaining

This is not verified full compatibility. Canvas composition currently uses screen blending of a black-background frame;
it does not preserve exact alpha or all blend modes. Frame dimensions are fixed. Full scene lighting, shader
configurations, model dependencies and audio require a complete client resource set. Package algorithm is currently
fixed to the client's 171. Unsaved PCK edits are not staged into the native worker. Startup/frame IPC still needs robust
timeouts, and binary frame transport needs performance profiling.

`smoke.ps1 -ClientRoot <path> -Effect <relative-gfx-path>` checks initialization and one full frame with bounded waits.
GfxCommon linker success and frontend tests alone do not validate rendered output.

## Directory layout

- `main.cpp` — native renderer and frame protocol.
- `build.cmd` — x86 compilation, linking and runtime dependency staging.
- `smoke.ps1` — bounded startup/frame check; `-UiMode` selects screen-space rendering.
- `out/` — generated EXE, DLLs, object files and runtime logs (ignored by Git).

Keep diagnostic captures in `out/`, for example `-OutputFrame ./out/smoke-frame.bmp`. Old root-level logs are also
ignored because a running worker may still hold them open.

Native visual smoke checks pass for the 3D lightsaberbladeviolet effect and the screen-space 13年角色选择栏_法阵转动
effect: 30 frames are visible and change over time. The standalone camera fits effect bounds from an oblique angle; UI
uses an exact 512x512 screen-space viewport. Full rendering compatibility has not been established.
Use smoke.ps1 -RequireVisible -RequireAnimation to reject empty or unchanging output. Optional PCKVIEW_GFX_TRACE emits
renderer diagnostics on stderr; PCKVIEW_GFX_NO_CULL is a diagnostic override only.
