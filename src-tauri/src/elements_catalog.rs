use super::{number, skip_dialogues, take, Field, List, Schema, R};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::OnceLock};

#[derive(Clone, Deserialize, Serialize)]
pub struct ElementsProfile {
    pub version: u16,
    pub variant: Option<String>,
}

#[derive(Serialize)]
pub struct ProfileOption {
    #[serde(flatten)]
    profile: ElementsProfile,
    client: String,
}

fn matching_profile<'a>(
    catalogue: &'a Catalogue,
    selected: &ElementsProfile,
) -> Option<&'a Profile> {
    catalogue
        .profiles
        .iter()
        .find(|profile| profile.version == selected.version && profile.variant == selected.variant)
}

pub(super) fn is_native(profile: &ElementsProfile) -> bool {
    profile.version == 145 && profile.variant.as_deref() == Some("lrpw")
}

pub(super) fn validate(profile: &ElementsProfile) -> R<()> {
    if is_native(profile) || matching_profile(catalogue()?, profile).is_some() {
        Ok(())
    } else {
        Err("Unknown elements.data schema profile".into())
    }
}

pub(super) fn options() -> R<Vec<ProfileOption>> {
    let mut options: Vec<_> = catalogue()?
        .profiles
        .iter()
        .map(|profile| ProfileOption {
            profile: ElementsProfile {
                version: profile.version,
                variant: profile.variant.clone(),
            },
            client: profile.client.clone(),
        })
        .collect();
    options.push(ProfileOption {
        profile: ElementsProfile {
            version: 145,
            variant: Some("lrpw".into()),
        },
        client: "1.5.5 (LRPW)".into(),
    });
    options.sort_by_key(|option| option.profile.version);
    Ok(options)
}

pub(super) fn parse_selected(
    bytes: &[u8],
    selected: &ElementsProfile,
) -> R<(Vec<List>, Option<usize>)> {
    let catalogue = catalogue()?;
    let profile =
        matching_profile(catalogue, selected).ok_or("Unknown elements.data schema profile")?;
    parse_profile(bytes, profile, catalogue)
}

#[derive(Deserialize)]
struct TableDefinition {
    name: String,
    fields: Vec<(String, String)>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Profile {
    version: u16,
    client: String,
    variant: Option<String>,
    header_bytes: usize,
    length_prefixes: BTreeMap<String, usize>,
    tables: Vec<String>,
}

#[derive(Deserialize)]
struct Catalogue {
    format: String,
    profiles: Vec<Profile>,
    schemas: BTreeMap<String, TableDefinition>,
}

fn catalogue() -> R<&'static Catalogue> {
    static CATALOGUE: OnceLock<R<Catalogue>> = OnceLock::new();
    CATALOGUE
        .get_or_init(|| {
            let catalogue: Catalogue = serde_json::from_str(include_str!("elements-catalog.json"))
                .map_err(|error| error.to_string())?;
            if catalogue.format != "pwforge-elements-schemas-v1" {
                return Err("Unsupported elements schema catalogue".into());
            }
            Ok(catalogue)
        })
        .as_ref()
        .map_err(Clone::clone)
}

impl TableDefinition {
    fn schema(&self) -> R<Schema> {
        let mut fields = Vec::with_capacity(self.fields.len());
        let mut offset: usize = 0;
        for (name, ty) in &self.fields {
            let (kind, size, unit) = match ty.as_str() {
                "int32" => ("i32", 4, 4),
                "float" => ("f32", 4, 4),
                other => {
                    let (kind, width) = other
                        .split_once(':')
                        .ok_or_else(|| format!("Unknown elements field type: {other}"))?;
                    let width = width.parse::<usize>().map_err(|error| error.to_string())?;
                    match kind {
                        "wstring" if width >= 2 && width % 2 == 0 => ("utf16", width, 2),
                        "string" if width > 0 => ("gbk", width, 1),
                        "byte" if width > 0 => ("u8", width, 1),
                        _ => return Err(format!("Invalid elements field type: {other}")),
                    }
                }
            };
            fields.push(Field {
                name: name.clone(),
                kind: kind.into(),
                offset,
                size,
                unit,
            });
            offset = offset
                .checked_add(size)
                .ok_or("Elements record size overflow")?;
        }
        if offset == 0 {
            return Err(format!("Empty elements table schema: {}", self.name));
        }
        Ok(Schema {
            name: self.name.clone(),
            size: offset,
            fields,
        })
    }
}

