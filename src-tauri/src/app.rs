#[path = "search/mod.rs"]
mod search;
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
            return Err("PCK слишком короткий".into());
        }
        let safe = Self::read_at(&path, 0, 12)?;
        let end = if matches!(u(&safe, 0), 0x4dca23ef | 0x3f071506) {
            u(&safe, 4) as u64
        } else {
            physical
        };
        if end < 280 {
            return Err("Некорректный safe header".into());
        }
        let version = Self::read_at(&path, end - 4, 4)?;
        if u(&version, 0) != VERSION {
            return Err(format!(
                "Неподдерживаемая версия PCK: 0x{:08x}; ожидается 0x20002",
                u(&version, 0)
            ));
        }
        // AFilePackGame uses 272 bytes; AFilePackage adds dwDisabledOffset (276).
        let mut header_len = 272usize;
        let mut tail = Self::read_at(&path, end - 280, 280)?;
        if u(&tail, 4) != VERSION {
            if end < 284 {
                return Err("Заголовок PCK обрезан".into());
            }
            header_len = 276;
            tail = Self::read_at(&path, end - 284, 284)?;
        }
        if u(&tail, 4) != VERSION {
            return Err("Не распознан заголовок PCK".into());
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
            .ok_or("Неизвестные guard bytes / алгоритм")?;
        let count = u(&tail, header_len) as usize;
        let mut pos = (u(&tail, entry_offset_field) ^ k.mask) as u64;
        if pos > footer_start || count > 2_000_000 {
            return Err("Некорректная таблица файлов".into());
        }
        let mut entries = Vec::with_capacity(count);
        progress("Чтение таблицы файлов", 0, count);
        for index in 0..count {
            if pos + 8 > footer_start {
                return Err("Таблица обрезана".into());
            }
            let sizes = Self::read_at(&path, pos, 8)?;
            let n = u(&sizes, 0) ^ k.mask;
            if n != (u(&sizes, 4) ^ k.mask ^ k.check)
                || n == 0
                || n > 4096
                || pos + 8 + n as u64 > footer_start
            {
                return Err("Некорректный размер записи".into());
            }
            let bytes = Self::read_at(&path, pos + 8, n as usize)?;
            let raw = if n == 276 || n == 288 {
                bytes
            } else {
                inflate(&bytes, 288)?
            };
            if raw.len() != 276 && raw.len() != 288 {
                return Err("Неизвестная структура записи".into());
            }
            let name_end = raw[..260]
                .iter()
                .position(|&v| v == 0)
                .ok_or("Имя без терминатора")?;
            let (name, _, bad) = encoding_rs::GBK.decode(&raw[..name_end]);
            if bad {
                return Err("Некорректное GBK имя".into());
            }
            let o = if raw.len() == 288 { 268 } else { 260 };
            let offset = u(&raw, o);
            let len = u(&raw, o + 4);
            let packed = u(&raw, o + 8);
            if offset as u64 + packed as u64 > end {
                return Err("Данные выходят за границы PCK".into());
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
                progress("Чтение таблицы файлов", index + 1, count);
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
        let e = self.entries.get(index).ok_or("Файл не найден")?;
        if let Some(d) = &e.data {
            return Ok(d.clone());
        }
        if preview_limit && e.len > 256 * 1024 * 1024 {
            return Err("Лимит просмотра/экспорта: 256 MiB на файл".into());
        }
        let b = Self::read_at(&self.path, e.offset as u64, e.packed as usize)?;
        self.decode_entry(e, b)
    }
    fn decode_entry(&self, e: &Entry, mut b: Vec<u8>) -> Result<Vec<u8>> {
        if self.encrypted {
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
            return Err(format!("Размер распакованного файла не совпал: ожидалось {}, получено {} (в PCK: {})", e.len, b.len(), e.packed));
        }
        Ok(b)
    }
    #[cfg(test)]
    fn save(&self, target: &Path) -> Result<()> {
        self.save_progress(target, &|_, _, _| {}).map(|_| ())
    }
    fn save_progress(&self, target: &Path, progress: &dyn Fn(&str, usize, usize)) -> Result<Self> {
        let parent = target.parent().ok_or("Нет каталога назначения")?;
        let mut f = tempfile::NamedTempFile::new_in(parent).map_err(err)?;
        let mut safe = vec![0; 12];
        put(&mut safe, 0, 0x4dca23ef);
        put(&mut safe, 8, 0x56a089b7);
        f.write_all(&safe).map_err(err)?;
        let mut rows = Vec::new();
        progress("Запись ресурсов", 0, self.entries.len());
        for (i, e) in self.entries.iter().enumerate() {
            let mut raw = e.raw.clone();
            let offset = f.stream_position().map_err(err)?;
            let b = if let Some(d) = &e.data {
                compress(d)?
            } else {
                Self::read_at(&self.path, e.offset as u64, e.packed as usize)?
            };
            if offset + b.len() as u64 >= SPLIT {
                return Err("Сохранение разделённых PCK/PKX пока не поддерживается".into());
            }
            f.write_all(&b).map_err(err)?;
            let o = if raw.len() == 288 { 268 } else { 260 };
            put(&mut raw, o, offset as u32);
            put(&mut raw, o + 4, e.len);
            put(&mut raw, o + 8, b.len() as u32);
            rows.push(raw);
            if i % 64 == 0 || i + 1 == self.entries.len() {
                progress("Запись ресурсов", i + 1, self.entries.len());
            }
        }
        let table = f.stream_position().map_err(err)? as u32;
        progress("Запись таблицы", 0, self.entries.len());
        for (i, row) in rows.into_iter().enumerate() {
            let b = compress(&row)?;
            let n = b.len() as u32;
            f.write_all(&(n ^ self.keys.mask).to_le_bytes())
                .map_err(err)?;
            f.write_all(&(n ^ self.keys.mask ^ self.keys.check).to_le_bytes())
                .map_err(err)?;
            f.write_all(&b).map_err(err)?;
            if i % 256 == 0 || i + 1 == self.entries.len() {
                progress("Запись таблицы", i + 1, self.entries.len());
            }
        }
        let mut header = self.header.clone();
        let offset_field = header.len() - 264;
        put(&mut header, offset_field, table ^ self.keys.mask);
        f.write_all(&header).map_err(err)?;
        f.write_all(&(self.entries.len() as u32).to_le_bytes())
            .map_err(err)?;
        f.write_all(&VERSION.to_le_bytes()).map_err(err)?;
        let end = f.stream_position().map_err(err)?;
        if end >= SPLIT {
            return Err("Выходной архив превышает лимит одного PCK".into());
        }
        put(&mut safe, 4, end as u32);
        f.seek(SeekFrom::Start(0)).map_err(err)?;
        f.write_all(&safe).map_err(err)?;
        f.as_file().sync_all().map_err(err)?;
        progress("Проверка сохранённого архива", 0, self.entries.len());
        let mut checked = Self::open_progress(f.path().to_path_buf(), &|_, done, total| {
            progress("Проверка таблицы", done, total)
        })?;
        for (i, e) in self.entries.iter().enumerate() {
            if e.data.is_some() && checked.data(i)? != self.data(i)? {
                return Err("Проверка записи не прошла".into());
            }
        }
        progress("Публикация файла", 0, 0);
        f.persist(target).map_err(err)?;
        checked.path = target.to_path_buf();
        Ok(checked)
    }
}
fn inflate(b: &[u8], limit: usize) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    ZlibDecoder::new(b)
        .take(limit as u64 + 1)
        .read_to_end(&mut out)
        .map_err(err)?;
    if out.len() > limit {
        return Err("Превышен размер распаковки".into());
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
fn read_entry_impl(index: usize, state: &App) -> Result<Vec<u8>> {
    state
        .0
        .lock()
        .map_err(err)?
        .as_ref()
        .ok_or("Откройте архив")?
        .data(index)
}
fn edit_entry_impl(
    index: Option<usize>,
    name: String,
    data: Option<Vec<u8>>,
    state: &App,
) -> Result<View> {
    let mut g = state.0.lock().map_err(err)?;
    let a = g.as_mut().ok_or("Откройте архив")?;
    if a.encrypted {
        return Err("Изменение зашифрованных архивов не поддерживается".into());
    }
    if let Some(d) = data {
        if d.len() > 256 * 1024 * 1024 {
            return Err("Файл больше 256 MiB".into());
        }
        let normalized = name.replace('/', "\\");
        if normalized.is_empty()
            || normalized.split('\\').any(|p| p == ".." || p.is_empty())
            || normalized.contains(':')
        {
            return Err("Некорректный путь внутри архива".into());
        }
        let (enc, _, bad) = encoding_rs::GBK.encode(&normalized);
        if bad || enc.len() > 259 {
            return Err("Имя должно помещаться в 259 байт GBK".into());
        }
        if a.entries
            .iter()
            .enumerate()
            .any(|(i, e)| Some(i) != index && e.name.eq_ignore_ascii_case(&normalized))
        {
            return Err("Такое имя уже есть".into());
        }
        let mut raw = if let Some(i) = index {
            a.entries.get(i).ok_or("Файл не найден")?.raw.clone()
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
        let i = index.ok_or("Не выбран файл")?;
        if i >= a.entries.len() {
            return Err("Файл не найден".into());
        }
        a.entries.remove(i);
    }
    Ok(a.view())
}
fn import_file_impl(path: String) -> Result<Vec<u8>> {
    if std::fs::metadata(&path).map_err(err)?.len() > 256 * 1024 * 1024 {
        return Err("Лимит 256 MiB".into());
    }
    std::fs::read(path).map_err(err)
}
fn export_entry_impl(index: usize, path: String, state: &App) -> Result<()> {
    let data = state
        .0
        .lock()
        .map_err(err)?
        .as_ref()
        .ok_or("Откройте архив")?
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
                Err("Текст содержит символы, отсутствующие в GBK".into())
            } else {
                Ok(b.into_owned())
            }
        }
        _ => Err("Неизвестная кодировка".into()),
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
        report(&app, operation, "Подготовка", 0, 0);
        let result = job(app.clone());
        report(
            &app,
            operation,
            if result.is_ok() {
                "Готово"
            } else {
                "Ошибка"
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
    background(app, "Открытие", move |app| {
        let a = Archive::open_progress(path.into(), &|stage, done, total| {
            report(&app, "Открытие", stage, done, total)
        })?;
        report(&app, "Открытие", "Подготовка списка", 0, 0);
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
    background(app, "Чтение ресурса", move |_| {
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
    background(app, "Изменение архива", move |_| {
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
    background(app, "Сохранение", move |app| {
        let mut guard = state.0.lock().map_err(err)?;
        let saved = guard
            .as_ref()
            .ok_or("Откройте архив")?
            .save_progress(Path::new(&path), &|stage, done, total| {
                report(&app, "Сохранение", stage, done, total)
            })?;
        let view = saved.view();
        *guard = Some(saved);
        Ok(view)
    })
        .await
}
#[tauri::command]
async fn import_file(path: String, app: tauri::AppHandle) -> Result<Vec<u8>> {
    background(app, "Импорт файла", move |_| {
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
    background(app, "Экспорт файла", move |_| {
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
    background(app, "Кодирование текста", move |_| {
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
            .title("Find in Files — LRPW | PCK View").inner_size(900.0, 600.0)
            .min_inner_size(520.0, 320.0).build().map_err(err)?;
    }
    Ok(())
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                use tauri::Manager;
                window.app_handle().exit(0);
            }
        })
        .manage(App::default())
        .manage(SearchControl::default())
        .invoke_handler(tauri::generate_handler![
            open_search_window,
            search::search_contents,
            search::cancel_search,
            open_archive,
            read_entry,
            edit_entry,
            save_archive,
            import_file,
            encode_text_command,
            export_entry,
            extract_archive,
            pack_folder
        ])
        .run(tauri::generate_context!())
        .expect("Ошибка запуска LRPW | PCK View");
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
            return Err(format!("Недопустимый путь ресурса: {name}"));
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
                "Ссылки/junction не поддерживаются: {}",
                path.display()
            ));
        }
    }
    if meta.file_type().is_symlink() {
        return Err(format!("Ссылка: {}", path.display()));
    }
    Ok(())
}
fn extract_all_impl(
    archive: &Archive,
    directory: &Path,
    progress: &dyn Fn(&str, usize, usize),
) -> Result<usize> {
    reject_link(directory)?;
    let root = std::fs::canonicalize(directory).map_err(err)?;
    let mut seen = HashSet::new();
    let paths = archive
        .entries
        .iter()
        .map(|entry| {
            let rel = archive_relative(&entry.name)?;
            if !seen.insert(entry.name.replace('/', "\\").to_lowercase()) {
                return Err(format!("Повторяющийся путь: {}", entry.name));
            }
            Ok(rel)
        })
        .collect::<Result<Vec<_>>>()?;
    for (i, rel) in paths.iter().enumerate() {
        if i % 32 == 0 {
            progress(&archive.entries[i].name, i, paths.len());
        }
        let mut parent = root.clone();
        for component in rel.parent().unwrap_or(Path::new("")).components() {
            parent.push(component);
            if !parent.exists() {
                std::fs::create_dir(&parent).map_err(err)?;
            }
            reject_link(&parent)?;
        }
        let target = root.join(rel);
        if std::fs::symlink_metadata(&target).is_ok() {
            reject_link(&target)?;
            let existing = std::fs::canonicalize(&target).map_err(err)?;
            if [archive.path.clone(), archive.path.with_extension("pkx")]
                .iter()
                .any(|p| {
                    std::fs::canonicalize(p)
                        .map(|p| p == existing)
                        .unwrap_or(false)
                })
            {
                return Err("Распаковка не может перезаписать исходный PCK/PKX".into());
            }
        }
        let data = archive
            .data_with_limit(i, false)
            .map_err(|e| format!("{}: {e}", archive.entries[i].name))?;
        let mut temp = tempfile::NamedTempFile::new_in(&parent).map_err(err)?;
        temp.write_all(&data).map_err(err)?;
        temp.as_file().sync_all().map_err(err)?;
        temp.persist(&target).map_err(err)?;
        if (i + 1) % 32 == 0 || i + 1 == paths.len() {
            progress(&archive.entries[i].name, i + 1, paths.len());
        }
    }
    Ok(paths.len())
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
        std::fs::canonicalize(target.parent().ok_or("Нет каталога назначения")?)
            .map_err(err)?
            .join(target.file_name().ok_or("Нет имени архива")?)
    };
    if target_absolute.starts_with(&root) {
        return Err("Выберите место для PCK вне упаковываемой папки".into());
    }
    let mut files = Vec::new();
    progress("Сканирование папки", 0, 0);
    collect_files(&root, &root, &mut files)?;
    files.sort();
    let mut spool =
        tempfile::NamedTempFile::new_in(target.parent().ok_or("Нет каталога назначения")?)
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
            .ok_or("Путь содержит неподдерживаемые символы")?
            .replace('/', "\\");
        archive_relative(&name)?;
        if !names.insert(name.to_lowercase()) {
            return Err(format!("Повторяющееся имя: {name}"));
        }
        let (encoded, _, bad) = encoding_rs::GBK.encode(&name);
        if bad || encoded.len() > 259 {
            return Err(format!("Имя не помещается в GBK: {name}"));
        }
        if i % 32 == 0 {
            progress(&name, i, files.len());
        }
        let mut source = File::open(root.join(rel)).map_err(err)?;
        let len = source.metadata().map_err(err)?.len();
        let offset = spool.stream_position().map_err(err)?;
        if len >= SPLIT || offset + len >= SPLIT {
            return Err("Папка превышает лимит одиночного PCK (2 ГБ)".into());
        }
        let mut encoder = ZlibEncoder::new(spool.as_file_mut(), Compression::default());
        let copied = std::io::copy(&mut source, &mut encoder).map_err(err)?;
        encoder.finish().map_err(err)?;
        if copied != len {
            return Err(format!("Размер файла изменился при чтении: {name}"));
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
            progress("Упаковка ресурсов", i + 1, files.len());
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
) -> Result<usize> {
    let state = state.inner().clone();
    background(app, "Распаковка", move |app| {
        let guard = state.0.lock().map_err(err)?;
        let archive = guard.as_ref().ok_or("Откройте архив")?;
        extract_all_impl(archive, Path::new(&directory), &|stage, done, total| {
            report(&app, "Распаковка", stage, done, total)
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
    background(app, "Упаковка", move |app| {
        let mut guard = state.0.lock().map_err(err)?;
        let archive = pack_folder_impl(
            Path::new(&directory),
            Path::new(&path),
            &|stage, done, total| report(&app, "Упаковка", stage, done, total),
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

