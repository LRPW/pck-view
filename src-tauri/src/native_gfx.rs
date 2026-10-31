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
pub async fn native_gfx_create(name: String, embedded: bool, state: tauri::State<'_, App>) -> Result<u64, String> {
    let path = state.0.lock().map_err(err)?.as_ref().ok_or("Откройте архив")?.path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root = path.parent().ok_or("Нет каталога архива")?;
        let adjacent = std::env::current_exe().map_err(err)?.with_file_name("native-gfx.exe");
        let executable = if adjacent.is_file() { adjacent } else { std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../runtimes/native-gfx/native-gfx.exe") };
        let mut command = Command::new(&executable);
        let search_path = std::env::join_paths(std::iter::once(root.to_path_buf()).chain(
            std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        )).map_err(err)?;
        command.env("PATH", search_path);
        let normalized = name.replace('/', "\\");
        let relative = if normalized.to_ascii_lowercase().starts_with("gfx\\") { &normalized[4..] } else { &normalized };
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
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("Native GFX startup: {e}"));
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
pub async fn native_gfx_frame(id: u64, delta: u32) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let mut guard = workers().lock().map_err(err)?;
        let child = guard.get_mut(&id).ok_or("Сеанс GFX закрыт")?;
        child.stdin.as_mut().ok_or("Нет stdin")?.write_all(&delta.to_le_bytes()).map_err(err)?;
        let mut bytes = vec![0; 512 * 512 * 4];
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
