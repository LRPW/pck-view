#[path = "mcp_preview.rs"]
mod preview;
use super::{err, project, Archive, Result};
use base64::Engine;
use quick_xml::{events::Event, Reader};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io::{self, BufRead, Write},
    path::PathBuf,
};

struct Session {
    target: Target,
    revision: u64,
}

enum Target {
    Unopened,
    Archive {
        archive: Archive,
        output: PathBuf,
        staged: bool,
    },
    Project(ProjectSession),
}

struct ProjectSession {
    manifest: String,
    entries: Vec<String>,
    snapshots: BTreeMap<usize, ProjectEntry>,
}

struct ProjectEntry {
    original: Vec<u8>,
    pending: Option<Vec<u8>>,
}

impl ProjectSession {
    fn open(path: &std::ffi::OsStr) -> Result<Self> {
        let path = std::fs::canonicalize(path).map_err(err)?;
        let manifest = path.to_str().ok_or("Invalid project path")?.to_owned();
        let entries = project::catalog(&manifest, &|_, _, _| {})?
            .into_iter()
            .filter(|item| {
                item.path.starts_with("data/")
                    || (item.path.starts_with("archives/") && is_xml(&item.path))
            })
            .map(|item| item.path)
            .collect();
        Ok(Self {
            manifest,
            entries,
            snapshots: BTreeMap::new(),
        })
    }

    fn read(&mut self, index: usize, operation: &str) -> Result<(Vec<u8>, bool)> {
        let snapshot = self.snapshots.get(&index);
        if let Some(pending) = snapshot.and_then(|entry| entry.pending.as_ref()) {
            return Ok((pending.clone(), false));
        }
        if operation == "patch_ui" {
            return snapshot
                .map(|entry| (entry.original.clone(), false))
                .ok_or_else(|| "Call inspect_ui before editing a project entry".into());
        }
        let path = &self.entries[index];
        let original = if path.starts_with("data/") {
            let path = project::materialize(&self.manifest, path)?;
            if std::fs::metadata(&path).map_err(err)?.len() > 256 * 1024 * 1024 {
                return Err("Data file exceeds the 256 MiB editor limit".into());
            }
            std::fs::read(path).map_err(err)?
        } else {
            project::read_impl(&self.manifest, path)?
        };
        if operation == "preview_ui" {
            return Ok((original, false));
        }
        let changed = snapshot.is_some_and(|entry| entry.original != original);
        self.snapshots.insert(
            index,
            ProjectEntry {
                original: original.clone(),
                pending: None,
            },
        );
        Ok((original, changed))
    }

    fn save(&mut self) -> Result<usize> {
        let mut saved = 0;
        for (&index, entry) in &mut self.snapshots {
            if let Some(bytes) = &entry.pending {
                project::store_edit(&self.manifest, &self.entries[index], &entry.original, bytes)?;
                entry.original = entry.pending.take().unwrap();
                saved += 1;
            }
        }
        Ok(saved)
    }
}

const TOOLS: &[(&str, &str, &[(&str, &str)])] = &[
    (
        "open_project",
        "Open a PckView project by its manifest path",
        &[("manifest", "string")],
    ),
    (
        "inspect_data",
        "Inspect elements, shop, quest or territory records through the PckView editors",
        &[("entry", "string"), ("selection", "object")],
    ),
    (
        "patch_data",
        "Stage a structured elements, shop, quest or territory edit",
        &[
            ("entry", "string"),
            ("revision", "integer"),
            ("patch", "object"),
        ],
    ),
    (
        "export_texts",
        "Export saved project strings to the PckView source localization JSON",
        &[],
    ),
    (
        "save_translations",
        "Import translated segments into a PckView locale",
        &[("language", "string"), ("changes", "object")],
    ),
    (
        "apply_translations",
        "Apply a saved locale to project edits",
        &[("language", "string")],
    ),
    (
        "create_project",
        "Import a client into a new PckView project",
        &[
            ("source", "string"),
            ("parent", "string"),
            ("name", "string"),
            ("archives", "array"),
        ],
    ),
    (
        "list_data",
        "Search project data/ paths by substring",
        &[("query", "string")],
    ),
    (
        "read_data",
        "Read a project data/ file as base64 and obtain its edit revision",
        &[("entry", "string")],
    ),
    (
        "replace_data",
        "Stage a complete base64 replacement of a project data/ file",
        &[
            ("entry", "string"),
            ("revision", "integer"),
            ("data", "string"),
        ],
    ),
    (
        "translate_texts",
        "Translate up to 50 segments through a PckView provider using its stored credential",
        &[
            ("settings", "object"),
            ("texts", "array"),
            ("target", "string"),
        ],
    ),
    (
        "search_ui",
        "Find up to 50 interface XML paths by substring",
        &[("query", "string")],
    ),
    (
        "inspect_ui",
        "Read the dialog elements, attributes and edit revision",
        &[("entry", "string")],
    ),
    (
        "patch_ui",
        "Set one numeric geometry attribute on an element",
        &[
            ("entry", "string"),
            ("revision", "integer"),
            ("node", "integer"),
            ("attribute", "string"),
            ("value", "integer"),
        ],
    ),
    (
        "preview_ui",
        "Render the PckView interface preview as PNG",
        &[("entry", "string")],
    ),
    (
        "save",
        "Save project edits to disk or stage standalone archive edits",
        &[],
    ),
    (
        "build_archive",
        "Build the saved project or the staged standalone PCK",
        &[],
    ),
];

