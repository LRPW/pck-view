use super::{err, ide, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{Arc, Mutex};
#[path = "task_detail.rs"]
mod detail;
pub(super) use detail::{export_npc_talks, translate_npc_talks};

const MAGIC: u32 = 0x93858361;
const SUPPORTED_VERSIONS: &[u32] = &[
    43, 52, 53, 54, 55, 56, 57, 59, 60, 63, 64, 68, 69, 75, 78, 79, 80, 81, 82, 83, 84,
    85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104,
    105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121,
    122, 123, 124, 125, 126, 127, 128, 129, 130, 135, 137, 139, 140, 146, 147, 153, 156,
    157, 158, 161, 162, 163, 164, 167, 175, 176, 177, 178, 180, 181, 182, 183, 185, 186,
    187, 188, 189, 190, 191, 192, 193, 194, 195, 198, 215, 216, 217, 218, 219, 220,
];
const NAME_UNITS: usize = 30;
const PREFIX: usize = 4 + NAME_UNITS * 2;

fn xor(bytes: &mut [u8], offset: usize) {
    let key = b"TROUXA";
    for (i, byte) in bytes.iter_mut().enumerate() {
        let value = key[(offset + i) % key.len()];
        if *byte != 0 && *byte != value {
            *byte ^= value;
        }
    }
}

fn u32_at(bytes: &[u8], offset: usize, encrypted: bool) -> Result<u32> {
    let mut word: [u8; 4] = bytes
        .get(offset..offset + 4)
        .ok_or("Truncated tasks.data file")?
        .try_into()
        .unwrap();
    if encrypted {
        xor(&mut word, offset);
    }
    Ok(u32::from_le_bytes(word))
}

struct Layout {
    version: u32,
    encrypted: bool,
    offsets: Vec<usize>,
}
#[derive(Clone, Copy, PartialEq)]
enum PackKind {
    Static,
    Dynamic,
    Npc,
}
impl PackKind {
    fn layout(self, bytes: &[u8]) -> Result<Layout> {
        if self == Self::Static {
            return layout(bytes);
        }
        let header = bytes.get(..12).ok_or("Truncated pack header")?;
        let size = u32::from_le_bytes(header[..4].try_into().unwrap()) as usize;
        let version = u16::from_le_bytes(header[8..10].try_into().unwrap());
        let count = u16::from_le_bytes(header[10..12].try_into().unwrap()) as usize;
        if size != bytes.len() {
            return Err("Pack size does not match its header".into());
        }
        let offsets = match self {
            Self::Npc if version == 1 && size == 12 + count * 12 => {
                (0..count).map(|i| 12 + i * 12).collect()
            }
            Self::Dynamic if version == 10 => detail::dynamic_offsets(bytes, count)?,
            _ => return Err("Unsupported quest pack format".into()),
        };
        Ok(Layout {
            encrypted: false,
            version: u32::from(version),
            offsets,
        })
    }
    fn parse(self, bytes: &[u8], version: u32) -> Result<detail::TaskNode> {
        match self {
            Self::Static => detail::parse(bytes, version),
            Self::Dynamic => detail::parse_dynamic(bytes),
            Self::Npc => detail::parse_npc(bytes),
        }
    }
}
struct CachedPack {
    id: u64,
    index: usize,
    revision: String,
    bytes: Arc<Vec<u8>>,
}
static CACHE: Mutex<Option<CachedPack>> = Mutex::new(None);
impl Layout {
    fn root(&self, bytes: &[u8], row: usize) -> Result<(usize, Vec<u8>)> {
        let start = *self.offsets.get(row).ok_or("No quest")?;
        let end = self
            .offsets
            .iter()
            .copied()
            .filter(|&offset| offset > start)
            .min()
            .unwrap_or(bytes.len());
        let mut record = bytes[start..end].to_vec();
        if self.encrypted {
            xor(&mut record, start);
        }
        Ok((start, record))
    }
}

fn layout(bytes: &[u8]) -> Result<Layout> {
    let encrypted = !matches!(u32_at(bytes, 0, false)?, MAGIC | 0);
    if !matches!(u32_at(bytes, 0, encrypted)?, MAGIC | 0) {
        return Err("Invalid tasks.data signature".into());
    }
    let version = u32_at(bytes, 4, encrypted)?;
    if SUPPORTED_VERSIONS.binary_search(&version).is_err() {
        return Err(format!("Unsupported tasks.data version {version}").into());
    }
    let prefix = id_offset(version) + PREFIX;
    let count = u32_at(bytes, 8, encrypted)? as usize;
    let end = 12usize
        .checked_add(count.checked_mul(4).ok_or("Invalid index size")?)
        .ok_or("Invalid index size")?;
    if end > bytes.len() {
        return Err("Truncated quest table".into());
    }
    let offsets = (0..count)
        .map(|i| u32_at(bytes, 12 + i * 4, encrypted).map(|value| value as usize))
        .collect::<Result<Vec<_>>>()?;
    let mut sorted = offsets.clone();
    sorted.sort_unstable();
    if sorted
        .iter()
        .any(|&offset| offset < end || offset > bytes.len().saturating_sub(prefix))
        || sorted.windows(2).any(|pair| pair[1] - pair[0] < prefix)
    {
        return Err("Invalid quest offsets".into());
    }
    Ok(Layout { encrypted, offsets, version })
}

fn id_offset(version: u32) -> usize {
    if version >= 153 { 2 } else { 0 }
}

fn revision(bytes: &[u8]) -> String {
    let mut hash = DefaultHasher::new();
    bytes.hash(&mut hash);
    format!("{:016x}", hash.finish())
}

#[derive(Serialize)]
struct TaskRow {
    id: u32,
    name: String,
    name_key: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    coordinates: Option<[i16; 3]>,
}

#[derive(Serialize)]
pub struct TaskPack {
    version: u32,
    revision: String,
    rows: Vec<TaskRow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    names_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    npc_names: Option<HashMap<u32, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    item_names: Option<HashMap<u32, String>>,
}

fn task_kind(scope: &ide::Scope, index: usize) -> Result<PackKind> {
    let entry = scope.entries.get(index).ok_or("No file")?;
    kind_from_name(&entry.name)
}
fn kind_from_name(name: &str) -> Result<PackKind> {
    match name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "tasks.data" => Ok(PackKind::Static),
        "dyn_tasks.data" => Ok(PackKind::Dynamic),
        "task_npc.data" => Ok(PackKind::Npc),
        _ => Err("Select a quest pack".into()),
    }
}

