#include <windows.h>
#include <shobjidl.h>
#pragma comment(lib, "shell32.lib")
#include <cstdio>
#include <io.h>
#include <fcntl.h>
#include <string>
#include <vector>
#include <A3DSkinModelAct.h>
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
#include <A3DFrame.h>
#include <A3DLitModel.h>
#include <A3DLitModelRender.h>
#include <AFileImage.h>
#include <A3DSkinModel.h>
#include <A3DSkinMan.h>
#include <A3DSkinRender.h>
#include <A3DSkeleton.h>
#include <A3DBone.h>
#include <A3DWireCollector.h>
#include <EC_Model.h>
#include <EC_ModelMan.h>
#include <LuaState.h>
#include <cfloat>
#include "glb-export.h"

class PreviewSkinModel : public A3DSkinModel {
public:
    using A3DSkinModel::BindSkeletonFile;
};

namespace {
    constexpr unsigned kExportGlb = 0xfffffffa;
    constexpr unsigned kSelectAnimation = 0xfffffffb;
    constexpr unsigned kListAnimations = 0xfffffffc;
    constexpr unsigned kResize = 0xfffffffd;
    constexpr unsigned kOrbit = 0xfffffffe;
    constexpr unsigned kRestart = 0xffffffff;

    // One worker owns the engine, loaded resource and frame protocol state.
    class PreviewRenderer {
    public:
        int Run(const char *clientRoot, const char *pathHex, bool uiMode);

    private:
        WNDCLASSA wc = {};
        HWND window = nullptr;
        std::string effectPath;
        A3DEngine engine;
        A3DGFXExMan *manager = nullptr;
        A3DCamera camera;
        A3DViewport viewport;
        A3DVIEWPORTPARAM view = {};
        PreviewSkinModel skin;
        CECModel ecModel;
        A3DSkinModel *skinView = &skin;
        A3DFrame model;
        A3DLitModel litModel;
        A3DGFXEx *effect = nullptr;
        bool isMox = false, isEcm = false, isSmd = false, isSki = false, isBon = false, isSkin = false, isLitModel =
                        false;
        bool trace = getenv("PCKVIEW_GFX_TRACE") != nullptr;
        A3DVECTOR3 orbitCenter = A3DVECTOR3(0);
        float orbitDistance = 5;
        std::vector<A3DSkinModelActionCore *> animations;
        unsigned selectedAnimation = kRestart, modelTime = 0;
        IDirect3DDevice9 *d3d = nullptr;
        IDirect3DSurface9 *capture = nullptr;
        D3DSURFACE_DESC desc = {};
        unsigned width = 512, height = 512;

        int CreateHiddenWindow() {
            wc.lpfnWndProc = DefWindowProcA;
            wc.hInstance = GetModuleHandle(nullptr);
            wc.lpszClassName = "PckViewNativeGfx";
            RegisterClassA(&wc);
            // This window is never shown. Keep its client area identical to the target;
            // Init2DViewport derives its projection from GetClientRect.
            window = CreateWindowA(wc.lpszClassName, "Angelica GFX", WS_POPUP, 0, 0, 512, 512, nullptr, nullptr,
                                   wc.hInstance, nullptr);
            if (!window)
                return 4;
            return 0;
        }

        int DecodePath(const char *pathHex) {
            for (size_t i = 0; pathHex[i] && pathHex[i + 1]; i += 2) {
                unsigned value;
                if (sscanf(pathHex + i, "%2x", &value) != 1)
                    return 11;
                effectPath.push_back(static_cast<char>(value));
            }
            return 0;
        }

