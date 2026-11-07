use serde::{Deserialize, Serialize};
use std::{io::Write, path::PathBuf, sync::Mutex};
type R<T> = Result<T, String>;
#[derive(Clone, Deserialize, Serialize)]
pub struct Field {
    name: String,
    kind: String,
    offset: usize,
    size: usize,
    unit: usize,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Schema {
    name: String,
    size: usize,
    fields: Vec<Field>,
}
struct List {
    schema: Schema,
    offset: usize,
    count: usize,
}
#[path = "gshop.rs"]
mod gshop;
#[path = "elements_catalog.rs"]
mod elements_catalog;
pub(super) use elements_catalog::ElementsProfile;

pub(super) fn validate_elements_profile(profile: &ElementsProfile) -> R<()> {
    elements_catalog::validate(profile)
}

#[tauri::command]
pub fn elements_schema_profiles() -> R<Vec<elements_catalog::ProfileOption>> {
    elements_catalog::options()
}
struct Document {
    ide: Option<(u64, usize)>,
    project: Option<(String, String)>,
    path: PathBuf,
    original: Vec<u8>,
    bytes: Vec<u8>,
    encrypted: bool,
    lists: Vec<List>,
    talks_offset: Option<usize>,
    gshop_version: Option<u8>,
    dirty: bool,
}
#[derive(Default)]
pub struct Elements(
    Mutex<std::collections::HashMap<u64, Document>>,
    std::sync::atomic::AtomicU64,
);
fn crypt(b: &mut [u8]) {
    let key = b"TROUXA";
    for (i, v) in b.iter_mut().enumerate() {
        if *v != 0 && *v != key[i % 6] {
            *v ^= key[i % 6];
        }
    }
}
fn take<'a>(b: &'a [u8], pos: &mut usize, n: usize) -> R<&'a [u8]> {
    let end = pos.checked_add(n).ok_or("Size overflow")?;
    let value = b
        .get(*pos..end)
        .ok_or("File is truncated or its structure does not match the client version")?;
    *pos = end;
    Ok(value)
}
fn number(b: &[u8], p: &mut usize) -> R<usize> {
    Ok(u32::from_le_bytes(take(b, p, 4)?.try_into().unwrap()) as usize)
}
fn skip_dialogues(bytes: &[u8], position: &mut usize) -> R<()> {
    let count = number(bytes, position)?;
    for _ in 0..count {
        take(bytes, position, 132)?;
        let windows = number(bytes, position)?;
        for _ in 0..windows {
            take(bytes, position, 8)?;
            let chars = number(bytes, position)?;
            take(bytes, position, chars.checked_mul(2).ok_or("Dialogue size")?)?;
            let options = number(bytes, position)?;
            take(bytes, position, options.checked_mul(136).ok_or("Option size")?)?;
        }
    }
    Ok(())
}

fn parse_elements(bytes: &[u8], selected: Option<&ElementsProfile>) -> R<(Vec<List>, Option<usize>)> {
    let header = bytes.get(..4).ok_or("Missing elements.data header")?;
    let version = u16::from_le_bytes(header[..2].try_into().unwrap());
    if let Some(selected) = selected {
        if version != selected.version {
            return Err(format!("Expected elements.data version {}, found {version}", selected.version));
        }
        if elements_catalog::is_native(selected) {
            return parse(bytes, 4).or_else(|_| parse(bytes, 8));
        }
        return elements_catalog::parse_selected(bytes, selected);
    }
    if header == 0x30000091u32.to_le_bytes() {
        // The bundled project format also supports an extended timestamp.
        if let Ok(document) = parse(bytes, 4).or_else(|_| parse(bytes, 8)) {
            return Ok(document);
        }
    }
    elements_catalog::parse(bytes, version)
}

