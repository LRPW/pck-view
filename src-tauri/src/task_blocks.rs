use super::{Field, Kind, Reader, Result, GROUP_KEY};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
struct Item {
    id: u32,
    common: bool,
    count: u32,
    probability: f32,
    period: i32,
}
#[derive(Deserialize, Serialize)]
pub(super) struct Group {
    random: bool,
    items: Vec<Item>,
}

impl Reader<'_> {
    pub(super) fn groups(
        &mut self,
        count: usize,
        header: usize,
        section: &str,
        compact: bool,
    ) -> Result<Field> {
        let start = self.pos;
        let mut groups = Vec::new();
        for _ in 0..count {
            let offset = self.take(1)?;
            let random = self.bytes[offset] != 0;
            let count = if compact {
                let offset = self.take(1)?;
                self.bytes[offset] as usize
            } else {
                self.count()?
            };
            let mut items = Vec::new();
            for _ in 0..count {
                let offset = self.take(17)?;
                items.push(Item {
                    id: self.u32(offset),
                    common: self.bytes[offset + 4] != 0,
                    count: self.u32(offset + 5),
                    probability: f32::from_bits(self.u32(offset + 9)),
                    period: self.u32(offset + 13) as i32,
                });
            }
            groups.push(Group { random, items });
        }
        Ok(Field {
            key: start | GROUP_KEY,
            end: self.pos,
            code: (start - header) as u16,
            label: "Reward items".into(),
            section: section.into(),
            kind: if compact {
                Kind::CompactAwardGroups
            } else {
                Kind::AwardGroups
            },
            value: serde_json::to_string(&groups).map_err(|e| e.to_string())?,
        })
    }
}

fn word(bytes: &mut Vec<u8>, value: u32) {
    bytes.extend_from_slice(&value.to_le_bytes());
}
fn count(bytes: &mut Vec<u8>, length: usize, compact: bool) -> Result<()> {
    if compact {
        if length > 127 {
            return Err("The compact format supports at most 127 records".into());
        }
        bytes.push(length as u8);
    } else {
        word(bytes, length as u32);
    }
    Ok(())
}
pub(super) fn encode_groups(value: &str, compact: bool) -> Result<Vec<u8>> {
    let groups: Vec<Group> = serde_json::from_str(value).map_err(|e| e.to_string())?;
    if groups.len() > 12 {
        return Err("At most 12 reward groups are allowed".into());
    }
    let mut bytes = Vec::new();
    if compact && !groups.is_empty() {
        count(&mut bytes, groups.len(), true)?;
    }
    for group in groups {
        bytes.push(u8::from(group.random));
        count(&mut bytes, group.items.len(), compact)?;
        for item in group.items {
            if item.id == 0 || item.count == 0 || !(0.0..=1.0).contains(&item.probability) {
                return Err("Specify an item ID, quantity and probability from 0 to 1".into());
            }
            word(&mut bytes, item.id);
            bytes.push(u8::from(item.common));
            word(&mut bytes, item.count);
            word(&mut bytes, item.probability.to_bits());
            word(&mut bytes, item.period as u32);
        }
    }
    Ok(bytes)
}

#[derive(Deserialize, Serialize)]
struct Talk {
    id: u32,
    title: String,
    windows: Vec<Window>,
}
#[derive(Deserialize, Serialize)]
struct Window {
    id: u32,
    parent: u32,
    text: String,
    options: Vec<TalkOption>,
}
#[derive(Deserialize, Serialize)]
struct TalkOption {
    target: u32,
    param: u32,
    text: String,
}

pub(super) fn export_talk(
    value: &str,
    path: &str,
    emit: &mut dyn FnMut(String, &str) -> Result<()>,
) -> Result<()> {
    let talk: Talk = serde_json::from_str(value).map_err(|error| error.to_string())?;
    emit(format!("{path}/title"), &talk.title)?;
    for (index, window) in talk.windows.iter().enumerate() {
        let window_path = format!("{path}/windows/{index}/{}", window.id);
        emit(format!("{window_path}/text"), &window.text)?;
        for (i, option) in window.options.iter().enumerate() {
            emit(format!("{window_path}/options/{i}/text"), &option.text)?;
        }
    }
    Ok(())
}