        void MountArchives(const char *clientRoot) {
            g_AFilePackMan.SetAlgorithmID(171);
            // Discover actual filenames (including case) and mount the selected resource's
            // archive plus shared dependencies. PKX segments are handled by Angelica.
            const size_t separator = effectPath.find_first_of("\\/");
            const std::string resourceArchive = effectPath.substr(0, separator) + ".pck";
            WIN32_FIND_DATAA found = {};
            const std::string pattern = std::string(clientRoot) + "\\*.pck";
            HANDLE search = FindFirstFileA(pattern.c_str(), &found);
            if (search != INVALID_HANDLE_VALUE) {
                do {
                    if (found.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)
                        continue;
                    bool mount = _stricmp(found.cFileName, resourceArchive.c_str()) == 0;
                    for (const char *dependency:
                         {
                             "configs.pck", "gfx.pck", "surfaces.pck", "models.pck", "textures.pck", "shaders.pck",
                             "sfx.pck"
                         })
                        mount = mount || _stricmp(found.cFileName, dependency) == 0;
                    if (mount)
                        g_AFilePackMan.OpenFilePackageInGame(found.cFileName);
                } while (FindNextFileA(search, &found));
                FindClose(search);
            }
        }

        int InitializeEngine() {
            A3DDEVFMT format = {};
            format.bWindowed = true;
            format.nWidth = 512;
            format.nHeight = 512;
            format.fmtTarget = A3DFMT_UNKNOWN;
            format.fmtDepth = A3DFMT_UNKNOWN;
            if (!engine.Init(wc.hInstance, window, &format, A3DDEV_ALLOWMULTITHREAD))
                return 5;
            g_pA3DConfig->RT_SetShowFPSFlag(false);
            g_pA3DConfig->RT_SetShowPerformanceFlag(false);
            manager = AfxGetGFXExMan();
            if (!manager->Init(engine.GetA3DDevice()))
                return 6;
            if (!camera.Init(engine.GetA3DDevice(), 0.977384f, 0.1f, 2000.0f))
                return 12;
            camera.SetPos(A3DVECTOR3(0, 0, -5));
            camera.SetDirAndUp(A3DVECTOR3(0, 0, 1), A3DVECTOR3(0, 1, 0));
            view.Width = 512;
            view.Height = 512;
            view.MinZ = 0;
            view.MaxZ = 1;
            if (!viewport.Init(engine.GetA3DDevice(), &view, false, false, 0))
                return 13;
            viewport.SetCamera(&camera);
            viewport.Active();
            return 0;
        }

        void ClassifyResource() {
            isMox = effectPath.size() >= 4 && _stricmp(effectPath.c_str() + effectPath.size() - 4, ".mox") == 0;
            const auto extension = effectPath.substr(effectPath.find_last_of('.'));
            isEcm = _stricmp(extension.c_str(), ".ecm") == 0;
            isSmd = _stricmp(extension.c_str(), ".smd") == 0;
            isSki = _stricmp(extension.c_str(), ".ski") == 0;
            isBon = _stricmp(extension.c_str(), ".bon") == 0;
            isSkin = isEcm || isSmd || isSki || isBon;
        }

        void FitModelCamera(const A3DAABB &bounds) {
            A3DVECTOR3 offset(1, 0.6f, -1);
            offset.Normalize();
            if (getenv("PCKVIEW_GFX_TRACE"))
                fprintf(stderr, "bounds center=%f,%f,%f ext=%f,%f,%f\n", bounds.Center.x, bounds.Center.y,
                        bounds.Center.z,
                        bounds.Extents.x, bounds.Extents.y, bounds.Extents.z);
            orbitCenter = bounds.Center;
            const A3DVECTOR3 position =
                    bounds.Center + offset * fmaxf(2, bounds.Extents.Magnitude() / sinf(0.977384f * 0.5f) * 1.3f);
            camera.SetPos(position);
            camera.SetDirAndUp(bounds.Center - position, A3DVECTOR3(0, 1, 0));
        }

        int LoadMox() {
            AFileImage file;
            if (!file.Open(effectPath.c_str(), AFILE_OPENEXIST))
                return 7;
            DWORD version = 0, read = 0;
            const DWORD start = file.GetPos();
            file.Read(&version, sizeof(version), &read);
            isLitModel = version == 0x80000001;
            file.Seek(start, AFILE_SEEK_SET);
            if (isLitModel) {
                // Building MOX: version + one-byte flag, followed by a lit model.
                file.Seek(start + 5, AFILE_SEEK_SET);
                if (!litModel.Load(engine.GetA3DDevice(), &file))
                    return 7;
            } else if (!model.Load(engine.GetA3DDevice(), &file))
                return 7;
            if (!isLitModel)
                model.UpdateToFrame(0);
            const A3DAABB bounds = isLitModel ? litModel.GetModelAABB() : model.GetChildAABB();
            FitModelCamera(bounds);
            return 0;
        }