fn parse(bytes: &[u8], time: usize) -> R<(Vec<List>, Option<usize>)> {
    let schemas: Vec<Schema> =
        serde_json::from_str(include_str!("elements-schema.json")).map_err(|e| e.to_string())?;
    let mut p = 4 + time;
    let mut lists = Vec::new();
    let mut talks_offset = None;
    for schema in schemas {
        if schema.name == "SKILLTOME_SUB_TYPE" {
            take(bytes, &mut p, 4)?;
            let n = number(bytes, &mut p)?;
            take(bytes, &mut p, n + time)?;
        }
        if schema.name == "NPC_WAR_TOWERBUILD_SERVICE" {
            take(bytes, &mut p, 4)?;
            let n = number(bytes, &mut p)?;
            take(bytes, &mut p, n)?;
        }
        if schema.name == "FACE_TEXTURE_ESSENCE" {
            talks_offset = Some(p);
            skip_dialogues(bytes, &mut p)?;
        }
        let count = number(bytes, &mut p)?;
        let offset = p;
        take(
            bytes,
            &mut p,
            count.checked_mul(schema.size).ok_or("List size")?,
        )?;
        lists.push(List {
            schema,
            offset,
            count,
        });
    }
    if p != bytes.len() {
        return Err(format!(
            "{} bytes remain after the last list",
            bytes.len().saturating_sub(p)
        ));
    }
    Ok((lists,talks_offset))
}
impl Document {
    fn open(path: PathBuf) -> R<Self> {
        let original = std::fs::read(&path).map_err(|e| e.to_string())?;
        Self::from_bytes(path, original)
    }
    fn from_bytes(path: PathBuf, original: Vec<u8>) -> R<Self> {
        Self::from_bytes_with_version(path, original, None, None)
    }
    fn from_bytes_with_version(path: PathBuf, original: Vec<u8>, requested: Option<u8>, elements_profile: Option<&ElementsProfile>) -> R<Self> {
        let mut bytes = original.clone();
        if let Some(shop) = gshop::filename(&path) {
            let (lists, version) = gshop::parse_version(&bytes, shop, requested)?;
            return Ok(Self {
                ide: None,
                project: None,
                path,
                original,
                bytes,
                encrypted: false,
                lists,
                talks_offset: None,
                gshop_version: Some(version),
                dirty: false,
            });
        }
        let (lists, talks_offset, encrypted) = match parse_elements(&bytes, elements_profile) {
            Ok((lists, talks_offset)) => (lists, talks_offset, false),
            Err(plain_error) => {
                crypt(&mut bytes);
                let (lists, talks_offset) = parse_elements(&bytes, elements_profile).map_err(|_| plain_error)?;
                (lists, talks_offset, true)
            }
        };
        Ok(Self {
            ide: None,
            project: None,
            path,
            original,
            bytes,
            encrypted,
            lists,
            talks_offset,
            gshop_version: None,
            dirty: false,
        })
    }
    fn encoded(&self) -> Vec<u8> {
        let mut b = self.bytes.clone();
        if self.encrypted {
            crypt(&mut b);
        }
        b
    }
}
#[derive(Serialize)]
pub struct Summary {
    id: u64,
    path: String,
    encrypted: bool,
    lists: Vec<(String, usize)>,
    elements_version: Option<u16>,
    gshop_version: Option<u8>,
}
#[tauri::command]
pub fn elements_open(path: String, state: tauri::State<'_, Elements>) -> R<Summary> {
    let doc = Document::open(path.into())?;
    let id = state.1.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    let summary = Summary {
        id,
        path: doc.path.to_string_lossy().into(),
        encrypted: doc.encrypted,
        gshop_version: doc.gshop_version,
        elements_version: doc.gshop_version.is_none().then(|| u16::from_le_bytes(doc.bytes[..2].try_into().unwrap())),
        lists: doc
            .lists
            .iter()
            .map(|l| (l.schema.name.clone(), l.count))
            .collect(),
    };
    state.0.lock().map_err(|e| e.to_string())?.insert(id, doc);
    Ok(summary)
}
#[tauri::command]
pub fn elements_open_project(
    manifest: String,
    path: String,
    state: tauri::State<'_, Elements>,
) -> R<Summary> {
    let file = super::project::materialize(&manifest, &path)?;
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    let (gshop_version, elements_profile) = super::project::data_profiles(&manifest)?;
    let mut doc = Document::from_bytes_with_version(file, bytes, gshop_version, elements_profile.as_ref())?;
    if let Some(version) = doc.gshop_version {
        super::project::remember_gshop_version(&manifest, &path, version)?;
    }
    doc.project = Some((manifest, path));
    let id = state.1.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    let summary = Summary {
        id,
        path: doc.path.to_string_lossy().into(),
        encrypted: doc.encrypted,
        gshop_version: doc.gshop_version,
        elements_version: doc.gshop_version.is_none().then(|| u16::from_le_bytes(doc.bytes[..2].try_into().unwrap())),
        lists: doc
            .lists
            .iter()
            .map(|l| (l.schema.name.clone(), l.count))
            .collect(),
    };
    state.0.lock().map_err(|e| e.to_string())?.insert(id, doc);
    Ok(summary)
}
pub(super) type Names = std::collections::HashMap<u32, String>;
pub(super) fn task_names(bytes: Vec<u8>, include_items: bool) -> R<(Names, Names)> {
    let doc = Document::from_bytes(PathBuf::from("elements.data"), bytes)?;
    let mut npc = Names::new();
    let mut items = Names::new();
    let mut lists: Vec<_> = doc.lists.iter().collect();
    lists.sort_by_key(|list| !list.schema.fields.iter().any(|field| field.name == "file_icon"));
    for list in lists {
        let target = if list.schema.name == "NPC_ESSENCE" { &mut npc }
        else if include_items && (list.schema.name.ends_with("_ESSENCE") ||
            list.schema.fields.iter().any(|field| field.name == "file_icon")) { &mut items }
        else { continue; };
        let Some(name) = list.schema.fields.iter().find(|field| field.name == "name") else {continue;};
        for index in 0..list.count {
            let start = list.offset + index * list.schema.size;
            let id = u32::from_le_bytes(doc.bytes[start..start + 4].try_into().unwrap());
            let start = start + name.offset;
            target.entry(id).or_insert_with(|| value(name, &doc.bytes[start..start + name.size]));
        }
    }
    Ok((npc,items))
}