pub(super) fn export_texts(
    scope: &ide::Scope,
    index: usize,
    bytes: &[u8],
    emit: &mut dyn FnMut(String, &str) -> Result<()>,
) -> Result<()> {
    let name = &scope.entries.get(index).ok_or("No file")?.name;
    export_file_texts(name, bytes, emit)
}

pub(super) fn export_file_texts(
    name: &str,
    bytes: &[u8],
    emit: &mut dyn FnMut(String, &str) -> Result<()>,
) -> Result<()> {
    let kind = kind_from_name(name)?;
    let layout = kind.layout(bytes)?;
    let mut ends = layout.offsets.clone();
    ends.sort_unstable();
    for (row, &start) in layout.offsets.iter().enumerate() {
        let next = ends.partition_point(|&offset| offset <= start);
        let end = ends.get(next).copied().unwrap_or(bytes.len());
        let mut record = bytes[start..end].to_vec();
        if layout.encrypted {
            xor(&mut record, start);
        }
        let node = kind.parse(&record, layout.version)?;
        detail::export_texts(&node, &format!("/tasks/{row}/{}", node.id), emit)?;
    }
    Ok(())
}

pub(super) fn translate_texts(
    scope: &ide::Scope,
    index: usize,
    bytes: &[u8],
    rows: &std::collections::HashSet<usize>,
    replace: &mut super::locales::ReplaceText<'_>,
) -> Result<Vec<u8>> {
    let kind = task_kind(scope, index)?;
    let layout = kind.layout(bytes)?;
    let mut changes = Vec::new();
    for &row in rows {
        let (_, record) = layout.root(bytes, row)?;
        let node = kind.parse(&record, layout.version)?;
        let mut fields = HashMap::new();
        detail::translate_texts(
            &node,
            &format!("/tasks/{row}/{}", node.id),
            replace,
            &mut fields,
        )?;
        if !fields.is_empty() {
            changes.push(TaskEdit { row, fields });
        }
    }
    if changes.is_empty() {
        Ok(bytes.to_vec())
    } else {
        apply_edits(kind, bytes, changes)
    }
}