        int LoadSkin() {
            if (!isBon && !engine.GetA3DSkinMan()->LoadSkinModelVertexShaders("Configs\\2.2\\skinmodelvs.cfg"))
                if (!engine.GetA3DSkinMan()->LoadSkinModelVertexShaders("Configs\\skinmodelvs.cfg"))
                    return 18;
            if (isEcm) {
                if (!g_LuaStateMan.Init(false))
                    return 7;
                if (!AfxGetECModelMan()->Init())
                    return 7;
                if (!ecModel.Load(effectPath.c_str(), true, 0, true, true))
                    return 7;
                skinView = ecModel.GetA3DSkinModel();
                if (!skinView)
                    return 7;
            } else {
                if (!skin.Init(&engine))
                    return 7;
                if (isSmd) {
                    if (!skin.Load(effectPath.c_str()))
                        return 7;
                } else {
                    const std::string skeleton = isBon
                                                     ? effectPath
                                                     : effectPath.substr(0, effectPath.size() - 4) + ".bon";
                    if (!skin.BindSkeletonFile(skeleton.c_str()))
                        return 17;
                    if (isSki && skin.AddSkinFile(effectPath.c_str(), true) < 0)
                        return 7;
                }
            }
            A3DSkinModel::LIGHTINFO light = {};
            light.colAmbient = A3DCOLORVALUE(0.5f, 0.5f, 0.5f, 1);
            light.vLightDir = Normalize(A3DVECTOR3(0, -0.7f, -1));
            light.colDirDiff = A3DCOLORVALUE(1, 1, 1, 1);
            light.bPtLight = false;
            skinView->SetLightInfo(light);
            if (isEcm)
                ecModel.Tick(1);
            else
                skinView->Update(1);
            A3DAABB bounds = isEcm ? ecModel.GetModelAABB() : skinView->GetModelAABB();
            if (isBon) {
                bounds.Clear();
                auto skeleton = skinView->GetSkeleton();
                for (int i = 0; i < skeleton->GetBoneNum(); ++i)
                    bounds.AddVertex(skeleton->GetBone(i)->GetAbsoluteTM().GetRow(3));
                bounds.CompleteCenterExts();
            }
            FitModelCamera(bounds);
            return 0;
        }

        int LoadEffect(bool uiMode) {
            effect = manager->LoadGfx(engine.GetA3DDevice(), effectPath.c_str(), false, false);
            if (!effect)
                return 7;
            if (effect) {
                if (getenv("PCKVIEW_GFX_NO_CULL"))
                    effect->SetUseAABB(false);
                if (uiMode)
                    effect->Set2DRender(true);
                effect->Set2DBackLayer(false);
                if (effect->Is2DRender())
                    effect->SetParentTM(a3d_Translate(256, 256, 0));
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
            }
            return 0;
        }

        void CollectAnimations() {
            if (isSmd || isEcm)
                for (auto action = skinView->GetFirstAction(); action; action = skinView->GetNextAction())
                    animations.push_back(action);
        }

        int InitializeCapture() {
            _setmode(_fileno(stdin), _O_BINARY);
            _setmode(_fileno(stdout), _O_BINARY);
            d3d = engine.GetA3DDevice()->GetD3DDevice();
            engine.GetA3DDevice()->GetBackBuffer()->GetDesc(&desc);
            if (FAILED(d3d->CreateOffscreenPlainSurface(512, 512, desc.Format, D3DPOOL_SYSTEMMEM, &capture, nullptr)))
                return 8;
            return 0;
        }