pub fn run() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(2).collect();
    let target = match args.as_slice() {
        [] => Target::Unopened,
        [manifest] => Target::Project(ProjectSession::open(manifest)?),
        [input, output] => {
            let archive =
                Archive::open_progress(std::fs::canonicalize(input).map_err(err)?, &|_, _, _| {})?;
            let output = std::path::absolute(output).map_err(err)?;
            if !output
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("pck"))
            {
                return Err("Output must be a .pck file".into());
            }
            Target::Archive {
                archive,
                output,
                staged: false,
            }
        }
        _ => return Err("Usage: pckview --mcp [PROJECT.pwforge | INPUT.pck OUTPUT.pck]".into()),
    };
    let mut session = Session {
        target,
        revision: 0,
    };
    let mut stdout = io::stdout().lock();
    for line in io::stdin().lock().lines() {
        let response = match serde_json::from_str::<Value>(&line.map_err(err)?) {
            Ok(request) => session.request(request),
            Err(_) => Some(rpc_error(Value::Null, -32700, "Invalid JSON")),
        };
        if let Some(response) = response {
            writeln!(stdout, "{response}").map_err(err)?;
            stdout.flush().map_err(err)?;
        }
    }
    Ok(())
}

fn rpc_error(id: Value, code: i32, message: &str) -> Value {
    json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})
}

fn content(value: Value) -> Value {
    json!({"content":[{"type":"text","text":value.to_string()}],"structuredContent":value})
}

fn string<'a>(args: &'a Value, name: &str) -> Result<&'a str> {
    args[name]
        .as_str()
        .ok_or_else(|| format!("Expected string: {name}"))
}

impl Session {
    fn request(&mut self, request: Value) -> Option<Value> {
        if request["jsonrpc"] != "2.0" || !request["method"].is_string() {
            return Some(rpc_error(request["id"].clone(), -32600, "Invalid request"));
        }
        let id = request.get("id")?.clone();
        let params = &request["params"];
        let result = match request["method"].as_str()? {
            "initialize" => {
                let version = match params["protocolVersion"].as_str() {
                    Some("2024-11-05") => "2024-11-05",
                    Some("2025-03-26") => "2025-03-26",
                    Some("2025-06-18") => "2025-06-18",
                    _ => "2025-11-25",
                };
                json!({"protocolVersion":version,"capabilities":{"tools":{}},"serverInfo":{"name":"pckview","version":env!("CARGO_PKG_VERSION")}})
            }
            "ping" => json!({}),
            "tools/list" => {
                let tools: Vec<_> = TOOLS.iter().map(|(name, description, args)| {
                    let properties: serde_json::Map<_, _> = args.iter().map(|(key, kind)| (key.to_string(), if *kind == "array" { json!({"type":kind,"items":{"type":"string"}}) } else { json!({"type":kind}) })).collect();
                    let required: Vec<_> = args.iter().map(|(key, _)| key).collect();
                    json!({"name":name,"description":description,"inputSchema":{"type":"object","properties":properties,"required":required}})
                }).collect();
                json!({"tools":tools})
            }
            "tools/call" => {
                let Some(name) = params["name"]
                    .as_str()
                    .filter(|name| TOOLS.iter().any(|tool| tool.0 == *name))
                else {
                    return Some(rpc_error(id, -32602, "Unknown tool"));
                };
                self.call(name, &params["arguments"]).unwrap_or_else(
                    |message| json!({"isError":true,"content":[{"type":"text","text":message}]}),
                )
            }
            _ => return Some(rpc_error(id, -32601, "Unknown method")),
        };
        Some(json!({"jsonrpc":"2.0","id":id,"result":result}))
    }

