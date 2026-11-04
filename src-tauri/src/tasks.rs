use super::{err, ide, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{Arc, Mutex};
#[path = "task_detail.rs"]
mod detail;
pub(super) use detail::{export_npc_talks, translate_npc_talks};

const MAGIC: u32 = 0x93858361;
const VERSION: u32 = 125;
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
        .ok_or("Файл tasks.data обрезан")?
        .try_into()
        .unwrap();
    if encrypted {
        xor(&mut word, offset);
    }
    Ok(u32::from_le_bytes(word))
}

struct Layout {
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
        let header = bytes.get(..12).ok_or("Заголовок пакета обрезан")?;
        let size = u32::from_le_bytes(header[..4].try_into().unwrap()) as usize;
        let version = u16::from_le_bytes(header[8..10].try_into().unwrap());
        let count = u16::from_le_bytes(header[10..12].try_into().unwrap()) as usize;
        if size != bytes.len() {
            return Err("Размер пакета не совпадает с заголовком".into());
        }
        let offsets = match self {
            Self::Npc if version == 1 && size == 12 + count * 12 => {
                (0..count).map(|i| 12 + i * 12).collect()
            }
            Self::Dynamic if version == 10 => detail::dynamic_offsets(bytes, count)?,
            _ => return Err("Неподдерживаемый формат пакета заданий".into()),
        };
        Ok(Layout {
            encrypted: false,
            offsets,
        })
    }
    fn parse(self, bytes: &[u8]) -> Result<detail::TaskNode> {
        match self {
            Self::Static => detail::parse(bytes),
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
        let start = *self.offsets.get(row).ok_or("Нет задания")?;
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
    let encrypted = u32_at(bytes, 0, false)? != MAGIC;
    if u32_at(bytes, 0, encrypted)? != MAGIC || u32_at(bytes, 4, encrypted)? != VERSION {
        return Err("Поддерживается tasks.data версии 125".into());
    }
    let count = u32_at(bytes, 8, encrypted)? as usize;
    let end = 12usize
        .checked_add(count.checked_mul(4).ok_or("Неверный размер индекса")?)
        .ok_or("Неверный размер индекса")?;
    if end > bytes.len() {
        return Err("Таблица заданий обрезана".into());
    }
    let offsets = (0..count)
        .map(|i| u32_at(bytes, 12 + i * 4, encrypted).map(|value| value as usize))
        .collect::<Result<Vec<_>>>()?;
    let mut sorted = offsets.clone();
    sorted.sort_unstable();
    if sorted
        .iter()
        .any(|&offset| offset < end || offset > bytes.len().saturating_sub(PREFIX))
        || sorted.windows(2).any(|pair| pair[1] - pair[0] < PREFIX)
    {
        return Err("Некорректные смещения заданий".into());
    }
    Ok(Layout { encrypted, offsets })
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
    let entry = scope.entries.get(index).ok_or("Нет файла")?;
    match entry
        .name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "tasks.data" => Ok(PackKind::Static),
        "dyn_tasks.data" => Ok(PackKind::Dynamic),
        "task_npc.data" => Ok(PackKind::Npc),
        _ => Err("Выберите пакет заданий".into()),
    }
}

pub(super) fn export_texts(
    scope: &ide::Scope,
    index: usize,
    bytes: &[u8],
    emit: &mut dyn FnMut(String, &str) -> Result<()>,
) -> Result<()> {
    let kind = task_kind(scope, index)?;
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
        let node = kind.parse(&record)?;
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
        let node = kind.parse(&record)?;
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
                let node = kind.parse(&record)?;
                rows.push(TaskRow {
                    id: node.id,
                    name: node.name,
                    name_key: (kind == PackKind::Dynamic).then(|| node.fields[0].key),
                    coordinates: None,
                });
                continue;
            }
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
                name_key: Some(4),
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
                return Err("Файл изменён. Откройте его заново.".into());
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
        let (_, record) = kind.layout(&bytes)?.root(&bytes, row)?;
        kind.parse(&record)
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
            return Err("Файл изменён. Откройте его заново.".into());
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
            &kind.parse(&record)?,
            &mut change.fields,
            start,
            &record,
            &mut patches,
        )?;
        if !change.fields.is_empty() {
            return Err("Нет поля задания".into());
        }
    }
    patches.sort_unstable_by_key(|patch| (patch.0, patch.1));
    if patches.windows(2).any(|pair| pair[0].1 > pair[1].0) {
        return Err("Правки пересекаются".into());
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
            return Err("Пакет заданий слишком велик".into());
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
            kind.parse(&record)?;
        }
    }
    Ok(updated)
}
