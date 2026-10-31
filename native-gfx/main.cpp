#include <windows.h>
#include <cstdio>
#include <io.h>
#include <fcntl.h>
#include <string>
#include <cstdlib>
#include <cmath>
#include <A3DEngine.h>
#include <A3DDevice.h>
#include <A3DCamera.h>
#include <A3DViewport.h>
#include <A3DConfig.h>
#include <A3DFuncs.h>
#include <AFI.h>
#include <AFilePackMan.h>
#include <A3DGFXEx.h>
#include <A3DGFXExMan.h>
#include <A3DGFXElement.h>

// Separate process: legacy Angelica libraries are Win32; Tauri is x64.
int main(int argc, char **argv) {
    if (argc != 4) {
        fprintf(stderr, "usage: native-gfx <client-root> <gfx-gbk-hex> <ui-mode>\n");
        return 2;
    }
    if (!af_Initialize() || !af_SetBaseDir(argv[1])) return 3;
    WNDCLASSA wc = {};
    wc.lpfnWndProc = DefWindowProcA;
    wc.hInstance = GetModuleHandle(nullptr);
    wc.lpszClassName = "PckViewNativeGfx";
    RegisterClassA(&wc);
    // This window is never shown. Keep its client area identical to the target;
    // Init2DViewport derives its projection from GetClientRect.
    HWND window = CreateWindowA(wc.lpszClassName, "Angelica GFX", WS_POPUP,
                                0, 0, 512, 512, nullptr, nullptr, wc.hInstance, nullptr);
    if (!window) return 4;
    g_AFilePackMan.SetAlgorithmID(171);
    for (const char *name: {"gfx", "surfaces", "models", "textures", "shaders", "sfx"}) {
        char path[MAX_PATH];
        snprintf(path, sizeof(path), "%s\\%s.pck", argv[1], name);
        if (GetFileAttributesA(path) != INVALID_FILE_ATTRIBUTES)
            g_AFilePackMan.OpenFilePackageInGame((std::string(name) + ".pck").c_str());
    }
    A3DEngine engine;
    A3DDEVFMT format = {};
    format.bWindowed = true;
    format.nWidth = 512;
    format.nHeight = 512;
    format.fmtTarget = A3DFMT_UNKNOWN;
    format.fmtDepth = A3DFMT_UNKNOWN;
    if (!engine.Init(wc.hInstance, window, &format, A3DDEV_ALLOWMULTITHREAD)) return 5;
    g_pA3DConfig->RT_SetShowFPSFlag(false);
    g_pA3DConfig->RT_SetShowPerformanceFlag(false);
    auto manager = AfxGetGFXExMan();
    if (!manager->Init(engine.GetA3DDevice())) return 6;
    A3DCamera camera;
    A3DViewport viewport;
    if (!camera.Init(engine.GetA3DDevice(), 0.977384f, 0.1f, 2000.0f)) return 12;
    camera.SetPos(A3DVECTOR3(0, 0, -5));
    camera.SetDirAndUp(A3DVECTOR3(0, 0, 1), A3DVECTOR3(0, 1, 0));
    A3DVIEWPORTPARAM view = {};
    view.Width = 512;
    view.Height = 512;
    view.MinZ = 0;
    view.MaxZ = 1;
    if (!viewport.Init(engine.GetA3DDevice(), &view, false, false, 0)) return 13;
    viewport.SetCamera(&camera);
    viewport.Active();
    std::string effectPath;
    for (size_t i = 0; argv[2][i] && argv[2][i + 1]; i += 2) {
        unsigned value;
        if (sscanf(argv[2] + i, "%2x", &value) != 1) return 11;
        effectPath.push_back(static_cast<char>(value));
    }
    auto effect = manager->LoadGfx(engine.GetA3DDevice(), effectPath.c_str(), false, false);
    if (!effect) return 7;
    const bool trace = getenv("PCKVIEW_GFX_TRACE") != nullptr;
    if (getenv("PCKVIEW_GFX_NO_CULL")) effect->SetUseAABB(false);
    if (atoi(argv[3])) effect->Set2DRender(true);
    effect->Set2DBackLayer(false);
    if (effect->Is2DRender()) effect->SetParentTM(a3d_Translate(256, 256, 0));
    else {
        // An axial camera collapses view-facing ribbons/quads aligned with Z.
        const A3DAABB &bounds = effect->GetAABB();
        const float radius = bounds.Extents.Magnitude();
        const float distance = fmaxf(2.0f, radius / sinf(0.977384f * 0.5f) * 1.3f);
        A3DVECTOR3 offset(1.0f, 0.6f, -1.0f);
        offset.Normalize();
        const A3DVECTOR3 position = bounds.Center + offset * distance;
        camera.SetPos(position);
        camera.SetDirAndUp(bounds.Center - position, A3DVECTOR3(0, 1, 0));
    }
    effect->Start();
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
    auto d3d = engine.GetA3DDevice()->GetD3DDevice();
    IDirect3DSurface9 *capture = nullptr;
    D3DSURFACE_DESC desc;
    engine.GetA3DDevice()->GetBackBuffer()->GetDesc(&desc);
    if (FAILED(d3d->CreateOffscreenPlainSurface(512, 512, desc.Format, D3DPOOL_SYSTEMMEM, &capture, nullptr))) return 8;
    const unsigned ready = 0x31584647;
    fwrite(&ready, 4, 1, stdout);
    fflush(stdout);
    unsigned delta;
    while (fread(&delta, 4, 1, stdin) == 1) {
        viewport.Active();
        if (delta == 0xffffffff) {
            effect->Stop();
            effect->Start();
            delta = 0;
        }
        effect->TickAnimation(delta);
        d3d->Clear(0, nullptr, D3DCLEAR_TARGET | D3DCLEAR_ZBUFFER, 0, 1, 0);
        if (!engine.BeginRender()) return 14;
        manager->RegisterGfx(effect);
        manager->RenderAllGfx(&viewport);
        manager->Render2DGfx(false);
        if (trace) {
            fprintf(stderr, "gfx state=%d visible=%d alpha=%f elements=%d draws=%lu faces=%lu\n", effect->GetState(),
                    effect->IsVisible(), effect->GetAlpha(), effect->GetElementCount(),
                    engine.GetA3DDevice()->GetDrawCount(), engine.GetA3DDevice()->GetDrawFaceCount());
            for (int i = 0; i < effect->GetElementCount(); ++i) {
                auto element = effect->GetElement(i);
                KEY_POINT key;
                const bool active = element->GetCurKeyPoint(&key);
                fprintf(stderr, "element %d init=%d visible=%d render=%d key=%d color=%08lx scale=%f\n", i,
                        element->IsInit(), element->IsVisible(), element->CanRender(), active, active ? key.m_color : 0,
                        active ? key.m_fScale : 0);
            }
        }
        if (!engine.EndRender()) return 15;
        if (FAILED(d3d->GetRenderTargetData(engine.GetA3DDevice()->GetBackBuffer(), capture))) return 9;
        D3DLOCKED_RECT lock;
        if (FAILED(capture->LockRect(&lock, nullptr, D3DLOCK_READONLY))) return 10;
        for (int y = 0; y < 512; ++y) fwrite((char *) lock.pBits + y * lock.Pitch, 4, 512, stdout);
        capture->UnlockRect();
        fflush(stdout);
        engine.Present();
    }
    capture->Release();
    effect->Stop();
    effect->Release();
    delete effect;
    manager->Release();
    engine.Release();
    g_AFilePackMan.CloseAllPackages();
    af_Finalize();
    return 0;
}

const char *AfxGetECMHullPath() { return "Models\\"; }