        void ExportGlb() {
            try {
                std::vector<GlbMesh> meshes;
                std::vector<GlbRig> rigs;
                if (isLitModel) {
                    for (int m = 0; m < litModel.GetNumMeshes(); ++m) {
                        auto mesh = litModel.GetMesh(m);
                        GlbMesh item;
                        auto v = mesh->GetVerts();
                        auto normals = mesh->GetNormals();
                        for (int i = 0; i < mesh->GetNumVerts(); ++i)
                            item.vertices.emplace_back(v[i].pos, normals[i], v[i].u, v[i].v);
                        item.indices.assign(mesh->GetIndices(), mesh->GetIndices() + mesh->GetNumFaces() * 3);
                        item.texture = mesh->GetTexturePtr();
                        meshes.push_back(item);
                    }
                } else if (isMox)
                    glbFrame(&model, meshes);
                else if (isEcm)
                    glbEcm(&ecModel, meshes, rigs);
                else if (isSkin && !isBon)
                    glbSkin(&skin, meshes, rigs);
                else
                    throw std::runtime_error("This resource has no mesh to export");
                auto bytes = makeGlb(meshes, rigs);
                unsigned status = 1, length = static_cast<unsigned>(bytes.size());
                fwrite(&status, 4, 1, stdout);
                fwrite(&length, 4, 1, stdout);
                fwrite(bytes.data(), 1, length, stdout);
            } catch (const std::exception &e) {
                unsigned status = 0, length = static_cast<unsigned>(strlen(e.what()));
                fwrite(&status, 4, 1, stdout);
                fwrite(&length, 4, 1, stdout);
                fwrite(e.what(), 1, length, stdout);
            }
            fflush(stdout);
        }

        void WriteAnimations() {
            unsigned count = static_cast<unsigned>(animations.size());
            fwrite(&count, 4, 1, stdout);
            for (auto action: animations) {
                for (const char *value: {action->GetName(), action->GetTrackSetFileName()}) {
                    unsigned length = static_cast<unsigned>(strlen(value));
                    fwrite(&length, 4, 1, stdout);
                    fwrite(value, 1, length, stdout);
                }
            }
            fflush(stdout);
        }

        int SelectAnimation() {
            unsigned index;
            if (fread(&index, 4, 1, stdin) != 1)
                return -1;
            unsigned ok = 0;
            if (isSmd || isEcm) {
                if (index == 0xffffffff) {
                    skinView->StopAllActions();
                    selectedAnimation = index;
                    ok = 1;
                } else if (index < animations.size()) {
                    ok = skinView->PlayActionByNameDC(animations[index]->GetName(), -1, 0, true) ? 1 : 0;
                    if (ok)
                        selectedAnimation = index;
                }
                skinView->Update(0);
            }
            fwrite(&ok, 4, 1, stdout);
            fflush(stdout);
            return 0;
        }

