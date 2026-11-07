#[path = "mcp.rs"]
mod mcp;
pub use mcp::run as run_mcp;

#[path = "startup.rs"]
mod startup;
#[path = "search/mod.rs"]
mod search;
#[path = "native_gfx.rs"]
mod native_gfx;
#[path = "ui_fonts.rs"]
mod ui_fonts;
#[path = "elements.rs"]
mod elements;
#[path = "project.rs"]
mod project;
#[path = "ide.rs"]
mod ide;
#[path = "tasks.rs"]
mod tasks;
#[path = "text_export.rs"]
mod text_export;
#[path = "locales.rs"]
mod locales;
#[path = "translation.rs"]
mod translation;
#[path = "translation_credentials.rs"]
mod translation_credentials;
#[path = "search_data.rs"]
mod search_data;
#[path = "ide_search.rs"]
mod ide_search;
use search::SearchControl;
use flate2::{read::ZlibDecoder, write::ZlibEncoder, Compression};
use serde::Serialize;
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::Emitter;
const SPLIT: u64 = 0x7fffff00;
const VERSION: u32 = 0x20002;
type Result<T> = std::result::Result<T, String>;

#[cfg(test)]
fn test_client_root() -> std::path::PathBuf {
    std::env::var_os("PW_CLIENT_DIR")
        .filter(|path| !path.is_empty())
        .map(std::path::PathBuf::from)
        .expect("Set PW_CLIENT_DIR to the client directory containing data/ and the PCK files")
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn u(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes(b[o..o + 4].try_into().unwrap())
}
fn put(b: &mut [u8], o: usize, v: u32) {
    b[o..o + 4].copy_from_slice(&v.to_le_bytes());
}
#[derive(Clone, Copy)]
struct Keys {
    g0: u32,
    g1: u32,
    mask: u32,
    check: u32,
}
fn keys(id: u32) -> Keys {
    Keys {
        g0: 0x01207940u32.wrapping_add(id.wrapping_mul(0x72341f2)),
        g1: 0x549d22b4u32.wrapping_add(id.wrapping_mul(0x1237a73)),
        mask: 0x350daa8cu32.wrapping_add(id.wrapping_mul(0xab2321f)),
        check: 0x3e367b13u32.wrapping_add(id.wrapping_mul(0x987a223)),
    }
}
#[derive(Clone)]
struct Entry {
    raw: Vec<u8>,
    name: String,
    offset: u32,
    len: u32,
    packed: u32,
    data: Option<Vec<u8>>,
}
#[derive(Clone)]
struct Archive {
    path: PathBuf,
    entries: Vec<Entry>,
    header: Vec<u8>,
    keys: Keys,
    encrypted: bool,
}
#[derive(Serialize)]
struct Item {
    name: String,
    size: u32,
    packed: u32,
    changed: bool,
}
#[derive(Serialize)]
struct View {
    path: String,
    entries: Vec<Item>,
}
impl Archive {
    fn view(&self) -> View {
        View {
            path: self.path.display().to_string(),
            entries: self
                .entries
                .iter()
                .map(|e| Item {
                    name: e.name.clone(),
                    size: e.len,
                    packed: e.packed,
                    changed: e.data.is_some(),
                })
                .collect(),
        }
    }
    fn read_at(path: &Path, offset: u64, len: usize) -> Result<Vec<u8>> {
        let mut out = vec![0; len];
        let first = if offset < SPLIT {
            len.min((SPLIT - offset) as usize)
        } else {
            0
        };
        if first > 0 {
            let mut f = File::open(path).map_err(err)?;
            f.seek(SeekFrom::Start(offset)).map_err(err)?;
            f.read_exact(&mut out[..first]).map_err(err)?;
        }
        if first < len {
            let mut f = File::open(path.with_extension("pkx")).map_err(err)?;
            f.seek(SeekFrom::Start((offset + first as u64) - SPLIT))
                .map_err(err)?;
            f.read_exact(&mut out[first..]).map_err(err)?;
        }
        Ok(out)
    }
    #[cfg(test)]
    fn open(path: PathBuf) -> Result<Self> {
        Self::open_progress(path, &|_, _, _| {})
    }
    fn open_progress(path: PathBuf, progress: &dyn Fn(&str, usize, usize)) -> Result<Self> {
        let physical = std::fs::metadata(&path).map_err(err)?.len();
        if physical < 280 {
            return Err("PCK is too short".into());
        }
        let safe = Self::read_at(&path, 0, 12)?;
        let end = if matches!(u(&safe, 0), 0x4dca23ef | 0x3f071506) {
            u(&safe, 4) as u64
        } else {
            physical
        };
        if end < 280 {
            return Err("Invalid safe header".into());
        }
        let version = Self::read_at(&path, end - 4, 4)?;
        if u(&version, 0) != VERSION {
            return Err(format!(
                "Unsupported PCK version: 0x{:08x}; expected 0x20002",
                u(&version, 0)
            ));
        }
        // AFilePackGame uses 272 bytes; AFilePackage adds dwDisabledOffset (276).
        let mut header_len = 272usize;
        let mut tail = Self::read_at(&path, end - 280, 280)?;
        if u(&tail, 4) != VERSION {
            if end < 284 {
                return Err("Truncated PCK header".into());
            }
            header_len = 276;
            tail = Self::read_at(&path, end - 284, 284)?;
        }
        if u(&tail, 4) != VERSION {
            return Err("Unrecognized PCK header".into());
        }
        let footer_start = end - header_len as u64 - 8;
        let entry_offset_field = header_len - 264;
        let k = [
            keys(171),
            keys(0),
            Keys {
                g0: 0xfdfdfeee,
                g1: 0xf00dbeef,
                mask: 0xa8937462,
                check: 0x59374231,
            },
            Keys {
                g0: 0xab12908f,
                g1: 0xb3231902,
                mask: 0x2a63810e,
                check: 0x18734563,
            },
        ]
            .into_iter()
            .find(|k| u(&tail, 0) == k.g0 && u(&tail, header_len - 4) == k.g1)
            .ok_or("Unknown guard bytes / algorithm")?;
        let count = u(&tail, header_len) as usize;
        let mut pos = (u(&tail, entry_offset_field) ^ k.mask) as u64;
        if pos > footer_start || count > 2_000_000 {
            return Err("Invalid file table".into());
        }
        let mut entries = Vec::with_capacity(count);
        progress("Reading file table", 0, count);
        for index in 0..count {
            project::build_checkpoint()?;
            if pos + 8 > footer_start {
                return Err("Truncated file table".into());
            }
            let sizes = Self::read_at(&path, pos, 8)?;
            let n = u(&sizes, 0) ^ k.mask;
            if n != (u(&sizes, 4) ^ k.mask ^ k.check)
                || n == 0
                || n > 4096
                || pos + 8 + n as u64 > footer_start
            {
                return Err("Invalid entry size".into());
            }
            let bytes = Self::read_at(&path, pos + 8, n as usize)?;
            let raw = if n == 276 || n == 288 {
                bytes
            } else {
                inflate(&bytes, 288)?
            };
            if raw.len() != 276 && raw.len() != 288 {
                return Err("Unknown entry structure".into());
            }
            let name_end = raw[..260]
                .iter()
                .position(|&v| v == 0)
                .ok_or("Unterminated filename")?;
            let (name, _, bad) = encoding_rs::GBK.decode(&raw[..name_end]);
            if bad {
                return Err("Invalid GBK filename".into());
            }
            let o = if raw.len() == 288 { 268 } else { 260 };
            let offset = u(&raw, o);
            let len = u(&raw, o + 4);
            let packed = u(&raw, o + 8);
            if offset as u64 + packed as u64 > end {
                return Err("Data lies outside the PCK bounds".into());
            }
            entries.push(Entry {
                name: name.into_owned(),
                offset,
                len,
                packed,
                raw,
                data: None,
            });
            pos += 8 + n as u64;
            if index % 256 == 0 || index + 1 == count {
                progress("Reading file table", index + 1, count);
            }
        }
        Ok(Self {
            path,
            entries,
            keys: k,
            encrypted: u(&tail, entry_offset_field + 4) & 0x80000000 != 0,
            header: tail[..header_len].to_vec(),
        })
    }
    fn data(&self, index: usize) -> Result<Vec<u8>> {
        self.data_with_limit(index, true)
    }
    fn data_with_limit(&self, index: usize, preview_limit: bool) -> Result<Vec<u8>> {
        let e = self.entries.get(index).ok_or("File not found")?;
        if let Some(d) = &e.data {
            return Ok(d.clone());
        }
        if preview_limit && e.len > 256 * 1024 * 1024 {
            return Err("Preview/export limit: 256 MiB per file".into());
        }
        let b = Self::read_at(&self.path, e.offset as u64, e.packed.min(e.len) as usize)?;
        self.decode_entry(e, b)
    }
    fn decode_entry(&self, e: &Entry, b: Vec<u8>) -> Result<Vec<u8>> {
        Self::decode_stored(self.encrypted,e,b)
    }
    fn decode_stored(encrypted:bool,e:&Entry,mut b:Vec<u8>)->Result<Vec<u8>> {
        if encrypted {
            let mask = (b.len() as u32).wrapping_add(0x739802ab);
            for c in b.chunks_exact_mut(4) {
                let v = u32::from_be_bytes(c.try_into().unwrap()).rotate_left(16) ^ mask;
                c.copy_from_slice(&v.to_be_bytes());
            }
        }
        if e.packed < e.len {
            b = inflate(&b, e.len as usize)?
        }
        if b.len() != e.len as usize {
            return Err(format!("Unpacked file size mismatch: expected {}, got {} (in PCK: {})", e.len, b.len(), e.packed));
        }
        Ok(b)
    }
    #[cfg(test)]
    fn save(&self, target: &Path) -> Result<()> {
        self.save_progress(target, &|_, _, _| {}).map(|_| ())
    }
    fn save_progress(&self, target: &Path, progress: &dyn Fn(&str, usize, usize)) -> Result<Self> {
        self.write_archive(target, progress, true)
    }
    fn save_new(&self, target: &Path) -> Result<()> {
        self.write_archive(target, &|_, _, _| {}, false).map(|_| ())
    }

    fn write_archive(
        &self,
        target: &Path,
        progress: &dyn Fn(&str, usize, usize),
        overwrite: bool,
    ) -> Result<Self> {
        let target = std::path::absolute(target).map_err(err)?;
        if target
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("pkx"))
        {
            return Err("Specify the main PCK filename".into());
        }
        let parent = target.parent().ok_or("Missing destination directory")?;
        let companion = target.with_extension("pkx");
        for path in [&target, &companion] {
            match std::fs::symlink_metadata(path) {
                Ok(meta) if !overwrite || !meta.is_file() => {
                    return Err(format!(
                        "Destination file already exists: {}",
                        path.display()
                    ));
                }
                Ok(_) => reject_link(path)?,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(err(error)),
            }
        }
        let stage = tempfile::Builder::new()
            .prefix(".pck-save-")
            .tempdir_in(parent)
            .map_err(err)?;
        let staged_pck = stage.path().join("archive.pck");
        let mut checked = project::write_archive(self, &staged_pck, &Default::default(), progress)?;
        progress("Publishing archive", 0, 0);
        publish_archive(stage, &staged_pck, &target, overwrite)?;
        checked.path = target;
        Ok(checked)
    }
}