fn value(field: &Field, data: &[u8]) -> String {
    if field.kind == "utf16" {
        let units: Vec<u16> = data
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .take_while(|v| *v != 0)
            .collect();
        return String::from_utf16_lossy(&units);
    }
    if field.kind == "gbk" {
        let end = data.iter().position(|v| *v == 0).unwrap_or(data.len());
        return encoding_rs::GBK.decode(&data[..end]).0.into();
    }
    data.chunks_exact(field.unit)
        .map(|c| match field.kind.as_str() {
            "u8" => c[0].to_string(),
            "u32" => u32::from_le_bytes(c.try_into().unwrap()).to_string(),
            "i32" => i32::from_le_bytes(c.try_into().unwrap()).to_string(),
            "f32" => f32::from_le_bytes(c.try_into().unwrap()).to_string(),
            "f64" => f64::from_le_bytes(c.try_into().unwrap()).to_string(),
            "u64" => u64::from_le_bytes(c.try_into().unwrap()).to_string(),
            "i64" => i64::from_le_bytes(c.try_into().unwrap()).to_string(),
            "u16" => u16::from_le_bytes(c.try_into().unwrap()).to_string(),
            "i16" => i16::from_le_bytes(c.try_into().unwrap()).to_string(),
            _ => unreachable!(),
        })
        .collect::<Vec<_>>()
        .join(", ")
}

pub(super) fn export_texts(
    name: &str,
    bytes: Vec<u8>,
    profile: Option<&ElementsProfile>,
    emit: &mut dyn FnMut(String, &str) -> R<()>,
) -> R<()> {
    let shop = gshop::filename(std::path::Path::new(name)).is_some();
    let doc = Document::from_bytes_with_version(name.into(), bytes, None, profile)?;
    if let Some(offset) = doc.talks_offset {
        super::tasks::export_npc_talks(&doc.bytes[offset..],emit)?;
    }
    scan_texts(&doc,shop,&mut |path,_,_,text|emit(path,text))
}

fn scan_texts(doc:&Document, shop:bool, emit:&mut dyn FnMut(String,usize,&Field,&str)->R<()>) -> R<()> {
    for (list_index, list) in doc.lists.iter().enumerate() {
        for field in &list.schema.fields {
            if field.kind != "utf16" && !(field.kind == "gbk" && field.name == "realname") {
                continue;
            }
            for row in 0..list.count {
                let start = list.offset + row * list.schema.size + field.offset;
                let text = value(field, &doc.bytes[start..start + field.size]);
                if !text.trim().is_empty() {
                    let name = field.name.replace('~', "~0").replace('/', "~1");
                    let list_path = if shop {format!("/shop/lists/{list_index}")}
                        else {format!("/elements/{}",list.schema.name.to_ascii_lowercase())};
                    emit(format!("{list_path}/records/{row}/{name}"), start, field, &text)?;
                }
            }
        }
    }
    Ok(())
}

