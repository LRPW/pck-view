use super::{
    background, edit_entry_impl, encode_text, err, project, read_entry_impl, read_surface_impl,
    App, Archive, Result, SurfaceCache,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
#[derive(Clone, Serialize)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub changed: bool,
}
#[derive(Clone)]
enum Source {
    Archive(App, SurfaceCache),
    Project(String),
    File(PathBuf),
}
#[derive(Clone)]
pub(super) struct Scope {
    source: Source,
    pub(super) entries: Arc<Vec<Entry>>,
    root: PathBuf,
}
#[derive(Default)]
pub struct Ide {
    scopes: Mutex<HashMap<u64, Scope>>,
    next: AtomicU64,
}
impl Scope {
    pub(super) fn manifest(&self) -> Option<&str> {
        match &self.source { Source::Project(path) => Some(path), _ => None }
    }
    pub(super) fn path(&self) -> Result<String> {
        match &self.source {
            Source::Project(path) => Ok(path.clone()),
            Source::Archive(archive, _) => Ok(archive.0.lock().map_err(err)?.as_ref().ok_or("No archive")?.path.to_string_lossy().into_owned()),
            Source::File(path) => Ok(path.to_string_lossy().into_owned()),
        }
    }
}

#[derive(Serialize)]
pub(super) struct SearchSource {
    id: u64,
    path: String,
    project: bool,
    modules: Vec<String>,
}