fn existing_companion(path: &Path) -> Result<bool> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() => {
            reject_link(path)?;
            Ok(true)
        }
        Ok(_) => Err(format!("Invalid destination file: {}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(err(error)),
    }
}

fn publish_archive(
    stage: tempfile::TempDir,
    staged_pck: &Path,
    target: &Path,
    overwrite: bool,
) -> Result<()> {
    let companion = target.with_extension("pkx");
    let staged_pkx = staged_pck.with_extension("pkx");
    let pck = tempfile::TempPath::try_from_path(staged_pck).map_err(err)?;
    let pkx = staged_pkx
        .is_file()
        .then(|| tempfile::TempPath::try_from_path(staged_pkx))
        .transpose()
        .map_err(err)?;
    let backup = stage.path().join("previous.pkx");
    let backed_up = if overwrite && existing_companion(&companion)? {
        match std::fs::rename(&companion, &backup) {
            Ok(()) => true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => return Err(err(error)),
        }
    } else {
        false
    };
    let mut published_companion = false;
    let result = (|| -> Result<()> {
        if let Some(pkx) = pkx {
            pkx.persist_noclobber(&companion).map_err(err)?;
            published_companion = true;
        }
        if overwrite {
            pck.persist(target).map_err(err)?;
        } else {
            pck.persist_noclobber(target).map_err(err)?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        let restored = if backed_up {
            std::fs::rename(&backup, &companion)
        } else if published_companion {
            std::fs::remove_file(&companion)
        } else {
            Ok(())
        };
        if let Err(restore_error) = restored {
            return Err(format!(
                "{error}. Rollback failed: {restore_error}. Temporary files: {}",
                stage.keep().display()
            ));
        }
        return Err(error);
    }
    Ok(())
}

fn inflate(b: &[u8], limit: usize) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    ZlibDecoder::new(b)
        .take(limit as u64 + 1)
        .read_to_end(&mut out)
        .map_err(err)?;
    if out.len() > limit {
        return Err("Decompression size limit exceeded".into());
    }
    Ok(out)
}
fn compress(b: &[u8]) -> Result<Vec<u8>> {
    let mut z = ZlibEncoder::new(Vec::new(), Compression::default());
    z.write_all(b).map_err(err)?;
    let c = z.finish().map_err(err)?;
    Ok(if c.len() < b.len() { c } else { b.to_vec() })
}
#[derive(Default, Clone)]
struct App(Arc<Mutex<Option<Archive>>>);
#[derive(Default, Clone)]
struct SurfaceCache(Arc<Mutex<Option<Archive>>>);

fn read_surface_impl(name: &str, state: &App, cache: &SurfaceCache) -> Result<Vec<u8>> {
    let path = state.0.lock().map_err(err)?.as_ref()
        .ok_or("Open an archive")?.path.clone();
    let parent = path.parent().ok_or("Archive directory is missing")?;
    let archive_name = if name.to_lowercase().ends_with(".gfx") || name.replace('\\', "/").to_lowercase().starts_with("gfx/") { "gfx.pck" } else { "surfaces.pck" };
    let surface_path = std::fs::read_dir(parent).map_err(err)?
        .filter_map(|entry| entry.ok())
        .find(|entry| entry.file_name().to_string_lossy().eq_ignore_ascii_case(archive_name))
        .ok_or_else(|| format!("{archive_name} is missing next to the open archive"))?.path();
    let mut guard = cache.0.lock().map_err(err)?;
    if guard.as_ref().map(|a| &a.path) != Some(&surface_path) {
        *guard = None;
        *guard = Some(Archive::open_progress(surface_path, &|_, _, _| {})?);
    }
    let archive = guard.as_ref().ok_or("Failed to open surfaces.pck")?;
    let normalize = |s: &str| s.replace('\\', "/").trim_start_matches('/').to_lowercase();
    let requested = normalize(name);
    let relative = requested.strip_prefix("surfaces/").or_else(|| requested.strip_prefix("gfx/")).unwrap_or(&requested);
    let index = archive.entries.iter().position(|entry| {
        let key = normalize(&entry.name);
        key.strip_prefix("surfaces/").or_else(|| key.strip_prefix("gfx/")).unwrap_or(&key) == relative
    }).ok_or_else(|| format!("Texture not found in surfaces.pck: {name}"))?;
    archive.data(index)
}

#[tauri::command]
async fn read_surface_texture(name: String, state: tauri::State<'_, App>, cache: tauri::State<'_, SurfaceCache>) -> Result<Vec<u8>> {
    let state = state.inner().clone();
    let cache = cache.inner().clone();
    tauri::async_runtime::spawn_blocking(move || read_surface_impl(&name, &state, &cache)).await.map_err(err)?
}
fn read_entry_impl(index: usize, state: &App) -> Result<Vec<u8>> {
    state
        .0
        .lock()
        .map_err(err)?
        .as_ref()
        .ok_or("Open an archive")?
        .data(index)
}
fn edit_entry_impl(
    index: Option<usize>,
    name: String,
    data: Option<Vec<u8>>,
    state: &App,
) -> Result<View> {
    let mut g = state.0.lock().map_err(err)?;
    let a = g.as_mut().ok_or("Open an archive")?;
    if a.encrypted {
        return Err("Editing encrypted archives is unsupported".into());
    }
    if let Some(d) = data {
        if d.len() > 256 * 1024 * 1024 {
            return Err("File exceeds 256 MiB".into());
        }
        let normalized = name.replace('/', "\\");
        if normalized.is_empty()
            || normalized.split('\\').any(|p| p == ".." || p.is_empty())
            || normalized.contains(':')
        {
            return Err("Invalid path inside archive".into());
        }
        let (enc, _, bad) = encoding_rs::GBK.encode(&normalized);
        if bad || enc.len() > 259 {
            return Err("The name must fit within 259 GBK bytes".into());
        }
        if a.entries
            .iter()
            .enumerate()
            .any(|(i, e)| Some(i) != index && e.name.eq_ignore_ascii_case(&normalized))
        {
            return Err("This name already exists".into());
        }
        let mut raw = if let Some(i) = index {
            a.entries.get(i).ok_or("File not found")?.raw.clone()
        } else {
            vec![0; 276]
        };
        raw[..260].fill(0);
        raw[..enc.len()].copy_from_slice(&enc);
        let e = Entry {
            name: normalized,
            offset: 0,
            len: d.len() as u32,
            packed: 0,
            raw,
            data: Some(d),
        };
        if let Some(i) = index {
            a.entries[i] = e
        } else {
            a.entries.push(e)
        }
    } else {
        let i = index.ok_or("No file selected")?;
        if i >= a.entries.len() {
            return Err("File not found".into());
        }
        a.entries.remove(i);
    }
    Ok(a.view())
}
fn import_file_impl(path: String) -> Result<Vec<u8>> {
    if std::fs::metadata(&path).map_err(err)?.len() > 256 * 1024 * 1024 {
        return Err("256 MiB limit".into());
    }
    std::fs::read(path).map_err(err)
}
fn export_entry_impl(index: usize, path: String, state: &App) -> Result<()> {
    let data = state
        .0
        .lock()
        .map_err(err)?
        .as_ref()
        .ok_or("Open an archive")?
        .data(index)?;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(err)?;
    f.write_all(&data).map_err(err)
}
fn encode_text(text: String, encoding: String) -> Result<Vec<u8>> {
    match encoding.as_str() {
        "utf-8" => Ok(text.into_bytes()),
        "utf-16le" => Ok(text.encode_utf16().flat_map(u16::to_le_bytes).collect()),
        "utf-16be" => Ok(text.encode_utf16().flat_map(u16::to_be_bytes).collect()),
        "gbk" => {
            let (b, _, bad) = encoding_rs::GBK.encode(&text);
            if bad {
                Err("The text contains characters that cannot be represented in GBK".into())
            } else {
                Ok(b.into_owned())
            }
        }
        _ => Err("Unknown encoding".into()),
    }
}

#[derive(Clone, Serialize)]
struct Progress {
    operation: String,
    stage: String,
    completed: usize,
    total: usize,
}
fn report(app: &tauri::AppHandle, operation: &str, stage: &str, completed: usize, total: usize) {
    let _ = app.emit(
        "pck-progress",
        Progress {
            operation: operation.into(),
            stage: stage.into(),
            completed,
            total,
        },
    );
}
async fn background<T, F>(app: tauri::AppHandle, operation: &'static str, job: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(tauri::AppHandle) -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        report(&app, operation, "Preparing", 0, 0);
        let result = job(app.clone());
        report(
            &app,
            operation,
            if result.is_ok() {
                "Done"
            } else {
                "Error"
            },
            1,
            1,
        );
        result
    })
        .await
        .map_err(err)?
}
#[tauri::command]
async fn open_archive(
    path: String,
    state: tauri::State<'_, App>,
    app: tauri::AppHandle,
) -> Result<View> {
    let state = state.inner().clone();
    background(app, "Opening", move |app| {
        let a = Archive::open_progress(path.into(), &|stage, done, total| {
            report(&app, "Opening", stage, done, total)
        })?;
        report(&app, "Opening", "Preparing file list", 0, 0);
        let view = a.view();
        *state.0.lock().map_err(err)? = Some(a);
        Ok(view)
    })
        .await
}
#[tauri::command]
async fn read_entry(
    index: usize,
    state: tauri::State<'_, App>,
    app: tauri::AppHandle,
) -> Result<Vec<u8>> {
    let state = state.inner().clone();
    background(app, "Reading entry", move |_| {
        read_entry_impl(index, &state)
    })
        .await
}
#[tauri::command]
async fn edit_entry(
    index: Option<usize>,
    name: String,
    data: Option<Vec<u8>>,
    state: tauri::State<'_, App>,
    app: tauri::AppHandle,
) -> Result<View> {
    let state = state.inner().clone();
    background(app, "Updating archive", move |_| {
        edit_entry_impl(index, name, data, &state)
    })
        .await
}
#[tauri::command]
async fn save_archive(
    path: String,
    state: tauri::State<'_, App>,
    app: tauri::AppHandle,
) -> Result<View> {
    let state = state.inner().clone();
    background(app, "Saving", move |app| {
        let mut guard = state.0.lock().map_err(err)?;
        let saved = guard
            .as_ref()
            .ok_or("Open an archive")?
            .save_progress(Path::new(&path), &|stage, done, total| {
                report(&app, "Saving", stage, done, total)
            })?;
        let view = saved.view();
        *guard = Some(saved);
        Ok(view)
    })
        .await
}
#[tauri::command]
async fn import_file(path: String, app: tauri::AppHandle) -> Result<Vec<u8>> {
    background(app, "Importing file", move |_| {
        import_file_impl(path)
    })
        .await
}
#[tauri::command]
async fn export_entry(
    index: usize,
    path: String,
    state: tauri::State<'_, App>,
    app: tauri::AppHandle,
) -> Result<()> {
    let state = state.inner().clone();
    background(app, "Exporting file", move |_| {
        export_entry_impl(index, path, &state)
    })
        .await
}
#[tauri::command]
async fn encode_text_command(
    text: String,
    encoding: String,
    app: tauri::AppHandle,
) -> Result<Vec<u8>> {
    background(app, "Encoding text", move |_| {
        encode_text(text, encoding)
    })
        .await
}
#[tauri::command]
async fn open_search_window(app: tauri::AppHandle) -> Result<()> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("search") {
        window.show().map_err(err)?;
        window.set_focus().map_err(err)?;
    } else {
        tauri::WebviewWindowBuilder::new(&app, "search", tauri::WebviewUrl::App("index.html#search".into()))
            .title("Find in Files — PW Forge").inner_size(1100.0, 720.0)
            .min_inner_size(520.0, 320.0).decorations(false).build().map_err(err)?;
    }
    Ok(())
}
#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle) -> Result<()> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("settings") {
        window.show().map_err(err)?;
        window.set_focus().map_err(err)?;
    } else {
        tauri::WebviewWindowBuilder::new(&app, "settings", tauri::WebviewUrl::App("index.html#settings".into()))
            .title("Settings — PW Forge").inner_size(820.0, 680.0)
            .min_inner_size(640.0, 480.0).decorations(false).build().map_err(err)?;
    }
    Ok(())
}
#[tauri::command]
async fn open_resource_window(name: String, state: tauri::State<'_, App>) -> Result<()> {
    let current = state.0.lock().map_err(err)?.as_ref().ok_or("Open an archive")?.path.clone();
    let parent = current.parent().ok_or("Archive directory is missing")?;
    let normalized = name.replace('\\', "/").to_lowercase();
    let extension = normalized.rsplit('.').next().unwrap_or("");
    let archive_name = if extension == "gfx" || normalized.starts_with("gfx/") { "gfx.pck" } else if matches!(extension, "wav" | "mp3" | "ogg") { "sfx.pck" } else if matches!(extension, "ecm" | "smd" | "ski" | "skn" | "bon") { "models.pck" } else if matches!(extension, "hlsl" | "vsh" | "psh" | "fx") { "shaders.pck" } else { "surfaces.pck" };
    let path = std::fs::read_dir(parent).map_err(err)?.filter_map(|e| e.ok())
        .find(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(archive_name))
        .ok_or_else(|| format!("{archive_name} is missing"))?.path();
    std::process::Command::new(std::env::current_exe().map_err(err)?)
        .arg("--open-archive").arg(path).arg("--select-entry").arg(name)
        .spawn().map_err(err)?;
    Ok(())
}
#[tauri::command]
fn startup_target() -> Option<(String, String)> {
    startup::target(std::env::args_os())
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                native_gfx::shutdown();
                use tauri::Manager;
                window.app_handle().exit(0);
            }
        })
        .manage(App::default())
        .manage(SurfaceCache::default())
        .manage(SearchControl::default())
        .manage(elements::Elements::default())
        .manage(ide::Ide::default())
        .invoke_handler(tauri::generate_handler![
            open_project_github,
            open_project_releases,
            check_app_update,
            install_app_update,
            open_build_directory,
            ide::ide_open,ide::ide_read,ide::ide_resource,ide::ide_save,ide::ide_save_archive,ide::ide_close,ide::ide_native_context,ide::ide_fonts,ide::ide_font,
            ide::ide_save_domain,
            ide::ide_export_server_data,
            ide::ide_export_controller,
            ide::ide_read_binary,
            ide::ide_import_server,
            ide::ide_save_aipolicy,
            ide::ide_save_server_records,
            ide::ide_item_descriptions,
            tasks::tasks_open, tasks::tasks_detail, tasks::tasks_save,
            text_export::ide_export_texts,
            locales::ide_locale_page, locales::ide_locale_save, locales::ide_locale_apply,
            translation::ide_translate_row,
            translation_credentials::ide_translation_key_load,
            translation_credentials::ide_translation_key_store,
            locales::batch::ide_locale_batch_start, locales::batch::ide_locale_batch_cancel, locales::batch::ide_locale_batch_status,
            project::project_scan,
            project::project_create,
            project::project_open,
            project::project_set_client_version,
            ide::ide_check_interface_compatibility,
            project::project_startup,
            project::project_children,
            project::project_read,
            project::project_write,
            project::project_path,
            project::project_build,
            project::project_cancel_build,
            project::project_clean_builds,
            project::project_register_association,
            elements::elements_open,
            elements::elements_open_project,
            elements::elements_open_ide,
            elements::elements_schema_profiles,
            elements::elements_close,
            elements::elements_rows,
            elements::gshop_categories,
            elements::gshop_inventory_atlas,
            elements::elements_record,
            elements::elements_find_item,
            elements::elements_update,
            elements::elements_save,
            elements::gshop_export_server,
            open_search_window,
            open_settings_window,
            ide_search::ide_search,
            ide::ide_search_preview,
            ide::ide_search_sources,
            open_resource_window,
            startup_target,
            ui_fonts::list_ui_fonts,
            ui_fonts::read_ui_font,
            native_gfx::native_gfx_create,
            native_gfx::native_gfx_frame,
            native_gfx::native_gfx_close,
            native_gfx::native_gfx_animations,
            native_gfx::native_gfx_export_glb,
            search::search_contents,
            search::cancel_search,
            open_archive,
            read_entry,
            read_surface_texture,
            edit_entry,
            save_archive,
            import_file,
            encode_text_command,
            export_entry,
            extract_archive,
            pack_folder
        ])
        .run(tauri::generate_context!())
        .expect("LRPW | PCK View startup failed");
}

