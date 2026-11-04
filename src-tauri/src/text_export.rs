use super::{elements, encode_text, err, ide, ide_search, report, tasks, Result};
use regex::Regex;
use serde::Serialize;
use std::{
    io::{BufWriter, Write},
    sync::OnceLock,
};

#[derive(Serialize)]
struct Segment<'a> {
    color: Option<&'a str>,
    text: &'a str,
}

fn segments(text: &str) -> Vec<Segment<'_>> {
    static COLORS: OnceLock<Regex> = OnceLock::new();
    let colors = COLORS.get_or_init(|| Regex::new(r"\^([0-9A-Fa-f]{6})").unwrap());
    let mut out = Vec::new();
    let mut start = 0;
    let mut color = None;
    for code in colors.find_iter(text) {
        if code.start() > start || color.is_some() {
            out.push(Segment {
                color,
                text: &text[start..code.start()],
            });
        }
        color = Some(&text[code.start() + 1..code.end()]);
        start = code.end();
    }
    out.push(Segment {
        color,
        text: &text[start..],
    });
    out
}

#[derive(Serialize)]
struct TextEntry<'a> {
    file: &'a str,
    path: String,
    segments: Vec<Segment<'a>>,
}

#[derive(Serialize)]
struct ExportError {
    file: String,
    error: String,
}
#[derive(Serialize)]
pub struct ExportResult {
    count: usize,
    skipped: usize,
    path: String,
}

fn translatable(parts: &[Segment<'_>]) -> bool {
    static CODE: OnceLock<Regex> = OnceLock::new();
    let code = CODE.get_or_init(|| {
        Regex::new(r"(?i)^(?:[a-z]{1,3}\d{1,4}|[a-z0-9]+(?:_[a-z0-9]+)+)$").unwrap()
    });
    let text: String = parts.iter().map(|part| part.text).collect();
    let text = text.trim();
    text.chars().any(char::is_alphabetic)
        && !text.eq_ignore_ascii_case("RootNode")
        && !code.is_match(text)
        && !text.starts_with(['#', '<', '[', '{'])
        && !(text.contains(['/', '\\']) && !text.contains(char::is_whitespace))
}

fn territory_texts(
    bytes: &[u8],
    nations: bool,
    emit: &mut dyn FnMut(String, usize, &str) -> Result<()>,
) -> Result<()> {
    let mut pos = if bytes.starts_with(b"MOXB") { 4 } else { 0 };
    fn take<'a>(bytes: &'a [u8], pos: &mut usize, len: usize) -> Result<&'a [u8]> {
        let end = pos
            .checked_add(len)
            .ok_or("Неверный размер файла территорий")?;
        let slice = bytes.get(*pos..end).ok_or("Файл территорий обрезан")?;
        *pos = end;
        Ok(slice)
    }
    fn number(bytes: &[u8], pos: &mut usize) -> Result<u32> {
        Ok(u32::from_le_bytes(take(bytes, pos, 4)?.try_into().unwrap()))
    }
    if nations {
        take(bytes, &mut pos, 8)?;
    }
    let count = number(bytes, &mut pos)?;
    for row in 0..count {
        let offset = pos;
        let name = take(bytes, &mut pos, 32)?;
        let units: Vec<_> = name
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .take_while(|&unit| unit != 0)
            .collect();
        let id = number(bytes, &mut pos)?;
        take(bytes, &mut pos, if nations { 72 } else { 16 })?;
        for stride in [8, 12, 4] {
            let count = number(bytes, &mut pos)? as usize;
            let size = count
                .checked_mul(stride)
                .ok_or("Неверный размер блока территории")?;
            take(bytes, &mut pos, size)?;
        }
        emit(
            format!("/territories/{row}/{id}/name"),
            offset,
            &String::from_utf16_lossy(&units),
        )?;
    }
    Ok(())
}

pub(super) fn translate_territories(
    bytes: &[u8],
    nations: bool,
    replace: &mut super::locales::ReplaceText<'_>,
) -> Result<Vec<u8>> {
    let mut updated = bytes.to_vec();
    territory_texts(bytes, nations, &mut |path, offset, text| {
        if let Some(value) = replace(&path, text)? {
            let units: Vec<_> = value.encode_utf16().collect();
            if units.len() > 15 || units.contains(&0) {
                return Err(format!(
                    "{path}: название должно помещаться в 15 кодовых единиц UTF-16"
                ));
            }
            let field = &mut updated[offset..offset + 32];
            field.fill(0);
            for (i, unit) in units.iter().enumerate() {
                field[i * 2..i * 2 + 2].copy_from_slice(&unit.to_le_bytes());
            }
        }
        Ok(())
    })?;
    Ok(updated)
}

