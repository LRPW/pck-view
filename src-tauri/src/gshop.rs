use super::{number, take, Field, List, Schema, R};
use std::path::Path;

pub(super) fn filename(path: &Path) -> Option<u8> {
    let name = path
        .to_str()?
        .rsplit(['/', '\\'])
        .next()?
        .to_ascii_lowercase();
    match name.strip_suffix(".data")?.trim_end_matches(".edited") {
        "gshop" => Some(0),
        "gshop1" => Some(1),
        "gshop2" => Some(2),
        _ => None,
    }
}

fn field(fields: &mut Vec<Field>, name: impl Into<String>, kind: &str, size: usize, unit: usize) {
    let offset = fields.last().map_or(0, |f| f.offset + f.size);
    fields.push(Field {
        name: name.into(),
        kind: kind.into(),
        offset,
        size,
        unit,
    });
}

fn items(version: u8) -> Schema {
    let mut fields = Vec::new();
    for name in ["local_id", "main_type", "sub_type"] {
        field(&mut fields, name, "i32", 4, 4);
    }
    field(&mut fields, "icon", "gbk", 128, 1);
    for name in ["item_id", "num"] {
        field(&mut fields, name, "u32", 4, 4);
    }
    for slot in 0..4 {
        for name in [
            "price",
            "end_time",
            "time",
            "start_time",
            "type",
            "day",
            "status",
            "flag",
        ]
        .into_iter()
        .take(if version == 0 { 3 } else { 8 })
        {
            field(
                &mut fields,
                format!("buy[{slot}].{name}"),
                if name == "type" { "i32" } else { "u32" },
                4,
                4,
            );
        }
        if version >= 5 {
            field(
                &mut fields,
                format!("buy[{slot}].min_vip_level"),
                "u32",
                4,
                4,
            );
        }
    }
    if version == 0 {
        field(&mut fields, "status", "i32", 4, 4);
    }
    field(&mut fields, "desc", "utf16", 1024, 2);
    field(&mut fields, "name", "utf16", 64, 2);
    if version >= 2 {
        for name in ["idGift", "iGiftNum", "iGiftTime"] {
            field(&mut fields, name, "u32", 4, 4);
        }
    }
    if version >= 3 {
        field(&mut fields, "iLogPrice", "u32", 4, 4);
    }
    if version >= 4 {
        field(&mut fields, "owner_npcs", "u32", 32, 4);
    }
    if version >= 5 {
        for name in ["buy_times_limit", "buy_times_limit_mode"] {
            field(&mut fields, name, "i32", 4, 4);
        }
    }
    if version >= 6 {
        field(&mut fields, "class", "i32", 4, 4);
    }
    let size = fields.last().map_or(0, |f| f.offset + f.size);
    Schema {
        name: "Products".into(),
        size,
        fields,
    }
}

fn names(name: String, offset: usize, count: usize) -> List {
    let mut fields = Vec::new();
    field(&mut fields, "name", "utf16", 128, 2);
    List {
        schema: Schema {
            name,
            size: 128,
            fields,
        },
        offset,
        count,
    }
}

fn parse_layout(bytes: &[u8], version: u8, trailer: bool) -> R<Vec<List>> {
    let mut pos = 4;
    let count = number(bytes, &mut pos)?;
    let schema = items(version);
    let offset = pos;
    take(
        bytes,
        &mut pos,
        count.checked_mul(schema.size).ok_or("Product size")?,
    )?;
    let mut lists = vec![List {
        schema,
        offset,
        count,
    }];
    for category in 0..9 {
        if category == 8 && (pos == bytes.len() || trailer) {
            break;
        }
        lists.push(names(format!("Category {category}"), pos, 1));
        take(bytes, &mut pos, 128)?;
        let count = number(bytes, &mut pos)?;
        if count > 9 {
            return Err("Invalid shop subcategory count".into());
        }
        lists.push(names(format!("Subcategories {category}"), pos, count));
        take(
            bytes,
            &mut pos,
            count.checked_mul(128).ok_or("Subcategory size")?,
        )?;
    }
    if !trailer && pos != bytes.len() {
        return Err("Trailing data after categories".into());
    }
    Ok(lists)
}

pub(super) fn parse_version(bytes: &[u8], shop: u8, requested: Option<u8>) -> R<(Vec<List>, u8)> {
    if let Some(version) = requested {
        if version > 7 {
            return Err("Unsupported GShop version".into());
        }
        return parse_layout(bytes, version, false)
            .or_else(|error| {
                if shop == 2 && version == 5 {
                    parse_layout(bytes, version, true)
                } else {
                    Err(error)
                }
            })
            .map(|lists| (lists, version));
    }

    // Versions 6 and 7 share a layout. Prefer 6 when detecting it.
    for version in [5, 4, 6, 3, 2, 1, 0] {
        if let Ok(lists) = parse_layout(bytes, version, false) {
            return Ok((lists, version));
        }
    }
    if shop == 2 {
        if let Ok(lists) = parse_layout(bytes, 5, true) {
            return Ok((lists, 5));
        }
    }
    Err("Unsupported or corrupted gshop.data format".into())
}

pub(super) fn export_server(bytes: &[u8], list: &List) -> R<Vec<u8>> {
    let client = &list.schema;
    let server = items(5);
    let mut result = bytes.get(..8).ok_or("Missing shop header")?.to_vec();
    for index in 0..list.count {
        let start = list.offset + index * client.size;
        let item = bytes
            .get(start..start + client.size)
            .ok_or("Truncated shop record")?;
        for field in &server.fields {
            if matches!(field.name.as_str(), "icon" | "desc" | "name") {
                continue;
            }
            if let Some(source) = client
                .fields
                .iter()
                .find(|source| source.name == field.name)
            {
                result.extend_from_slice(&item[source.offset..source.offset + source.size]);
            } else {
                // Older client records have no VIP fields.
                result.resize(result.len() + field.size, 0);
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_gshop_layouts_and_preserves_explicit_version_seven() {
        let sizes = [1288, 1364, 1376, 1380, 1412, 1436, 1440, 1440];
        for (version, size) in sizes.into_iter().enumerate() {
            let mut bytes = vec![0; 8 + size + 8 * 132];
            bytes[4..8].copy_from_slice(&1u32.to_le_bytes());
            let (lists, detected) = parse_version(&bytes, 0, None).unwrap();
            assert_eq!(detected, version.min(6) as u8);
            assert_eq!(lists[0].schema.size, size);
            assert_eq!(
                parse_version(&bytes, 0, Some(version as u8)).unwrap().1,
                version as u8
            );
            assert!(parse_version(&bytes, 0, Some(8)).is_err());
        }
    }

    #[test]
    fn reads_ninth_category_when_present() {
        let mut bytes = vec![0; 8 + 1288 + 9 * 132];
        bytes[4..8].copy_from_slice(&1u32.to_le_bytes());
        let (lists, version) = parse_version(&bytes, 0, None).unwrap();
        assert_eq!(version, 0);
        assert_eq!(lists.len(), 19);
        bytes.pop();
        assert!(parse_version(&bytes, 0, Some(0)).is_err());
    }
}
