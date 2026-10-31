<div align="center">

[Русский](README.md) · **English**

<img src="src-tauri/icons/lrpw/icon.png" alt="LRPW PCK View" width="128" />

# LRPW | PCK View

PCK archive viewer and editor: file operations, content search, texture decoding, and media playback.

![Windows](https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square)
![RU / EN](https://img.shields.io/badge/interface-RU%20%2F%20EN-63e2c5?style=flat-square)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8D8?style=flat-square&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/backend-Rust-CE422B?style=flat-square&logo=rust&logoColor=white)
![React](https://img.shields.io/badge/frontend-React-149ECA?style=flat-square&logo=react&logoColor=white)

[Features](#features) · [Usage](#usage) · [Keyboard shortcuts](#keyboard-shortcuts) · [Building](#building) · [Limitations](#format-and-limitations)

</div>

---

## Features

### Archive operations

- Directory tree with path filtering and virtualization for large lists.
- Resource sizes, compression indicators, and unsaved change indicators.
- Add, replace, delete, and export individual files.
- Extract an entire archive or pack a folder into PCK while preserving relative paths.
- Progress reporting for long-running operations.

### Content search

Search runs on a background thread. Options, progress, and results are displayed in a separate native **Find in Files**
window.

- Plain text, regular expressions, case sensitivity, and whole-word matching.
- Automatic encoding detection or explicit UTF-8, GBK, UTF-16 LE / BE selection.
- Results arrive during the search, grouped by file, with line numbers, columns, and text snippets.
- Navigation to a match is available before the search completes.
- Cancellation preserves results already found.
- Known binary formats are excluded by default and can be included explicitly.
- A resource read error does not stop the remaining files from being searched.

### Textures, images, and media

| Resource        | Preview                                                                               |
|-----------------|---------------------------------------------------------------------------------------|
| **DDS**         | DXT1 / DXT3 / DXT5, uncompressed RGB / RGBA; supported DXT variants with DX10 headers |
| **TGA**         | Uncompressed and RLE, indexed color, grayscale, transparency                          |
| **Images**      | PNG, JPEG, GIF, WebP, BMP, ICO, AVIF                                                  |
| **Audio**       | OGG / Opus, MP3, WAV, FLAC, M4A, AAC                                                  |
| **Video**       | MP4, WebM, OGV                                                                        |
| **Text**        | View and edit UTF-8, GBK, UTF-16 LE / BE                                              |
| **Binary data** | HEX view of the first 64 KiB                                                          |

Audio and video playback, along with some image formats, depend on the codecs available in WebView2. DDS and TGA use a
separate decoder.

Image controls:

| Input                                     | Action                                   |
|-------------------------------------------|------------------------------------------|
| Mouse wheel                               | Zoom around the cursor position          |
| Drag with the left or middle mouse button | Pan the image                            |
| Double-click / **Fit**                    | Fit the image within the viewport        |
| **100%**                                  | One texture pixel per viewport CSS pixel |

Transparent regions are displayed over a checkerboard background.

### Localization

**RU / EN** changes the interface language without restarting. The selection is saved and applies to both the main and
search windows. Native file picker elements may follow the Windows language.

## Usage

1. Open a `.pck` using **Open PCK** or `Ctrl+O`.
2. Select a resource in the tree. Supported images and media open in preview mode automatically.
3. Select **Text**, **HEX**, or **Preview** to change the representation.
4. Press `Ctrl+Shift+F` to search file contents.
5. Save changes with `Ctrl+S`, or save a separate copy with `Ctrl+Shift+S`.

Resource changes remain in memory until the archive is saved. **Apply text** updates the resource in memory; saving the
archive also applies the current pending text edit.

### Extraction

Click **Extract all** and select a destination folder. Resource paths are preserved relative to that folder. Existing
files at matching paths are replaced; other files in the folder are left in place. If an error occurs, files already
extracted remain on disk.

Extraction uses up to four worker threads with a limit on concurrently processed data. A resource read or write error
does not stop other files; errors are listed in an expandable report. Uncompressed entries whose stored-size field
exceeds their original length are read using the original length.

### Packing

Click **Pack into PCK**, select a resource folder, and choose an archive destination **outside that folder**. The
resulting archive opens in the application. Empty directories are omitted; links and junctions are rejected.

## Keyboard shortcuts

| Action              | Shortcut                   |
|---------------------|----------------------------|
| Open archive        | `Ctrl+O`                   |
| Save                | `Ctrl+S`                   |
| Save as…            | `Ctrl+Shift+S`             |
| Open content search | `Ctrl+Shift+F`             |
| Next match          | `F3`                       |
| Previous match      | `Shift+F3`                 |
| Hide search window  | `Esc` in the search window |
| Start search        | `Enter` in the query field |

## Building

Run commands from the project directory containing `package.json`.

### Requirements

- Windows with **WebView2 Runtime** installed.
- **Node.js** with npm.
- **Rust** with the MSVC toolchain.
- **Visual Studio Build Tools** with MSVC tools and the Windows SDK.

### Development

```powershell
npm install
npm run tauri dev
```

### Application build

```powershell
npm run tauri build
```

Executable: `src-tauri/target/release/pckview.exe`.

Installer generation is disabled in the configuration. Application icons are located in `src-tauri/icons/lrpw/`.

### Checks

```powershell
# Localization and texture decoders
npm test

# TypeScript and production frontend build
npm run build

# Backend tests
cargo test --manifest-path src-tauri/Cargo.toml
```

Some backend tests create and replace temporary files and require write access. The local game installation check is
ignored by default.

## Format and limitations

| Parameter           | Support                                                    |
|---------------------|------------------------------------------------------------|
| PCK version         | `0x20002`                                                  |
| Profiles            | Standard, `171`, custom/update (`0`), `111`                |
| Resource table      | 276-byte and 288-byte entries, zlib, safe header           |
| Filenames           | GBK, up to 259 bytes                                       |
| Split archives      | Read PCK with an adjacent PKX; split boundary `0x7fffff00` |
| Saving              | Single PCK below `0x7fffff00` bytes — slightly under 2 GiB |
| Encrypted archives  | Reading and export; editing disabled                       |
| Individual resource | Up to 256 MiB for preview, search, import, and export      |
| Full extraction     | The 256 MiB per-resource preview limit does not apply      |
| Search results      | Up to 5000 matches, with an explicit limit indicator       |

Saving writes a temporary file in the destination directory. The written archive is verified before replacing the
destination file. Unchanged compressed resources are copied without recompression.

DDS support does not cover every DXGI format: BC6H and BC7, for example, are not decoded. Preview displays the base
texture level without mip-level or cubemap-face selection.

Search cancellation is checked between files and after reading the current resource. Stopping may be delayed while a
large compressed file is being processed.

## Project structure

```text
src/
├── app/                 Main window state and archive actions
├── features/
│   ├── archive/         Resource tree and indexing
│   ├── search/          Separate search window
│   └── media/           Preview, player, and image controls
├── lib/textures/        DDS and TGA decoders
├── i18n/                RU / EN translations
├── styles/              Interface styles
└── main.tsx             React entry point

src-tauri/
├── src/
│   ├── app.rs           Archive operations and application commands
│   ├── search/          Background search and cancellation
│   ├── tests/           Format and file operation tests
│   └── main.rs          Rust entry point
├── capabilities/        Window permissions
├── icons/lrpw/          Application icons
└── tauri.conf.json      Configuration

tests/                   Localization and decoder tests
assets/icon-concepts/     Original icon variants
```

The `node_modules/`, `dist/`, `src-tauri/target/`, and `.logs/` directories contain local dependencies, build output,
and logs.