    fn call(&mut self, name: &str, args: &Value) -> Result<Value> {
        if matches!(self.target, Target::Unopened)
            && !matches!(name, "open_project" | "create_project" | "translate_texts")
        {
            return Err("Open or create a project first".into());
        }
        match name {
            "open_project" => {
                if !matches!(self.target, Target::Unopened) {
                    return Err("Start an empty MCP session to open another project".into());
                }
                let manifest = string(args, "manifest")?;
                self.target =
                    Target::Project(ProjectSession::open(std::ffi::OsStr::new(manifest))?);
                return Ok(content(json!({"manifest":manifest})));
            }
            "create_project" => {
                let view = project::create_project(
                    string(args, "source")?.into(),
                    string(args, "parent")?.into(),
                    string(args, "name")?.into(),
                    serde_json::from_value(args["archives"].clone()).map_err(err)?,
                    args["clientVersion"].as_str().unwrap_or("1.5.5-lrpw").into(),
                    &|_, _, _| {},
                )?;
                let view = serde_json::to_value(view).map_err(err)?;
                if matches!(self.target, Target::Unopened) && view["project"]["status"] == "ready" {
                    let manifest = string(&view, "manifest")?;
                    self.target =
                        Target::Project(ProjectSession::open(std::ffi::OsStr::new(manifest))?);
                }
                return Ok(content(view));
            }
            "translate_texts" => {
                let mut settings = args["settings"]
                    .as_object()
                    .cloned()
                    .ok_or("Expected settings object")?;
                let provider = settings
                    .get("provider")
                    .and_then(Value::as_str)
                    .ok_or("Expected provider")?;
                let endpoint = settings
                    .get("endpoint")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let key = if settings.get("useStoredCredential").and_then(Value::as_bool)
                    == Some(false)
                {
                    String::new()
                } else {
                    super::translation_credentials::ide_translation_key_load(
                        provider.into(),
                        endpoint.into(),
                    )?
                    .unwrap_or_default()
                };
                settings.insert("apiKey".into(), json!(key));
                for field in ["endpoint", "model", "source", "glossary"] {
                    settings.entry(field).or_insert(json!(""));
                }
                let settings = serde_json::from_value(Value::Object(settings)).map_err(err)?;
                let texts = serde_json::from_value(args["texts"].clone()).map_err(err)?;
                let texts = super::translation::translate(
                    settings,
                    texts,
                    string(args, "target")?.into(),
                    None,
                )?;
                return Ok(content(json!({"texts":texts})));
            }
            "export_texts" | "save_translations" | "apply_translations" => {
                return self.locale_tool(name, args)
            }
            "list_data" | "read_data" | "replace_data" | "inspect_data" | "patch_data" => {
                return self.data_tool(name, args)
            }
            "search_ui" => {
                let query = string(args, "query")?.to_lowercase().replace('/', "\\");
                let paths: Box<dyn Iterator<Item = &str>> = match &self.target {
                    Target::Unopened => return Err("Open a project first".into()),
                    Target::Archive { archive, .. } => {
                        Box::new(archive.entries.iter().map(|entry| entry.name.as_str()))
                    }
                    Target::Project(project) => Box::new(
                        project
                            .entries
                            .iter()
                            .map(String::as_str)
                            .filter(|path| path.starts_with("archives/")),
                    ),
                };
                let mut matches = paths.filter(|path| {
                    is_xml(path) && path.to_lowercase().replace('/', "\\").contains(&query)
                });
                let entries: Vec<_> = matches.by_ref().take(50).collect();
                return Ok(content(
                    json!({"entries":entries,"truncated":matches.next().is_some()}),
                ));
            }
            "save" => {
                let result = match &mut self.target {
                    Target::Unopened => return Err("Open a project first".into()),
                    Target::Archive { staged, .. } => {
                        *staged = true;
                        json!({"stagedRevision":self.revision})
                    }
                    Target::Project(project) => {
                        json!({"savedRevision":self.revision,"savedEntries":project.save()?})
                    }
                };
                return Ok(content(result));
            }
            "build_archive" => {
                let result = match &self.target {
                    Target::Unopened => return Err("Open a project first".into()),
                    Target::Archive {
                        archive,
                        output,
                        staged: true,
                    } => {
                        archive.save_new(output)?;
                        let companion = output.with_extension("pkx");
                        json!({"path":output,"companion":companion.is_file().then_some(companion)})
                    }
                    Target::Archive { .. } => return Err("Call save before building".into()),
                    Target::Project(project) => {
                        if project
                            .snapshots
                            .values()
                            .any(|entry| entry.pending.is_some())
                        {
                            return Err("Call save before building".into());
                        }
                        serde_json::to_value(super::project::build_impl(
                            &project.manifest,
                            &|_, _, _| {},
                        )?)
                        .map_err(err)?
                    }
                };
                return Ok(content(result));
            }
            _ => {}
        }

        let entry = string(args, "entry")?;
        let (index, bytes) = match &mut self.target {
            Target::Unopened => return Err("Open a project first".into()),
            Target::Archive { archive, .. } => {
                let entry = entry.replace('/', "\\");
                let index = archive
                    .entries
                    .iter()
                    .position(|item| item.name.eq_ignore_ascii_case(&entry) && is_xml(&item.name))
                    .ok_or("Interface XML entry not found")?;
                (index, archive.data(index)?)
            }
            Target::Project(project) => {
                let entry = entry.replace('\\', "/");
                let index = project
                    .entries
                    .iter()
                    .position(|path| {
                        path.starts_with("archives/") && path.eq_ignore_ascii_case(&entry)
                    })
                    .ok_or("Use an archive-qualified entry from search_ui")?;
                let (bytes, changed) = project.read(index, name)?;
                if changed {
                    self.revision += 1;
                }
                (index, bytes)
            }
        };
        let (xml, encoding, bom) = decode(&bytes)?;
        let nodes = parse(&xml)?;
        match name {
            "inspect_ui" => Ok(content(
                json!({"entry":entry,"revision":self.revision,"nodes":nodes}),
            )),
            "preview_ui" => self.preview(entry, &xml, &nodes),
            "patch_ui" => {
                if matches!(&self.target, Target::Archive { archive, .. } if archive.encrypted) {
                    return Err("Encrypted PCK editing is unsupported".into());
                }
                if args["revision"].as_u64() != Some(self.revision) {
                    return Err("Revision conflict. Call inspect_ui again".into());
                }
                let node = args["node"]
                    .as_u64()
                    .and_then(|n| usize::try_from(n).ok())
                    .and_then(|n| nodes.get(n))
                    .ok_or("Invalid node index")?;
                let key = string(args, "attribute")?;
                let value = args["value"]
                    .as_i64()
                    .ok_or("Expected integer geometry value")?;
                if !matches!(key, "x" | "y" | "Width" | "Height")
                    || !(-10000..=10000).contains(&value)
                    || (matches!(key, "Width" | "Height") && value < 1)
                {
                    return Err("Invalid geometry attribute or value".into());
                }
                let mut tag = node.tag.clone();
                for (attribute, raw) in &node.attributes {
                    if !attribute.eq_ignore_ascii_case(key) {
                        tag.push_str(&format!(" {attribute}=\"{}\"", raw.replace('"', "&quot;")));
                    }
                }
                tag.push_str(&format!(" {key}=\"{value}\""));
                let ending = if node.empty { "/>" } else { ">" };
                let updated = format!("{}<{tag}{ending}{}", &xml[..node.start], &xml[node.end..]);
                parse(&updated)?;
                let mut data = bom.to_vec();
                data.extend(super::encode_text(updated, encoding.into())?);
                match &mut self.target {
                    Target::Unopened => return Err("Open a project first".into()),
                    Target::Archive {
                        archive, staged, ..
                    } => {
                        let item = &mut archive.entries[index];
                        item.len = u32::try_from(data.len()).map_err(err)?;
                        item.data = Some(data);
                        *staged = false;
                    }
                    Target::Project(project) => {
                        project
                            .snapshots
                            .get_mut(&index)
                            .ok_or("Call inspect_ui first")?
                            .pending = Some(data);
                    }
                }
                self.revision += 1;
                Ok(content(json!({"entry":entry,"revision":self.revision})))
            }
            _ => Err("Unknown interface operation".into()),
        }
    }
}