#[tauri::command]
pub(super) fn ide_search_sources(state: tauri::State<'_, Ide>) -> Result<Vec<SearchSource>> {
    let scopes = state.scopes.lock().map_err(err)?.clone();
    let mut sources = Vec::new();
    for (id, scope) in scopes {
        if matches!(&scope.source, Source::File(_)) && !scope.entries.iter().any(|entry| super::search_data::supported(&entry.name)) { continue; }
        let project = scope.manifest().is_some();
        let modules = if project {
            scope.entries.iter().filter_map(|entry| {
                if let Some(relative) = entry.path.strip_prefix("archives/") {
                    let end = relative.to_ascii_lowercase().find(".pck/")?;
                    Some(format!("archives/{}", &relative[..end + 4]))
                } else if entry.path.starts_with("data/") {
                    Some("data".into())
                } else if entry.path.starts_with("server/") { Some("server".into()) } else { None }
            }).collect::<std::collections::BTreeSet<_>>().into_iter().collect()
        } else { vec![String::new()] };
        sources.push(SearchSource { id, path: scope.path()?, project, modules });
    }
    sources.sort_by_key(|source| source.id);
    Ok(sources)
}
#[derive(Serialize)]
pub struct Opened {
    pub id: u64,
    pub path: String,
    pub kind: String,
    pub entries: Vec<Entry>,
}
impl Ide {
    pub(super) fn scope(&self, id: u64) -> Result<Scope> {
        self.scopes
            .lock()
            .map_err(err)?
            .get(&id)
            .cloned()
            .ok_or("Document is closed".into())
    }
    fn insert(&self, scope: Scope, path: String, kind: &str) -> Result<Opened> {
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let entries = scope.entries.as_ref().clone();
        self.scopes.lock().map_err(err)?.insert(id, scope);
        Ok(Opened {
            id,
            path,
            kind: kind.into(),
            entries,
        })
    }
}
#[tauri::command]
pub async fn ide_open(path: String, state: tauri::State<'_, Ide>, app: tauri::AppHandle) -> Result<Opened> {
    let path = PathBuf::from(path).canonicalize().map_err(err)?;
    let original = path.to_string_lossy().to_string();
    let is_project = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("pwforge"));
    let is_archive = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("pck"));
    let scope = tauri::async_runtime::spawn_blocking(move || -> Result<Scope> {
        if is_project {
            project_scope(&path.to_string_lossy(), &|stage, done, total| {
                super::report(&app, "Opening", stage, done, total);
            })
        } else if is_archive {
            let a = Archive::open_progress(path.clone(), &|stage, done, total| {
                super::report(&app, "Opening", stage, done, total);
            })?;
            let entries = a
                .entries
                .iter()
                .map(|e| Entry {
                    name: e.name.clone(),
                    path: e.name.clone(),
                    size: e.len as u64,
                    changed: e.data.is_some(),
                })
                .collect();
            Ok(Scope {
                source: Source::Archive(
                    App(Arc::new(Mutex::new(Some(a)))),
                    SurfaceCache::default(),
                ),
                entries: Arc::new(entries),
                root: path.parent().ok_or("No folder")?.into(),
            })
        } else {
            let name = path
                .file_name()
                .ok_or("No name")?
                .to_string_lossy()
                .to_string();
            Ok(Scope {
                entries: Arc::new(vec![Entry {
                    name,
                    path: original_path(&path),
                    size: std::fs::metadata(&path).map_err(err)?.len(),
                    changed: false,
                }]),
                root: path.parent().ok_or("No folder")?.into(),
                source: Source::File(path),
            })
        }
    })
    .await
    .map_err(err)??;
    state.insert(
        scope,
        original,
        if is_project {
            "project"
        } else if is_archive {
            "archive"
        } else {
            "file"
        },
    )
}
pub(super) fn project_scope(manifest: &str, progress: &dyn Fn(&str, usize, usize)) -> Result<Scope> {
    project::project_open(manifest.into())?;
    let entries = project::catalog(manifest, progress)?
        .into_iter()
        .map(|e| Entry {name: e.name, path: e.path, size: e.size, changed: e.changed})
        .collect();
    Ok(Scope {
        source: Source::Project(manifest.into()),
        entries: Arc::new(entries),
        root: project::native_root(manifest)?,
    })
}
fn original_path(p: &Path) -> String {
    p.to_string_lossy().into()
}
pub(super) fn read(scope: &Scope, index: usize) -> Result<Vec<u8>> {
    let entry = scope.entries.get(index).ok_or("No file")?;
    if entry.size > 256 * 1024 * 1024 {
        return Err("File limit: 256 MiB".into());
    }
    match &scope.source {
        Source::Archive(app, _) => read_entry_impl(index, app),
        Source::Project(manifest) => {
            std::fs::read(project::materialize(manifest, &entry.path)?).map_err(err)
        }
        Source::File(path) => {
            if entry.size > 256 * 1024 * 1024 {
                return Err("File limit: 256 MiB".into());
            }
            std::fs::read(path).map_err(err)
        }
    }
}
#[tauri::command]
pub async fn ide_read(id: u64, index: usize, state: tauri::State<'_, Ide>) -> Result<Vec<u8>> {
    let scope = state.scope(id)?;
    tauri::async_runtime::spawn_blocking(move || read(&scope, index))
        .await
        .map_err(err)?
}
#[tauri::command]
pub async fn ide_read_binary(
    id: u64,
    index: usize,
    state: tauri::State<'_, Ide>,
) -> Result<tauri::ipc::Response> {
    ide_read(id, index, state).await.map(tauri::ipc::Response::new)
}
fn normalized(s: &str) -> String {
    s.replace('\\', "/").trim_start_matches("./").to_lowercase()
}
fn resolve(scope: &Scope, name: &str) -> Option<usize> {
    let requested = normalized(name);
    let candidates = [
        requested.clone(),
        format!("interfaces/{requested}"),
        format!("surfaces/{requested}"),
        format!("gfx/{requested}"),
    ];
    scope
        .entries
        .iter()
        .position(|e| candidates.contains(&normalized(&e.name)))
}

pub(super) fn read_elements(scope: &Scope) -> Result<Vec<u8>> {
    match &scope.source {
        Source::File(_) => {
            let path = scope.root.join("elements.data");
            super::reject_link(&path)?;
            std::fs::read(path).map_err(err)
        }
        _ => {
            let index = resolve(scope, "data/elements.data")
                .or_else(|| resolve(scope, "elements.data"))
                .ok_or("The project has no elements.data")?;
            read(scope, index)
        }
    }
}