pub(super) fn translate_talk(
    value: &str,
    path: &str,
    replace: &mut super::super::super::locales::ReplaceText<'_>,
) -> Result<Option<String>> {
    let mut talk: Talk = serde_json::from_str(value).map_err(|error| error.to_string())?;
    let mut changed = false;
    let mut edit = |path: String, text: &mut String| -> Result<()> {
        if let Some(next) = replace(&path, text)? {
            *text = next;
            changed = true;
        }
        Ok(())
    };
    edit(format!("{path}/title"), &mut talk.title)?;
    for (index, window) in talk.windows.iter_mut().enumerate() {
        let path = format!("{path}/windows/{index}/{}", window.id);
        edit(format!("{path}/text"), &mut window.text)?;
        for (i, option) in window.options.iter_mut().enumerate() {
            edit(format!("{path}/options/{i}/text"), &mut option.text)?;
        }
    }
    if changed {
        Ok(Some(
            serde_json::to_string(&talk).map_err(|error| error.to_string())?,
        ))
    } else {
        Ok(None)
    }
}

impl Reader<'_> {
    fn talk_count(&mut self, compact: bool) -> Result<usize> {
        if compact {
            let offset = self.take(1)?;
            Ok(self.bytes[offset] as usize)
        } else {
            self.count()
        }
    }
    fn talk_label(&mut self, compact: bool, code: u16) -> Result<String> {
        let size = if compact { self.count()? } else { 128 };
        if size > 128 || size % 2 != 0 {
            return Err("Invalid dialogue label".into());
        }
        let start = self.take(size)?;
        Ok(self.text(start, size / 2, code))
    }
    pub(super) fn talk(&mut self, code: u16, section: &str, compact: bool) -> Result<Field> {
        let key = self.pos;
        let id = if compact { 0 } else { self.count()? as u32 };
        let title = self.talk_label(compact, code)?;
        let mut windows = Vec::new();
        for _ in 0..self.talk_count(compact)? {
            let id = self.talk_count(compact)? as u32;
            let parent = self.talk_count(compact)? as u32;
            let units = self.count()?;
            let offset = self.pos;
            self.skip(units, 2)?;
            let text = self.text(offset, units, code);
            let mut options = Vec::new();
            for _ in 0..self.talk_count(compact)? {
                let target = self.count()? as u32;
                let (text, param) = if compact {
                    let param = self.count()? as u32;
                    (self.talk_label(true, code)?, param)
                } else {
                    let text = self.talk_label(false, code)?;
                    (text, self.count()? as u32)
                };
                options.push(TalkOption {
                    target,
                    param,
                    text,
                });
            }
            windows.push(Window {
                id,
                parent,
                text,
                options,
            });
        }
        Ok(Field {
            key,
            end: self.pos,
            code,
            label: section.into(),
            section: section.into(),
            kind: if compact {
                Kind::CompactTalk
            } else {
                Kind::Talk
            },
            value: serde_json::to_string(&Talk { id, title, windows })
                .map_err(|e| e.to_string())?,
        })
    }
}

fn label(bytes: &mut Vec<u8>, text: &str, code: u16, compact: bool) -> Result<()> {
    let mut units = text.encode_utf16().collect::<Vec<_>>();
    if units.len() >= 64 || units.contains(&0) {
        return Err("Dialogue label must fit in 63 UTF-16 code units".into());
    }
    if compact {
        word(bytes, (units.len() * 2) as u32);
    } else {
        units.resize(64, 0);
    }
    for unit in units {
        bytes.extend_from_slice(&(unit ^ code).to_le_bytes());
    }
    Ok(())
}
pub(super) fn encode_talk(value: &str, code: u16, compact: bool) -> Result<Vec<u8>> {
    let talk: Talk = serde_json::from_str(value).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    if !compact {
        word(&mut bytes, talk.id);
    }
    label(&mut bytes, &talk.title, code, compact)?;
    count(&mut bytes, talk.windows.len(), compact)?;
    for window in talk.windows {
        if compact {
            bytes.push(u8::try_from(window.id).map_err(|_| "Window ID is out of range")?);
            bytes.push(u8::try_from(window.parent).map_err(|_| "Parent ID is out of range")?);
        } else {
            word(&mut bytes, window.id);
            word(&mut bytes, window.parent);
        }
        let units = window.text.encode_utf16().collect::<Vec<_>>();
        if units.len() > 1_000_000 || units.contains(&0) {
            return Err("Invalid window text".into());
        }
        word(&mut bytes, (units.len() + 1) as u32);
        for unit in units.into_iter().chain([0]) {
            bytes.extend_from_slice(&(unit ^ code).to_le_bytes());
        }
        count(&mut bytes, window.options.len(), compact)?;
        for option in window.options {
            word(&mut bytes, option.target);
            if compact {
                word(&mut bytes, option.param);
            }
            label(&mut bytes, &option.text, code, compact)?;
            if !compact {
                word(&mut bytes, option.param);
            }
        }
    }
    Ok(bytes)
}
