use super::{
    archive_relative, background, collect_files, compress, encode_text, err, put, reject_link,
    report, Archive, Result, SPLIT, VERSION,
};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{self, File},
    hash::{Hash, Hasher},
    io::{BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};
static BUILD_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static BUILD_CANCEL: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
thread_local! { static BUILD_THREAD: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }
pub(super) fn build_checkpoint() -> Result<()> {
    if BUILD_THREAD.with(|v| v.get()) && BUILD_CANCEL.load(std::sync::atomic::Ordering::SeqCst) { return Err("Build cancelled".into()); }
    Ok(())
}
#[tauri::command]
pub fn project_cancel_build() { BUILD_CANCEL.store(true, std::sync::atomic::Ordering::SeqCst); }
#[derive(Serialize, Deserialize)]
pub struct Project {
    format: String,
    version: u32,
    #[serde(default = "default_client_version")]
    client_version: String,
    #[serde(default)]
    gshop_version: Option<u8>,
    #[serde(default)]
    elements_profile: Option<super::elements::ElementsProfile>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    detected_gshop_versions: BTreeMap<String, u8>,
    name: String,
    source: String,
    archives: Vec<String>,
    status: String,
    errors: Vec<String>,
}
#[derive(Serialize)]
pub struct ProjectView {
    manifest: String,
    project: Project,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct FileItem {
    name: String,
    path: String,
    directory: bool,
    size: u64,
    #[serde(default)]
    changed: bool,
}
#[derive(Clone, Serialize)]
pub(super) struct CatalogItem {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub changed: bool,
}
pub(super) fn catalog(
    manifest: &str,
    progress: &dyn Fn(&str, usize, usize),
) -> Result<Vec<CatalogItem>> {
    let (root, p) = location(manifest)?;
    let mut out = Vec::new();
    let edits = managed(&root, "edits", Path::new(""))?;
    let mut edit_files = Vec::new();
    collect_files(&edits, &edits, &mut edit_files)?;
    let mut changes = HashMap::new();
    for rel in edit_files {
        changes.insert(
            key(&rel.to_string_lossy()),
            fs::metadata(edits.join(rel)).map_err(err)?.len(),
        );
    }
    for section in ["data", "server"] {
    let data = managed(&root, "originals", Path::new(section))?;
    if !data.is_dir() { continue; }
    let mut files = Vec::new();
    collect_files(&data, &data, &mut files)?;
    for rel in files {
        let path = format!("{section}/{}", normal(&rel.to_string_lossy()));
        let edit = managed(&root, "edits", &archive_relative(&path)?)?;
        out.push(CatalogItem {
            name: path.clone(),
            path,
            size: fs::metadata(if edit.is_file() {
                edit.clone()
            } else {
                data.join(rel)
            })
            .map_err(err)?
            .len(),
            changed: edit.is_file(),
        });
    }
    }
    for (position, name) in p.archives.iter().enumerate() {
        progress(name, position, p.archives.len());
        let index = get_index(&root, name, &|_, _, _| {})?;
        for (entry, size, _, _) in &index.entries {
            let path = format!("archives/{name}/{entry}");
            let changed = changes.get(&key(&path));
            out.push(CatalogItem {
                name: entry.clone(),
                path,
                size: changed.copied().unwrap_or(*size),
                changed: changed.is_some(),
            });
        }
    }
    progress("Preparing tree", 0, 0);
    Ok(out)
}
pub(super) fn native_root(manifest: &str) -> Result<PathBuf> {
    let (root, _) = location(manifest)?;
    managed(&root, "originals", Path::new("archives"))
}
#[derive(Clone, Hash, Serialize, Deserialize, PartialEq, Eq)]
struct Stamp {
    size: u64,
    modified: u128,
    pkx: Option<(u64, u128)>,
}
#[derive(Serialize, Deserialize)]
struct DiskIndex {
    version: u32,
    stamp: Stamp,
    encrypted: bool,
    entries: Vec<(String, u64, u32, u32)>,
}
struct Index {
    stamp: Stamp,
    encrypted: bool,
    entries: Vec<(String, u64, u32, u32)>,
    positions: HashMap<String, usize>,
    children: OnceLock<HashMap<String, Vec<FileItem>>>,
}
static INDEXES: OnceLock<Mutex<HashMap<PathBuf, Arc<Index>>>> = OnceLock::new();
static IO: Mutex<()> = Mutex::new(());
fn normal(s: &str) -> String {
    s.replace('\\', "/")
}
fn key(s: &str) -> String {
    normal(s).to_lowercase()
}
fn stamp(path: &Path) -> Result<Stamp> {
    fn meta(p: &Path) -> Result<(u64, u128)> {
        reject_link(p)?;
        let m = fs::metadata(p).map_err(err)?;
        Ok((
            m.len(),
            m.modified()
                .map_err(err)?
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(err)?
                .as_nanos(),
        ))
    }
    let (size, modified) = meta(path)?;
    let extra = path.with_extension("pkx");
    Ok(Stamp {
        size,
        modified,
        pkx: if extra.exists() {
            Some(meta(&extra)?)
        } else {
            None
        },
    })
}
fn is_bug_archive(path: &str) -> bool {
    path.rsplit(['/', '\\'])
        .next()
        .is_some_and(|name| name.eq_ignore_ascii_case("Bug.pck"))
}

fn load(path: &Path) -> Result<Project> {
    reject_link(path)?;
    if fs::metadata(path).map_err(err)?.len() > 1024 * 1024 {
        return Err("Invalid project".into());
    }
    let mut p: Project = serde_json::from_slice(&fs::read(path).map_err(err)?).map_err(err)?;
    if p.format != "pw-forge-project" {
        return Err("This is not a PW Forge project".into());
    }
    if p.version == 1 {
        return Err("This project uses the old full-extraction format. Create a new indexed project; the old files and edits are preserved.".into());
    }
    if p.version != 2 {
        return Err("Unsupported project version".into());
    }
    p.archives.retain(|name| !is_bug_archive(name));
    Ok(p)
}
fn location(manifest: &str) -> Result<(PathBuf, Project)> {
    let path = PathBuf::from(manifest).canonicalize().map_err(err)?;
    let p = load(&path)?;
    Ok((path.parent().ok_or("Project folder is missing")?.to_path_buf(), p))
}
fn safe(root: &Path, relative: &Path) -> Result<PathBuf> {
    reject_link(root)?;
    let mut p = root.to_path_buf();
    for c in relative.components() {
        match c {
            std::path::Component::Normal(s) => p.push(s),
            _ => return Err("Path is outside the project".into()),
        };
        if fs::symlink_metadata(&p).is_ok() {
            reject_link(&p)?;
        }
    }
    Ok(p)
}
fn managed(root: &Path, folder: &str, relative: &Path) -> Result<PathBuf> {
    safe(root, &Path::new(folder).join(relative))
}
fn atomic(path: &Path, b: &[u8]) -> Result<()> {
    fs::create_dir_all(path.parent().ok_or("No directory")?).map_err(err)?;
    let mut f = tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(err)?;
    f.write_all(b).map_err(err)?;
    f.as_file().sync_all().map_err(err)?;
    f.persist(path).map_err(err)?;
    Ok(())
}
fn write_manifest(path: &Path, p: &Project) -> Result<()> {
    atomic(path, &serde_json::to_vec_pretty(p).map_err(err)?)
}
fn copied(root: &Path, name: &str) -> Result<PathBuf> {
    managed(root, "originals/archives", &archive_relative(name)?)
}
fn make_index(disk: DiskIndex) -> Result<Index> {
    let mut positions = HashMap::new();
    for (i, (name, size, offset, packed)) in disk.entries.iter().enumerate() {
        if *size > u32::MAX as u64
            || *offset as u64 + (*packed as u64).min(*size)
                > disk.stamp.size + disk.stamp.pkx.map(|p| p.0).unwrap_or(0)
        {
            return Err("Invalid index sizes or offsets".into());
        }
        let path = normal(&archive_relative(name)?.to_string_lossy());
        if positions.insert(key(&path), i).is_some() {
            return Err(format!("Duplicate path: {name}"));
        }
    }
    for path in positions.keys() {
        if path
            .match_indices('/')
            .any(|(end, _)| positions.contains_key(&path[..end]))
        {
            return Err(format!("File/directory conflict: {path}"));
        }
    }
    Ok(Index {
        stamp: disk.stamp,
        encrypted: disk.encrypted,
        entries: disk.entries,
        positions,
        children: OnceLock::new(),
    })
}

fn index_children(entries: &[(String, u64, u32, u32)]) -> HashMap<String, Vec<FileItem>> {
    let mut tree: HashMap<String, BTreeMap<String, FileItem>> = HashMap::new();
    for (name, size, _, _) in entries {
        let path = normal(name);

        let parts: Vec<_> = path.split('/').collect();
        let mut parent = String::new();
        for (n, part) in parts.iter().enumerate() {
            let child = if parent.is_empty() {
                part.to_string()
            } else {
                format!("{parent}/{part}")
            };
            let directory = n + 1 < parts.len();
            let item = FileItem {
                name: part.to_string(),
                path: child.clone(),
                directory,
                size: if directory { 0 } else { *size },
                changed: false,
            };
            let map = tree.entry(key(&parent)).or_default();
            map.entry(key(part)).or_insert(item);
            parent = child;
        }
    }
    tree
        .into_iter()
        .map(|(k, v)| {
            let mut items: Vec<_> = v.into_values().collect();
            items.sort_by(|a, b| {
                b.directory
                    .cmp(&a.directory)
                    .then_with(|| key(&a.name).cmp(&key(&b.name)))
            });
            (k, items)
        })
        .collect()
}
fn get_index(root: &Path, name: &str, progress: &dyn Fn(&str, usize, usize)) -> Result<Arc<Index>> {
    let path = copied(root, name)?;
    let current = stamp(&path)?;
    let cache = INDEXES.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(index) = cache.lock().map_err(err)?.get(&path) {
        if index.stamp == current {
            return Ok(index.clone());
        }
    }
    let index_file = managed(
        root,
        ".forge/index",
        &archive_relative(&format!("{name}.json.gz"))?,
    )?;
    let saved = (|| -> Result<DiskIndex> {
        let decoder = GzDecoder::new(File::open(&index_file).map_err(err)?);
        serde_json::from_reader(BufReader::new(decoder.take(256 * 1024 * 1024))).map_err(err)
    })();
    let index = match saved {
        Ok(d) if d.version == 2 && d.stamp == current => make_index(d)?,
        _ => {
            let a = Archive::open_progress(path.clone(), progress)?;
            let d = DiskIndex {
                version: 2,
                stamp: current,
                encrypted: a.encrypted,
                entries: a
                    .entries
                    .iter()
                    .map(|e| (normal(&e.name), e.len as u64, e.offset, e.packed))
                    .collect(),
            };
            let mut gz = GzEncoder::new(Vec::new(), Compression::fast());
            serde_json::to_writer(&mut gz, &d).map_err(err)?;
            let index = make_index(d)?;
            atomic(&index_file, &gz.finish().map_err(err)?)?;
            index
        }
    };
    let index = Arc::new(index);
    let mut guard = cache.lock().map_err(err)?;
    if guard.len() >= 32 && !guard.contains_key(&path) {
        if let Some(old) = guard.keys().next().cloned() {
            guard.remove(&old);
        }
    }
    guard.insert(path, index.clone());
    Ok(index)
}
fn virtual_archive<'a>(p: &'a Project, path: &str) -> Result<Option<(&'a str, String)>> {
    let path = normal(path);
    if !path.to_lowercase().starts_with("archives/") {
        return Ok(None);
    }
    for name in &p.archives {
        let prefix = format!("archives/{}", normal(name));
        if path.eq_ignore_ascii_case(&prefix) {
            return Ok(Some((name, String::new())));
        }
        if let Some(head) = path.get(..prefix.len()) {
            if head.eq_ignore_ascii_case(&prefix)
                && path.as_bytes().get(prefix.len()) == Some(&b'/')
            {
                return Ok(Some((name, path[prefix.len() + 1..].into())));
            }
        }
    }
    Err("Archive is absent from the project".into())
}
fn canonical_virtual(root: &Path, p: &Project, path: &str) -> Result<String> {
    archive_relative(path)?;
    if let Some((name, entry)) = virtual_archive(p, path)? {
        let index = get_index(root, name, &|_, _, _| {})?;
        let i = *index
            .positions
            .get(&key(&entry))
            .ok_or("File is absent from the index")?;
        return Ok(format!("archives/{}/{}", normal(name), index.entries[i].0));
    }
    let path = normal(path);
    if !path.starts_with("data/") && !path.starts_with("server/") {
        return Err("Unknown project section".into());
    }
    if !managed(root, "originals", &archive_relative(&path)?)?.is_file() {
        return Err("File is missing from the project".into());
    }
    Ok(path)
}
pub(super) fn search_reader(manifest: &str) -> Result<impl FnMut(&str) -> Result<Vec<u8>>> {
    let (root, project) = location(manifest)?;
    let mut indexes = HashMap::new();
    Ok(move |path: &str| {
        let relative = archive_relative(path)?;
        let edited = managed(&root, "edits", &relative)?;
        if edited.is_file() {
            return fs::read(edited).map_err(err);
        }
        if let Some((name, entry)) = virtual_archive(&project, path)? {
            if !indexes.contains_key(name) {
                indexes.insert(name.to_owned(), get_index(&root, name, &|_, _, _| {})?);
            }
            let index = &indexes[name];
            let position = *index.positions.get(&key(&entry)).ok_or("No file")?;
            return read_indexed(&root, name, index, position);
        }
        fs::read(managed(&root, "originals", &relative)?).map_err(err)
    })
}

