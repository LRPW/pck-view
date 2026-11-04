use std::{collections::HashMap, io::{Read, Write}, process::{Child, Command, Stdio}, sync::{Mutex, OnceLock, atomic::{AtomicU64, Ordering}}};
use super::{App, err};
static WORKERS: OnceLock<Mutex<HashMap<u64, Child>>> = OnceLock::new();
static NEXT: AtomicU64 = AtomicU64::new(1);
fn workers() -> &'static Mutex<HashMap<u64, Child>> { WORKERS.get_or_init(|| Mutex::new(HashMap::new())) }
pub fn shutdown() {
    if let Ok(mut guard) = workers().lock() {
        for (_, mut child) in guard.drain() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
pub async fn native_gfx_create(name: String, embedded: bool, root:Option<String>, state: tauri::State<'_, App>) -> Result<u64, String> {
    let root=if let Some(root)=root {std::path::PathBuf::from(root).canonicalize().map_err(err)?}else{state.0.lock().map_err(err)?.as_ref().ok_or("Откройте архив")?.path.parent().ok_or("Нет каталога архива")?.to_path_buf()};
    tauri::async_runtime::spawn_blocking(move || {
        // Legacy Angelica APIs use ANSI Win32 paths, not Rust's verbatim prefix.
        let text=root.to_string_lossy();
        let legacy=if let Some(unc)=text.strip_prefix(r"\\?\UNC\"){format!(r"\\{}",unc)}else{text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()};
        let root=std::path::PathBuf::from(legacy);
        let root = root.as_path();
        let adjacent = std::env::current_exe().map_err(err)?.with_file_name("native-gfx.exe");
        let executable = if adjacent.is_file() { adjacent } else { std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../runtimes/native-gfx/native-gfx.exe") };
        let mut command = Command::new(&executable);
        let search_path = std::env::join_paths(std::iter::once(root.to_path_buf()).chain(
            std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        )).map_err(err)?;
        command.env("PATH", search_path);
        let normalized = name.replace('/', "\\");
        let relative = if !normalized.to_ascii_lowercase().ends_with(".mox") && normalized.to_ascii_lowercase().starts_with("gfx\\") { &normalized[4..] } else { &normalized };
        let (encoded, _, errors) = encoding_rs::GBK.encode(relative);
        if errors { return Err("Имя GFX не представимо в кодировке движка GBK".into()); }
        let hex: String = encoded.iter().map(|byte| format!("{byte:02x}")).collect();
        command.arg(root).arg(hex).arg(if embedded { "1" } else { "0" })
            .current_dir(executable.parent().ok_or("Нет каталога проигрывателя")?).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().map_err(err)?;
        let mut ready = [0; 4];
        if let Err(e) = child.stdout.as_mut().ok_or("Нет stdout")?.read_exact(&mut ready) {
            if e.kind() != std::io::ErrorKind::UnexpectedEof { let _ = child.kill(); }
            let status = child.wait().ok();
            let code = status.as_ref().and_then(|s| s.code());
            let reason = match code {
                Some(3) => "Не удалось открыть каталог клиента.",
                Some(4) | Some(5) | Some(12) | Some(13) => "Не удалось инициализировать Direct3D для предпросмотра.",
                Some(6) => "Не удалось инициализировать движок эффектов.",
                Some(7) => "Движок не смог открыть или загрузить ресурс. Проверьте наличие исходного архива и связанных файлов; формат также может быть несовместим с движком.",
                Some(18) => "Не удалось загрузить шейдеры скелетных моделей. Нужен configs.pck с skinmodelvs.cfg и соответствующий shaders.pck.",
                Some(17) => "Не найден скелет. Для отдельного SKI нужен BON с тем же именем в том же каталоге; откройте SMD или ECM для полной сборки модели.",
                Some(8) => "Не удалось создать буфер изображения Direct3D.",
                Some(11) => "Не удалось передать имя файла движку.",
                Some(-1073741515) => "Отсутствует DLL, необходимая для запуска проигрывателя.",
                _ => "Проигрыватель завершился до подготовки первого кадра.",
            };
            let details = code.map(|c| format!("Код завершения: {c} (0x{:08X}).", c as u32))
                .unwrap_or_else(|| format!("Ошибка связи: {e}."));
            return Err(format!("Не удалось открыть предпросмотр «{name}».\n{reason}\n{details}"));
        }
        if u32::from_le_bytes(ready) != 0x31584647 {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Неверный протокол Native GFX".into());
        }
        let id = NEXT.fetch_add(1, Ordering::Relaxed);
        workers().lock().map_err(err)?.insert(id, child);
        Ok(id)
    }).await.map_err(err)?
}
#[tauri::command]
pub async fn native_gfx_frame(id: u64, delta: u32, camera: Option<[f32; 3]>, size: Option<[u32; 2]>, animation: Option<u32>) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let mut guard = workers().lock().map_err(err)?;
        let child = guard.get_mut(&id).ok_or("Сеанс GFX закрыт")?;
        if let Some(index) = animation {
            let input = child.stdin.as_mut().ok_or("Нет stdin")?;
            for value in [0xfffffffbu32, index] { input.write_all(&value.to_le_bytes()).map_err(err)?; }
            let mut status = [0; 4]; child.stdout.as_mut().ok_or("Нет stdout")?.read_exact(&mut status).map_err(err)?;
            if u32::from_le_bytes(status) != 1 { return Err("Не удалось запустить анимацию. Проверьте наличие связанного STCK.".into()); }
        }
        let [width, height] = size.unwrap_or([512, 512]);
        if width == 0 || height == 0 || width > 2560 || height > 2560 { return Err("Неверный размер предпросмотра".into()); }
        if size.is_some() {
            let input = child.stdin.as_mut().ok_or("Нет stdin")?;
            for value in [0xfffffffdu32, width, height] { input.write_all(&value.to_le_bytes()).map_err(err)?; }
        }
        if let Some(camera) = camera {
            if camera.iter().any(|v| !v.is_finite()) { return Err("Неверная камера".into()); }
            let input = child.stdin.as_mut().ok_or("Нет stdin")?;
            input.write_all(&0xfffffffeu32.to_le_bytes()).map_err(err)?;
            for value in camera { input.write_all(&value.to_le_bytes()).map_err(err)?; }
        }
        child.stdin.as_mut().ok_or("Нет stdin")?.write_all(&delta.to_le_bytes()).map_err(err)?;
        let mut bytes = vec![0; width as usize * height as usize * 4];
        child.stdout.as_mut().ok_or("Нет stdout")?.read_exact(&mut bytes).map_err(err)?;
        Ok(bytes)
    }).await.map_err(err)??;
    Ok(tauri::ipc::Response::new(bytes))
}
#[tauri::command]
pub async fn native_gfx_close(id: u64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(mut child) = workers().lock().map_err(err)?.remove(&id) {
            let _ = child.kill();
            let _ = child.wait();
        }
        Ok(())
    }).await.map_err(err)?
}