pub(super) fn translate_texts(
    name:&str, bytes:&[u8], replace:&mut super::locales::ReplaceText<'_>,
) -> R<Vec<u8>> {
    let shop=gshop::filename(std::path::Path::new(name)).is_some();
    let mut doc=Document::from_bytes(name.into(),bytes.to_vec())?;
    let mut patches=Vec::new();
    scan_texts(&doc,shop,&mut |path,start,field,text| {
        if let Some(translated)=replace(&path,text)? {
            patches.push((start,start+field.size,encode(field,&translated).map_err(|error|format!("{path}: {error}"))?));
        }
        Ok(())
    })?;
    if let Some(offset)=doc.talks_offset {
        for (start,end,bytes) in super::tasks::translate_npc_talks(&doc.bytes[offset..],replace)? {
            patches.push((offset+start,offset+end,bytes));
        }
    }
    patches.sort_unstable_by_key(|patch|patch.0);
    for (start,end,bytes) in patches.into_iter().rev() {doc.bytes.splice(start..end,bytes);}
    if !shop {parse(&doc.bytes,4).or_else(|_|parse(&doc.bytes,8))?;}
    Ok(doc.encoded())
}
#[derive(Serialize)]
pub struct Row {
    index: usize,
    id: u32,
    name: String,
}
#[derive(Serialize)]
pub struct Rows {
    total: usize,
    rows: Vec<Row>,
}
#[tauri::command]
pub fn elements_rows(
    document: u64,
    list: usize,
    query: String,
    page: usize,
    main_type: Option<i32>,
    sub_type: Option<i32>,
    state: tauri::State<'_, Elements>,
) -> R<Rows> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let doc = guard.get(&document).ok_or("Open elements.data")?;
    let l = doc.lists.get(list).ok_or("No list")?;
    let name = l.schema.fields.iter().find(|f| f.name == "name");
    let item_id = l.schema.fields.iter().find(|f| f.name == "item_id");
    let filters = [("main_type", main_type), ("sub_type", sub_type)]
        .into_iter()
        .filter_map(|(name, wanted)| {
            let wanted = wanted?;
            let field = l.schema.fields.iter().find(|f| f.name == name && f.size == 4)?;
            Some((field.offset, wanted))
        })
        .collect::<Vec<_>>();
    let q = query.to_lowercase();
    let mut rows = Vec::new();
    let mut total = 0;
    for index in 0..l.count {
        let start = l.offset + index * l.schema.size;
        let data = &doc.bytes[start..start + l.schema.size];
        if filters.iter().any(|&(offset, wanted)| {
            i32::from_le_bytes(data[offset..offset + 4].try_into().unwrap()) != wanted
        }) {
            continue;
        }
        let id = if let Some(field) = item_id {
            u32::from_le_bytes(data[field.offset..field.offset + 4].try_into().unwrap())
        } else if l.schema.fields.len() == 1 && name.is_some() {
            index as u32
        } else {
            u32::from_le_bytes(data[..4].try_into().unwrap())
        };
        let name = name
            .map(|f| value(f, &data[f.offset..f.offset + f.size]))
            .unwrap_or_default();
        if !q.is_empty() && !id.to_string().contains(&q) && !name.to_lowercase().contains(&q) {
            continue;
        }
        if total >= page.saturating_mul(200) && rows.len() < 200 {
            rows.push(Row { index, id, name });
        }
        total += 1;
    }
    Ok(Rows { total, rows })
}

#[derive(Serialize)]
pub struct ShopCategory {
    name: String,
    subcategories: Vec<String>,
}

#[tauri::command]
pub fn gshop_categories(document: u64, state: tauri::State<'_, Elements>) -> R<Vec<ShopCategory>> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let doc = guard.get(&document).ok_or("No file")?;
    if doc.lists.len() != 17 || doc.lists[0].schema.name != "Products" {
        return Err("Open gshop.data".into());
    }
    let read_name = |list: &List, index: usize| {
        let start = list.offset + index * list.schema.size;
        value(&list.schema.fields[0], &doc.bytes[start..start + list.schema.size])
    };
    Ok(doc.lists[1..].chunks_exact(2).map(|pair| ShopCategory {
        name: read_name(&pair[0], 0),
        subcategories: (0..pair[1].count).map(|index| read_name(&pair[1], index)).collect(),
    }).collect())
}

#[derive(Serialize)]
pub struct InventoryAtlas {
    width: usize,
    height: usize,
    columns: usize,
    cells: std::collections::HashMap<u32, usize>,
}