fn read_indexed(root: &Path, name: &str, index: &Index, position: usize) -> Result<Vec<u8>> {
    let (entry_name, len, offset, packed) = &index.entries[position];
    if *len > 256 * 1024 * 1024 {
        return Err("Extraction limit: 256 MiB per file".into());
    }
    let stored = Archive::read_at(&copied(root, name)?, *offset as u64, (*packed).min(*len as u32) as usize)?;
    let entry = super::Entry { raw: vec![], name: entry_name.clone(), len: *len as u32, offset: *offset, packed: *packed, data: None };
    Archive::decode_stored(index.encrypted, &entry, stored)
}

fn materialize_impl(manifest: &str, path: &str) -> Result<PathBuf> {
    let (root, p) = location(manifest)?;
    let path = canonical_virtual(&root, &p, path)?;
    let rel = archive_relative(&path)?;
    let edited = managed(&root, "edits", &rel)?;
    if edited.is_file() {
        return Ok(edited);
    }
    if let Some((name, entry)) = virtual_archive(&p, &path)? {
        let index = get_index(&root, name, &|_, _, _| {})?;
        let i = *index.positions.get(&key(&entry)).ok_or("No file")?;
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        index.stamp.hash(&mut hash);
        let cache_rel = archive_relative(&format!(
            "archives/{}/{:016x}/{}",
            normal(name),
            hash.finish(),
            index.entries[i].0
        ))?;
        let target = managed(&root, ".forge/cache", &cache_rel)?;
        if target.is_file() && fs::metadata(&target).map_err(err)?.len() == index.entries[i].1 {
            return Ok(target);
        }
        atomic(&target, &read_indexed(&root, name, &index, i)?)?;
        return Ok(target);
    }
    managed(&root, "originals", &rel)
}
pub(super) fn materialize(manifest: &str, path: &str) -> Result<PathBuf> {
    let _lock = IO.lock().map_err(err)?;
    materialize_impl(manifest, path)
}
pub(super) fn store_edit(
    manifest: &str,
    path: &str,
    expected: &[u8],
    bytes: &[u8],
) -> Result<PathBuf> {
    let _lock = IO.lock().map_err(err)?;
    let (root, p) = location(manifest)?;
    let path = canonical_virtual(&root, &p, path)?;
    let current = materialize_impl(manifest, &path)?;
    if fs::read(&current).map_err(err)? != expected {
        return Err("File was changed by another program. Reopen it.".into());
    }
    if expected == bytes {
        return Ok(current);
    }
    let rel = archive_relative(&path)?;
    let target = managed(&root, "edits", &rel)?;
    if target.is_file() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(err)?
            .as_nanos();
        let backup = managed(
            &root,
            ".forge/backups",
            &Path::new(&stamp.to_string()).join(&rel),
        )?;
        fs::create_dir_all(backup.parent().unwrap()).map_err(err)?;
        fs::copy(&target, backup).map_err(err)?;
    }
    atomic(&target, bytes)?;
    Ok(target)
}
#[tauri::command]
pub async fn project_scan(source: String, app: tauri::AppHandle) -> Result<Vec<FileItem>> {
    background(app, "Find archives", move |_| {
        let source = PathBuf::from(source).canonicalize().map_err(err)?;
        let mut files = Vec::new();
        collect_files(&source, &source, &mut files)?;
        let mut result = Vec::new();
        for rel in files {
            if !is_bug_archive(&rel.to_string_lossy()) && rel
                .extension()
                .is_some_and(|x| x.eq_ignore_ascii_case("pck"))
            {
                let path = source.join(&rel);
                let mut size = fs::metadata(&path).map_err(err)?.len();
                let pkx = path.with_extension("pkx");
                if pkx.exists() {
                    reject_link(&pkx)?;
                    size += fs::metadata(pkx).map_err(err)?.len();
                }
                result.push(FileItem {
                    name: normal(&rel.to_string_lossy()),
                    path: normal(&rel.to_string_lossy()),
                    directory: false,
                    size,
                    changed: false,
                });
            }
        }
        result.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(result)
    })
    .await
}
fn default_client_version() -> String {
    "1.5.5-lrpw".into()
}

