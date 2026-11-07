use super::{decode, err, parse, string, Node, Result, Session, Target};
use base64::Engine;
use serde_json::{json, Value};
use std::path::PathBuf;

impl Session {
    pub(super) fn preview(&self, entry: &str, xml: &str, nodes: &[Node]) -> Result<Value> {
        const BUNDLE: &str = include_str!(concat!(env!("OUT_DIR"), "/mcp-preview.js"));
        if BUNDLE.is_empty() {
            return Err(
                "Build the PckView frontend with npm run build before building Rust".into(),
            );
        }
        let mut textures = serde_json::Map::new();
        let mut fonts = serde_json::Map::new();
        let encode =
            |bytes: Vec<u8>| Value::String(base64::engine::general_purpose::STANDARD.encode(bytes));
        let entry = entry.replace('\\', "/");
        let file = if matches!(self.target, Target::Project(_)) {
            entry
                .to_ascii_lowercase()
                .find(".pck/")
                .map_or(entry.as_str(), |end| &entry[end + 5..])
        } else {
            entry.as_str()
        };
        let mut dialogs = serde_json::Map::new();
        let mut texture_paths = std::collections::BTreeSet::new();
        let root = match &self.target {
            Target::Unopened => return Err("Open a project first".into()),
            Target::Project(project) => {
                let catalog = super::super::project::catalog(&project.manifest, &|_, _, _| {})?;
                let mut read = super::super::project::search_reader(&project.manifest)?;
                collect_preview_assets(
                    file,
                    nodes,
                    0,
                    &mut dialogs,
                    &mut texture_paths,
                    &mut |name| {
                        let entry = catalog.iter().find(|item| {
                            item.name.replace('\\', "/").eq_ignore_ascii_case(name)
                                && item.size <= 8 * 1024 * 1024
                        })?;
                        read(&entry.path).ok()
                    },
                );
                for path in texture_paths {
                    let requested = path.replace('\\', "/").to_lowercase();
                    let candidates = [
                        requested.clone(),
                        format!("surfaces/{requested}"),
                        format!("interfaces/{requested}"),
                    ];
                    if let Some(entry) = catalog.iter().rev().find(|item| {
                        candidates.contains(&item.name.replace('\\', "/").to_lowercase())
                            && item.size <= 32 * 1024 * 1024
                    }) {
                        if let Ok(bytes) = read(&entry.path) {
                            textures.insert(path, encode(bytes));
                        }
                    }
                }
                for entry in catalog
                    .iter()
                    .filter(|item| font_file(&item.name) && item.size <= 64 * 1024 * 1024)
                {
                    if let Ok(bytes) = read(&entry.path) {
                        fonts.insert(entry.path.clone(), encode(bytes));
                    }
                }
                super::super::project::native_root(&project.manifest)?
            }
            Target::Archive { archive, .. } => {
                let state = super::super::App(std::sync::Arc::new(std::sync::Mutex::new(Some(
                    archive.clone(),
                ))));
                let cache = super::super::SurfaceCache::default();
                collect_preview_assets(
                    file,
                    nodes,
                    0,
                    &mut dialogs,
                    &mut texture_paths,
                    &mut |name| {
                        let index = archive.entries.iter().position(|item| {
                            item.name.replace('\\', "/").eq_ignore_ascii_case(name)
                        })?;
                        archive.data(index).ok()
                    },
                );
                for path in texture_paths {
                    let requested = path.replace('/', "\\");
                    let bytes = archive
                        .entries
                        .iter()
                        .position(|item| item.name.eq_ignore_ascii_case(&requested))
                        .map_or_else(
                            || super::super::read_surface_impl(&path, &state, &cache),
                            |index| archive.data(index),
                        );
                    if let Ok(bytes) = bytes {
                        textures.insert(path, encode(bytes));
                    }
                }
                for (index, entry) in archive
                    .entries
                    .iter()
                    .enumerate()
                    .filter(|(_, entry)| font_file(&entry.name))
                {
                    if let Ok(bytes) = archive.data(index) {
                        fonts.insert(entry.name.clone(), encode(bytes));
                    }
                }
                archive
                    .path
                    .parent()
                    .ok_or("Archive has no parent directory")?
                    .to_path_buf()
            }
        };
        for folder in ["font", "fonts"] {
            if let Ok(files) = std::fs::read_dir(root.join(folder)) {
                for entry in files.flatten() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if font_file(&name)
                        && entry
                            .metadata()
                            .is_ok_and(|m| m.is_file() && m.len() <= 64 * 1024 * 1024)
                    {
                        if let Ok(bytes) = std::fs::read(entry.path()) {
                            fonts.insert(format!("{folder}/{name}"), encode(bytes));
                        }
                    }
                }
            }
        }
        let input =
            json!({"text":xml,"file":file,"dialogs":dialogs,"textures":textures,"fonts":fonts})
                .to_string()
                .replace('<', "\\u003c");
        let directory = tempfile::tempdir().map_err(err)?;
        let html = format!(
            r#"<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:; font-src blob: data:"><style>body{{margin:0;background:#101720;color:#e6edf4;font-family:Segoe UI,sans-serif}}#root{{display:flex;width:max-content}}</style><div id="root"></div><script>window.addEventListener("error", event => window.previewError = event.message);window.addEventListener("unhandledrejection", event => window.previewError = String(event.reason));window.previewInput={input};</script><script>{BUNDLE}</script>"#
        );
        std::fs::write(directory.path().join("preview.html"), html).map_err(err)?;
        let browser = browser_path()?;
        let output = std::process::Command::new("node")
            .args([
                "-e",
                include_str!("../../scripts/capture-mcp-preview.cjs"),
                "--",
            ])
            .arg(browser)
            .arg(directory.path())
            .output()
            .map_err(err)?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
        }
        let rendered: Value = serde_json::from_slice(&output.stdout).map_err(err)?;
        let data = string(&rendered, "data")?;
        Ok(json!({"content":[
            {"type":"text","text":rendered["report"].to_string()},
            {"type":"image","mimeType":"image/png","data":data}
        ]}))
    }
}