#[tauri::command]
pub async fn ide_item_descriptions(id: u64, state: tauri::State<'_, Ide>) -> Result<tauri::ipc::Response> {
    let scope = state.scope(id)?;
    tauri::async_runtime::spawn_blocking(move || {
        const NAME: &str = "configs/item_ext_desc.txt";
        if let Some(index) = resolve(&scope, NAME).or_else(|| resolve(&scope, "item_ext_desc.txt")) {
            return Ok(tauri::ipc::Response::new(read(&scope,index)?));
        }
        let root = match &scope.source {
            Source::Project(_) => return Err("The project has no configs/item_ext_desc.txt".into()),
            Source::File(_) => scope.root.parent().ok_or("Client directory is missing")?,
            Source::Archive(_, _) => &scope.root,
        };
        let loose = root.join(NAME);
        if loose.is_file() {
            super::reject_link(&loose)?;
            return Ok(tauri::ipc::Response::new(std::fs::read(loose).map_err(err)?));
        }
        let path = root.join("configs.pck");
        super::reject_link(&path)?;
        let archive = Archive::open_progress(path, &|_, _, _| {})?;
        let index = archive.entries.iter().position(|entry| {
            let name = normalized(&entry.name);
            name == NAME || name == "item_ext_desc.txt"
        }).ok_or("configs.pck has no item_ext_desc.txt")?;
        Ok(tauri::ipc::Response::new(archive.data(index)?))
    }).await.map_err(err)?
}

pub(super) fn inventory_files(scope: Scope) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>)> {
    let elements = read_elements(&scope)?;
    let read_atlas: Box<dyn Fn(&str) -> Result<Vec<u8>>> = match &scope.source {
        Source::File(_) => {
            let client = scope.root.parent().ok_or("Client folder is missing")?;
            let archive = client.join("surfaces.pck");
            super::reject_link(&archive)?;
            let archive = Archive::open_progress(archive, &|_, _, _| {})?;
            Box::new(move |name| {
                let requested = normalized(name);
                let index = archive.entries.iter().position(|entry| {
                    let path = normalized(&entry.name);
                    path.strip_prefix("surfaces/").unwrap_or(&path) == requested
                }).ok_or("Atlas file was not found")?;
                archive.data(index)
            })
        }
        _ => {
            Box::new(move |name| {
                let index = resolve(&scope, name).ok_or("Atlas file was not found")?;
                read(&scope, index)
            })
        }
    };
    for gender in ["M", "F"] {
        let base = format!("IconSet/IconList_Ivtr{gender}");
        if let (Ok(list), Ok(texture)) = (read_atlas(&format!("{base}.txt")), read_atlas(&format!("{base}.dds"))) {
            return Ok((elements, list, texture));
        }
    }
    Err("Inventory icon atlas was not found".into())
}

#[tauri::command]
pub async fn ide_resource(id: u64, name: String, state: tauri::State<'_, Ide>) -> Result<Vec<u8>> {
    let scope = state.scope(id)?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(i) = resolve(&scope, &name) {
            return read(&scope, i);
        }
        match &scope.source {
            Source::Archive(app, cache) => read_surface_impl(&name, app, cache),
            Source::File(_) => {
                let path = super::archive_relative(&name)?;
                super::reject_link(&scope.root.join(&path))?;
                std::fs::read(scope.root.join(path)).map_err(err)
            }
            _ => Err(format!("Resource not found: {name}")),
        }
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn ide_save(
    id: u64,
    index: usize,
    text: String,
    encoding: String,
    original: Vec<u8>,
    state: tauri::State<'_, Ide>,
) -> Result<()> {
    let scope = state.scope(id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let b = encode_text(text, encoding)?;
        save_bytes(&scope, index, &original, b)
    })
    .await
    .map_err(err)?
}
pub(super) fn read_binary(state: &Ide, id: u64, index: usize) -> Result<(String, Vec<u8>)> {
    let scope = state.scope(id)?;
    Ok((
        scope.entries.get(index).ok_or("No file")?.name.clone(),
        read(&scope, index)?,
    ))
}
pub(super) fn write_binary(
    state: &Ide,
    id: u64,
    index: usize,
    original: &[u8],
    b: Vec<u8>,
) -> Result<()> {
    let scope = state.scope(id)?;
    save_bytes(&scope, index, original, b)
}