#[cfg(test)]
#[path = "tests/archive.rs"]
mod tests;

#[cfg(test)]
#[path = "tests/game_header.rs"]
mod game_header_tests;
use std::collections::HashSet;

fn archive_relative(name: &str) -> Result<PathBuf> {
    let name = name.replace('\\', "/");
    let mut path = PathBuf::new();
    for part in name.split('/') {
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.ends_with([' ', '.'])
            || part.chars().any(|c| c < ' ' || "<>:\"|?*".contains(c))
            || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        {
            return Err(format!("Invalid resource path: {name}"));
        }
        path.push(part);
    }
    Ok(path)
}
fn reject_link(path: &Path) -> Result<()> {
    let meta = std::fs::symlink_metadata(path).map_err(err)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err(format!(
                "Links/junctions are unsupported: {}",
                path.display()
            ));
        }
    }
    if meta.file_type().is_symlink() {
        return Err(format!("Link: {}", path.display()));
    }
    Ok(())
}
#[derive(Serialize)]
struct ExtractionResult {
    extracted: usize,
    errors: Vec<String>,
}
fn extract_all_impl(
    archive: &Archive,
    directory: &Path,
    progress: &(dyn Fn(&str, usize, usize) + Sync),
) -> Result<ExtractionResult> {
    use std::sync::{atomic::{AtomicUsize, Ordering}, Condvar};
    reject_link(directory)?;
    let root = std::fs::canonicalize(directory).map_err(err)?;
    let mut seen = HashSet::new();
    let paths = archive.entries.iter().map(|entry| {
        let rel = archive_relative(&entry.name)?;
        if !seen.insert(entry.name.replace('/', "\\").to_lowercase()) {
            return Err(format!("Duplicate path: {}", entry.name));
        }
        Ok(rel)
    }).collect::<Result<Vec<_>>>()?;
    // Refuse overwriting the source archive before starting any workers.
    let sources: Vec<_> = [archive.path.clone(), archive.path.with_extension("pkx")]
        .iter().filter_map(|path| std::fs::canonicalize(path).ok()).collect();
    for rel in &paths {
        let target = root.join(rel);
        if let Ok(existing) = std::fs::canonicalize(&target) {
            if sources.contains(&existing) {
                return Err("Extraction cannot overwrite the source PCK/PKX".into());
            }
        }
    }
    let next = AtomicUsize::new(0);
    let errors = Mutex::new(Vec::<(usize, String)>::new());
    let completed = Mutex::new((0usize, std::time::Instant::now()));
    let budget = (Mutex::new(0u64), Condvar::new());
    const MEMORY_BUDGET: u64 = 512 * 1024 * 1024;
    let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1).min(4).min(paths.len());
    progress("Extracting", 0, paths.len());
    std::thread::scope(|scope| {
        let mut handles = Vec::new();
        for _ in 0..workers {
            handles.push(scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    if i >= paths.len() { break; }
                    let entry = &archive.entries[i];
                    let weight = (entry.len as u64 + entry.packed.min(entry.len) as u64).max(1);
                    {
                        let mut used = budget.0.lock().unwrap();
                        while *used > 0 && used.saturating_add(weight) > MEMORY_BUDGET {
                            used = budget.1.wait(used).unwrap();
                        }
                        *used += weight;
                    }
                    let result = (|| -> Result<()> {
                        let rel = &paths[i];
                        let mut parent = root.clone();
                        for component in rel.parent().unwrap_or(Path::new("")).components() {
                            parent.push(component);
                            match std::fs::create_dir(&parent) {
                                Ok(()) => {},
                                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {},
                                Err(error) => return Err(err(error)),
                            }
                            reject_link(&parent)?;
                        }
                        let target = root.join(rel);
                        if std::fs::symlink_metadata(&target).is_ok() { reject_link(&target)?; }
                        let data = archive.data_with_limit(i, false)?;
                        let mut temp = tempfile::NamedTempFile::new_in(&parent).map_err(err)?;
                        temp.write_all(&data).map_err(err)?;
                        // No per-resource disk barrier: extraction is not an archive commit.
                        temp.persist(&target).map_err(err)?;
                        Ok(())
                    })();
                    {
                        let mut used = budget.0.lock().unwrap();
                        *used -= weight;
                        budget.1.notify_all();
                    }
                    if let Err(error) = result {
                        errors.lock().unwrap().push((i, format!("{}: {error}", entry.name)));
                    }
                    let mut done = completed.lock().unwrap();
                    done.0 += 1;
                    if done.0 == paths.len() || done.0 % 32 == 0 || done.1.elapsed().as_millis() >= 100 {
                        progress(&entry.name, done.0, paths.len());
                        done.1 = std::time::Instant::now();
                    }
                }
            }));
        }
        for handle in handles {
            handle.join().map_err(|_| "Extraction worker failed".to_string())?;
        }
        Ok::<(), String>(())
    })?;
    let mut errors = errors.into_inner().map_err(err)?;
    errors.sort_by_key(|(index, _)| *index);
    Ok(ExtractionResult { extracted: paths.len() - errors.len(), errors: errors.into_iter().map(|(_, error)| error).collect() })
}
fn collect_files(root: &Path, directory: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
    reject_link(directory)?;
    for item in std::fs::read_dir(directory).map_err(err)? {
        let path = item.map_err(err)?.path();
        reject_link(&path)?;
        if path.is_dir() {
            collect_files(root, &path, files)?;
        } else if path.is_file() {
            files.push(path.strip_prefix(root).map_err(err)?.to_path_buf());
        }
    }
    Ok(())
}
fn pack_folder_impl(
    directory: &Path,
    target: &Path,
    progress: &dyn Fn(&str, usize, usize),
) -> Result<Archive> {
    reject_link(directory)?;
    let root = std::fs::canonicalize(directory).map_err(err)?;
    let target_absolute = if target.exists() {
        std::fs::canonicalize(target).map_err(err)?
    } else {
        std::fs::canonicalize(target.parent().ok_or("Missing destination directory")?)
            .map_err(err)?
            .join(target.file_name().ok_or("Missing archive filename")?)
    };
    if target_absolute.starts_with(&root) {
        return Err("Choose a PCK destination outside the source folder".into());
    }
    let mut files = Vec::new();
    progress("Scanning folder", 0, 0);
    collect_files(&root, &root, &mut files)?;
    files.sort();
    let mut spool =
        tempfile::NamedTempFile::new_in(target.parent().ok_or("Missing destination directory")?)
            .map_err(err)?;
    let k = keys(171);
    let mut header = vec![0; 272];
    put(&mut header, 0, k.g0);
    put(&mut header, 4, VERSION);
    put(&mut header, 268, k.g1);
    let mut archive = Archive {
        path: spool.path().to_path_buf(),
        entries: Vec::new(),
        header,
        keys: k,
        encrypted: false,
    };
    let mut names = HashSet::new();
    for (i, rel) in files.iter().enumerate() {
        let name = rel
            .to_str()
            .ok_or("The path contains unsupported characters")?
            .replace('/', "\\");
        archive_relative(&name)?;
        if !names.insert(name.to_lowercase()) {
            return Err(format!("Duplicate name: {name}"));
        }
        let (encoded, _, bad) = encoding_rs::GBK.encode(&name);
        if bad || encoded.len() > 259 {
            return Err(format!("Name cannot be represented in GBK: {name}"));
        }
        if i % 32 == 0 {
            progress(&name, i, files.len());
        }
        let mut source = File::open(root.join(rel)).map_err(err)?;
        let len = source.metadata().map_err(err)?.len();
        let offset = spool.stream_position().map_err(err)?;
        if len >= SPLIT || offset + len >= SPLIT {
            return Err("The folder exceeds the single PCK limit (2 GiB)".into());
        }
        let mut encoder = ZlibEncoder::new(spool.as_file_mut(), Compression::default());
        let copied = std::io::copy(&mut source, &mut encoder).map_err(err)?;
        encoder.finish().map_err(err)?;
        if copied != len {
            return Err(format!("File size changed while reading: {name}"));
        }
        let mut packed = spool.stream_position().map_err(err)? - offset;
        if packed >= len {
            spool.as_file_mut().set_len(offset).map_err(err)?;
            spool.seek(SeekFrom::Start(offset)).map_err(err)?;
            source.seek(SeekFrom::Start(0)).map_err(err)?;
            packed = std::io::copy(&mut source, &mut spool).map_err(err)?;
        }
        let mut raw = vec![0; 276];
        raw[..encoded.len()].copy_from_slice(&encoded);
        archive.entries.push(Entry {
            raw,
            name,
            offset: offset as u32,
            len: len as u32,
            packed: packed as u32,
            data: None,
        });
        if (i + 1) % 32 == 0 || i + 1 == files.len() {
            progress("Packing resources", i + 1, files.len());
        }
    }
    spool.as_file_mut().flush().map_err(err)?;
    archive.save_progress(target, progress)
}
#[tauri::command]
async fn extract_archive(
    directory: String,
    state: tauri::State<'_, App>,
    app: tauri::AppHandle,
) -> Result<ExtractionResult> {
    let state = state.inner().clone();
    background(app, "Extracting", move |app| {
        let guard = state.0.lock().map_err(err)?;
        let archive = guard.as_ref().ok_or("Open an archive")?;
        extract_all_impl(archive, Path::new(&directory), &|stage, done, total| {
            report(&app, "Extracting", stage, done, total)
        })
    })
        .await
}
#[tauri::command]
async fn pack_folder(
    directory: String,
    path: String,
    state: tauri::State<'_, App>,
    app: tauri::AppHandle,
) -> Result<View> {
    let state = state.inner().clone();
    background(app, "Packing", move |app| {
        let mut guard = state.0.lock().map_err(err)?;
        let archive = pack_folder_impl(
            Path::new(&directory),
            Path::new(&path),
            &|stage, done, total| report(&app, "Packing", stage, done, total),
        )?;
        let view = archive.view();
        *guard = Some(archive);
        Ok(view)
    })
        .await
}