fn collect_preview_assets(
    file: &str,
    nodes: &[Node],
    depth: usize,
    dialogs: &mut serde_json::Map<String, Value>,
    textures: &mut std::collections::BTreeSet<String>,
    read: &mut dyn FnMut(&str) -> Option<Vec<u8>>,
) {
    if depth >= 12 || dialogs.len() >= 64 {
        return;
    }
    let parent = file.rsplit_once('/').map_or("", |(parent, _)| parent);
    for (key, raw) in nodes.iter().flat_map(|node| &node.attributes) {
        let Ok(value) = quick_xml::escape::unescape(raw) else {
            continue;
        };
        if key.eq_ignore_ascii_case("FileName") && !value.to_ascii_lowercase().ends_with(".gfx") {
            textures.insert(value.into_owned());
        } else if key.eq_ignore_ascii_case("DialogFile") {
            let value = value.replace('\\', "/").to_lowercase();
            let candidates = [
                format!("{parent}/{value}"),
                value.clone(),
                format!("interfaces/{value}"),
            ];
            for name in candidates {
                if dialogs.contains_key(&name) {
                    break;
                }
                let Some(bytes) = read(&name) else { continue };
                let Ok((xml, _, _)) = decode(&bytes) else {
                    break;
                };
                let Ok(children) = parse(&xml) else { break };
                dialogs.insert(
                    name.clone(),
                    json!(base64::engine::general_purpose::STANDARD.encode(bytes)),
                );
                collect_preview_assets(&name, &children, depth + 1, dialogs, textures, read);
                break;
            }
        }
    }
}

fn font_file(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(_, ext)| {
        ["ttf", "otf", "ttc"]
            .iter()
            .any(|kind| ext.eq_ignore_ascii_case(kind))
    })
}

fn browser_path() -> Result<PathBuf> {
    if let Some(path) = std::env::var_os("PCKVIEW_MCP_BROWSER") {
        return Ok(path.into());
    }
    for root in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
        .into_iter()
        .filter_map(std::env::var_os)
    {
        for browser in [
            "Google/Chrome/Application/chrome.exe",
            "Microsoft/Edge/Application/msedge.exe",
        ] {
            let path = PathBuf::from(&root).join(browser);
            if path.is_file() {
                return Ok(path);
            }
        }
    }
    Err("Set PCKVIEW_MCP_BROWSER to a Chromium browser executable".into())
}