#[tauri::command]
pub async fn gshop_inventory_atlas(id: u64, ide: tauri::State<'_, super::ide::Ide>) -> R<tauri::ipc::Response> {
    let scope = ide.scope(id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (elements, list, texture) = super::ide::inventory_files(scope)?;
        let list = list.strip_prefix(b"MOXT").or_else(|| list.strip_prefix(b"MOXB")).unwrap_or(&list);
        let list = encoding_rs::UTF_8.decode_without_bom_handling_and_without_replacement(list)
            .unwrap_or_else(|| encoding_rs::GBK.decode(list).0);
        let mut lines = list.trim_start_matches('\u{feff}').lines();
        let mut dimension = || {
            lines.next().and_then(|line| line.trim().parse::<usize>().ok())
                .filter(|&value| value > 0 && value <= 16384)
                .ok_or("Invalid atlas size")
        };
        let width = dimension()?;
        let height = dimension()?;
        let rows = dimension()?;
        let columns = dimension()?;
        let basename = |name: &str| name.rsplit(['/', '\\']).next().unwrap_or("").trim().to_lowercase();
        let indices: std::collections::HashMap<_, _> = lines.take(rows * columns).enumerate()
            .filter(|(_, name)| !name.trim().is_empty())
            .map(|(index, name)| (basename(name), index)).collect();
        let doc = Document::from_bytes(PathBuf::from("elements.data"), elements)?;
        let mut cells = std::collections::HashMap::new();
        for list in doc.lists {
            let Some(icon) = list.schema.fields.iter().find(|field| field.name == "file_icon") else {
                continue;
            };
            for index in 0..list.count {
                let offset = list.offset + index * list.schema.size;
                let item = u32::from_le_bytes(doc.bytes[offset..offset + 4].try_into().unwrap());
                let start = offset + icon.offset;
                let name = value(icon, &doc.bytes[start..start + icon.size]);
                if let Some(&cell) = indices.get(&basename(&name)) {
                    cells.entry(item).or_insert(cell);
                }
            }
        }
        let metadata = serde_json::to_vec(&InventoryAtlas { width, height, columns, cells })
            .map_err(|error| error.to_string())?;
        let mut bytes = Vec::with_capacity(4 + metadata.len() + texture.len());
        bytes.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&metadata);
        bytes.extend_from_slice(&texture);
        Ok(tauri::ipc::Response::new(bytes))
    }).await.map_err(|error| error.to_string())?
}
#[tauri::command]
pub fn elements_find_item(
    document: u64,
    item_id: u32,
    npc: Option<bool>,
    state: tauri::State<'_, Elements>,
) -> R<Option<(usize, usize)>> {
    let guard = state.0.lock().map_err(|error| error.to_string())?;
    let doc = guard.get(&document).ok_or("No file")?;
    let mut fallback = None;
    let npc = npc.unwrap_or(false);
    for (list_index, list) in doc.lists.iter().enumerate() {
        if (list.schema.name == "NPC_ESSENCE") != npc {
            continue;
        }
        let has_icon = list.schema.fields.iter().any(|field| field.name == "file_icon");
        if !has_icon && !list.schema.name.ends_with("_ESSENCE") {
            continue;
        }
        let Some(id) = list.schema.fields.iter().find(|field| field.name == "id" && field.size == 4) else {
            continue;
        };
        let found = (0..list.count).find(|&index| {
            let offset = list.offset + index * list.schema.size + id.offset;
            u32::from_le_bytes(doc.bytes[offset..offset + 4].try_into().unwrap()) == item_id
        });
        if let Some(index) = found {
            let result = (list_index, index);
            if npc || has_icon {
                return Ok(Some(result));
            }
            fallback.get_or_insert(result);
        }
    }
    Ok(fallback)
}