fn parse_profile(
    bytes: &[u8],
    profile: &Profile,
    catalogue: &Catalogue,
) -> R<(Vec<List>, Option<usize>)> {
    let mut position = 0;
    take(bytes, &mut position, profile.header_bytes)?;
    let mut lists = Vec::with_capacity(profile.tables.len());
    let mut talks_offset = None;
    for table in &profile.tables {
        if let Some(&suffix) = profile.length_prefixes.get(table) {
            take(bytes, &mut position, 4)?;
            let length = number(bytes, &mut position)?;
            take(
                bytes,
                &mut position,
                length
                    .checked_add(suffix)
                    .ok_or("Elements prefix size overflow")?,
            )?;
        }
        if table == "$dialogues" {
            talks_offset = Some(position);
            skip_dialogues(bytes, &mut position)?;
            continue;
        }
        let schema = catalogue
            .schemas
            .get(table)
            .ok_or_else(|| format!("Unknown elements table schema: {table}"))?
            .schema()?;
        let count = number(bytes, &mut position)?;
        let offset = position;
        take(
            bytes,
            &mut position,
            count
                .checked_mul(schema.size)
                .ok_or("Elements table size overflow")?,
        )
        .map_err(|error| format!("{}: {error}", schema.name))?;
        lists.push(List {
            schema,
            offset,
            count,
        });
    }
    if position != bytes.len() {
        return Err(format!(
            "{} bytes remain after the last list",
            bytes.len() - position
        ));
    }
    Ok((lists, talks_offset))
}

pub(super) fn parse(bytes: &[u8], version: u16) -> R<(Vec<List>, Option<usize>)> {
    let catalogue = catalogue()?;
    let mut errors = Vec::new();
    for profile in catalogue
        .profiles
        .iter()
        .filter(|profile| profile.version == version)
    {
        match parse_profile(bytes, profile, catalogue) {
            Ok(document) => return Ok(document),
            Err(error) => {
                let variant = profile.variant.as_deref().unwrap_or("default");
                errors.push(format!("{} ({variant}): {error}", profile.client));
            }
        }
    }
    if errors.is_empty() {
        Err(format!("Unsupported elements.data version {version}"))
    } else {
        Err(format!(
            "Cannot read elements.data version {version}: {}",
            errors.join(" · ")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_profiles_parse_with_nonempty_tables_and_prefixes() {
        let catalogue = catalogue().unwrap();
        for profile in &catalogue.profiles {
            let mut bytes = vec![0; profile.header_bytes];
            bytes[..2].copy_from_slice(&profile.version.to_le_bytes());
            let mut expected = Vec::new();
            for table in &profile.tables {
                if let Some(&suffix) = profile.length_prefixes.get(table) {
                    bytes.extend(42u32.to_le_bytes());
                    bytes.extend(3u32.to_le_bytes());
                    bytes.extend([1, 2, 3]);
                    bytes.resize(bytes.len() + suffix, 0);
                }
                if table == "$dialogues" {
                    bytes.extend(0u32.to_le_bytes());
                    continue;
                }
                let schema = catalogue.schemas[table].schema().unwrap();
                bytes.extend(1u32.to_le_bytes());
                expected.push(bytes.len());
                bytes.resize(bytes.len() + schema.size, 0);
            }
            let (lists, talks_offset) = parse_profile(&bytes, profile, catalogue).unwrap();
            assert!(talks_offset.is_some());
            assert_eq!(
                lists.iter().map(|list| list.offset).collect::<Vec<_>>(),
                expected
            );
            bytes.pop();
            assert!(parse_profile(&bytes, profile, catalogue).is_err());
        }
    }
}
