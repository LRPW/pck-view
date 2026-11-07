use super::{Result, NAME_UNITS};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::OnceLock};
#[path = "task_blocks.rs"]
mod blocks;
#[path = "task_dynamic.rs"]
mod dynamic;
#[path = "task_v93.rs"]
mod v93;
#[path = "task_versioned.rs"]
mod versioned;
#[cfg(test)]
pub(super) use versioned::synthetic_fixed_size;
const GROUP_KEY: usize = 1 << 31;
pub(super) use dynamic::{dynamic_offsets, parse_dynamic, parse_npc};

#[derive(Deserialize)]
struct Block {
    size: usize,
    fields: HashMap<String, usize>,
}
#[derive(Deserialize)]
struct Layout {
    fixed: Block,
    award: Block,
}
fn layout() -> &'static Layout {
    static LAYOUT: OnceLock<Layout> = OnceLock::new();
    LAYOUT.get_or_init(|| {
        serde_json::from_str(include_str!("task-layout.json")).expect("task layout")
    })
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum Kind {
    #[serde(rename = "uint")]
    UInt,
    Byte,
    Short,
    UShort,
    Int,
    Bool,
    Float,
    Text,
    FixedText,
    Dialogue,
    Name,
    TalkLabel,
    AwardGroups,
    CompactAwardGroups,
    Talk,
    CompactTalk,
}

#[derive(Serialize)]
pub(super) struct Field {
    pub(super) key: usize,
    label: String,
    section: String,
    kind: Kind,
    value: String,
    #[serde(skip)]
    end: usize,
    #[serde(skip)]
    code: u16,
}

impl Field {
    pub(super) fn patch(&self, value: &str) -> Result<Vec<u8>> {
        let error = || format!("Invalid field value “{}”", self.label);
        Ok(match self.kind {
            Kind::UInt => value
                .trim()
                .parse::<u32>()
                .map_err(|_| error())?
                .to_le_bytes()
                .to_vec(),
            Kind::Byte => vec![value.trim().parse::<u8>().map_err(|_| error())?],
            Kind::Short => value
                .trim()
                .parse::<i16>()
                .map_err(|_| error())?
                .to_le_bytes()
                .to_vec(),
            Kind::UShort => value
                .trim()
                .parse::<u16>()
                .map_err(|_| error())?
                .to_le_bytes()
                .to_vec(),
            Kind::Int => value
                .trim()
                .parse::<i32>()
                .map_err(|_| error())?
                .to_le_bytes()
                .to_vec(),
            Kind::Bool => match value {
                "0" => vec![0],
                "1" => vec![1],
                _ => return Err(error()),
            },
            Kind::Float => {
                let number = value.trim().parse::<f32>().map_err(|_| error())?;
                if !number.is_finite() {
                    return Err(error());
                }
                number.to_le_bytes().to_vec()
            }
            Kind::AwardGroups | Kind::CompactAwardGroups => {
                blocks::encode_groups(value, matches!(self.kind, Kind::CompactAwardGroups))?
            }
            Kind::Talk | Kind::CompactTalk => {
                blocks::encode_talk(value, self.code, matches!(self.kind, Kind::CompactTalk))?
            }
            Kind::Text | Kind::FixedText | Kind::Dialogue | Kind::Name | Kind::TalkLabel => {
                let mut units = value.encode_utf16().collect::<Vec<_>>();
                if units.contains(&0) || units.len() > 1_000_000 {
                    return Err(error());
                }
                let mut bytes = Vec::new();
                match self.kind {
                    Kind::FixedText => {
                        let capacity = (self.end - self.key) / 2;
                        if units.len() >= capacity {
                            return Err(format!(
                                "{} · maximum {} UTF-16 code units",
                                self.label,
                                capacity - 1
                            ));
                        }
                        units.resize(capacity, 0);
                    }
                    Kind::Text | Kind::Dialogue => {
                        if matches!(self.kind, Kind::Dialogue) {
                            units.push(0);
                        }
                        bytes.extend_from_slice(&(units.len() as u32).to_le_bytes());
                    }
                    Kind::Name => {
                        if units.len() >= NAME_UNITS {
                            return Err(error());
                        }
                        bytes.push(units.len() as u8);
                    }
                    Kind::TalkLabel => {
                        if units.len() >= 64 {
                            return Err(error());
                        }
                        bytes.extend_from_slice(&((units.len() * 2) as u32).to_le_bytes());
                    }
                    _ => unreachable!(),
                }
                for unit in units {
                    bytes.extend_from_slice(&(unit ^ self.code).to_le_bytes());
                }
                bytes
            }
        })
    }
    pub(super) fn end(&self) -> usize {
        self.end
    }
    pub(super) fn start(&self) -> usize {
        self.key & !GROUP_KEY
    }
    pub(super) fn group_header(
        &self,
        value: &str,
        record: &[u8],
    ) -> Result<Option<(usize, Vec<u8>)>> {
        if !matches!(self.kind, Kind::AwardGroups | Kind::CompactAwardGroups) {
            return Ok(None);
        }
        let start = self.start() - self.code as usize;
        let groups: Vec<blocks::Group> =
            serde_json::from_str(value).map_err(|error| error.to_string())?;
        let word = if matches!(self.kind, Kind::CompactAwardGroups) {
            let old = u32::from_le_bytes(record[start..start + 4].try_into().unwrap());
            if groups.is_empty() {
                old & !16
            } else {
                old | 16
            }
        } else {
            groups.len() as u32
        };
        Ok(Some((start, word.to_le_bytes().to_vec())))
    }
}