#[tauri::command]
pub async fn ide_save_domain(
    id: u64,
    index: usize,
    original: Vec<u8>,
    bytes: Vec<u8>,
    state: tauri::State<'_, Ide>,
) -> Result<()> {
    let scope = state.scope(id)?;
    let entry = scope.entries.get(index).ok_or("No file")?;
    if !matches!(
        normalized(&entry.name).rsplit('/').next(),
        Some("domain.data" | "domain2.data" | "domain2_cross.data")
    ) {
        return Err("Select a territory file".into());
    }
    tauri::async_runtime::spawn_blocking(move || save_bytes(&scope, index, &original, bytes))
        .await
        .map_err(err)?
}

#[tauri::command]
pub async fn ide_export_server_data(path: std::path::PathBuf, bytes: Vec<u8>) -> Result<()> {
    if !path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("sev")) {
        return Err("Select a file with the .sev extension".into());
    }
    tauri::async_runtime::spawn_blocking(move || write_export(path, bytes))
        .await
        .map_err(err)?
}

pub(super) fn write_export(path: std::path::PathBuf, bytes: Vec<u8>) -> Result<()> {
    use std::io::Write;

    let directory = path.parent().filter(|parent| !parent.as_os_str().is_empty())
        .ok_or("Choose an export folder")?;
    let mut temp = tempfile::NamedTempFile::new_in(directory).map_err(err)?;
    temp.write_all(&bytes).map_err(err)?;
    temp.as_file().sync_all().map_err(err)?;
    temp.persist(path).map_err(err)?;
    Ok(())
}

#[tauri::command]
pub async fn ide_save_aipolicy(
    request: tauri::ipc::Request<'_>,
    state: tauri::State<'_, Ide>,
) -> Result<()> {
    save_binary_request(request, state, &["aipolicy.data"]).await
}

#[tauri::command]
pub async fn ide_save_server_records(
    request: tauri::ipc::Request<'_>,
    state: tauri::State<'_, Ide>,
) -> Result<()> {
    save_binary_request(request, state, &["extra_drops.sev", "npcgen.data", "path.sev", "wmgj.nmd"]).await
}

async fn save_binary_request(
    request: tauri::ipc::Request<'_>,
    state: tauri::State<'_, Ide>,
    filenames: &[&str],
) -> Result<()> {
    let header = |name: &str| -> Result<u64> {
        request.headers().get(name)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse().ok())
            .ok_or_else(|| format!("Invalid header {name}"))
    };
    let scope = state.scope(header("x-ide-id")?)?;
    let index = usize::try_from(header("x-ide-index")?).map_err(err)?;
    let original_size = usize::try_from(header("x-original-size")?).map_err(err)?;
    let entry = scope.entries.get(index).ok_or("No file")?;
    if !normalized(&entry.name).rsplit('/').next().is_some_and(|name| filenames.contains(&name)) {
        return Err("Unexpected file format".into());
    }
    let tauri::ipc::InvokeBody::Raw(payload) = request.body() else {
        return Err("Binary data is required".into());
    };
    let (original, bytes) = payload.split_at_checked(original_size)
        .ok_or("Invalid original file size")?;
    let (original, bytes) = (original.to_vec(), bytes.to_vec());
    tauri::async_runtime::spawn_blocking(move || save_bytes(&scope, index, &original, bytes))
        .await
        .map_err(err)?
}