impl Session {
    fn locale_tool(&mut self, operation: &str, args: &Value) -> Result<Value> {
        let Target::Project(project) = &mut self.target else {
            return Err("Open a .pwforge project to work with locales".into());
        };
        if project
            .snapshots
            .values()
            .any(|entry| entry.pending.is_some())
        {
            return Err("Save pending project edits first".into());
        }
        let scope = super::ide::project_scope(&project.manifest, &|_, _, _| {})?;
        let result = match operation {
            "export_texts" => {
                serde_json::to_value(super::text_export::export_impl(&scope, &|_, _, _| {})?)
                    .map_err(err)?
            }
            "save_translations" => {
                let changes =
                    serde_json::from_value(args["changes"]["entries"].clone()).map_err(err)?;
                let path =
                    super::locales::save_impl(&scope, string(args, "language")?.into(), changes)?;
                json!({"path":path})
            }
            "apply_translations" => {
                let applied = super::locales::apply_impl(
                    &scope,
                    string(args, "language")?.into(),
                    &|_, _, _| {},
                );
                project.snapshots.clear();
                self.revision += 1;
                serde_json::to_value(applied?).map_err(err)?
            }
            _ => return Err("Unknown locale tool".into()),
        };
        Ok(content(result))
    }

    fn data_tool(&mut self, operation: &str, args: &Value) -> Result<Value> {
        let Target::Project(project) = &mut self.target else {
            return Err("Open a .pwforge project to work with data/".into());
        };
        if operation == "list_data" {
            let query = string(args, "query")?.replace('\\', "/").to_lowercase();
            let entries: Vec<_> = project
                .entries
                .iter()
                .filter(|path| path.starts_with("data/") && path.to_lowercase().contains(&query))
                .collect();
            return Ok(content(json!({"entries":entries})));
        }
        let entry = string(args, "entry")?.replace('\\', "/");
        let index = project
            .entries
            .iter()
            .position(|path| path.starts_with("data/") && path.eq_ignore_ascii_case(&entry))
            .ok_or("Project data file not found")?;
        let codec = base64::engine::general_purpose::STANDARD;
        if matches!(operation, "read_data" | "inspect_data") {
            let (bytes, changed) = project.read(index, "read_data")?;
            if changed {
                self.revision += 1;
            }
            if operation == "inspect_data" {
                let record = structured_data(&entry, bytes, &args["selection"], false)?;
                return Ok(content(
                    json!({"entry":entry,"revision":self.revision,"record":record}),
                ));
            }
            return Ok(content(
                json!({"entry":entry,"revision":self.revision,"data":codec.encode(bytes)}),
            ));
        }
        if args["revision"].as_u64() != Some(self.revision) {
            return Err("Revision conflict. Call read_data again".into());
        }
        let data = if operation == "patch_data" {
            let (bytes, _) = project.read(index, "patch_ui")?;
            let encoded = structured_data(&entry, bytes, &args["patch"], true)?;
            codec
                .decode(encoded.as_str().ok_or("Invalid structured patch result")?)
                .map_err(err)?
        } else {
            let data = string(args, "data")?;
            if data.len() > 4 * (256 * 1024 * 1024 / 3 + 1) {
                return Err("Data exceeds the 256 MiB editor limit".into());
            }
            codec.decode(data).map_err(err)?
        };
        project
            .snapshots
            .get_mut(&index)
            .ok_or("Call read_data first")?
            .pending = Some(data);
        self.revision += 1;
        Ok(content(json!({"entry":entry,"revision":self.revision})))
    }
}

