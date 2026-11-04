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

fn items(vip: bool) -> Schema {
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
        ] {
            field(
                &mut fields,
                format!("buy[{slot}].{name}"),
                if name == "type" { "i32" } else { "u32" },
                4,
                4,
            );
        }
        if vip {
            field(
                &mut fields,
                format!("buy[{slot}].min_vip_level"),
                "u32",
                4,
                4,
            );
        }
    }
    field(&mut fields, "desc", "utf16", 1024, 2);
    field(&mut fields, "name", "utf16", 64, 2);
    for name in ["idGift", "iGiftNum", "iGiftTime", "iLogPrice"] {
        field(&mut fields, name, "u32", 4, 4);
    }
    field(&mut fields, "owner_npcs", "u32", 32, 4);
    if vip {
        for name in ["buy_times_limit", "buy_times_limit_mode"] {
            field(&mut fields, name, "i32", 4, 4);
        }
    }
    let size = fields.last().map_or(0, |f| f.offset + f.size);
    Schema {
        name: "Товары".into(),
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

fn parse_layout(bytes: &[u8], vip: bool, trailer: bool) -> R<Vec<List>> {
    let mut pos = 4;
    let count = number(bytes, &mut pos)?;
    let schema = items(vip);
    let offset = pos;
    take(
        bytes,
        &mut pos,
        count.checked_mul(schema.size).ok_or("Размер товаров")?,
    )?;
    let mut lists = vec![List {
        schema,
        offset,
        count,
    }];
    for category in 0..8 {
        lists.push(names(format!("Категория {category}"), pos, 1));
        take(bytes, &mut pos, 128)?;
        let count = number(bytes, &mut pos)?;
        lists.push(names(format!("Подкатегории {category}"), pos, count));
        take(
            bytes,
            &mut pos,
            count.checked_mul(128).ok_or("Размер подкатегорий")?,
        )?;
    }
    if !trailer && pos != bytes.len() {
        return Err("Лишние данные после категорий".into());
    }
    Ok(lists)
}

pub(super) fn parse(bytes: &[u8], shop: u8) -> R<Vec<List>> {
    parse_layout(bytes, true, false)
        .or_else(|_| parse_layout(bytes, false, false))
        .or_else(|error| {
            if shop == 2 {
                parse_layout(bytes, true, true)
            } else {
                Err(error)
            }
        })
        .map_err(|_| "Неподдерживаемый или повреждённый формат gshop.data".into())
}