#[cfg(test)]
#[path = "tests/bulk.rs"]
mod bulk_tests;


#[tauri::command]
fn open_project_github() -> Result<()> {
    open_browser("https://github.com/LRPW/pw-forge")
}

#[tauri::command]
fn open_project_releases() -> Result<()> {
    open_browser("https://github.com/LRPW/pw-forge/releases/latest")
}

fn open_browser(address: &str) -> Result<()> {
    #[cfg(windows)]
    {
        #[link(name = "shell32")]
        extern "system" {
            fn ShellExecuteW(hwnd: *mut std::ffi::c_void, operation: *const u16, file: *const u16,
                parameters: *const u16, directory: *const u16, show: i32) -> isize;
        }
        let operation: Vec<u16> = "open\0".encode_utf16().collect();
        let url: Vec<u16> = address.encode_utf16().chain(std::iter::once(0)).collect();
        let result = unsafe { ShellExecuteW(std::ptr::null_mut(), operation.as_ptr(), url.as_ptr(),
            std::ptr::null(), std::ptr::null(), 1) };
        if result <= 32 { return Err(format!("Could not open GitHub: {result}")); }
        Ok(())
    }
    #[cfg(not(windows))]
    { Err("Opening the project browser is only supported on Windows".into()) }
}

#[tauri::command]
fn open_build_directory(directory: String) -> Result<()> {
    let path = std::path::Path::new(&directory).canonicalize().map_err(err)?;
    if !path.is_dir() { return Err("Build directory does not exist".into()); }
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe").arg(path).spawn().map_err(err)?;
        Ok(())
    }
    #[cfg(not(windows))]
    { Err("Explorer is only available on Windows".into()) }
}