#[derive(serde::Serialize)]
pub struct NativeAnimation { name: String, track: String }
#[tauri::command]
pub async fn native_gfx_animations(id: u64) -> Result<Vec<NativeAnimation>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = workers().lock().map_err(err)?;
        let child = guard.get_mut(&id).ok_or("Сеанс закрыт")?;
        child.stdin.as_mut().ok_or("Нет stdin")?.write_all(&0xfffffffcu32.to_le_bytes()).map_err(err)?;
        let output = child.stdout.as_mut().ok_or("Нет stdout")?;
        let mut word = [0; 4]; output.read_exact(&mut word).map_err(err)?;
        let count = u32::from_le_bytes(word);
        if count > 10000 { return Err("Неверный список анимаций. Обновите native-gfx.exe".into()); }
        let mut result = Vec::new();
        for _ in 0..count {
            let mut fields = Vec::new();
            for _ in 0..2 {
                output.read_exact(&mut word).map_err(err)?;
                let len = u32::from_le_bytes(word) as usize;
                if len > 65536 { return Err("Неверное имя анимации".into()); }
                let mut bytes = vec![0; len]; output.read_exact(&mut bytes).map_err(err)?;
                fields.push(encoding_rs::GBK.decode(&bytes).0.into_owned());
            }
            result.push(NativeAnimation { name: fields.remove(0), track: fields.remove(0) });
        }
        Ok(result)
    }).await.map_err(err)?
}
#[tauri::command]
pub async fn native_gfx_export_glb(id: u64, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = {
            let mut guard = workers().lock().map_err(err)?;
            let child = guard.get_mut(&id).ok_or("Сеанс предпросмотра закрыт")?;
            child.stdin.as_mut().ok_or("Нет stdin")?.write_all(&0xfffffffau32.to_le_bytes()).map_err(err)?;
            let output = child.stdout.as_mut().ok_or("Нет stdout")?;
            let mut word = [0;4]; output.read_exact(&mut word).map_err(err)?;
            let status = u32::from_le_bytes(word);
            output.read_exact(&mut word).map_err(err)?;
            let length = u32::from_le_bytes(word) as usize;
            if length > 512 * 1024 * 1024 { return Err("Слишком большой результат экспорта GLB".into()); }
            let mut bytes = vec![0;length]; output.read_exact(&mut bytes).map_err(err)?;
            if status != 1 { return Err(format!("Экспорт GLB: {}", String::from_utf8_lossy(&bytes))); }
            if !bytes.starts_with(b"glTF") { return Err("Неверный формат GLB от renderer".into()); }
            bytes
        };
        let destination = std::path::Path::new(&path);
        let parent = destination.parent().ok_or("Нет каталога экспорта")?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(err)?;
        temporary.write_all(&bytes).map_err(err)?;
        temporary.persist(destination).map_err(err)?;
        Ok(())
    }).await.map_err(err)?
}
