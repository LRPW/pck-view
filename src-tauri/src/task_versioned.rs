use super::{Field, Kind, Reader, Result, TaskNode};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

#[path = "task_schema_generated.rs"]
mod generated;

struct Schema<'a> {
    reader: Reader<'a>,
    values: HashMap<String, i64>,
    positions: HashMap<String, usize>,
    structural: RefCell<HashSet<usize>>,
    fields: Vec<Field>,
    scope: String,
    switches: HashMap<String, Vec<u8>>,
    operations: usize,
}

#[allow(non_snake_case)]
impl<'a> Schema<'a> {
    fn new(bytes: &'a [u8], pos: usize) -> Self {
        Self {
            reader: Reader { bytes, pos },
            values: HashMap::new(),
            positions: HashMap::new(),
            structural: RefCell::default(),
            fields: Vec::new(),
            scope: String::new(),
            switches: HashMap::new(),
            operations: 0,
        }
    }

    fn limit(&self, count: i64) -> Result<i64> {
        if !(0..=1_000_000).contains(&count) {
            return Err("Invalid quest array size".into());
        }
        Ok(count)
    }

    fn take(&mut self, size: usize) -> Result<usize> {
        self.operations += 1;
        if self.operations > 1_000_000 {
            return Err("Quest schema is too large".into());
        }
        self.reader.take(size)
    }

    fn key(&self, name: &str) -> String {
        format!("{}{name}", self.scope)
    }

    fn scope(&mut self, name: &str, body: impl FnOnce(&mut Self) -> Result<()>) -> Result<()> {
        let length = self.scope.len();
        self.scope.push_str(name);
        self.scope.push('.');
        let result = body(self);
        self.scope.truncate(length);
        result
    }

    fn N(&self, name: &str) -> i64 {
        let key = self.key(name);
        if let Some(&position) = self.positions.get(&key) {
            self.structural.borrow_mut().insert(position);
        }
        self.values.get(&key).copied().unwrap_or_default()
    }

    fn Set(&mut self, name: &str, value: i64) {
        let key = self.key(name);
        self.positions.remove(&key);
        self.values.insert(key, value);
    }

    fn Switch(&self, version: i64, parameter: usize) -> i64 {
        let Some(bytes) = self.switches.get(&self.scope) else {
            return 0;
        };
        generated::SWITCHES
            .iter()
            .filter(|&&(_, min, max)| version >= min && (max == 0 || version <= max))
            .position(|&(name, _, _)| name == generated::SWITCH_PARAMS[parameter])
            .and_then(|bit| {
                bytes
                    .get(bit / 8)
                    .map(|byte| i64::from((byte >> (bit % 8)) & 1))
            })
            .unwrap_or_default()
    }

    fn number(&mut self, name: &str, size: usize, kind: Kind) -> Result<i64> {
        let start = self.take(size)?;
        let key = self.key(name);
        let field = self.reader.number(start, &key, self.section(), kind);
        let value = match kind {
            Kind::Bool => i64::from(self.reader.bytes[start]),
            Kind::Float => 0,
            _ => field
                .value
                .parse::<i64>()
                .map_err(|_| "Invalid numeric quest field")?,
        };
        self.values.insert(key.clone(), value);
        self.positions.insert(key, start);
        if name != "m_ID" && name != "m_usIDSpace" && !name.contains("Pointer") {
            self.fields.push(field);
        }
        Ok(value)
    }

    fn section(&self) -> &str {
        match self.scope.split('.').next().unwrap_or_default() {
            "m_Award_S" => "Success reward",
            "m_Award_F" => "Failure reward",
            "m_AwByRatio_S" => "By time · success",
            "m_AwByRatio_F" => "By time · failure",
            "m_AwByItems_S" => "By items · success",
            "m_AwByItems_F" => "By items · failure",
            name if name.starts_with("AwBy") => "Rewards",
            _ => "General",
        }
    }

    fn I16(&mut self, name: &str) -> Result<i64> {
        self.number(name, 2, Kind::Short)
    }
    fn I32(&mut self, name: &str) -> Result<i64> {
        self.number(name, 4, Kind::Int)
    }
    fn U32(&mut self, name: &str) -> Result<i64> {
        self.number(name, 4, Kind::UInt)
    }
    fn U8(&mut self, name: &str) -> Result<i64> {
        self.number(name, 1, Kind::Byte)
    }
    fn Bool(&mut self, name: &str) -> Result<i64> {
        self.number(name, 1, Kind::Bool)
    }
    fn F32(&mut self, name: &str) -> Result<i64> {
        self.number(name, 4, Kind::Float)
    }

    fn Bytes(&mut self, name: &str, size: i64) -> Result<()> {
        let size = self.limit(size)? as usize;
        let start = self.take(size)?;
        if name == "CombinedSwitches" {
            self.switches.insert(
                self.scope.clone(),
                self.reader.bytes[start..start + size].to_vec(),
            );
        }
        Ok(())
    }

