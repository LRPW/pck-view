<div align="center">

[Русский](README.md) · **English**

<img src="src-tauri/icons/lrpw/icon.png" alt="PW Forge" width="128" />

# PW Forge

A Perfect World editor for Windows. Work with PCK archives, client files, and translations in one workspace.

![Windows](https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square)
![RU / EN](https://img.shields.io/badge/interface-RU%20%2F%20EN-63e2c5?style=flat-square)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8D8?style=flat-square&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/backend-Rust-CE422B?style=flat-square&logo=rust&logoColor=white)
![React](https://img.shields.io/badge/frontend-React-149ECA?style=flat-square&logo=react&logoColor=white)

[Working with projects](#working-with-projects) · [Project format](#project-format-on-disk) · [Editors](#editors-and-search) · [Translation](#translation) · [Build](#installation-and-build)

</div>

---

## Working with projects

1. Click **Create project**, select the game client folder, and choose the archives to import.
2. PW Forge copies the `data` folder and the selected PCK/PKX archives into the project. Open the `.pwforge` manifest from the app or double-click it after registering the file association through **Associate .pwforge**.
3. Open resources from the tree on the left. They appear in tabs on the right. Archive entries are indexed, and resources are extracted into the cache when opened.
4. Saved edits live separately from the original files. A project build produces modified archives and loose files ready to copy into the client.

Use **Open** to work with an individual archive or client file outside a project.

## Project format on disk

```text
MyProject/
  MyProject.pwforge
  originals/
    data/
    archives/
  edits/
    data/
    archives/<archive.pck>/<resource path>
  .forge/
    index/<archive.pck>.json.gz
    cache/
    backups/
  locales/
    source.json
    ru.json
  builds/<build ID>/
    pwforge-build.json
```

The JSON manifest contains `format: "pw-forge-project"` and `version: 2`. The `name`, `source`, `archives`, `status`, and `errors` fields record the project name, source client folder, selected archives, import status, and import errors. The importer skips `bug.pck`. Project paths resolve relative to the manifest directory.

Reads prefer the corresponding file in `edits/`. Otherwise, loose files are read from `originals/data/`, and archived resources are extracted from PCK/PKX. The version 2 index stores each entry's name, offset, unpacked size, and packed size. PW Forge reuses the saved index when the PCK and PKX metadata match. If an archive changes or its index is missing, PW Forge reads the entry table again. Both `.forge/index/` and `.forge/cache/` can be regenerated from the original copies.

Project builds group saved edits by archive and produce only the affected archives and modified loose files. The build writes to a temporary directory first, then publishes the result under `builds/`. The `pwforge-build.json` report lists the built archives and the number of loose files. Project builds can split archives into PCK and PKX when needed.

## Editors and search

| Format | Features |
| --- | --- |
| PCK / PKX | Resource tree, extraction, addition, replacement, deletion, and packing |
| `elements.data` | Categories, record search, typed fields, resource selection, and previews |
| `gshop.data`, `gshop1.data`, `gshop2.data` | Categories, subcategories, purchase slots, inventory icons, and links to item and NPC records |
| `domain.data`, `domain2.data`, `domain2_cross.data` | Map, territory list, and neighbor highlighting |
| `tasks.data`, `task_npc.data`, `dyn_tasks.data` | Quests, NPCs, conditions, rewards, and dialogs |
| Interfaces and GFX | Interface editing and native GFX previews |
| Other resources | Text, hex, images, DDS/TGA textures, audio, and video |

Content search opens in a separate window that can be moved to a second monitor. Scope it to the whole project, a PCK or data module, or a folder. Search supports file masks, regular expressions, case sensitivity, and whole-word matching. Canceling preserves the matches already found.

## Translation

Text export creates `locales/source.json`. Each entry records the file path, field path, and individual text segments with their colors. Translations are stored in the selected locale file, such as `locales/ru.json`.

- Search within the translation editor, filter for untranslated entries, and translate them manually or in batches.
- Supported providers include DeepL, Yandex Translate, Ollama, and OpenAI-compatible APIs. API keys are stored in Windows Credential Manager.
- Batch translation shows saved results as it runs and supports cancellation and resumption. Existing translations are preserved. Changes to placeholders and formatting codes are flagged for manual review.
- **Apply translation** writes translated resources through the project's edit layer, preserving colors and original files.

### JSON structure

The source catalog contains an `entries` array. A translation file also contains `version` and `language`. In each entry, `file` identifies the virtual file path, `path` identifies the field within the resource, and `segments` holds fragments with `text` and `color`. Colors are stored as six-digit RGB hex values without a prefix, or as `null`. A translation entry can also contain `source_segments` for comparison with the original text.

Completed batch results are written to a `<language>.pending.jsonl` journal. On completion or the next batch run, PW Forge merges the journal into the locale JSON and fills empty segments. Applying a translation checks the source segments and field paths and reports errors per file.

## Application architecture

- `src/app/IdeApp.tsx` manages the resource tree, tabs, and resource opening.
- `src/features/editor/` contains the editors. `src/features/search/` contains the separate search window.
- `src-tauri/src/project.rs` handles imports, indexes, the edit layer, and project builds. `ide.rs` handles resource access and standalone files.
- `src-tauri/src/locales.rs`, `locale_batch.rs`, and `translation.rs` handle locale files, batch processing, and requests to translation providers.
- `native-gfx/` contains a separate executable. Tauri starts it for native previews and communicates with it through the backend.

## Installation and build

Extract the ZIP from [Releases](https://github.com/LRPW/pw-forge/releases) into a dedicated folder and run `pckview.exe` alongside `native-gfx.exe` and the DLLs. The app requires the WebView2 Runtime.

Building requires Node.js, Yarn Classic, Rust with MSVC, Visual Studio with x86 C++ tools, the Windows SDK, and the DirectX SDK (June 2010). Native GFX also uses engine sources and libraries from the client source tree. See [native-gfx/README.md](native-gfx/README.md).

Run these commands from the directory containing `package.json`:

```powershell
yarn install --frozen-lockfile
npm run tauri dev
```

Run `.\scripts\build-release.ps1` to generate a release ZIP and checksum under `release/`. Tauri builds Native GFX automatically in development mode and during release builds.

```powershell
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

For integration tests that use real game files, set `PW_CLIENT_DIR` to the installed client folder and run the relevant test with `-- --ignored`.

## PCK limits

PW Forge supports format version `0x20002`, including reading split PCK/PKX archives. Saving a standalone archive produces a single PCK smaller than `0x7fffff00` bytes. Project builds can split the archive into PCK and PKX at that boundary. Search returns up to 5,000 matches and skips files larger than 256 MiB. Encrypted archives support reading and export. Playback of individual media formats depends on the codecs available in WebView2.