pub(super) fn save_bytes(scope: &Scope, index: usize, original: &[u8], b: Vec<u8>) -> Result<()> {
    let entry = scope.entries.get(index).ok_or("No file")?;
    if read(&scope, index)? != original {
        return Err("File has changed. Reopen it.".into());
    }
    match &scope.source {
        Source::Archive(app, _) => {
            edit_entry_impl(Some(index), entry.name.clone(), Some(b), app)?;
            Ok(())
        }
        Source::Project(manifest) => {
            project::store_edit(manifest, &entry.path, &original, &b)?;
            Ok(())
        }
        Source::File(path) => {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(err)?
                .as_nanos();
            std::fs::copy(path, path.with_extension(format!("{stamp}.bak"))).map_err(err)?;
            let mut temp = tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(err)?;
            use std::io::Write;
            temp.write_all(&b).map_err(err)?;
            temp.as_file().sync_all().map_err(err)?;
            temp.persist(path).map_err(err)?;
            Ok(())
        }
    }
}
#[tauri::command]
pub async fn ide_save_archive(
    id: u64,
    path: String,
    state: tauri::State<'_, Ide>,
    app: tauri::AppHandle,
) -> Result<()> {
    let scope = state.scope(id)?;
    let Source::Archive(archive, _) = scope.source else {
        return Err("This is not a PCK".into());
    };
    background(app, "Saving PCK", move |app| {
        let mut guard = archive.0.lock().map_err(err)?;
        let saved = guard
            .as_ref()
            .ok_or("No archive")?
            .save_progress(Path::new(&path), &|s, d, t| {
                super::report(&app, "Saving PCK", s, d, t)
            })?;
        *guard = Some(saved);
        Ok(())
    })
    .await
}
#[tauri::command]
pub fn ide_close(id: u64, state: tauri::State<'_, Ide>) -> Result<()> {
    state.scopes.lock().map_err(err)?.remove(&id);
    Ok(())
}
#[derive(Serialize)]
pub struct NativeContext {
    root: String,
    name: String,
}
#[tauri::command]
pub fn ide_native_context(
    id: u64,
    name: String,
    state: tauri::State<'_, Ide>,
) -> Result<NativeContext> {
    let scope = state.scope(id)?;
    Ok(NativeContext {
        root: scope.root.to_string_lossy().into(),
        name,
    })
}
#[derive(Serialize)]
pub struct Fonts {
    scope: String,
    sources: Vec<String>,
}
#[tauri::command]
pub fn ide_fonts(id: u64, state: tauri::State<'_, Ide>) -> Result<Fonts> {
    let s = state.scope(id)?;
    let mut sources: Vec<_> = s
        .entries
        .iter()
        .enumerate()
        .filter(|(_, e)| {
            e.size <= 64 * 1024 * 1024
                && [".ttf", ".otf", ".ttc"]
                    .iter()
                    .any(|ext| e.name.to_lowercase().ends_with(ext))
        })
        .map(|(i, _)| format!("entry:{i}"))
        .collect();
    for folder in ["font", "fonts"] {
        if let Ok(files) = std::fs::read_dir(s.root.join(folder)) {
            for f in files.flatten() {
                let name = f.file_name().to_string_lossy().to_string();
                if ["ttf", "otf", "ttc"]
                    .iter()
                    .any(|e| name.to_lowercase().ends_with(e))
                {
                    sources.push(format!("disk:{folder}/{name}"));
                }
            }
        }
    }
    Ok(Fonts {
        scope: id.to_string(),
        sources,
    })
}
#[tauri::command]
pub async fn ide_font(
    id: u64,
    source: String,
    state: tauri::State<'_, Ide>,
) -> Result<tauri::ipc::Response> {
    let s = state.scope(id)?;
    let b = if let Some(i) = source.strip_prefix("entry:") {
        read(&s, i.parse().map_err(err)?)?
    } else {
        let path = super::archive_relative(source.strip_prefix("disk:").ok_or("No font")?)?;
        std::fs::read(s.root.join(path)).map_err(err)?
    };
    Ok(tauri::ipc::Response::new(b))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn archive_scope(root: &Path, payload: &[u8]) -> Scope {
        std::fs::create_dir_all(root.join("files/interfaces")).unwrap();
        std::fs::write(root.join("files/interfaces/shared.xml"), payload).unwrap();
        let pck = root.join("interfaces.pck");
        let a = super::super::pack_folder_impl(&root.join("files"), &pck, &|_, _, _| {}).unwrap();
        let entries = Arc::new(
            a.entries
                .iter()
                .map(|e| Entry {
                    name: e.name.clone(),
                    path: e.name.clone(),
                    size: e.len as u64,
                    changed: false,
                })
                .collect(),
        );
        Scope {
            source: Source::Archive(App(Arc::new(Mutex::new(Some(a)))), SurfaceCache::default()),
            entries,
            root: root.into(),
        }
    }
    #[test]
    fn archive_documents_keep_their_own_resources_and_edits() {
        let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let a = archive_scope(&temp.path().join("one"), b"<Dialog Name=\"one\"/>");
        let b = archive_scope(&temp.path().join("two"), b"<Dialog Name=\"two\"/>");
        let state = Ide::default();
        let first = state.insert(a, "one.pck".into(), "archive").unwrap();
        let second = state.insert(b, "two.pck".into(), "archive").unwrap();
        assert_ne!(first.id, second.id);
        let (_, one) = read_binary(&state, first.id, 0).unwrap();
        let (_, two) = read_binary(&state, second.id, 0).unwrap();
        assert_ne!(one, two);
        write_binary(
            &state,
            first.id,
            0,
            &one,
            b"<Dialog Name=\"edited\"/>".to_vec(),
        )
        .unwrap();
        assert_eq!(
            read_binary(&state, first.id, 0).unwrap().1,
            b"<Dialog Name=\"edited\"/>"
        );
        assert_eq!(read_binary(&state, second.id, 0).unwrap().1, two);
        assert_eq!(
            resolve(&state.scope(second.id).unwrap(), "shared.xml"),
            Some(0)
        );
        assert!(write_binary(&state, first.id, 0, &one, b"stale".to_vec()).is_err());
    }
    #[test]
    #[ignore = "requires local client archives"]
    fn local_interface_and_gfx_resources() {
        for name in ["interfaces", "gfx"] {
            let p = super::super::test_client_root().join(format!("{name}.pck"));
            let a = Archive::open(p.clone()).unwrap();
            let suffix = if name == "interfaces" { ".xml" } else { ".gfx" };
            let candidates: Vec<_> = a
                .entries
                .iter()
                .enumerate()
                .filter(|(_, e)| e.name.to_lowercase().ends_with(suffix))
                .take(3)
                .map(|(i, e)| (i, e.name.clone()))
                .collect();
            for (i, name) in candidates {
                let b = a.data(i).unwrap();
                assert!(!b.is_empty());
                println!("{}: {}", p.display(), name);
            }
        }
    }
}