fn portable_build() -> Result<bool> {
    Ok(std::env::current_exe().map_err(err)?.with_file_name("pwforge-portable.marker").is_file())
}

fn app_updater(app: &tauri::AppHandle) -> Result<tauri_plugin_updater::Updater> {
    use tauri_plugin_updater::UpdaterExt;
    let public_key = app.config().plugins.0.get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if public_key.is_empty() {
        return Err("Updates are available in signed release builds.".into());
    }
    app.updater().map_err(err)
}

#[derive(serde::Serialize)]
struct AppUpdate {
    version: String,
    portable: bool,
}

#[tauri::command]
async fn check_app_update(app: tauri::AppHandle) -> Result<Option<AppUpdate>> {
    let portable = portable_build()?;
    Ok(app_updater(&app)?.check().await.map_err(err)?.map(|update| AppUpdate {
        version: update.version,
        portable,
    }))
}

#[tauri::command]
async fn install_app_update(app: tauri::AppHandle, version: String) -> Result<()> {
    if portable_build()? {
        return Err("Download the portable update from GitHub Releases.".into());
    }
    let update = app_updater(&app)?.check().await.map_err(err)?
        .ok_or("The update is no longer available.")?;
    if update.version != version {
        return Err("The available version changed. Check for updates again.".into());
    }
    let bytes = update.download(|_, _| {}, || {}).await.map_err(err)?;
    native_gfx::shutdown();
    update.install(bytes).map_err(err)
}