#[derive(Serialize)]
pub struct TaskNode {
    pub(super) id: u32,
    pub(super) name: String,
    pub(super) fields: Vec<Field>,
    pub(super) children: Vec<TaskNode>,
}

struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}
impl Reader<'_> {
    fn take(&mut self, length: usize) -> Result<usize> {
        let start = self.pos;
        self.pos = start
            .checked_add(length)
            .filter(|&end| end <= self.bytes.len())
            .ok_or("Corrupted quest block")?;
        Ok(start)
    }
    fn skip(&mut self, count: usize, stride: usize) -> Result<()> {
        self.take(
            count
                .checked_mul(stride)
                .ok_or("Quest size overflow")?,
        )?;
        Ok(())
    }
    fn u32(&self, offset: usize) -> u32 {
        u32::from_le_bytes(self.bytes[offset..offset + 4].try_into().unwrap())
    }
    fn count(&mut self) -> Result<usize> {
        let offset = self.take(4)?;
        Ok(self.u32(offset) as usize)
    }
    fn text(&self, offset: usize, units: usize, code: u16) -> String {
        let units = self.bytes[offset..offset + units * 2]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]) ^ code)
            .take_while(|&unit| unit != 0)
            .collect::<Vec<_>>();
        String::from_utf16_lossy(&units)
    }
    fn number(&self, key: usize, label: &str, section: &str, kind: Kind) -> Field {
        let (size, value) = match kind {
            Kind::UInt => (4, self.u32(key).to_string()),
            Kind::Int => (4, (self.u32(key) as i32).to_string()),
            Kind::Bool => (1, u8::from(self.bytes[key] != 0).to_string()),
            Kind::Byte => (1, self.bytes[key].to_string()),
            Kind::Short | Kind::UShort => {
                let word = u16::from_le_bytes(self.bytes[key..key + 2].try_into().unwrap());
                (
                    2,
                    if matches!(kind, Kind::Short) {
                        (word as i16).to_string()
                    } else {
                        word.to_string()
                    },
                )
            }
            Kind::Float => (4, f32::from_bits(self.u32(key)).to_string()),
            _ => unreachable!(),
        };
        Field {
            key,
            end: key + size,
            label: label.into(),
            section: section.into(),
            kind,
            value,
            code: 0,
        }
    }
    fn fixed_text(&self, key: usize, units: usize, code: u16, label: &str, section: &str) -> Field {
        Field {
            key,
            end: key + units * 2,
            label: label.into(),
            section: section.into(),
            kind: Kind::FixedText,
            value: self.text(key, units, code),
            code,
        }
    }
    fn text_field(&mut self, code: u16, label: &str, section: &str, kind: Kind) -> Result<Field> {
        let key = self.pos;
        let units = self.count()?;
        let start = self.pos;
        self.skip(units, 2)?;
        Ok(Field {
            key,
            end: self.pos,
            label: label.into(),
            section: section.into(),
            kind,
            value: self.text(start, units, code),
            code,
        })
    }
    fn item(&mut self, fields: &mut Vec<Field>, section: &str, label: &str) -> Result<()> {
        let offset = self.take(17)?;
        for (delta, name, kind) in [
            (0, "Item ID", Kind::UInt),
            (4, "Common item", Kind::Bool),
            (5, "Quantity", Kind::UInt),
            (9, "Probability", Kind::Float),
            (13, "Duration", Kind::Int),
        ] {
            fields.push(self.number(offset + delta, &format!("{label} · {name}"), section, kind));
        }
        Ok(())
    }
    fn award(&mut self, fields: &mut Vec<Field>, section: &str) -> Result<()> {
        let block = &layout().award;
        let start = self.take(block.size)?;
        let get = |name: &str| start + block.fields[name];
        for (name, label, kind) in [
            ("m_ulGoldNum", "Coins", Kind::UInt),
            ("m_ulExp", "Experience", Kind::UInt),
            ("m_ulRealmExp", "Sky experience", Kind::UInt),
            ("m_ulSP", "Spirit", Kind::UInt),
            ("m_lReputation", "Reputation", Kind::Int),
            ("m_ulNewTask", "New quest ID", Kind::UInt),
            ("m_iFactionContrib", "Faction contribution", Kind::Int),
            ("m_iForceReputation", "Force reputation", Kind::Int),
            ("m_iWorldContribution", "World contribution", Kind::Int),
            ("m_ulDividend", "Dividends", Kind::UInt),
        ] {
            fields.push(self.number(get(name), label, section, kind));
        }
        fields.push(self.groups(
            self.u32(get("m_ulCandItems")) as usize,
            get("m_ulCandItems"),
            section,
            false,
        )?);
        let summons = self.u32(get("m_ulSummonedMonsters")) as usize;
        if summons != 0 {
            self.take(6)?;
            self.skip(summons, 16)?;
        }
        let ranks = self.u32(get("m_ulPQRankingAwardCnt")) as usize;
        if ranks != 0 {
            self.take(1)?;
            self.skip(ranks, 21)?;
        }
        for (name, stride) in [
            ("m_ulTitleNum", 8),
            ("m_ulChangeKeyCnt", 9),
            ("m_ulHistoryChangeCnt", 9),
            ("m_ulDisplayKeyCnt", 4),
            ("m_ulExpCnt", 576),
            ("m_ulTaskCharCnt", 128),
        ] {
            self.skip(self.u32(get(name)) as usize, stride)?;
        }
        Ok(())
    }

    fn node(&mut self, depth: usize, version: u32) -> Result<TaskNode> {
        if depth >= 64 {
            return Err("Quest tree is too deep".into());
        }
        if version == 93 {
            return self.node_v93(depth);
        }
        if version != 125 {
            return self.node_versioned(depth, version);
        }
        let block = &layout().fixed;
        let start = self.take(block.size)?;
        let get = |name: &str| start + block.fields[name];
        let id = self.u32(start);
        let code = id as u16;
        let name = self.fixed_text(start + 4, NAME_UNITS, code, "Name", "General");
        let title = name.value.clone();
        let mut fields = vec![name];
        for (name, label, section, kind) in [
            ("m_ulType", "Quest type", "General", Kind::UInt),
            (
                "m_ulTimeLimit",
                "Time limit (seconds)",
                "General",
                Kind::UInt,
            ),
            ("m_bCanGiveUp", "Can abandon", "General", Kind::Bool),
            ("m_bCanRedo", "Repeatable", "General", Kind::Bool),
            (
                "m_bCanRedoAfterFailure",
                "Repeat after failure",
                "General",
                Kind::Bool,
            ),
            (
                "m_bOfflineFail",
                "Fail on exit",
                "General",
                Kind::Bool,
            ),
            (
                "m_bFailAsPlayerDie",
                "Fail on death",
                "General",
                Kind::Bool,
            ),
            ("m_bHidden", "Hidden", "General", Kind::Bool),
            ("m_bKeyTask", "Important", "General", Kind::Bool),
            ("m_bCanSeekOut", "Available in search", "General", Kind::Bool),
            (
                "m_bShowDirection",
                "Show direction",
                "General",
                Kind::Bool,
            ),
            (
                "m_bExeChildInOrder",
                "Sequential subquests",
                "General",
                Kind::Bool,
            ),
            ("m_ulDelvNPC", "Quest giver NPC ID", "Conditions", Kind::UInt),
            ("m_ulAwardNPC", "Reward NPC ID", "Conditions", Kind::UInt),
            (
                "m_ulPremise_Lev_Min",
                "Minimum level",
                "Conditions",
                Kind::UInt,
            ),
            (
                "m_ulPremise_Lev_Max",
                "Maximum level",
                "Conditions",
                Kind::UInt,
            ),
            (
                "m_ulSuitableLevel",
                "Recommended level",
                "Conditions",
                Kind::UInt,
            ),
            ("m_ulPremise_Deposit", "Deposit", "Conditions", Kind::UInt),
            (
                "m_lPremise_Reputation",
                "Minimum reputation",
                "Conditions",
                Kind::Int,
            ),
            (
                "m_lPremise_RepuMax",
                "Maximum reputation",
                "Conditions",
                Kind::Int,
            ),
            ("m_ulGender", "Gender", "Conditions", Kind::UInt),
            ("m_bRcvByTeam", "Shared quest", "Conditions", Kind::Bool),
            (
                "m_bAutoDeliver",
                "Auto accept",
                "Conditions",
                Kind::Bool,
            ),
            ("m_enumMethod", "Completion method", "Objectives", Kind::UInt),
            ("m_enumFinishType", "Turn-in method", "Objectives", Kind::UInt),
            ("m_ulGoldWanted", "Required coins", "Objectives", Kind::UInt),
            ("m_ulWaitTime", "Wait time (seconds)", "Objectives", Kind::UInt),
            ("m_ulReachLevel", "Reach a level", "Objectives", Kind::UInt),
            (
                "m_ulReachReincarnationCount",
                "Required reincarnations",
                "Objectives",
                Kind::UInt,
            ),
            (
                "m_ulReachRealmLevel",
                "Reach sky level",
                "Objectives",
                Kind::UInt,
            ),
            (
                "m_ulPremReincarnationMin",
                "Minimum reincarnations",
                "Conditions",
                Kind::UInt,
            ),
            (
                "m_ulPremReincarnationMax",
                "Maximum reincarnations",
                "Conditions",
                Kind::UInt,
            ),
            ("m_iVIPLevelMin", "Minimum VIP", "Conditions", Kind::Int),
            ("m_iVIPLevelMax", "Maximum VIP", "Conditions", Kind::Int),
            ("m_ulNPCToProtect", "Protected NPC ID", "Objectives", Kind::UInt),
            (
                "m_ulProtectTimeLen",
                "Protection time (seconds)",
                "Objectives",
                Kind::UInt,
            ),
        ] {
            fields.push(self.number(get(name), label, section, kind));
        }
        for (count_key, data_key, max, label) in [
            (
                "m_ulPremise_Task_Count",
                "m_ulPremise_Tasks",
                20,
                "Previous quest (ID and failure flag)",
            ),
            (
                "m_ulMutexTaskCount",
                "m_ulMutexTasks",
                5,
                "Mutually exclusive quest",
            ),
            ("m_ulOccupations", "m_Occupations", 12, "Class ID"),
        ] {
            let count = self.u32(get(count_key)).min(max);
            for i in 0..count {
                fields.push(self.number(
                    get(data_key) + i as usize * 4,
                    &format!("{label} {}", i + 1),
                    "Conditions",
                    Kind::UInt,
                ));
            }
        }
        if self.bytes[get("m_bHasSign")] != 0 {
            let offset = self.take(NAME_UNITS * 2)?;
            fields.push(self.fixed_text(offset, NAME_UNITS, code, "Label", "Texts"));
        }
        for (name, stride) in [
            ("m_ulTimetable", 48),
            ("m_ulChangeKeyCnt", 9),
            ("m_ulPQExpCnt", 576),
            ("m_ulMonsterContribCnt", 16),
            ("m_ulDelvRegionCnt", 24),
            ("m_ulEnterRegionCnt", 24),
            ("m_ulLeaveRegionCnt", 24),
        ] {
            self.skip(self.u32(get(name)) as usize, stride)?;
        }
        for (key, label) in [
            ("m_ulPremItems", "Required item"),
            ("m_ulGivenItems", "Granted item"),
        ] {
            for index in 0..self.u32(get(key)) {
                self.item(&mut fields, "Conditions", &format!("{label} {}", index + 1))?;
            }
        }
        if self.bytes[get("m_bTeamwork")] != 0 {
            self.skip(self.u32(get("m_ulTeamMemsWanted")) as usize, 36)?;
        }
        self.skip(self.u32(get("m_iPremTitleNumTotal")) as usize, 4)?;
        for index in 0..self.u32(get("m_ulMonsterWanted")) {
            let offset = self.take(30)?;
            for (delta, label) in [
                (0, "Monster ID"),
                (4, "Quantity"),
                (8, "Drop item ID"),
                (12, "Item quantity"),
            ] {
                fields.push(self.number(
                    offset + delta,
                    &format!("Monster {} · {label}", index + 1),
                    "Objectives",
                    Kind::UInt,
                ));
            }
            fields.push(self.number(
                offset + 17,
                &format!("Monster {} · drop chance", index + 1),
                "Objectives",
                Kind::Float,
            ));
        }
        self.skip(self.u32(get("m_ulPlayerWanted")) as usize, 37)?;
        for index in 0..self.u32(get("m_ulItemsWanted")) {
            self.item(&mut fields, "Objectives", &format!("Item {}", index + 1))?;
        }
        for (name, stride) in [
            ("m_ulExpCnt", 576),
            ("m_ulTaskCharCnt", 128),
            ("m_ulReachSiteCnt", 24),
            ("m_ulLeaveSiteCnt", 24),
        ] {
            self.skip(self.u32(get(name)) as usize, stride)?;
        }
        self.award(&mut fields, "Success reward")?;
        self.award(&mut fields, "Failure reward")?;
        for (label, size) in [
            ("By time · success", 20),
            ("By time · failure", 20),
            ("By items · success", 24),
            ("By items · failure", 24),
        ] {
            let count = self.count()?;
            if count > 5 {
                return Err("Invalid reward tier count".into());
            }
            self.take(size)?;
            for i in 0..count {
                self.award(&mut fields, &format!("{label} · {}", i + 1))?;
            }
        }
        self.node_tail(id, title, fields, depth, version)
    }

    fn node_tail(
        &mut self,
        id: u32,
        title: String,
        mut fields: Vec<Field>,
        depth: usize,
        version: u32,
    ) -> Result<TaskNode> {
        let code = id as u16;
        for label in ["Description", "Success text", "Failure text", "Tribute"]
        {
            fields.push(self.text_field(code, label, "Texts", Kind::Text)?);
        }
        for section in [
            "Accept dialogue",
            "Abandon dialogue",
            "Item grant dialogue",
            "Completion dialogue",
            "Reward dialogue",
        ] {
            fields.push(self.talk(code, section, false)?);
        }
        let count = self.count()?;
        let mut children = Vec::new();
        for _ in 0..count {
            children.push(self.node(depth + 1, version)?);
        }
        Ok(TaskNode {
            id,
            name: title,
            fields,
            children,
        })
    }
}