fn structured_data(entry: &str, bytes: Vec<u8>, args: &Value, patch: bool) -> Result<Value> {
    let name = entry.rsplit('/').next().unwrap_or("").to_ascii_lowercase();
    let encode = |bytes| Value::String(base64::engine::general_purpose::STANDARD.encode(bytes));
    match name.as_str() {
        "tasks.data" | "dyn_tasks.data" | "task_npc.data" if patch => {
            super::tasks::mcp_patch(&name, &bytes, args).map(encode)
        }
        "tasks.data" | "dyn_tasks.data" | "task_npc.data" => {
            super::tasks::mcp_read(&name, &bytes, args)
        }
        "domain.data" | "domain2.data" | "domain2_cross.data" => {
            const SCRIPT: &str = include_str!(concat!(env!("OUT_DIR"), "/mcp-domain.cjs"));
            if SCRIPT.is_empty() {
                return Err(
                    "Build the PckView frontend with npm run build before building Rust".into(),
                );
            }
            let mut child = std::process::Command::new("node")
                .args(["-e", SCRIPT])
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .map_err(err)?;
            let input = json!({"name":name,"bytes":encode(bytes),"patch":patch,"args":args});
            child
                .stdin
                .take()
                .ok_or("No domain editor input")?
                .write_all(input.to_string().as_bytes())
                .map_err(err)?;
            let output = child.wait_with_output().map_err(err)?;
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).trim().into());
            }
            if patch {
                Ok(Value::String(
                    String::from_utf8(output.stdout).map_err(err)?,
                ))
            } else {
                serde_json::from_slice(&output.stdout).map_err(err)
            }
        }
        name if name == "elements.data"
            || matches!(name, "gshop.data" | "gshop1.data" | "gshop2.data") =>
        {
            if patch {
                super::elements::mcp_patch(name, bytes, args).map(encode)
            } else {
                super::elements::mcp_read(name, bytes, args)
            }
        }
        _ => Err("No structured editor for this data file. Use read_data and replace_data.".into()),
    }
}