#[tauri::command]
pub async fn ide_import_server(id: u64, source: String, state: tauri::State<'_, Ide>) -> Result<Opened> {
    let scope = state.scope(id)?;
    let manifest = scope.manifest().ok_or("Open a project")?.to_string();
    let path = manifest.clone();
    let mut updated = tauri::async_runtime::spawn_blocking(move || {
        project::import_server(&manifest, std::path::Path::new(&source))?;
        project_scope(&manifest, &|_, _, _| {})
    }).await.map_err(err)??;
    // Keep entry indices stable for tabs that are already open.
    let old_paths: std::collections::HashSet<_> = scope.entries.iter().map(|entry| entry.path.as_str()).collect();
    let mut entries = scope.entries.as_ref().clone();
    entries.extend(updated.entries.iter().filter(|entry| !old_paths.contains(entry.path.as_str())).cloned());
    updated.entries = Arc::new(entries.clone());
    state.scopes.lock().map_err(err)?.insert(id, updated);
    Ok(Opened {id, path, kind: "project".into(), entries})
}

#[tauri::command]
pub async fn ide_search_preview(
    structured: Option<bool>,
    source: Option<String>,
    path: String,
    state: tauri::State<'_, Ide>,
) -> Result<tauri::ipc::Response> {
    let scope = if let Some(source) = source {
        let scopes = state.scopes.lock().map_err(err)?;
        Some(scopes.values().find(|scope| scope.path()
            .is_ok_and(|value| normalized(&value) == normalized(&source)))
            .cloned().ok_or("Reopen this source to preview its results")?)
    } else {
        None
    };
    tauri::async_runtime::spawn_blocking(move || {
        let structured = structured.unwrap_or(false);
        let limit: u64 = if structured { 256 } else { 8 } * 1024 * 1024;
        let elements_profile = if structured {
            scope.as_ref().and_then(Scope::manifest)
                .map(super::project::data_profiles).transpose()?.unwrap_or_default().1
        } else {
            None
        };
        let bytes = if let Some(scope) = scope {
            let index = scope.entries.iter().position(|entry| normalized(&entry.path) == normalized(&path))
                .ok_or("Search result is no longer available")?;
            if scope.entries[index].size > limit {
                return Err("Preview limit: 8 MiB. Open the file in the editor.".into());
            }
            read(&scope, index)?
        } else {
            let path = std::path::PathBuf::from(&path);
            super::reject_link(&path)?;
            let metadata = std::fs::metadata(&path).map_err(err)?;
            if !metadata.is_file() || metadata.len() > limit {
                return Err("Preview limit: 8 MiB. Open the file in the editor.".into());
            }
            std::fs::read(path).map_err(err)?
        };
        if bytes.len() as u64 > limit {
            return Err("Preview limit: 8 MiB. Open the file in the editor.".into());
        }
        let bytes = if structured {
            super::search_data::project(&path, bytes, elements_profile.as_ref(), &|| false)?.into_bytes()
        } else {
            bytes
        };
        if bytes.len() > 8 * 1024 * 1024 {
            return Err("Preview limit: 8 MiB. Open the file in the editor.".into());
        }
        Ok(tauri::ipc::Response::new(bytes))
    }).await.map_err(err)?
}

