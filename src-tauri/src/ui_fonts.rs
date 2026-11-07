use super::{App, err};
use serde::Serialize;
use std::path::Path;

fn supported(name: &str) -> bool {
    matches!(Path::new(name).extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase().as_str(), "ttf" | "otf" | "ttc")
}
#[derive(Serialize)]
pub struct FontList {
    scope: String,
    sources: Vec<String>,
}
fn sources(archive: &super::Archive) -> Vec<String> {
    let mut result: Vec<String> = archive.entries.iter().enumerate()
        .filter(|(_, e)| supported(&e.name) && e.len <= 64 * 1024 * 1024)
        .map(|(i, _)| format!("entry:{i}")).collect();
    if let Some(root) = archive.path.parent() {
        for folder in ["font", "fonts"] {
            if let Ok(files) = std::fs::read_dir(root.join(folder)) {
                for file in files.flatten() {
                    let name = file.file_name().to_string_lossy().into_owned();
                    if supported(&name) && file.metadata().map(|m| m.is_file() && m.len() <= 64 * 1024 * 1024).unwrap_or(false) {
                        result.push(format!("disk:{folder}/{name}"));
                    }
                }
            }
        }
    }
    result.sort();
    result
}
#[tauri::command]
pub fn list_ui_fonts(state: tauri::State<'_, App>) -> Result<FontList, String> {
    let guard = state.0.lock().map_err(err)?;
    let archive = guard.as_ref().ok_or("Open an archive")?;
    Ok(FontList { scope: archive.path.to_string_lossy().into_owned(), sources: sources(archive) })
}
#[tauri::command]
pub async fn read_ui_font(scope: String, source: String, state: tauri::State<'_, App>) -> Result<tauri::ipc::Response, String> {
    let state = state.inner().clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let guard = state.0.lock().map_err(err)?;
        let archive = guard.as_ref().ok_or("Open an archive")?;
        if archive.path.to_string_lossy() != scope { return Err("Archive has changed".into()); }
        if !sources(archive).contains(&source) { return Err("Font was not found among the client resources".into()); }
        if let Some(index) = source.strip_prefix("entry:") {
            archive.data(index.parse::<usize>().map_err(err)?)
        } else {
            std::fs::read(archive.path.parent().ok_or("Client directory is missing")?.join(source.strip_prefix("disk:").ok_or("Invalid font source")?)).map_err(err)
        }
    }).await.map_err(err)??;
    Ok(tauri::ipc::Response::new(bytes))
}