fn is_xml(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".xml")
}

fn decode(bytes: &[u8]) -> Result<(String, &'static str, &[u8])> {
    let (encoding, label, offset) = if bytes.starts_with(&[0xff, 0xfe]) {
        (encoding_rs::UTF_16LE, "utf-16le", 2)
    } else if bytes.starts_with(&[0xfe, 0xff]) {
        (encoding_rs::UTF_16BE, "utf-16be", 2)
    } else if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        (encoding_rs::UTF_8, "utf-8", 3)
    } else if std::str::from_utf8(bytes).is_ok() {
        (encoding_rs::UTF_8, "utf-8", 0)
    } else {
        (encoding_rs::GBK, "gbk", 0)
    };
    let decoded = encoding
        .decode_without_bom_handling_and_without_replacement(&bytes[offset..])
        .ok_or("Invalid XML encoding")?;
    Ok((decoded.into_owned(), label, &bytes[..offset]))
}

#[derive(serde::Serialize)]
struct Node {
    index: usize,
    parent: Option<usize>,
    tag: String,
    attributes: Vec<(String, String)>,
    #[serde(skip)]
    start: usize,
    #[serde(skip)]
    end: usize,
    #[serde(skip)]
    empty: bool,
}

fn parse(xml: &str) -> Result<Vec<Node>> {
    let mut reader = Reader::from_str(xml.trim_end_matches('\0'));
    let mut nodes: Vec<Node> = Vec::new();
    let mut parents = Vec::new();
    loop {
        let start = reader.buffer_position() as usize;
        let event = reader.read_event().map_err(err)?;
        match event {
            Event::Start(ref tag) | Event::Empty(ref tag) => {
                let name = tag.name().as_ref().to_owned();
                if parents.is_empty() && (!nodes.is_empty() || !name.eq_ignore_ascii_case("dialog"))
                {
                    return Err("Expected one DIALOG root".into());
                }
                let index = nodes.len();
                let empty = matches!(event, Event::Empty(_));
                let attributes = tag
                    .attributes()
                    .map(|attribute| {
                        let attribute = attribute.map_err(err)?;
                        Ok((
                            attribute.key.as_ref().to_owned(),
                            attribute.value.into_owned(),
                        ))
                    })
                    .collect::<Result<_>>()?;
                nodes.push(Node {
                    index,
                    parent: parents.last().copied(),
                    tag: name,
                    attributes,
                    start,
                    end: reader.buffer_position() as usize,
                    empty,
                });
                if !empty {
                    parents.push(index);
                }
            }
            Event::End(_) => {
                parents.pop();
            }
            Event::DocType(_) => return Err("DOCTYPE is unsupported".into()),
            Event::Eof => break,
            _ => {}
        }
    }
    if nodes.is_empty() || !parents.is_empty() {
        return Err("Incomplete DIALOG XML".into());
    }
    Ok(nodes)
}