pub(super) fn data_profiles(manifest: &str) -> Result<(Option<u8>, Option<super::elements::ElementsProfile>)> {
    let project = location(manifest)?.1;
    Ok((project.gshop_version, project.elements_profile))
}

pub(super) fn remember_gshop_version(manifest: &str, resource: &str, version: u8) -> Result<()> {
    let _lock = IO.lock().map_err(err)?;
    let path = PathBuf::from(manifest).canonicalize().map_err(err)?;
    let mut project = load(&path)?;
    if project.gshop_version.is_none() && project.detected_gshop_versions.get(resource) != Some(&version) {
        project.detected_gshop_versions.insert(resource.into(), version);
        write_manifest(&path, &project)?;
    }
    Ok(())
}

fn validate_client_version(version: &str) -> Result<()> {
    match version {
        "1.5.5" | "1.5.5-lrpw" => Ok(()),
        _ => Err("Unsupported client version".into()),
    }
}

#[tauri::command]
pub fn project_set_client_version(manifest: String, client_version: String, gshop_version: Option<u8>, elements_profile: Option<super::elements::ElementsProfile>) -> Result<()> {
    validate_client_version(&client_version)?;
    if gshop_version.is_some_and(|version| version > 7) { return Err("Unsupported GShop version".into()); }
    if let Some(profile) = &elements_profile {
        super::elements::validate_elements_profile(profile)?;
    }
    let _lock = IO.lock().map_err(err)?;
    let path = PathBuf::from(manifest).canonicalize().map_err(err)?;
    let mut project = load(&path)?;
    project.client_version = client_version;
    project.gshop_version = gshop_version;
    project.elements_profile = elements_profile;
    write_manifest(&path, &project)
}