        int Resize() {
            unsigned size[2];
            if (fread(size, sizeof(unsigned), 2, stdin) != 2)
                return -1;
            if (!size[0] || !size[1] || size[0] > 2560 || size[1] > 2560)
                return 16;
            if (width != size[0] || height != size[1]) {
                capture->Release();
                capture = nullptr;
                width = size[0];
                height = size[1];
                SetWindowPos(window, nullptr, 0, 0, width, height, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
                if (!engine.GetA3DDevice()->SetDisplayMode(width, height, A3DFMT_UNKNOWN, true, false,
                                                           SDM_WIDTH | SDM_HEIGHT))
                    return 16;
                view.Width = width;
                view.Height = height;
                if (!viewport.SetParam(&view))
                    return 16;
                camera.SetProjectionParam(0.977384f, 0.1f, 2000, float(width) / height);
                if (effect && effect->Is2DRender())
                    effect->SetParentTM(a3d_Translate(width * 0.5f, height * 0.5f, 0));
                engine.GetA3DDevice()->GetBackBuffer()->GetDesc(&desc);
                if (FAILED(
                    d3d->CreateOffscreenPlainSurface(width, height, desc.Format, D3DPOOL_SYSTEMMEM, &capture, nullptr)))
                    return 8;
            }
            return 0;
        }

        int Orbit() {
            float orbit[3];
            if (fread(orbit, sizeof(float), 3, stdin) != 3)
                return -1;
            if ((isMox || isSkin) && std::isfinite(orbit[0]) && std::isfinite(orbit[1]) && std::isfinite(orbit[2])) {
                const float pitch = fmaxf(-1.5f, fminf(1.5f, orbit[1]));
                const float distance = orbitDistance * fmaxf(0.1f, fminf(10, orbit[2]));
                A3DVECTOR3 offset(sinf(orbit[0]) * cosf(pitch), sinf(pitch), -cosf(orbit[0]) * cosf(pitch));
                const A3DVECTOR3 position = orbitCenter + offset * distance;
                camera.SetPos(position);
                camera.SetDirAndUp(orbitCenter - position, A3DVECTOR3(0, 1, 0));
            }
            return 0;
        }

        void UpdateAnimation(unsigned delta) {
            if (delta == kRestart) {
                modelTime = 0;
                if (effect) {
                    effect->Stop();
                    effect->Start();
                }
                if ((isSmd || isEcm) && selectedAnimation < animations.size())
                    skinView->PlayActionByNameDC(animations[selectedAnimation]->GetName(), -1, 0, true);
                delta = 0;
            }
            if (effect)
                effect->TickAnimation(delta);
            else if (isEcm)
                ecModel.Tick(delta);
            else if (isSkin)
                skin.Update(delta);
            else if (!isLitModel) {
                modelTime += delta;
                const int count = model.GetFrameCountRecursive();
                model.UpdateToFrame(count > 0 ? (modelTime / 33) % count : 0);
            }
        }

        void DrawResource() {
            if (isSkin) {
                auto renderer = engine.GetA3DSkinMan()->GetCurSkinRender();
                renderer->ResetRenderInfo(false);
                renderer->ResetRenderInfo(true);
                if (isBon) {
                    auto skeleton = skin.GetSkeleton();
                    for (int i = 0; i < skeleton->GetBoneNum(); ++i) {
                        auto bone = skeleton->GetBone(i);
                        auto parent = bone->GetParentPtr();
                        if (parent)
                            engine.GetA3DWireCollector()->Add3DLine(bone->GetAbsoluteTM().GetRow(3),
                                                                    parent->GetAbsoluteTM().GetRow(3), 0xff63e2c5);
                    }
                    engine.GetA3DWireCollector()->Flush_3D();
                } else {
                    if (isEcm && !getenv("PCKVIEW_ECM_SKIN_ONLY"))
                        ecModel.Render(&viewport);
                    else
                        skinView->RenderAtOnce(&viewport, 0, false);
                    renderer->Render(&viewport);
                }
            } else if (isLitModel) {
                auto renderer = engine.GetA3DLitModelRender();
                renderer->ResetRenderInfo(false);
                renderer->ResetRenderInfo(true);
                litModel.Render(&viewport);
                renderer->Render(&viewport);
            } else if (isMox)
                model.Render(&viewport, false, false);
            else
                manager->RegisterGfx(effect);
            manager->RenderAllGfx(&viewport);
            manager->Render2DGfx(false);
        }

        void TraceFrame() {
            if (trace && isSkin)
                fprintf(stderr, "skins=%d hidden=%d transparent=%f draws=%lu faces=%lu\n", skinView->GetSkinNum(),
                        skinView->IsHidden(), skinView->GetTransparent(), engine.GetA3DDevice()->GetDrawCount(),
                        engine.GetA3DDevice()->GetDrawFaceCount());
            if (trace && effect) {
                fprintf(stderr, "gfx state=%d visible=%d alpha=%f elements=%d draws=%lu faces=%lu\n",
                        effect->GetState(),
                        effect->IsVisible(), effect->GetAlpha(), effect->GetElementCount(),
                        engine.GetA3DDevice()->GetDrawCount(), engine.GetA3DDevice()->GetDrawFaceCount());
                for (int i = 0; i < effect->GetElementCount(); ++i) {
                    auto element = effect->GetElement(i);
                    KEY_POINT key;
                    const bool active = element->GetCurKeyPoint(&key);
                    fprintf(stderr, "element %d init=%d visible=%d render=%d key=%d color=%08lx scale=%f\n", i,
                            element->IsInit(), element->IsVisible(), element->CanRender(), active,
                            active ? key.m_color : 0,
                            active ? key.m_fScale : 0);
                }
            }
        }

        int CaptureFrame() {
            if (FAILED(d3d->GetRenderTargetData(engine.GetA3DDevice()->GetBackBuffer(), capture)))
                return 9;
            D3DLOCKED_RECT lock;
            if (FAILED(capture->LockRect(&lock, nullptr, D3DLOCK_READONLY)))
                return 10;
            for (unsigned y = 0; y < height; ++y)
                fwrite((char *) lock.pBits + y * lock.Pitch, 4, width, stdout);
            capture->UnlockRect();
            fflush(stdout);
            engine.Present();
            return 0;
        }

        int RenderFrame(unsigned delta) {
            viewport.Active();
            UpdateAnimation(delta);
            d3d->Clear(0, nullptr, D3DCLEAR_TARGET | D3DCLEAR_ZBUFFER, 0, 1, 0);
            if (!engine.BeginRender())
                return 14;
            DrawResource();
            TraceFrame();
            if (!engine.EndRender())
                return 15;
            return CaptureFrame();
        }

        int ProcessCommands() {
            const unsigned ready = 0x31584647;
            fwrite(&ready, 4, 1, stdout);
            fflush(stdout);
            unsigned command;
            while (fread(&command, 4, 1, stdin) == 1) {
                int result = 0;
                switch (command) {
                    case kExportGlb:
                        ExportGlb();
                        break;
                    case kListAnimations:
                        WriteAnimations();
                        break;
                    case kSelectAnimation:
                        result = SelectAnimation();
                        break;
                    case kResize:
                        result = Resize();
                        break;
                    case kOrbit:
                        result = Orbit();
                        break;
                    default:
                        result = RenderFrame(command);
                        break;
                }
                if (result < 0)
                    break;
                if (result > 0)
                    return result;
            }
            return 0;
        }

        void Shutdown() {
            capture->Release();
            if (effect) {
                effect->Stop();
                effect->Release();
                delete effect;
            }
            if (isLitModel)
                litModel.Release();
            else if (isMox)
                model.Release();
            if (isEcm)
                ecModel.Release();
            else if (isSkin)
                skin.Release();
            manager->Release();
            engine.Release();
            g_AFilePackMan.CloseAllPackages();
            af_Finalize();
        }
    };