#[tauri::command]
pub async fn tasks_open(
    id: u64,
    index: usize,
    state: tauri::State<'_, ide::Ide>,
) -> Result<TaskPack> {
    let scope = state.scope(id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let kind = task_kind(&scope, index)?;
        let bytes = ide::read(&scope, index)?;
        let layout = kind.layout(&bytes)?;
        let (names, items, names_error) = match ide::read_elements(&scope)
            .and_then(|bytes| super::elements::task_names(bytes, kind != PackKind::Npc))
        {
            Ok((names, items)) => (names, items, None),
            Err(error) => (HashMap::new(), HashMap::new(), Some(error)),
        };
        let mut rows = Vec::with_capacity(layout.offsets.len());
        for (row, &offset) in layout.offsets.iter().enumerate() {
            if kind == PackKind::Npc {
                let id = u32_at(&bytes, offset, false)?;
                let coordinates = [4, 6, 8].map(|delta| {
                    let start = offset + delta;
                    i16::from_le_bytes(bytes[start..start + 2].try_into().unwrap())
                });
                rows.push(TaskRow {
                    id,
                    name: names.get(&id).cloned().unwrap_or_default(),
                    name_key: None,
                    coordinates: Some(coordinates),
                });
                continue;
            }
            if kind != PackKind::Static {
                let (_, record) = layout.root(&bytes, row)?;
                let node = kind.parse(&record, layout.version)?;
                rows.push(TaskRow {
                    id: node.id,
                    name: node.name,
                    name_key: (kind == PackKind::Dynamic).then(|| node.fields[0].key),
                    coordinates: None,
                });
                continue;
            }
            let offset = offset + id_offset(layout.version);
            let id = u32_at(&bytes, offset, layout.encrypted)?;
            let mut name = bytes[offset + 4..offset + PREFIX].to_vec();
            if layout.encrypted {
                xor(&mut name, offset + 4);
            }
            let units = name
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]) ^ id as u16)
                .take_while(|&unit| unit != 0)
                .collect::<Vec<_>>();
            rows.push(TaskRow {
                id,
                name: String::from_utf16_lossy(&units),
                name_key: Some(id_offset(layout.version) + 4),
                coordinates: None,
            });
        }
        let revision = revision(&bytes);
        *CACHE.lock().map_err(err)? = Some(CachedPack {
            id,
            index,
            revision: revision.clone(),
            bytes: Arc::new(bytes),
        });
        Ok(TaskPack {
            version: layout.version,
            revision,
            rows,
            names_error,
            npc_names: (kind == PackKind::Static).then_some(names),
            item_names: (kind != PackKind::Npc).then_some(items),
        })
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn tasks_detail(
    id: u64,
    index: usize,
    row: usize,
    expected: String,
    state: tauri::State<'_, ide::Ide>,
) -> Result<detail::TaskNode> {
    let scope = state.scope(id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let kind = task_kind(&scope, index)?;
        let cached = CACHE
            .lock()
            .map_err(err)?
            .as_ref()
            .filter(|entry| entry.id == id && entry.index == index && entry.revision == expected)
            .map(|entry| entry.bytes.clone());
        let bytes = if let Some(bytes) = cached {
            bytes
        } else {
            let bytes = ide::read(&scope, index)?;
            if expected != revision(&bytes) {
                return Err("File has changed. Reopen it.".into());
            }
            let bytes = Arc::new(bytes);
            *CACHE.lock().map_err(err)? = Some(CachedPack {
                id,
                index,
                revision: expected,
                bytes: bytes.clone(),
            });
            bytes
        };
        let layout = kind.layout(&bytes)?;
        let (_, record) = layout.root(&bytes, row)?;
        kind.parse(&record, layout.version)
    })
    .await
    .map_err(err)?
}