pub(super) fn parse(bytes: &[u8], version: u32) -> Result<TaskNode> {
    let mut reader = Reader { bytes, pos: 0 };
    let task = reader.node(0, version)?;
    if reader.pos != bytes.len() {
        return Err("Quest record boundary does not match its index".into());
    }
    Ok(task)
}

pub(super) fn export_texts(
    node: &TaskNode,
    path: &str,
    emit: &mut dyn FnMut(String, &str) -> Result<()>,
) -> Result<()> {
    for (index, field) in node.fields.iter().enumerate() {
        if matches!(
            field.kind,
            Kind::Text
                | Kind::FixedText
                | Kind::Dialogue
                | Kind::Name
                | Kind::TalkLabel
                | Kind::Talk
                | Kind::CompactTalk
        ) {
            let field_path = field_text_path(path, index, field);
            if matches!(field.kind, Kind::Talk | Kind::CompactTalk) {
                blocks::export_talk(&field.value, &field_path, emit)?;
            } else {
                emit(field_path, &field.value)?;
            }
        }
    }
    for (index, child) in node.children.iter().enumerate() {
        export_texts(
            child,
            &format!("{path}/children/{index}/{}", child.id),
            emit,
        )?;
    }
    Ok(())
}

pub(in super::super) fn export_npc_talks(
    bytes: &[u8],
    emit: &mut dyn FnMut(String, &str) -> Result<()>,
) -> Result<()> {
    let mut reader = Reader { bytes, pos: 0 };
    for index in 0..reader.count()? {
        let id = bytes
            .get(reader.pos..reader.pos + 4)
            .ok_or("Truncated NPC dialogue")?;
        let id = u32::from_le_bytes(id.try_into().unwrap());
        let field = reader.talk(0, "", false)?;
        blocks::export_talk(&field.value, &format!("/npcTalks/{index}/{id}"), emit)?;
    }
    Ok(())
}