#[tauri::command]
pub async fn ide_export_controller(path: std::path::PathBuf, text: String) -> Result<()> {
    if !path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("h") || ext.eq_ignore_ascii_case("cpp")) {
        return Err("Select a C++ header or source file".into());
    }
    tauri::async_runtime::spawn_blocking(move || write_export(path, text.into_bytes())).await.map_err(err)?
}

#[derive(serde::Serialize)]
pub struct InterfaceCompatibilityIssue {
    path: String,
    div: bool,
    mono: bool,
    error: Option<String>,
}

fn interface_extensions(xml: &str) -> Result<(bool, bool)> {
    use quick_xml::{events::Event, Reader};
    let mut reader = Reader::from_str(xml.trim_start_matches('\u{feff}').trim_end_matches('\0'));
    let (mut div, mut mono) = (false, false);
    loop {
        match reader.read_event().map_err(err)? {
            Event::Start(tag) | Event::Empty(tag) => {
                div |= tag.local_name().as_ref().eq_ignore_ascii_case("div");
                for attribute in tag.attributes() {
                    let attribute = attribute.map_err(err)?;
                    if attribute.key.as_ref().eq_ignore_ascii_case("fontname") {
                        mono |= quick_xml::escape::unescape(&attribute.value).map_err(err)?.trim().eq_ignore_ascii_case("mono");
                    }
                }
            }
            Event::Eof => return Ok((div, mono)),
            _ => {}
        }
    }
}

#[tauri::command]
pub async fn ide_check_interface_compatibility(
    id: u64,
    drafts: std::collections::HashMap<usize, String>,
    state: tauri::State<'_, Ide>,
) -> Result<Vec<InterfaceCompatibilityIssue>> {
    let scope = state.scope(id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut issues = Vec::new();
        for (index, entry) in scope.entries.iter().enumerate() {
            if !entry.name.to_ascii_lowercase().ends_with(".xml") { continue; }
            let result = match drafts.get(&index) {
                Some(xml) => interface_extensions(xml),
                None => read(&scope, index).and_then(|bytes| interface_extensions(&super::ide_search::decode(&bytes).0)),
            };
            let (div, mono, error) = match result {
                Ok((false, false)) => continue,
                Ok((div, mono)) => (div, mono, None),
                Err(error) => (false, false, Some(error)),
            };
            issues.push(InterfaceCompatibilityIssue { path: entry.path.clone(), div, mono, error });
        }
        issues.sort_by(|a, b| a.path.cmp(&b.path));
        issues
    }).await.map_err(err)
}

#[cfg(test)]
#[test]
fn compatibility_detects_extensions_in_markup() {
    assert_eq!(interface_extensions(r#"<DIALOG><!-- <DIV/> --><Text FontName="text"/></DIALOG>"#).unwrap(), (false, false));
    assert_eq!(interface_extensions(r#"<DIALOG><div><Text FONTNAME="M&#111;NO"/></div></DIALOG>"#).unwrap(), (true, true));
    assert!(interface_extensions("<DIALOG><DIV></DIALOG>").is_err());
}