    int PreviewRenderer::Run(const char *clientRoot, const char *pathHex, bool uiMode) {
        if (!af_Initialize() || !af_SetBaseDir(clientRoot))
            return 3;
        int result = CreateHiddenWindow();
        if (result)
            return result;
        if ((result = DecodePath(pathHex)))
            return result;
        MountArchives(clientRoot);
        if ((result = InitializeEngine()))
            return result;
        ClassifyResource();
        if (isMox)
            result = LoadMox();
        else if (isSkin)
            result = LoadSkin();
        else
            result = LoadEffect(uiMode);
        if (result)
            return result;
        CollectAnimations();
        if ((result = InitializeCapture()))
            return result;
        orbitDistance = (camera.GetPos() - orbitCenter).Magnitude();
        result = ProcessCommands();
        if (result)
            return result;
        Shutdown();
        return 0;
    }
} // namespace

// Separate process: legacy Angelica libraries are Win32; Tauri is x64.
int main(int argc, char **argv) {
    // Match the main application's shell identity before creating any windows.
    HRESULT appIdResult = SetCurrentProcessExplicitAppUserModelID(L"ru.lordralinc.pwforge");
    if (FAILED(appIdResult))
        fprintf(stderr, "Could not set AppUserModelID: 0x%08lX\n", static_cast<unsigned long>(appIdResult));
    if (argc != 4) {
        fprintf(stderr, "usage: native-gfx <client-root> <gfx-gbk-hex> <ui-mode>\n");
        return 2;
    }
    PreviewRenderer renderer;
    return renderer.Run(argv[1], argv[2], atoi(argv[3]) != 0);
}

const char *AfxGetECMHullPath() {
    return "Models\\";
}