fn field_text_path(path: &str, index: usize, field: &Field) -> String {
    let key = match field.label.as_str() {
        "Name" => "name",
        "Description" => "description",
        "Success text" => "successText",
        "Failure text" => "failureText",
        "Tribute" => "tribute",
        "Label" => "signature",
        "Accept dialogue" => "deliveryDialogue",
        "Abandon dialogue" => "refusalDialogue",
        "Item grant dialogue" => "itemDialogue",
        "Completion dialogue" => "executionDialogue",
        "Reward dialogue" => "awardDialogue",
        _ => "text",
    };
    format!("{path}/fields/{index}/{key}")
}

pub(super) fn translate_texts(
    node: &TaskNode,
    path: &str,
    replace: &mut super::super::locales::ReplaceText<'_>,
    changes: &mut HashMap<usize, String>,
) -> Result<()> {
    for (index, field) in node.fields.iter().enumerate() {
        let path = field_text_path(path, index, field);
        let result = match field.kind {
            Kind::Talk | Kind::CompactTalk => blocks::translate_talk(&field.value, &path, replace)?,
            Kind::Text | Kind::FixedText | Kind::Dialogue | Kind::Name | Kind::TalkLabel => {
                replace(&path, &field.value)?
            }
            _ => None,
        };
        if let Some(text) = result {
            changes.insert(field.key, text);
        }
    }
    for (index, child) in node.children.iter().enumerate() {
        translate_texts(
            child,
            &format!("{path}/children/{index}/{}", child.id),
            replace,
            changes,
        )?;
    }
    Ok(())
}

pub(in super::super) fn translate_npc_talks(
    bytes: &[u8],
    replace: &mut super::super::locales::ReplaceText<'_>,
) -> Result<Vec<(usize, usize, Vec<u8>)>> {
    let mut reader = Reader { bytes, pos: 0 };
    let mut patches = Vec::new();
    for index in 0..reader.count()? {
        let start = reader.pos;
        let field = reader.talk(0, "", false)?;
        let id = reader.u32(start);
        if let Some(value) =
            blocks::translate_talk(&field.value, &format!("/npcTalks/{index}/{id}"), replace)?
        {
            patches.push((start, reader.pos, field.patch(&value)?));
        }
    }
    Ok(patches)
}