#[derive(Serialize)]
pub struct Record {
    fields: Vec<Field>,
    values: Vec<String>,
}
#[tauri::command]
pub fn elements_record(
    document: u64,
    list: usize,
    index: usize,
    state: tauri::State<'_, Elements>,
) -> R<Record> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let doc = guard.get(&document).ok_or("No file")?;
    record(doc, list, index)
}
fn record(doc: &Document, list: usize, index: usize) -> R<Record> {
    let l = doc.lists.get(list).ok_or("No list")?;
    if index >= l.count {
        return Err("No record".into());
    }
    let start = l.offset + index * l.schema.size;
    Ok(Record {
        fields: l.schema.fields.clone(),
        values: l
            .schema
            .fields
            .iter()
            .map(|f| value(f, &doc.bytes[start + f.offset..start + f.offset + f.size]))
            .collect(),
    })
}
fn encode(f: &Field, input: &str) -> R<Vec<u8>> {
    let error = || format!("Invalid field value {} ({})", f.name, f.kind);
    if f.kind == "utf16" {
        let units: Vec<u16> = input.encode_utf16().collect();
        if units.len() * 2 >= f.size {
            return Err(format!(
                "{}: maximum {} UTF-16 code units",
                f.name,
                f.size / 2 - 1
            ));
        }
        let mut b: Vec<u8> = units.iter().flat_map(|v| v.to_le_bytes()).collect();
        b.resize(f.size, 0);
        return Ok(b);
    }
    if f.kind == "gbk" {
        let (b, _, errors) = encoding_rs::GBK.encode(input);
        if errors || b.len() >= f.size {
            return Err(format!(
                "{}: string does not fit or cannot be represented in GBK",
                f.name
            ));
        }
        let mut b = b.into_owned();
        b.resize(f.size, 0);
        return Ok(b);
    }
    let mut b = Vec::new();
    for part in input.split(',') {
        let s = part.trim();
        macro_rules! num {
            ($t:ty) => {
                b.extend_from_slice(&s.parse::<$t>().map_err(|_| error())?.to_le_bytes())
            };
        }
        match f.kind.as_str() {
            "u8" => num!(u8),
            "u32" => num!(u32),
            "i32" => num!(i32),
            "u64" => num!(u64),
            "i64" => num!(i64),
            "u16" => num!(u16),
            "i16" => num!(i16),
            "f32" => {
                let v = s.parse::<f32>().map_err(|_| error())?;
                if !v.is_finite() {
                    return Err(error());
                }
                b.extend(v.to_le_bytes());
            }
            "f64" => {
                let v = s.parse::<f64>().map_err(|_| error())?;
                if !v.is_finite() {
                    return Err(error());
                }
                b.extend(v.to_le_bytes());
            }
            _ => return Err(error()),
        }
    }
    if b.len() != f.size {
        return Err(format!(
            "{}: expected {} comma-separated values",
            f.name,
            f.size / f.unit
        ));
    }
    Ok(b)
}
#[tauri::command]
pub fn elements_update(
    document: u64,
    list: usize,
    index: usize,
    changes: Vec<(usize, String)>,
    state: tauri::State<'_, Elements>,
) -> R<()> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let doc = guard.get_mut(&document).ok_or("No file")?;
    update(doc, list, index, changes)
}
fn update(doc: &mut Document, list: usize, index: usize, changes: Vec<(usize, String)>) -> R<()> {
    let l = doc.lists.get(list).ok_or("No list")?;
    if index >= l.count {
        return Err("No record".into());
    }
    let mut edits = Vec::new();
    for (field, input) in changes {
        let f = l.schema.fields.get(field).ok_or("No field")?;
        edits.push((
            l.offset + index * l.schema.size + f.offset,
            encode(f, &input)?,
        ));
    }
    for (offset, b) in edits {
        doc.bytes[offset..offset + b.len()].copy_from_slice(&b);
        doc.dirty = true;
    }
    Ok(())
}
#[tauri::command]
pub async fn gshop_export_server(
    document: u64,
    path: PathBuf,
    state: tauri::State<'_, Elements>,
) -> R<()> {
    let bytes = {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        let doc = guard.get(&document).ok_or("No file")?;
        let shop = gshop::filename(&doc.path).ok_or("Open a client gshop.data file")?;
        let expected = ["gshopsev.data", "gshopsev1.data", "gshopsev2.data"][shop as usize];
        if !path.file_name().and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case(expected))
        {
            return Err(format!("Server filename: {expected}"));
        }
        gshop::export_server(&doc.bytes, doc.lists.first().ok_or("No product list")?)?
    };
    tauri::async_runtime::spawn_blocking(move || super::ide::write_export(path, bytes))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn elements_save(
    document: u64,
    path: String,
    state: tauri::State<'_, Elements>,
    ide: tauri::State<'_, super::ide::Ide>,
) -> R<SaveResult> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let doc = guard.get_mut(&document).ok_or("No file")?;
    let target = PathBuf::from(path);
    let backup = if let Some((id, index)) = doc.ide.filter(|_| target == doc.path) {
        let b = doc.encoded();
        super::ide::write_binary(&ide, id, index, &doc.original, b.clone())?;
        doc.original = b;
        doc.dirty = false;
        String::new()
    } else {
        let backup = save_document(doc, target)?;
        doc.ide = None;
        backup
    };
    Ok(SaveResult {
        path: doc.path.to_string_lossy().into(),
        backup,
    })
}
#[tauri::command]
pub fn elements_open_ide(
    id: u64,
    index: usize,
    state: tauri::State<'_, Elements>,
    ide: tauri::State<'_, super::ide::Ide>,
) -> R<Summary> {
    let (name, bytes) = super::ide::read_binary(&ide, id, index)?;
    let scope = ide.scope(id)?;
    let (gshop_version, elements_profile) = scope.manifest().map(super::project::data_profiles).transpose()?.unwrap_or_default();
    let mut doc = Document::from_bytes_with_version(name.into(), bytes, gshop_version, elements_profile.as_ref())?;
    if let (Some(manifest), Some(version)) = (scope.manifest(), doc.gshop_version) {
        super::project::remember_gshop_version(manifest, &scope.entries[index].path, version)?;
    }
    doc.ide = Some((id, index));
    let document = state.1.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    let summary = Summary {
        id: document,
        path: doc.path.to_string_lossy().into(),
        encrypted: doc.encrypted,
        gshop_version: doc.gshop_version,
        elements_version: doc.gshop_version.is_none().then(|| u16::from_le_bytes(doc.bytes[..2].try_into().unwrap())),
        lists: doc
            .lists
            .iter()
            .map(|l| (l.schema.name.clone(), l.count))
            .collect(),
    };
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(document, doc);
    Ok(summary)
}
#[tauri::command]
pub fn elements_close(document: u64, state: tauri::State<'_, Elements>) -> R<()> {
    state.0.lock().map_err(|e| e.to_string())?.remove(&document);
    Ok(())
}
#[derive(Serialize)]
pub struct SaveResult {
    path: String,
    backup: String,
}
fn save_document(doc: &mut Document, target: PathBuf) -> R<String> {
    let b = doc.encoded();
    // Validate the entire layout again before writing; preserve all unedited bytes.
    parse(&doc.bytes, 4).or_else(|_| parse(&doc.bytes, 8))?;
    if target == doc.path {
        if let Some((manifest, path)) = &doc.project {
            let edited = super::project::store_edit(manifest, path, &doc.original, &b)?;
            doc.path = edited;
            doc.original = b;
            doc.dirty = false;
            return Ok(String::new());
        }
    }
    let mut backup = String::new();
    if target.exists() {
        if target.canonicalize().ok() == doc.path.canonicalize().ok()
            && std::fs::read(&target).map_err(|e| e.to_string())? != doc.original
        {
            return Err("File was changed by another program. Save under a new name.".into());
        }
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let backup_path = target.with_file_name(format!(
            "{}.{}.bak",
            target.file_name().unwrap().to_string_lossy(),
            stamp
        ));
        std::fs::copy(&target, &backup_path).map_err(|e| e.to_string())?;
        backup = backup_path.to_string_lossy().into();
    }
    let mut temp = tempfile::NamedTempFile::new_in(target.parent().ok_or("No directory")?)
        .map_err(|e| e.to_string())?;
    temp.write_all(&b).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(&target).map_err(|e| e.to_string())?;
    doc.path = target;
    doc.project = None;
    doc.original = b;
    doc.dirty = false;
    Ok(backup)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires real elements.data files"]
    fn opens_elements_samples_without_changing_bytes() {
        let paths = std::env::var_os("PW_ELEMENTS_TEST_FILES").expect("Set PW_ELEMENTS_TEST_FILES");
        for path in std::env::split_paths(&paths) {
            let doc = Document::open(path.clone()).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
            assert!(!doc.lists.is_empty());
            assert_eq!(doc.encoded(), doc.original);
            let version = u16::from_le_bytes(doc.bytes[..2].try_into().unwrap());
            eprintln!("{}: version {version}, {} tables, XOR={}", path.display(), doc.lists.len(), doc.encrypted);
        }
    }

    #[test]
    fn encryption_is_reversible() {
        let a: Vec<u8> = (0..=255).cycle().take(3072).collect();
        let mut b = a.clone();
        crypt(&mut b);
        crypt(&mut b);
        assert_eq!(a, b);
    }
    #[test]
    fn rejects_invalid_values() {
        let f = Field {
            name: "price".into(),
            kind: "u32".into(),
            offset: 0,
            size: 4,
            unit: 4,
        };
        assert!(encode(&f, "-1").is_err());
        assert!(encode(&f, "4294967296").is_err());
        assert_eq!(encode(&f, "123").unwrap(), 123u32.to_le_bytes());
    }
    #[test]
    #[ignore]
    fn real_client_save_reopen_backup() {
        let mut doc =
            Document::open(super::super::test_client_root().join("data/elements.data")).unwrap();
        let folder = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let target = folder.path().join("elements.data");
        let original = doc.original.clone();
        assert!(save_document(&mut doc, target.clone()).unwrap().is_empty());
        assert_eq!(std::fs::read(&target).unwrap(), original);
        let field = doc.lists[3]
            .schema
            .fields
            .iter()
            .find(|f| f.name == "price")
            .unwrap();
        let offset = doc.lists[3].offset + field.offset;
        doc.bytes[offset..offset + 4].copy_from_slice(&encode(field, "12345").unwrap());
        let backup = save_document(&mut doc, target.clone()).unwrap();
        assert_eq!(std::fs::read(backup).unwrap(), original);
        let reopened = Document::open(target.clone()).unwrap();
        assert_eq!(&reopened.bytes[offset..offset + 4], &12345u32.to_le_bytes());
        assert_eq!(reopened.bytes, doc.bytes);
        std::fs::write(&target, b"external modification").unwrap();
        assert!(save_document(&mut doc, target)
            .unwrap_err()
            .contains("another program"));
    }
    #[test]
    #[ignore]
    fn real_client_roundtrip() {
        let doc =
            Document::open(super::super::test_client_root().join("data/elements.data")).unwrap();
        assert_eq!(doc.lists.len(), 213);
        assert_eq!(doc.original, doc.encoded());
        let mut bytes = doc.bytes.clone();
        let l = &doc.lists[3];
        let f = l.schema.fields.iter().find(|f| f.name == "price").unwrap();
        let offset = l.offset + f.offset;
        bytes[offset..offset + 4].copy_from_slice(&12345u32.to_le_bytes());
        if doc.encrypted {
            crypt(&mut bytes);
            crypt(&mut bytes);
        }
        assert_eq!(
            u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()),
            12345
        );
        assert_eq!(&bytes[..offset], &doc.bytes[..offset]);
        assert_eq!(&bytes[offset + 4..], &doc.bytes[offset + 4..]);
        println!(
            "{} lists, {} records",
            doc.lists.len(),
            doc.lists.iter().map(|l| l.count).sum::<usize>()
        );
    }
    #[test]
    #[ignore = "requires the local client's elements.data"]
    fn real_client_project_overlay_save() {
        let folder = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let original = folder.path().join("originals/data/elements.data");
        std::fs::create_dir_all(original.parent().unwrap()).unwrap();
        std::fs::create_dir(folder.path().join("edits")).unwrap();
        let manifest = folder.path().join("test.pwforge");
        std::fs::write(&manifest,br#"{"format":"pw-forge-project","version":2,"name":"test","source":"unused","archives":[],"status":"ready","errors":[]}"#).unwrap();
        std::fs::copy(
            super::super::test_client_root().join("data/elements.data"),
            &original,
        )
        .unwrap();
        let mut doc = Document::open(
            super::super::project::materialize(&manifest.to_string_lossy(), "data/elements.data")
                .unwrap(),
        )
        .unwrap();
        let original_bytes = doc.original.clone();
        doc.project = Some((
            manifest.to_string_lossy().into(),
            "data/elements.data".into(),
        ));
        let field = doc.lists[3]
            .schema
            .fields
            .iter()
            .find(|f| f.name == "price")
            .unwrap();
        let offset = doc.lists[3].offset + field.offset;
        doc.bytes[offset..offset + 4].copy_from_slice(&12345u32.to_le_bytes());
        let old_path = doc.path.clone();
        save_document(&mut doc, old_path).unwrap();
        assert!(doc.path.ends_with("edits/data/elements.data"));
        assert_eq!(std::fs::read(&original).unwrap(), original_bytes);
        doc.bytes[offset..offset + 4].copy_from_slice(&54321u32.to_le_bytes());
        let edit_path = doc.path.clone();
        save_document(&mut doc, edit_path).unwrap();
        let reopened = Document::open(
            super::super::project::materialize(&manifest.to_string_lossy(), "data/elements.data")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(&reopened.bytes[offset..offset + 4], &54321u32.to_le_bytes());
        assert_eq!(std::fs::read(original).unwrap(), original_bytes);
    }
}

pub(super) fn mcp_read(name: &str, bytes: Vec<u8>, args: &serde_json::Value) -> R<serde_json::Value> {
    let doc = Document::from_bytes(name.into(), bytes)?;
    if let Some(list) = args["list"].as_u64() {
        let row = args["row"].as_u64().ok_or("Expected row")?;
        return serde_json::to_value(record(&doc, list as usize, row as usize)?).map_err(super::err);
    }
    Ok(serde_json::json!({"lists":doc.lists.iter().map(|list| serde_json::json!({"schema":list.schema,"count":list.count})).collect::<Vec<_>>()}))
}

pub(super) fn mcp_patch(name: &str, bytes: Vec<u8>, args: &serde_json::Value) -> R<Vec<u8>> {
    let mut doc = Document::from_bytes(name.into(), bytes)?;
    let list = args["list"].as_u64().ok_or("Expected list")? as usize;
    let row = args["row"].as_u64().ok_or("Expected row")? as usize;
    let changes = serde_json::from_value(args["fields"].clone()).map_err(super::err)?;
    update(&mut doc, list, row, changes)?;
    Ok(doc.encoded())
}