#[derive(Deserialize)]
pub struct TaskEdit {
    row: usize,
    fields: HashMap<usize, String>,
}

fn collect_patches(
    node: &detail::TaskNode,
    fields: &mut HashMap<usize, String>,
    root: usize,
    record: &[u8],
    patches: &mut Vec<(usize, usize, Vec<u8>)>,
) -> Result<()> {
    for field in &node.fields {
        if let Some(value) = fields.remove(&field.key) {
            if let Some((start, bytes)) = field.group_header(&value, record)? {
                patches.push((root + start, root + start + bytes.len(), bytes));
            }
            patches.push((
                root + field.start(),
                root + field.end(),
                field.patch(&value)?,
            ));
        }
    }
    for child in &node.children {
        collect_patches(child, fields, root, record, patches)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn tasks_save(
    id: u64,
    index: usize,
    expected: String,
    changes: Vec<TaskEdit>,
    state: tauri::State<'_, ide::Ide>,
) -> Result<String> {
    let scope = state.scope(id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let kind = task_kind(&scope, index)?;
        let original = ide::read(&scope, index)?;
        if expected != revision(&original) {
            return Err("File has changed. Reopen it.".into());
        }
        let updated = apply_edits(kind, &original, changes)?;
        let result = revision(&updated);
        ide::save_bytes(&scope, index, &original, updated)?;
        if let Ok(mut cache) = CACHE.lock() {
            if cache
                .as_ref()
                .is_some_and(|entry| entry.id == id && entry.index == index)
            {
                *cache = None;
            }
        }
        Ok(result)
    })
    .await
    .map_err(err)?
}

fn apply_edits(kind: PackKind, original: &[u8], changes: Vec<TaskEdit>) -> Result<Vec<u8>> {
    let layout = kind.layout(&original)?;
    let edited_rows: Vec<_> = changes.iter().map(|change| change.row).collect();
    let mut patches = Vec::new();
    for mut change in changes {
        let (start, record) = layout.root(&original, change.row)?;
        collect_patches(
            &kind.parse(&record, layout.version)?,
            &mut change.fields,
            start,
            &record,
            &mut patches,
        )?;
        if !change.fields.is_empty() {
            return Err("No quest field".into());
        }
    }
    patches.sort_unstable_by_key(|patch| (patch.0, patch.1));
    if patches.windows(2).any(|pair| pair[0].1 > pair[1].0) {
        return Err("Edits overlap".into());
    }
    let mut updated = original.to_vec();
    if patches
        .iter()
        .all(|(start, end, bytes)| end - start == bytes.len())
    {
        for (start, end, mut bytes) in patches {
            if layout.encrypted {
                xor(&mut bytes, start);
            }
            updated[start..end].copy_from_slice(&bytes);
        }
    } else {
        if layout.encrypted {
            xor(&mut updated, 0);
        }
        let mut rebuilt = Vec::with_capacity(updated.len());
        let mut cursor = 0;
        let mut shifts = Vec::new();
        for (start, end, bytes) in patches {
            rebuilt.extend_from_slice(&updated[cursor..start]);
            rebuilt.extend_from_slice(&bytes);
            cursor = end;
            shifts.push((end, rebuilt.len() as i64 - end as i64));
        }
        rebuilt.extend_from_slice(&updated[cursor..]);
        if rebuilt.len() > i32::MAX as usize {
            return Err("Quest pack is too large".into());
        }
        if kind == PackKind::Dynamic {
            let size = rebuilt.len() as u32;
            rebuilt[..4].copy_from_slice(&size.to_le_bytes());
        }
        for (i, offset) in layout
            .offsets
            .iter()
            .copied()
            .enumerate()
            .filter(|_| kind == PackKind::Static)
        {
            let position = shifts.partition_point(|&(end, _)| end <= offset);
            let shift = if position == 0 {
                0
            } else {
                shifts[position - 1].1
            };
            let target = (offset as i64 + shift) as u32;
            rebuilt[12 + i * 4..16 + i * 4].copy_from_slice(&target.to_le_bytes());
        }
        if layout.encrypted {
            xor(&mut rebuilt, 0);
        }
        updated = rebuilt;
    }
    let checked = kind.layout(&updated)?;
    if kind == PackKind::Static {
        for row in edited_rows {
            let (_, record) = checked.root(&updated, row)?;
            kind.parse(&record, layout.version)?;
        }
    }
    Ok(updated)
}

pub(super) fn mcp_read(name: &str, bytes: &[u8], args: &serde_json::Value) -> Result<serde_json::Value> {
    let kind = kind_from_name(name)?;
    let layout = kind.layout(bytes)?;
    if let Some(row) = args["row"].as_u64() {
        let (_, record) = layout.root(bytes, row as usize)?;
        return serde_json::to_value(kind.parse(&record, layout.version)?).map_err(err);
    }
    Ok(serde_json::json!({"count":layout.offsets.len()}))
}

pub(super) fn mcp_patch(name: &str, bytes: &[u8], args: &serde_json::Value) -> Result<Vec<u8>> {
    apply_edits(kind_from_name(name)?, bytes, serde_json::from_value(args["changes"].clone()).map_err(err)?)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v93_round_trip_edits_reward_dialogue_and_child() {
        fn quest(id: u32, child: Option<Vec<u8>>) -> Vec<u8> {
            let mut body = vec![0; 906 + 2 * 208 + 2 * 24 + 2 * 28];
            body[..4].copy_from_slice(&id.to_le_bytes());
            for unit in body[4..64].chunks_exact_mut(2) {
                unit.copy_from_slice(&(id as u16).to_le_bytes());
            }
            body.extend_from_slice(&[0; 16]);
            for _ in 0..5 {
                body.extend_from_slice(&0u32.to_le_bytes());
                for _ in 0..64 {
                    body.extend_from_slice(&(id as u16).to_le_bytes());
                }
                body.extend_from_slice(&0u32.to_le_bytes());
            }
            body.extend_from_slice(&u32::from(child.is_some()).to_le_bytes());
            if let Some(child) = child {
                body.extend(child);
            }
            body
        }

        let root = quest(42, Some(quest(43, None)));
        let second = quest(44, None);
        let mut original = Vec::new();
        for word in [MAGIC, 93, 2, 20, (20 + root.len()) as u32] {
            original.extend_from_slice(&word.to_le_bytes());
        }
        original.extend(root);
        original.extend(&second);

        let layout = PackKind::Static.layout(&original).unwrap();
        let (_, record) = layout.root(&original, 0).unwrap();
        let node = PackKind::Static.parse(&record, 93).unwrap();
        let dialogue = serde_json::to_value(&node.fields).unwrap();
        let dialogue_key = dialogue.as_array().unwrap().iter()
            .find(|field| field["section"] == "Accept dialogue").unwrap()["key"].as_u64().unwrap() as usize;
        let dialogue = serde_json::json!({
            "id": 0, "title": "Accept", "windows": [{"id": 1, "parent": 0, "text": "Hello", "options": []}]
        });
        let updated = apply_edits(PackKind::Static, &original, vec![TaskEdit {
            row: 0,
            fields: HashMap::from([
                (906, "100".into()),
                (dialogue_key, dialogue.to_string()),
                (node.children[0].fields[0].key, "Child".into()),
            ]),
        }]).unwrap();

        let layout = PackKind::Static.layout(&updated).unwrap();
        let (_, record) = layout.root(&updated, 0).unwrap();
        let node = PackKind::Static.parse(&record, 93).unwrap();
        assert_eq!(node.children[0].name, "Child");
        assert_eq!(u32_at(&record, 906, false).unwrap(), 100);
        assert!(serde_json::to_string(&node).unwrap().contains("Hello"));
        assert_eq!(layout.root(&updated, 1).unwrap().1, second);
    }

    #[test]
    fn versioned_schemas_round_trip_quest_fields() {
        fn quest(version: u32, fixed_size: usize, id: u32, child: Option<Vec<u8>>) -> Vec<u8> {
            let mut body = vec![0; fixed_size];
            let start = id_offset(version);
            body[start..start + 4].copy_from_slice(&id.to_le_bytes());
            for unit in body[start + 4..start + PREFIX].chunks_exact_mut(2) {
                unit.copy_from_slice(&(id as u16).to_le_bytes());
            }
            body.extend_from_slice(&[0; 16]);
            for _ in 0..5 {
                body.extend_from_slice(&0u32.to_le_bytes());
                for _ in 0..64 {
                    body.extend_from_slice(&(id as u16).to_le_bytes());
                }
                body.extend_from_slice(&0u32.to_le_bytes());
            }
            body.extend_from_slice(&u32::from(child.is_some()).to_le_bytes());
            if let Some(child) = child {
                body.extend(child);
            }
            body
        }

        for version in SUPPORTED_VERSIONS.iter().copied().filter(|v| !matches!(v, 93 | 125)) {
            let fixed_size = detail::synthetic_fixed_size(version)
                .unwrap_or_else(|error| panic!("v{version}: {error}"));
            let root = quest(version, fixed_size, 42, Some(quest(version, fixed_size, 43, None)));
            let second = quest(version, fixed_size, 44, None);
            let mut original = Vec::new();
            for word in [MAGIC, version, 2, 20, (20 + root.len()) as u32] {
                original.extend_from_slice(&word.to_le_bytes());
            }
            original.extend(root);
            original.extend(&second);
            let layout = PackKind::Static.layout(&original).unwrap();
            assert_eq!(layout.version, version);
            let (_, record) = layout.root(&original, 0).unwrap();
            let node = PackKind::Static.parse(&record, version)
                .unwrap_or_else(|error| panic!("v{version}: {error}"));
            let fields = serde_json::to_value(&node.fields).unwrap();
            let lookup = |label: &str| {
                fields.as_array().unwrap().iter()
                    .find(|field| field["label"] == label)
                    .unwrap_or_else(|| panic!("v{version} lacks {label}"))
            };
            let key = |label| lookup(label)["key"].as_u64().unwrap() as usize;
            let dialogue = serde_json::json!({
                "id": 0, "title": "Accept", "windows": [
                    {"id": 1, "parent": 0, "text": "Hello", "options": []}
                ]
            });
            let updated = apply_edits(PackKind::Static, &original, vec![TaskEdit {
                row: 0,
                fields: HashMap::from([
                    (key("m_ulTimeLimit"), "60".into()),
                    (key("m_Award_S.m_ulGoldNum"), "100".into()),
                    (key("Accept dialogue"), dialogue.to_string()),
                    (node.children[0].fields[0].key, "Child".into()),
                ]),
            }]).unwrap_or_else(|error| panic!("v{version}: {error}"));
            let layout = PackKind::Static.layout(&updated).unwrap();
            let (_, record) = layout.root(&updated, 0).unwrap();
            let node = PackKind::Static.parse(&record, version).unwrap();
            assert_eq!(node.children[0].name, "Child");
            assert_eq!(u32_at(&record, key("m_ulTimeLimit"), false).unwrap(), 60);
            assert_eq!(u32_at(&record, key("m_Award_S.m_ulGoldNum"), false).unwrap(), 100);
            assert!(serde_json::to_string(&node).unwrap().contains("Hello"));
            assert_eq!(layout.root(&updated, 1).unwrap().1, second);
        }
    }
}