    fn Str8(&mut self, name: &str, size: i64) -> Result<()> {
        self.Bytes(name, size)
    }

    fn Str16(&mut self, name: &str, units: i64) -> Result<()> {
        let units = self.limit(units)? as usize;
        let start = self.take(units * 2)?;
        if name == "m_szName" {
            let id = self.values.get("m_ID").copied().unwrap_or_default();
            self.fields.push(
                self.reader
                    .fixed_text(start, units, id as u16, "Name", "General"),
            );
        }
        Ok(())
    }
}

#[allow(non_snake_case)]
fn GetMaxTimetableSize(v: i64) -> i64 {
    if v < 69 {
        12
    } else {
        24
    }
}
#[allow(non_snake_case)]
fn GetMaxPremTaskCount(v: i64) -> i64 {
    if v < 90 {
        5
    } else {
        20
    }
}
#[allow(non_snake_case)]
fn GetMaxOccupations(v: i64) -> i64 {
    match v {
        ..=88 => 8,
        89..=119 => 10,
        120..=146 => 12,
        147..=186 => 14,
        187..=194 => 15,
        _ => 16,
    }
}
#[allow(non_snake_case)]
fn GetMaxAwardScales(v: i64) -> i64 {
    if v < 140 {
        5
    } else {
        6
    }
}
#[allow(non_snake_case)]
fn GetMaxMutexTasks(v: i64) -> i64 {
    if v < 215 {
        5
    } else {
        20
    }
}
#[allow(non_snake_case)]
fn GetMaxNeededTasks(v: i64) -> i64 {
    GetMaxMutexTasks(v)
}
#[allow(non_snake_case)]
fn GetCombinedSwitches(v: i64) -> i64 {
    let count = generated::SWITCHES
        .iter()
        .filter(|&&(_, min, max)| v >= min && (max == 0 || v <= max))
        .count();
    count.div_ceil(8) as i64
}

#[allow(non_snake_case)]
fn L_SPECIAL_PARAMETERS(v: &mut Schema<'_>, version: i64, count: i64) -> Result<()> {
    let (mut items, mut tasks) = (0, 0);
    for index in 0..v.limit(count)? {
        let name = format!("ParameterTypes[{index}]");
        v.I32(&name)?;
        let kind = v.N(&name);
        if (0..=14).contains(&kind) {
            let name = format!("Param{kind}");
            let value = v.I32(&name)?;
            if kind == 3 || kind == 6 {
                v.N(&name);
                if kind == 3 {
                    items = value;
                } else {
                    tasks = value;
                }
            }
        }
        if version >= 176 {
            v.I32(&format!("unk176[{index}]"))?;
        }
    }
    for index in 0..v.limit(items)? {
        v.I32(&format!("UseItemIDs[{index}]"))?;
    }
    for index in 0..v.limit(tasks)? {
        v.I32(&format!("CompleteTaskIDs[{index}]"))?;
    }
    if version >= 153 {
        for index in 0..v.limit(tasks)? {
            v.I32(&format!("CompleteTaskIDsSpace[{index}]"))?;
        }
    }
    Ok(())
}

#[allow(non_snake_case)]
fn L_RANDOM_DIALOG_GROUP_DATA(
    v: &mut Schema<'_>,
    _: i64,
    groups: i64,
    per_group: i64,
) -> Result<()> {
    let count = groups
        .checked_mul(per_group)
        .ok_or("Invalid dialogue group count")?;
    v.Bytes(
        "TextGroups",
        count
            .checked_mul(200)
            .ok_or("Invalid dialogue group size")?,
    )
}

impl Reader<'_> {
    pub(super) fn node_versioned(&mut self, depth: usize, version: u32) -> Result<TaskNode> {
        let mut schema = Schema::new(self.bytes, self.pos);
        generated::Fixed(&mut schema, i64::from(version))?;
        self.pos = schema.reader.pos;
        let id = schema
            .values
            .get("m_ID")
            .copied()
            .ok_or("Missing quest ID")? as u32;
        let title = schema
            .fields
            .iter()
            .find(|field| field.label == "Name")
            .ok_or("Missing quest name")?
            .value
            .clone();
        let structural = schema.structural.into_inner();
        schema
            .fields
            .retain(|field| !structural.contains(&field.key));
        self.node_tail(id, title, schema.fields, depth, version)
    }
}

#[cfg(test)]
pub(in super::super) fn synthetic_fixed_size(version: u32) -> Result<usize> {
    let bytes = vec![0; 64 * 1024];
    let mut schema = Schema::new(&bytes, 0);
    generated::Fixed(&mut schema, i64::from(version))?;
    Ok(schema.reader.pos)
}
