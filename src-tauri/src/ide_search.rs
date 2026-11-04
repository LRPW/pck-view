use super::{background, err, ide, project, search, Result};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::atomic::Ordering, time::Instant};
use tauri::Emitter;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Request {
    search_id: u64,
    scope_id: Option<u64>,
    module: String,
    directory: String,
    disk: bool,
    query: String,
    mask: String,
    regexp: bool,
    case_sensitive: bool,
    whole_word: bool,
}

#[derive(Clone, Serialize)]
struct Hit {
    source: Option<String>,
    path: String,
    hit: search::SearchHit,
}

#[derive(Serialize)]
pub(super) struct Outcome {
    matches: Vec<Hit>,
    cancelled: bool,
    truncated: bool,
    unreadable: usize,
}

fn mask_filter(mask: &str) -> Result<Option<regex::Regex>> {
    let patterns: Vec<_> = mask
        .split([',', ';'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| regex::escape(s).replace(r"\*", ".*").replace(r"\?", "."))
        .collect();
    if patterns.is_empty() {
        return Ok(None);
    }
    regex::RegexBuilder::new(&format!("^(?:{})$", patterns.join("|")))
        .case_insensitive(true)
        .build()
        .map(Some)
        .map_err(err)
}

fn folder_prefix(folder: &str) -> String {
    let normalized = folder.trim().replace('\\', "/");
    let relative = normalized.trim_matches('/');
    if relative.is_empty() { String::new() } else { format!("{}/", relative.to_lowercase()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_match_complete_filenames_and_accept_multiple_patterns() {
        let mask = mask_filter("*.xml, npc?.lua; readme.txt").unwrap().unwrap();
        assert!(mask.is_match("Dialog.XML"));
        assert!(mask.is_match("npc1.lua"));
        assert!(mask.is_match("readme.txt"));
        assert!(!mask.is_match("npc12.lua"));
        assert!(!mask.is_match("readme.txt.bak"));
    }
}

pub(super) fn decode(data: &[u8]) -> (std::borrow::Cow<'_, str>, &'static str) {
    let sample = &data[..data.len().min(4096)];
    let even = sample.iter().step_by(2).filter(|&&b| b == 0).count();
    let odd = sample
        .iter()
        .skip(1)
        .step_by(2)
        .filter(|&&b| b == 0)
        .count();
    let (codec, name) = if data.starts_with(&[255, 254])
        || (sample.len() >= 16 && odd > sample.len() / 4 && even < sample.len() / 20)
    {
        (encoding_rs::UTF_16LE, "utf-16le")
    } else if data.starts_with(&[254, 255])
        || (sample.len() >= 16 && even > sample.len() / 4 && odd < sample.len() / 20)
    {
        (encoding_rs::UTF_16BE, "utf-16be")
    } else if std::str::from_utf8(data).is_ok() {
        (encoding_rs::UTF_8, "utf-8")
    } else {
        (encoding_rs::GBK, "gbk")
    };
    (codec.decode_without_bom_handling(data).0, name)
}

#[tauri::command]
pub(super) async fn ide_search(
    request: Request,
    state: tauri::State<'_, ide::Ide>,
    control: tauri::State<'_, search::SearchControl>,
    app: tauri::AppHandle,
) -> Result<Outcome> {
    let matcher = search::content_matcher(
        request.query,
        request.regexp,
        request.case_sensitive,
        request.whole_word,
    )?;
    let mask = mask_filter(&request.mask)?;
    let scope = if request.disk {
        None
    } else {
        Some(state.scope(request.scope_id.ok_or("Выберите проект или архив")?)?)
    };
    let cancellation = control.token();
    background(app, "Поиск по содержимому", move |app| {
        let cancelled = || cancellation.load(Ordering::Relaxed) == request.search_id;
        let mut candidates = Vec::new();
        let mut project_read = None;
        let mut source = None;
        let allowed = |path: &str| {
            let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
            !search::known_binary(name) && mask.as_ref().is_none_or(|mask| mask.is_match(name))
        };
        if let Some(scope) = &scope {
            source = Some(scope.path()?);
            if let Some(manifest) = scope.manifest() {
                project_read = Some(project::search_reader(manifest)?);
            }
            let module = folder_prefix(&request.module);
            let directory = folder_prefix(&request.directory);
            for (index, entry) in scope.entries.iter().enumerate() {
                if cancelled() {
                    break;
                }
                let path = entry.path.replace('\\', "/");
                let normalized = path.to_lowercase();
                if normalized.starts_with(&module)
                    && (normalized.starts_with(&directory)
                        || entry.name.replace('\\', "/").to_lowercase().starts_with(&directory))
                    && allowed(&path)
                    && entry.size <= 256 * 1024 * 1024
                {
                    candidates.push((index, path));
                }
            }
        } else {
            let root = PathBuf::from(&request.directory)
                .canonicalize()
                .map_err(err)?;
            if !root.is_dir() {
                return Err("Выберите папку".into());
            }
            let mut directories = vec![root];
            while let Some(dir) = directories.pop() {
                if cancelled() {
                    break;
                }
                for entry in std::fs::read_dir(dir).map_err(err)? {
                    if cancelled() {
                        break;
                    }
                    let entry = entry.map_err(err)?;
                    let path = entry.path();
                    if super::reject_link(&path).is_err() {
                        continue;
                    }
                    let metadata = entry.metadata().map_err(err)?;
                    if metadata.is_dir() {
                        directories.push(path);
                    } else if metadata.is_file()
                        && metadata.len() <= 256 * 1024 * 1024
                        && allowed(&path.to_string_lossy())
                    {
                        candidates.push((0, path.to_string_lossy().into_owned()));
                    }
                }
            }
        }
        let mut result = Outcome {
            matches: vec![],
            cancelled: false,
            truncated: false,
            unreadable: 0,
        };
        let mut sent = 0;
        let mut last_emit = Instant::now();
        let total = candidates.len();
        for (position, (index, path)) in candidates.into_iter().enumerate() {
            if cancelled() {
                break;
            }
            let bytes = if let Some(read) = &mut project_read {
                read(&path)
            } else if let Some(scope) = &scope {
                ide::read(scope, index)
            } else {
                std::fs::read(&path).map_err(err)
            };
            if cancelled() {
                break;
            }
            if let Ok(bytes) = bytes {
                let (text, encoding) = decode(&bytes);
                let mut hits = Vec::new();
                let file_limit = search::collect_hits(&text, &matcher, index, encoding, &mut hits);
                let remaining = 5000 - result.matches.len();
                result.truncated = file_limit || hits.len() > remaining;
                result
                    .matches
                    .extend(hits.into_iter().take(remaining).map(|hit| Hit {
                        source: source.clone(),
                        path: path.clone(),
                        hit,
                    }));
            } else {
                result.unreadable += 1;
            }
            if last_emit.elapsed().as_millis() >= 100 || position + 1 == total {
                super::report(&app, "Поиск по содержимому", &path, position + 1, total);
                if sent < result.matches.len() {
                    let _ = app.emit(
                        "ide-search-batch",
                        (request.search_id, &result.matches[sent..]),
                    );
                    sent = result.matches.len();
                }
                last_emit = Instant::now();
            }
            if result.truncated || result.matches.len() >= 5000 {
                result.truncated = true;
                break;
            }
        }
        result.cancelled = cancelled();
        Ok(result)
    })
    .await
}