#[derive(Clone, Copy)]
enum TextMode {
    Xml,
    Quoted,
    Parenthesized,
    Bare,
    Line,
}

fn text_file(
    bytes: &[u8],
    xml: bool,
    emit: &mut dyn FnMut(String, &str) -> Result<()>,
) -> Result<()> {
    let bytes = bytes
        .strip_prefix(b"MOXT")
        .or_else(|| bytes.strip_prefix(b"MOXB"))
        .unwrap_or(bytes);
    let (text, _) = ide_search::decode(bytes);
    scan_text_file(
        text.trim_start_matches('\u{feff}'),
        xml,
        &mut |path, _, value, _| emit(path, value),
    )
}

fn scan_text_file(
    text: &str,
    xml: bool,
    emit: &mut dyn FnMut(String, usize, &str, TextMode) -> Result<()>,
) -> Result<()> {
    static TABLE: OnceLock<Regex> = OnceLock::new();
    let table = TABLE.get_or_init(|| Regex::new(r"(?i)#_index\b[\s\S]*?#_begin\b").unwrap());
    if xml {
        static ATTRS: OnceLock<Regex> = OnceLock::new();
        let attrs=ATTRS.get_or_init(||Regex::new(r#"(?i)\b(?:text|string|hint|tooltip|caption|title|label)\s*=\s*(?:"([^"]*)"|'([^']*)')"#).unwrap());
        for attr in attrs.captures_iter(text) {
            let value = attr.get(1).or_else(|| attr.get(2)).unwrap();
            emit(
                format!("/attributes/{}", value.start()),
                value.start(),
                value.as_str(),
                TextMode::Xml,
            )?;
        }
    } else if let Some(header) = table.find(text) {
        let body = &text[header.end()..];
        static TOKENS: OnceLock<Regex> = OnceLock::new();
        let tokens = TOKENS.get_or_init(|| {
            Regex::new(r#"//[^\r\n]*|/\*[\s\S]*?\*/|"([^"]*)"|\(([^)]*)\)|([^\s;,]+)"#).unwrap()
        });
        let mut id = None;
        let mut seen = std::collections::HashSet::new();
        for token in tokens.captures_iter(body) {
            let Some(value) = token
                .get(1)
                .or_else(|| token.get(2))
                .or_else(|| token.get(3))
            else {
                continue;
            };
            if let Some(key) = id.take() {
                if seen.insert(key) {
                    let mode = if token.get(1).is_some() {
                        TextMode::Quoted
                    } else if token.get(2).is_some() {
                        TextMode::Parenthesized
                    } else {
                        TextMode::Bare
                    };
                    emit(
                        format!("/strings/{key}"),
                        header.end() + value.start(),
                        value.as_str(),
                        mode,
                    )?;
                }
            } else {
                id = value.as_str().parse::<i32>().ok();
            }
        }
    } else {
        let mut offset = 0;
        for (index, raw) in text.split_inclusive('\n').enumerate() {
            let line = raw.strip_suffix('\n').unwrap_or(raw);
            let line = line.strip_suffix('\r').unwrap_or(line);
            if !line.trim_start().starts_with("//") {
                emit(
                    format!("/lines/{}", index + 1),
                    offset,
                    line,
                    TextMode::Line,
                )?;
            }
            offset += raw.len();
        }
    }
    Ok(())
}

pub(super) fn translate_text_file(
    bytes: &[u8],
    xml: bool,
    replace: &mut super::locales::ReplaceText<'_>,
) -> Result<Vec<u8>> {
    let prefix = if bytes.starts_with(b"MOXT") || bytes.starts_with(b"MOXB") {
        4
    } else {
        0
    };
    let (decoded, encoding) = ide_search::decode(&bytes[prefix..]);
    let text = decoded.trim_start_matches('\u{feff}');
    let bom = &decoded[..decoded.len() - text.len()];
    let mut patches = Vec::new();
    scan_text_file(text, xml, &mut |path, start, old, mode| {
        let Some(value) = replace(&path, old)? else {
            return Ok(());
        };
        let invalid = || format!("{path}: перевод содержит недопустимый разделитель");
        let value = match mode {
            TextMode::Xml => {
                static AMP: OnceLock<Regex> = OnceLock::new();
                let amp = AMP.get_or_init(|| {
                    Regex::new(r"&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);|&").unwrap()
                });
                amp.replace_all(&value, |caps: &regex::Captures<'_>| {
                    if &caps[0] == "&" {
                        "&amp;".to_owned()
                    } else {
                        caps[0].to_owned()
                    }
                })
                .replace('<', "&lt;")
                .replace('"', "&quot;")
                .replace('\'', "&apos;")
            }
            TextMode::Quoted if value.contains('"') => return Err(invalid()),
            TextMode::Parenthesized if value.contains(')') => return Err(invalid()),
            TextMode::Line if value.contains(['\r', '\n']) => return Err(invalid()),
            TextMode::Bare => {
                if value.contains('"') {
                    return Err(invalid());
                }
                format!("\"{value}\"")
            }
            _ => value,
        };
        patches.push((start, start + old.len(), value));
        Ok(())
    })?;
    if patches.is_empty() {
        return Ok(bytes.to_vec());
    }
    let mut updated = bom.to_owned();
    let mut cursor = 0;
    for (start, end, value) in patches {
        updated.push_str(&text[cursor..start]);
        updated.push_str(&value);
        cursor = end;
    }
    updated.push_str(&text[cursor..]);
    let mut encoded = bytes[..prefix].to_vec();
    encoded.extend(encode_text(updated, encoding.to_owned())?);
    Ok(encoded)
}

#[tauri::command]
pub async fn ide_export_texts(
    id: u64,
    state: tauri::State<'_, ide::Ide>,
    app: tauri::AppHandle,
) -> Result<ExportResult> {
    let scope = state.scope(id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let source = scope.path()?;
        let target = super::locales::paths(&scope, "source")?;
        let parent = target
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .ok_or("Нет папки назначения")?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(err)?;
        let mut out = BufWriter::new(file.as_file_mut());
        write!(
            out,
            "{{\"version\":1,\"source\":{},\"entries\":[\n",
            serde_json::to_string(&source).map_err(err)?
        )
        .map_err(err)?;
        let mut errors = Vec::new();
        let mut count = 0;
        let total = scope.entries.len();
        let mut last_report = None;
        for (index, entry) in scope.entries.iter().enumerate() {
            let basename = entry
                .name
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or("")
                .to_ascii_lowercase();
            let task = matches!(basename.as_str(), "tasks.data" | "dyn_tasks.data");
            let elements = (basename.starts_with("elements") || basename.starts_with("gshop"))
                && basename.ends_with(".data");
            let territory = matches!(
                basename.as_str(),
                "domain.data" | "domain2.data" | "domain2_cross.data"
            );
            let plain = basename.ends_with(".txt") || basename.ends_with(".xml");
            if !(task || elements || territory || plain) {
                continue;
            }
            if last_report.map_or(true, |last: std::time::Instant| {
                last.elapsed().as_millis() >= 100
            }) {
                report(&app, "Экспорт текстов", &entry.name, index, total);
                last_report = Some(std::time::Instant::now());
            }
            let mut output_error = None;
            let mut emit = |path: String, text: &str| -> Result<()> {
                let segments = segments(text);
                if !translatable(&segments) {
                    return Ok(());
                }
                let write_entry = || -> Result<()> {
                    if count != 0 {
                        out.write_all(b",\n").map_err(err)?;
                    }
                    serde_json::to_writer(
                        &mut out,
                        &TextEntry {
                            file: &entry.path,
                            path,
                            segments,
                        },
                    )
                    .map_err(err)?;
                    count += 1;
                    Ok(())
                };
                let result = write_entry();
                if let Err(error) = &result {
                    output_error = Some(error.clone());
                }
                result
            };
            let result = ide::read(&scope, index).and_then(|bytes| {
                if task {
                    tasks::export_texts(&scope, index, &bytes, &mut emit)
                } else if elements {
                    elements::export_texts(&entry.name, bytes, &mut emit)
                } else if territory {
                    territory_texts(&bytes, basename != "domain.data", &mut |path, _, text| {
                        emit(path, text)
                    })
                } else {
                    text_file(&bytes, basename.ends_with(".xml"), &mut emit)
                }
            });
            if let Some(error) = output_error {
                return Err(error);
            }
            if let Err(error) = result {
                errors.push(ExportError {
                    file: entry.path.clone(),
                    error,
                });
            }
        }
        out.write_all(b"\n],\"errors\":").map_err(err)?;
        serde_json::to_writer(&mut out, &errors).map_err(err)?;
        out.write_all(b"}\n").map_err(err)?;
        out.flush().map_err(err)?;
        drop(out);
        file.as_file().sync_all().map_err(err)?;
        file.persist(&target).map_err(err)?;
        super::locales::invalidate(&target);
        report(&app, "Экспорт текстов", "Готово", total, total);
        Ok(ExportResult {
            count,
            skipped: errors.len(),
            path: target.to_string_lossy().into_owned(),
        })
    })
    .await
    .map_err(err)?
}