pub(super) fn create_project(
    source: String,
    parent: String,
    name: String,
    archives: Vec<String>,
    client_version: String,
    progress: &dyn Fn(&str, usize, usize),
) -> Result<ProjectView> {
    validate_client_version(&client_version)?;
    let archives: Vec<_> = archives.into_iter().filter(|path| !is_bug_archive(path)).collect();
    let name = name.trim();
    if name.is_empty() || name.len() > 100 || name.contains(['\\', '/']) {
        return Err("Specify a project name without path separators".into());
    }
    archive_relative(name)?;
    let source = PathBuf::from(source).canonicalize().map_err(err)?;
    let parent = PathBuf::from(parent).canonicalize().map_err(err)?;
    let directory = parent.join(name);
    if directory.starts_with(&source) || source.starts_with(&directory) {
        return Err("The project folder must be separate from the client".into());
    }
    let mut seen = HashSet::new();
    for name in &archives {
        if !seen.insert(key(name)) {
            return Err("Archive was selected twice".into());
        }
        let path = safe(&source, &archive_relative(name)?)?;
        if !path.is_file()
            || !path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("pck"))
        {
            return Err(format!("Missing archive {name}"));
        }
        let extra = path.with_extension("pkx");
        if extra.exists() {
            reject_link(&extra)?;
        }
    }
    fs::create_dir(&directory).map_err(err)?;
    for folder in [
        "originals/data",
        "originals/archives",
        "edits",
        ".forge/index",
        ".forge/cache",
        "builds",
    ] {
        fs::create_dir_all(directory.join(folder)).map_err(err)?;
    }
    let manifest = directory.join(format!("{name}.pwforge"));
    let mut project = Project {
        format: "pw-forge-project".into(),
        client_version,
        gshop_version: None,
        elements_profile: None,
        detected_gshop_versions: BTreeMap::new(),
        version: 2,
        name: name.into(),
        source: source.to_string_lossy().into(),
        archives: archives.iter().map(|s| normal(s)).collect(),
        status: "importing".into(),
        errors: vec![],
    };
    write_manifest(&manifest, &project)?;
    let imported = (|| -> Result<()> {
        let data = source.join("data");
        if data.is_dir() {
            let mut files = Vec::new();
            collect_files(&data, &data, &mut files)?;
            for (i, rel) in files.iter().enumerate() {
                let target = managed(&directory, "originals/data", rel)?;
                fs::create_dir_all(target.parent().unwrap()).map_err(err)?;
                fs::copy(data.join(rel), target).map_err(err)?;
                progress(
                    &format!("Copying data/{}", rel.display()),
                    i + 1,
                    files.len(),
                );
            }
        }
        for folder in ["font", "fonts"] {
            let from = source.join(folder);
            if !from.is_dir() {
                continue;
            }
            let mut files = Vec::new();
            collect_files(&from, &from, &mut files)?;
            for rel in files {
                let target = managed(
                    &directory,
                    "originals/archives",
                    &Path::new(folder).join(&rel),
                )?;
                fs::create_dir_all(target.parent().unwrap()).map_err(err)?;
                fs::copy(from.join(rel), target).map_err(err)?;
            }
        }
        for (i, name) in project.archives.iter().enumerate() {
            let from = safe(&source, &archive_relative(name)?)?;
            let to = copied(&directory, name)?;
            fs::create_dir_all(to.parent().unwrap()).map_err(err)?;
            progress(
                &format!("Copying {name} / PKX"),
                i,
                project.archives.len(),
            );
            fs::copy(&from, &to).map_err(err)?;
            let extra = from.with_extension("pkx");
            if extra.exists() {
                fs::copy(extra, to.with_extension("pkx")).map_err(err)?;
            }
            let index = get_index(&directory, name, progress)?;
            progress(
                &format!("Index {name}: {} files", index.entries.len()),
                i + 1,
                project.archives.len(),
            );
        }
        Ok(())
    })();
    if let Err(e) = imported {
        project.errors.push(e);
    }
    project.status = if project.errors.is_empty() {
        "ready"
    } else {
        "incomplete"
    }
    .into();
    write_manifest(&manifest, &project)?;
    Ok(ProjectView {
        manifest: manifest.to_string_lossy().into(),
        project,
    })
}
#[tauri::command]
pub async fn project_create(
    source: String,
    parent: String,
    name: String,
    archives: Vec<String>,
    client_version: Option<String>,
    app: tauri::AppHandle,
) -> Result<ProjectView> {
    background(app, "Import project", move |app| {
        create_project(source, parent, name, archives, client_version.unwrap_or_else(default_client_version), &|s, d, t| {
            report(&app, "Import project", s, d, t)
        })
    })
    .await
}
#[tauri::command]
pub fn project_open(path: String) -> Result<ProjectView> {
    let path = PathBuf::from(path).canonicalize().map_err(err)?;
    let project = load(&path)?;
    let root = path.parent().ok_or("No folder")?;
    if !safe(root, Path::new("originals"))?.is_dir() {
        return Err("Project originals were not found".into());
    }
    Ok(ProjectView {
        manifest: path.to_string_lossy().into(),
        project,
    })
}
#[tauri::command]
pub fn project_startup() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .find(|a| {
            Path::new(a)
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("pwforge"))
        })
        .map(|a| a.to_string_lossy().into())
}
fn children_impl(manifest: &str, path: &str) -> Result<Vec<FileItem>> {
    let (root, p) = location(manifest)?;
    if path.is_empty() {
        return Ok(["data", "server", "archives"]
            .iter()
            .map(|s| FileItem {
                name: s.to_string(),
                path: s.to_string(),
                directory: true,
                size: 0,
                changed: false,
            })
            .collect());
    }
    archive_relative(path)?;
    if path == "archives" {
        return p
            .archives
            .iter()
            .map(|name| {
                let i = get_index(&root, name, &|_, _, _| {})?;
                Ok(FileItem {
                    name: name.clone(),
                    path: format!("archives/{name}"),
                    directory: true,
                    size: i.entries.len() as u64,
                    changed: false,
                })
            })
            .collect();
    }
    if let Some((name, entry)) = virtual_archive(&p, path)? {
        let index = get_index(&root, name, &|_, _, _| {})?;
        let mut result = index
            .children
            .get_or_init(|| index_children(&index.entries))
            .get(&key(&entry))
            .cloned()
            .unwrap_or_default();
        for item in &mut result {
            item.path = format!("archives/{}/{}", normal(name), item.path);
            let edited = managed(&root, "edits", &archive_relative(&item.path)?)?;
            item.changed = edited.exists();
            if !item.directory && edited.is_file() {
                item.size = fs::metadata(edited).map_err(err)?.len();
            }
        }
        return Ok(result);
    }
    if path != "data" && !path.starts_with("data/") && path != "server" && !path.starts_with("server/") {
        return Err("No section".into());
    }
    let directory = managed(&root, "originals", &archive_relative(path)?)?;
    let mut result = Vec::new();
    if !directory.exists() { return Ok(Vec::new()); }
    for entry in fs::read_dir(directory).map_err(err)? {
        let e = entry.map_err(err)?;
        reject_link(&e.path())?;
        let m = e.metadata().map_err(err)?;
        let name = e.file_name().to_string_lossy().to_string();
        let relative = format!("{path}/{name}");
        let edited = managed(&root, "edits", &archive_relative(&relative)?)?;
        result.push(FileItem {
            name,
            path: relative,
            directory: m.is_dir(),
            size: if edited.is_file() {
                fs::metadata(&edited).map_err(err)?.len()
            } else {
                m.len()
            },
            changed: edited.exists(),
        });
    }
    result.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then_with(|| key(&a.name).cmp(&key(&b.name)))
    });
    Ok(result)
}
#[tauri::command]
pub async fn project_children(
    manifest: String,
    path: String,
    app: tauri::AppHandle,
) -> Result<Vec<FileItem>> {
    background(app, "Project tree", move |_| {
        children_impl(&manifest, &path)
    })
    .await
}
#[tauri::command]
pub async fn project_path(manifest: String, path: String, app: tauri::AppHandle) -> Result<String> {
    background(app, "Extract file", move |_| {
        Ok(materialize(&manifest, &path)?.to_string_lossy().into())
    })
    .await
}
pub(super) fn read_impl(manifest: &str, path: &str) -> Result<Vec<u8>> {
    let path = materialize(manifest, path)?;
    if fs::metadata(&path).map_err(err)?.len() > 8 * 1024 * 1024 {
        return Err("File exceeds 8 MiB: use a specialized editor".into());
    }
    fs::read(path).map_err(err)
}
#[tauri::command]
pub async fn project_read(
    manifest: String,
    path: String,
    app: tauri::AppHandle,
) -> Result<Vec<u8>> {
    background(app, "Extract file", move |_| {
        read_impl(&manifest, &path)
    })
    .await
}
#[tauri::command]
pub async fn project_write(
    manifest: String,
    path: String,
    text: String,
    encoding: String,
    original: Vec<u8>,
    app: tauri::AppHandle,
) -> Result<()> {
    background(app, "Saving edit", move |_| {
        store_edit(&manifest, &path, &original, &encode_text(text, encoding)?)?;
        Ok(())
    })
    .await
}
pub(super) fn write_archive(
    archive: &Archive,
    target: &Path,
    overrides: &HashMap<usize, PathBuf>,
    progress: &dyn Fn(&str, usize, usize),
) -> Result<Archive> {
    let mut spool =
        tempfile::NamedTempFile::new_in(target.parent().ok_or("No folder")?).map_err(err)?;
    let mut safe_header = vec![0; 12];
    put(&mut safe_header, 0, 0x4dca23ef);
    put(&mut safe_header, 8, 0x56a089b7);
    spool.write_all(&safe_header).map_err(err)?;
    let mut rows = Vec::new();
    for (i, e) in archive.entries.iter().enumerate() {
        build_checkpoint()?;
        let offset = spool.stream_position().map_err(err)?;
        let replacement = if let Some(path) = overrides.get(&i) {
            Some(std::borrow::Cow::Owned(fs::read(path).map_err(err)?))
        } else {
            e.data.as_deref().map(std::borrow::Cow::Borrowed)
        };
        let (packed, len) = if let Some(d) = replacement {
            if d.len() > 256 * 1024 * 1024 {
                return Err("Edit exceeds the 256 MiB limit".into());
            }
            let len = d.len() as u32;
            let compressed = compress(&d)?;
            let mut b = if compressed.len() < d.len() { compressed } else { d.into_owned() };
            if archive.encrypted {
                let mask = (b.len() as u32).wrapping_add(0x739802ab);
                for c in b.chunks_exact_mut(4) {
                    let v = u32::from_be_bytes(c.try_into().unwrap()) ^ mask;
                    c.copy_from_slice(&v.rotate_right(16).to_be_bytes());
                }
            }
            (b, len)
        } else {
            (
                Archive::read_at(&archive.path, e.offset as u64, e.packed.min(e.len) as usize)?,
                e.len,
            )
        };
        if offset + packed.len() as u64 > u32::MAX as u64 {
            return Err("Archive exceeds the 4 GiB addressable size".into());
        }
        spool.write_all(&packed).map_err(err)?;
        let mut row = e.raw.clone();
        let o = if row.len() == 288 { 268 } else { 260 };
        put(&mut row, o, offset as u32);
        put(&mut row, o + 4, len);
        put(&mut row, o + 8, packed.len() as u32);
        rows.push(row);
        if i % 128 == 0 || i + 1 == archive.entries.len() {
            progress("Writing resources", i + 1, archive.entries.len());
        }
    }
    let table = u32::try_from(spool.stream_position().map_err(err)?).map_err(err)?;
    for (i, row) in rows.iter().enumerate() {
        build_checkpoint()?;
        let b = compress(row)?;
        let n = b.len() as u32;
        spool
            .write_all(&(n ^ archive.keys.mask).to_le_bytes())
            .map_err(err)?;
        spool
            .write_all(&(n ^ archive.keys.mask ^ archive.keys.check).to_le_bytes())
            .map_err(err)?;
        spool.write_all(&b).map_err(err)?;
        if i % 256 == 0 {
            progress("Writing PCK index", i, rows.len());
        }
    }
    let mut header = archive.header.clone();
    let field = header.len() - 264;
    put(&mut header, field, table ^ archive.keys.mask);
    spool.write_all(&header).map_err(err)?;
    spool
        .write_all(&(archive.entries.len() as u32).to_le_bytes())
        .map_err(err)?;
    spool.write_all(&VERSION.to_le_bytes()).map_err(err)?;
    let end = spool.stream_position().map_err(err)?;
    put(
        &mut safe_header,
        4,
        u32::try_from(end).map_err(|_| "Output archive exceeds 4 GiB")?,
    );
    spool.seek(SeekFrom::Start(0)).map_err(err)?;
    spool.write_all(&safe_header).map_err(err)?;
    split_spool(spool.as_file_mut(), target, SPLIT)?;
    progress("Verifying built archive", 0, overrides.len());
    let checked = Archive::open_progress(target.to_path_buf(), &|_, _, _| {})?;
    if checked.entries.len() != archive.entries.len() {
        return Err("Entry count verification failed".into());
    }
    for (done, (i, path)) in overrides.iter().enumerate() {
        build_checkpoint()?;
        progress("Verifying built archive", done, overrides.len() + archive.entries.len());
        if checked.data(*i)? != fs::read(path).map_err(err)? {
            return Err(format!(
                "Entry {} verification failed",
                archive.entries[*i].name
            ));
        }
    }
    for (i, entry) in archive.entries.iter().enumerate() {
        build_checkpoint()?;
        if i % 256 == 0 { progress("Verifying built archive", overrides.len() + i, overrides.len() + archive.entries.len()); }
        if let Some(data) = &entry.data {
            if !overrides.contains_key(&i) && checked.data(i)? != *data {
                return Err(format!("Entry {} verification failed", entry.name));
            }
        }
    }
    Ok(checked)
}
fn split_spool(spool: &mut File, target: &Path, boundary: u64) -> Result<()> {
    let end = spool.metadata().map_err(err)?.len();
    spool.seek(SeekFrom::Start(0)).map_err(err)?;
    let mut pck = File::create(target).map_err(err)?;
    copy_cancellable(&mut (&mut *spool).take(boundary), &mut pck)?;
    pck.sync_all().map_err(err)?;
    drop(pck);
    if end > boundary {
        let mut pkx = File::create(target.with_extension("pkx")).map_err(err)?;
        copy_cancellable(spool, &mut pkx)?;
        pkx.sync_all().map_err(err)?;
    }
    Ok(())
}
fn copy_cancellable(reader: &mut impl Read, writer: &mut impl Write) -> Result<()> {
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        build_checkpoint()?;
        let count = reader.read(&mut buffer).map_err(err)?;
        if count == 0 { return Ok(()); }
        writer.write_all(&buffer[..count]).map_err(err)?;
    }
}
fn copy_build_file(from: &Path, to: &Path) -> Result<()> {
    copy_cancellable(&mut File::open(from).map_err(err)?, &mut File::create(to).map_err(err)?)
}
#[derive(Serialize)]
pub struct BuildResult {
    directory: String,
    archives: Vec<String>,
    loose_files: usize,
    server_files: Vec<String>,
    client_files: Vec<String>,
}
pub(super) fn build_impl(manifest: &str, progress: &(dyn Fn(&str, usize, usize) + Sync)) -> Result<BuildResult> {
    build_mode(manifest, false, 0, progress)
}
fn build_mode(manifest: &str, full: bool, threads: usize, progress: &(dyn Fn(&str, usize, usize) + Sync)) -> Result<BuildResult> {
    let _lock = IO.lock().map_err(err)?;
    let (root, p) = location(manifest)?;
    if p.status != "ready" {
        return Err("Project import is incomplete. Check the errors.".into());
    }
    build_checkpoint()?;
    progress("Collecting project files", 0, 0);
    let edits_root = safe(&root, Path::new("edits"))?;
    let mut edits = Vec::new();
    collect_files(&edits_root, &edits_root, &mut edits)?;
    let mut groups: HashMap<String, HashMap<usize, PathBuf>> = HashMap::new();
    let mut loose = Vec::new();
    for rel in edits {
        let path = normal(&rel.to_string_lossy());
        if path.strip_prefix("archives/").is_some_and(|path| {
            path.split('/').find(|part| part.to_ascii_lowercase().ends_with(".pck"))
                .is_some_and(is_bug_archive)
        }) {
            continue;
        }
        let canonical = canonical_virtual(&root, &p, &path)?;
        let file = managed(&root, "edits", &archive_relative(&canonical)?)?;
        if let Some((name, entry)) = virtual_archive(&p, &canonical)? {
            let index = get_index(&root, name, progress)?;
            let i = *index
                .positions
                .get(&key(&entry))
                .ok_or("Edit is absent from the index")?;
            groups.entry(name.into()).or_default().insert(i, file);
        } else {
            loose.push((archive_relative(&canonical)?, file));
        }
    }
    if full {
        for name in &p.archives {
            if !is_bug_archive(name) { groups.entry(name.clone()).or_default(); }
        }
        let existing: HashSet<_> = loose.iter().map(|(rel, _)| key(&rel.to_string_lossy())).collect();
        for section in ["data", "server"] {
            let source = managed(&root, "originals", Path::new(section))?;
            if !source.is_dir() { continue; }
            let mut files = Vec::new();
            collect_files(&source, &source, &mut files)?;
            for rel in files {
                let target = Path::new(section).join(&rel);
                if !existing.contains(&key(&target.to_string_lossy())) { loose.push((target, source.join(rel))); }
            }
        }
    }
    if groups.is_empty() && loose.is_empty() {
        return Err("There are no saved edits to build".into());
    }
    let staging = tempfile::Builder::new()
        .prefix("pwforge-build-")
        .tempdir()
        .map_err(err)?;
    fs::create_dir_all(staging.path().join("server")).map_err(err)?;
    fs::create_dir_all(staging.path().join("client")).map_err(err)?;
    let mut names: Vec<_> = groups.keys().cloned().collect();
    names.sort();
    let overall_total = (names.len() + loose.len() + 1) * 1000;
    let mut overall_done = 0;
    progress("__overall", overall_done, overall_total);
    let workers = if threads == 0 { std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) } else { threads.clamp(1, 32) }.min(names.len());
    progress(&format!("Archive workers: {workers}"), 0, 0);
    let next = std::sync::atomic::AtomicUsize::new(0);
    let amounts = Mutex::new(vec![0usize; names.len()]);
    let failure = Mutex::new(None::<String>);
    let cancellable = BUILD_THREAD.with(|v| v.get());
    std::thread::scope(|scope| {
        let mut handles = Vec::new();
        for worker in 0..workers {
            let (next, failure, amounts, names, root, staging, groups) = (&next, &failure, &amounts, &names, &root, &staging, &groups);
            handles.push(scope.spawn(move || {
                BUILD_THREAD.with(|v| v.set(cancellable));
                loop {
                    if failure.lock().unwrap().is_some() { break; }
                    let index = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    if index >= names.len() { break; }
                    let name = &names[index];
                    let stage = Mutex::new(String::from("Building archive"));
                    let update = |amount: usize| {
                        let mut values = amounts.lock().unwrap();
                        values[index] = values[index].max(amount);
                        progress("__overall", values.iter().sum(), overall_total);
                        progress(&format!("__worker:{}:{}", worker + 1, serde_json::json!({"archive": name, "stage": *stage.lock().unwrap()})), values[index], 1000);
                    };
                    let result = (|| -> Result<()> {
        build_checkpoint()?;
        progress(&format!("Building client/{name}"), 0, 0);
        let archive = Archive::open_progress(copied(&root, name)?, &|reading_stage, done, total| {
            *stage.lock().unwrap() = reading_stage.into();
            progress(&format!("{name}: {reading_stage}"), done, total);
            if total > 0 { update(done.min(total) * 100 / total); }
        })?;
        let target = staging.path().join("client").join(archive_relative(name)?);
        fs::create_dir_all(target.parent().unwrap()).map_err(err)?;
        write_archive(&archive, &target, &groups[name], &|s, d, t| {
            *stage.lock().unwrap() = s.into();
            progress(&format!("{name}: {s}"), d, t);
            let (base, weight) = match s {
                "Writing resources" => (100, 600),
                "Writing PCK index" => (700, 150),
                _ => (850, 150),
            };
            let fraction = if t > 0 { d.min(t) * weight / t } else { 0 };
            update(base + fraction);
        })?;

                        *stage.lock().unwrap() = "Build complete".into();
                        update(1000);
                        Ok(())
                    })();
                    if let Err(error) = result { *failure.lock().unwrap() = Some(error); break; }
                }
                BUILD_THREAD.with(|v| v.set(false));
            }));
        }
        for handle in handles { if handle.join().is_err() { *failure.lock().unwrap() = Some("Archive worker failed".into()); } }
    });
    if let Some(error) = failure.into_inner().map_err(err)? { return Err(error); }
    overall_done = names.len() * 1000;
    for (rel, file) in &loose {
        build_checkpoint()?;
        let output = if rel.starts_with("server") { rel.clone() } else { Path::new("client").join(rel) };
        progress(&format!("Copying {}", output.display()), 0, 0);
        let target = staging.path().join(output);
        fs::create_dir_all(target.parent().unwrap()).map_err(err)?;
        copy_build_file(file, &target)?;
        if fs::read(file).map_err(err)? != fs::read(target).map_err(err)? {
            return Err("Loose file verification failed".into());
        }
        overall_done += 1000;
        progress("__overall", overall_done, overall_total);
    }
    let builds = safe(&root, Path::new("builds"))?;
    fs::create_dir_all(&builds).map_err(err)?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(err)?
        .as_nanos();
    let destination = builds.join(timestamp.to_string());
    let result = BuildResult {
        directory: destination.to_string_lossy().into(),
        archives: names,
        loose_files: loose.len(),
        server_files: loose.iter().filter(|(rel, _)| rel.starts_with("server")).map(|(rel, _)| normal(&rel.to_string_lossy())).collect(),
        client_files: loose.iter().filter(|(rel, _)| !rel.starts_with("server")).map(|(rel, _)| normal(&rel.to_string_lossy())).collect(),
    };
    fs::write(
        &staging.path().join("pwforge-build.json"),
        &serde_json::to_vec_pretty(&result).map_err(err)?,
    ).map_err(err)?;
    build_checkpoint()?;
    progress("Publishing build", 0, 0);
    // System temp may be on a different volume. Copy into an unpublished
    // directory on the destination volume, then publish with an atomic rename.
    let publishing = tempfile::Builder::new().prefix(".publishing-").tempdir_in(&builds).map_err(err)?;
    fs::create_dir_all(publishing.path().join("server")).map_err(err)?;
    fs::create_dir_all(publishing.path().join("client")).map_err(err)?;
    let mut output_files = Vec::new();
    collect_files(staging.path(), staging.path(), &mut output_files)?;
    for (index, rel) in output_files.iter().enumerate() {
        build_checkpoint()?;
        progress(&format!("Publishing {}", rel.display()), index, output_files.len());
        progress("__overall", overall_done + index * 1000 / output_files.len().max(1), overall_total);
        let target = publishing.path().join(rel);
        fs::create_dir_all(target.parent().unwrap()).map_err(err)?;
        copy_build_file(&staging.path().join(rel), &target)?;
    }
    build_checkpoint()?;
    fs::rename(publishing.path(), &destination).map_err(err)?;
    progress("__overall", overall_total, overall_total);
    Ok(result)
}
#[tauri::command]
pub async fn project_build(manifest: String, full: Option<bool>, threads: Option<usize>, app: tauri::AppHandle) -> Result<BuildResult> {
    if BUILD_ACTIVE.swap(true, std::sync::atomic::Ordering::SeqCst) { return Err("A build is already running".into()); }
    BUILD_CANCEL.store(false, std::sync::atomic::Ordering::SeqCst);
    let result = background(app, "Build project", move |app| {
        BUILD_THREAD.with(|v| v.set(true));
        let started = std::time::Instant::now();
        let (root, _) = location(&manifest)?;
        let log_dir = safe(&root, Path::new(".forge/logs"))?;
        fs::create_dir_all(&log_dir).map_err(err)?;
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(err)?.as_nanos();
        let log_path = log_dir.join(format!("build-{stamp}.log"));
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&log_path).map_err(err)?;
        writeln!(file, "Build started: {stamp}\nProject: {manifest}\nFull build: {}\nThreads: {}", full.unwrap_or(false), threads.unwrap_or(0)).map_err(err)?;
        file.sync_data().map_err(err)?;
        let log = Mutex::new(file);
        let log_error = Mutex::new(None::<String>);
        report(&app, "Build project", &format!("Build log: {}", log_path.display()), 0, 0);
        let result = build_mode(&manifest, full.unwrap_or(false), threads.unwrap_or(0), &|s, d, t| {
            // Overall/worker events duplicate detailed stages and need not hit disk.
            if !s.starts_with("__") {
                let written = (|| -> Result<()> {
                    let mut file = log.lock().map_err(err)?;
                    writeln!(file, "[{:.3}s] {s} {d}/{t}", started.elapsed().as_secs_f64()).map_err(err)?;
                    file.sync_data().map_err(err)
                })();
                if let Err(error) = written { *log_error.lock().unwrap() = Some(error); BUILD_CANCEL.store(true, std::sync::atomic::Ordering::SeqCst); }
            }
            report(&app, "Build project", s, d, t);
        });
        BUILD_THREAD.with(|v| v.set(false));
        {
            let mut file = log.lock().map_err(err)?;
            let status = match &result { Ok(_) => "Build complete".to_string(), Err(error) => format!("Build stopped: {error}") };
            writeln!(file, "[{:.3}s] {status}", started.elapsed().as_secs_f64()).map_err(err)?;
            file.sync_data().map_err(err)?;
        }
        if let Some(error) = log_error.into_inner().map_err(err)? { return Err(format!("Build log write failed: {error}")); }
        if let Ok(ref built) = result {
            fs::copy(&log_path, Path::new(&built.directory).join("build.log")).map_err(err)?;
        }
        result
    }).await;
    BUILD_ACTIVE.store(false, std::sync::atomic::Ordering::SeqCst);
    result
}
#[tauri::command]
pub async fn project_clean_builds(manifest: String, keep: usize, app: tauri::AppHandle) -> Result<usize> {
    background(app, "Clean builds", move |_| {
        let _lock = IO.lock().map_err(err)?;
        let (root, _) = location(&manifest)?;
        let builds = safe(&root, Path::new("builds"))?;
        if !builds.exists() { return Ok(0); }
        reject_link(&builds)?;
        let base = builds.canonicalize().map_err(err)?;
        let mut candidates = Vec::new();
        for entry in fs::read_dir(&base).map_err(err)? {
            let entry = entry.map_err(err)?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.parse::<u128>().is_err() || !entry.file_type().map_err(err)?.is_dir() { continue; }
            let path = entry.path(); reject_link(&path)?;
            let resolved = path.canonicalize().map_err(err)?;
            if resolved.parent() != Some(base.as_path()) { return Err("Invalid build path".into()); }
            if resolved.join("pwforge-build.json").is_file() { candidates.push((name.parse::<u128>().map_err(err)?, resolved)); }
        }
        candidates.sort_by(|a,b| b.0.cmp(&a.0));
        let mut deleted=0;
        for (_, path) in candidates.into_iter().skip(keep) { fs::remove_dir_all(path).map_err(err)?; deleted+=1; }
        Ok(deleted)
    }).await
}
#[tauri::command]
pub fn project_register_association() -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let exe = std::env::current_exe().map_err(err)?;
        let command = format!("\"{}\" \"%1\"", exe.display());
        for (k, v) in [
            ("HKCU\\Software\\Classes\\.pwforge", "PWForge.Project"),
            (
                "HKCU\\Software\\Classes\\PWForge.Project",
                "PW Forge Project",
            ),
            (
                "HKCU\\Software\\Classes\\PWForge.Project\\shell\\open\\command",
                command.as_str(),
            ),
        ] {
            let r = std::process::Command::new("reg.exe")
                .args(["add", k, "/ve", "/t", "REG_SZ", "/d", v, "/f"])
                .creation_flags(0x08000000)
                .output()
                .map_err(err)?;
            if !r.status.success() {
                return Err(String::from_utf8_lossy(&r.stderr).into());
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("File association is available on Windows".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split_output_preserves_boundary_bytes() {
        let t = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let mut spool = tempfile::NamedTempFile::new_in(t.path()).unwrap();
        let payload: Vec<u8> = (0..=255).cycle().take(1057).collect();
        spool.write_all(&payload).unwrap();
        let target = t.path().join("split.pck");
        split_spool(spool.as_file_mut(), &target, 31).unwrap();
        assert_eq!(fs::read(&target).unwrap(), payload[..31]);
        assert_eq!(
            fs::read(target.with_extension("pkx")).unwrap(),
            payload[31..]
        );
    }
    #[test]
    fn encrypted_archive_rebuild_preserves_untouched_data() {
        let (t, p) = fixture();
        let root = t.path().join("Test");
        let mut archive = Archive::open(root.join("originals/archives/interfaces.pck")).unwrap();
        archive.encrypted = true;
        let flag = archive.header.len() - 260;
        let flags =
            u32::from_le_bytes(archive.header[flag..flag + 4].try_into().unwrap()) | 0x80000000;
        put(&mut archive.header, flag, flags);
        let mut overrides = HashMap::new();
        for (i, e) in archive.entries.iter().enumerate() {
            let file = t.path().join(format!("encrypted-edit-{i}"));
            fs::write(
                &file,
                if e.name.ends_with("test.xml") {
                    b"<Encrypted/>".to_vec()
                } else {
                    vec![b'z'; 5000]
                },
            )
            .unwrap();
            overrides.insert(i, file);
        }
        let first = t.path().join("encrypted.pck");
        write_archive(&archive, &first, &overrides, &|_, _, _| {}).unwrap();
        let encrypted = Archive::open(first).unwrap();
        assert!(encrypted.encrypted);
        let i = encrypted
            .entries
            .iter()
            .position(|e| e.name.ends_with("test.xml"))
            .unwrap();
        let edit = t.path().join("second-edit");
        fs::write(&edit, b"<SecondEncrypted/>").unwrap();
        let second = t.path().join("second.pck");
        write_archive(
            &encrypted,
            &second,
            &HashMap::from([(i, edit)]),
            &|_, _, _| {},
        )
        .unwrap();
        let checked = Archive::open(second).unwrap();
        assert_eq!(checked.data(i).unwrap(), b"<SecondEncrypted/>");
        for (j, e) in checked.entries.iter().enumerate() {
            if j != i {
                assert_eq!(checked.data(j).unwrap(), vec![b'z'; 5000]);
                assert_eq!(e.name, encrypted.entries[j].name);
            }
        }
        assert!(project_open(p.manifest).is_ok());
    }
    fn fixture() -> (tempfile::TempDir, ProjectView) {
        let t = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let client = t.path().join("client");
        let resources = t.path().join("resources");
        fs::create_dir_all(client.join("data")).unwrap();
        fs::create_dir_all(resources.join("interfaces")).unwrap();
        fs::write(client.join("data/config.ini"), b"level=1\r\n").unwrap();
        fs::write(resources.join("interfaces/test.xml"), b"<Dialog/>\r\n").unwrap();
        fs::write(resources.join("interfaces/untouched.txt"), vec![b'x'; 5000]).unwrap();
        super::super::pack_folder_impl(&resources, &client.join("interfaces.pck"), &|_, _, _| {})
            .unwrap();
        fs::write(client.join("interfaces.pkx"), b"companion").unwrap();
        fs::write(client.join("unselected.pck"), b"unselected").unwrap();
        let p = create_project(
            client.to_string_lossy().into(),
            t.path().to_string_lossy().into(),
            "Test".into(),
            vec!["interfaces.pck".into()],
            default_client_version(),
            &|_, _, _| {},
        )
        .unwrap();
        (t, p)
    }
    #[test]
    fn lazy_import_edit_and_build() {
        let (t, p) = fixture();
        assert_eq!(p.project.status, "ready");
        let root = t.path().join("Test").canonicalize().unwrap();
        assert_eq!(
            fs::read(root.join("originals/archives/interfaces.pkx")).unwrap(),
            b"companion"
        );
        assert!(!root.join("originals/archives/unselected.pck").exists());
        assert_eq!(fs::read_dir(root.join(".forge/cache")).unwrap().count(), 0);
        assert_eq!(
            children_impl(&p.manifest, "archives/interfaces.pck/interfaces")
                .unwrap()
                .len(),
            2
        );
        assert_eq!(fs::read_dir(root.join(".forge/cache")).unwrap().count(), 0);
        let path = "archives/interfaces.pck/interfaces/test.xml";
        assert_eq!(read_impl(&p.manifest, path).unwrap(), b"<Dialog/>\r\n");
        let cached = materialize(&p.manifest, path).unwrap();
        assert!(cached.starts_with(root.join(".forge/cache")));
        assert!(!cached.parent().unwrap().join("untouched.txt").exists());
        let original = fs::read(root.join("originals/archives/interfaces.pck")).unwrap();
        store_edit(
            &p.manifest,
            path,
            b"<Dialog/>\r\n",
            b"<Dialog name=\"changed\"/>\r\n",
        )
        .unwrap();
        assert_eq!(fs::read(cached).unwrap(), b"<Dialog/>\r\n");
        store_edit(
            &p.manifest,
            "data/config.ini",
            b"level=1\r\n",
            b"level=2\r\n",
        )
        .unwrap();
        let output = build_impl(&p.manifest, &|_, _, _| {}).unwrap();
        assert_eq!(output.archives, vec!["interfaces.pck"]);
        assert_eq!(output.loose_files, 1);
        let built = Archive::open(Path::new(&output.directory).join("client/interfaces.pck")).unwrap();
        for (i, e) in built.entries.iter().enumerate() {
            if e.name.ends_with("test.xml") {
                assert_eq!(built.data(i).unwrap(), b"<Dialog name=\"changed\"/>\r\n");
            } else {
                assert_eq!(built.data(i).unwrap(), vec![b'x'; 5000]);
            }
        }
        assert_eq!(
            fs::read(Path::new(&output.directory).join("client/data/config.ini")).unwrap(),
            b"level=2\r\n"
        );
        assert_eq!(
            fs::read(root.join("originals/archives/interfaces.pck")).unwrap(),
            original
        );
        assert_eq!(
            fs::read(t.path().join("client/data/config.ini")).unwrap(),
            b"level=1\r\n"
        );
        assert!(project_open(p.manifest).is_ok());
    }
    #[test]
    fn paths_and_cache_recreation() {
        let (t, p) = fixture();
        let root = t.path().join("Test").canonicalize().unwrap();
        assert!(materialize(&p.manifest, "../client/data/config.ini").is_err());
        assert!(store_edit(&p.manifest, "originals/data/config.ini", b"", b"x").is_err());
        assert!(store_edit(&p.manifest, "data/config.ini", b"stale", b"x").is_err());
        assert!(build_impl(&p.manifest, &|_, _, _| {}).is_err());
        INDEXES
            .get()
            .unwrap()
            .lock()
            .unwrap()
            .retain(|path, _| !path.starts_with(&root));
        fs::write(
            root.join(".forge/index/interfaces.pck.json.gz"),
            b"broken index",
        )
        .unwrap();
        assert_eq!(
            children_impl(&p.manifest, "archives/interfaces.pck/interfaces")
                .unwrap()
                .len(),
            2
        );
    }
}

pub(super) fn import_server(manifest: &str, source: &Path) -> Result<()> {
    let (root, _) = location(manifest)?;
    let target = managed(&root, "originals", Path::new("server"))?;
    if target.exists() { return Err("Server files have already been added to this project".into()); }
    let source = source.canonicalize().map_err(err)?;
    let mut files = Vec::new();
    collect_files(&source, &source, &mut files)?;
    if files.is_empty() { return Err("The server files folder is empty".into()); }
    let staging = tempfile::Builder::new().prefix("server-import-")
        .tempdir_in(safe(&root, Path::new(".forge"))?).map_err(err)?;
    for relative in files {
        let destination = staging.path().join(&relative);
        if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(err)?; }
        fs::copy(source.join(relative), destination).map_err(err)?;
    }
    fs::rename(staging.path(), target).map_err(err)?;
    Ok(())
}
#[cfg(test)]
#[test]
fn build_copy_observes_cancellation() {
    BUILD_THREAD.with(|v| v.set(true));
    BUILD_CANCEL.store(true, std::sync::atomic::Ordering::SeqCst);
    let mut source = std::io::Cursor::new(vec![1u8; 1024]);
    let mut target = Vec::new();
    let result = copy_cancellable(&mut source, &mut target);
    BUILD_THREAD.with(|v| v.set(false));
    BUILD_CANCEL.store(false, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(result.unwrap_err(), "Build cancelled");
    assert!(target.is_empty());
}
