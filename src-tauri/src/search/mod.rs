use super::*;

#[derive(Serialize)]
pub(super) struct SearchResults {
    matches: Vec<SearchHit>,
    errors: Vec<String>,
    truncated: bool,
    cancelled: bool,
}
#[derive(Clone, Serialize)]
pub(super) struct SearchHit {
    index: usize,
    line: usize,
    column: usize,
    start: usize,
    end: usize,
    preview: String,
    before: String,
    matched: String,
    after: String,
    encoding: String,
}
pub(super) fn collect_hits(text: &str, matcher: &regex::Regex, index: usize, encoding: &str, hits: &mut Vec<SearchHit>) -> bool {
    collect_hits_cancellable(text, matcher, index, encoding, hits, &|| false)
}
pub(super) fn collect_hits_cancellable(text: &str, matcher: &regex::Regex, index: usize, encoding: &str, hits: &mut Vec<SearchHit>, cancelled: &dyn Fn() -> bool) -> bool {
    let mut cursor = 0;
    let mut offset = 0;
    let mut line = 1;
    let mut line_start = 0;
    for m in matcher.find_iter(text) {
        if cancelled() { return false; }
        if hits.len() >= 5000 { return true; }
        let between = &text[cursor..m.start()];
        offset += between.encode_utf16().count();
        line += between.bytes().filter(|&b| b == b'\n').count();
        if let Some(pos) = between.rfind('\n') { line_start = cursor + pos + 1; }
        let before: String = text[line_start..m.start()].chars().rev().take(100).collect::<Vec<_>>().into_iter().rev().collect();
        let matched: String = m.as_str().chars().take(160).collect();
        let after: String = text[m.end()..].chars().take_while(|&c| c != '\n' && c != '\r').take(120).collect();
        let end = offset + m.as_str().encode_utf16().count();
        hits.push(SearchHit {
            index,
            line,
            column: text[line_start..m.start()].chars().count() + 1,
            start: offset,
            end,
            preview: format!("{}{}{}", before, matched, after),
            before,
            matched,
            after,
            encoding: encoding.into(),
        });
        cursor = m.start();
    }
    false
}

#[derive(Default)]
pub(super) struct SearchControl(std::sync::Mutex<std::collections::HashMap<u64, Arc<std::sync::atomic::AtomicU64>>>);
impl SearchControl {
    pub(super) fn token(&self, id: u64) -> Arc<std::sync::atomic::AtomicU64> {
        let mut tokens = self.0.lock().unwrap_or_else(|error| error.into_inner());
        tokens.retain(|key, token| *key >= id.saturating_sub(60_000) || Arc::strong_count(token) > 1);
        tokens.entry(id).or_insert_with(|| Arc::new(std::sync::atomic::AtomicU64::new(0))).clone()
    }
}
#[derive(Clone, Serialize)]
struct SearchBatch<'a> {
    search_id: u64,
    matches: &'a [SearchHit],
}
#[tauri::command]
pub(super) async fn cancel_search(search_id: u64, control: tauri::State<'_, SearchControl>) -> Result<()> {
    control.token(search_id).store(search_id, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}
pub(super) fn known_binary(name: &str) -> bool {
    let extension = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    matches!(extension.as_str(), "7z" | "zip" | "rar" | "gz" | "pck" | "pkx" |
        "dds" | "tga" | "png" | "jpg" | "jpeg" | "bmp" | "gif" | "ico" |
        "wav" | "mp3" | "ogg" | "flac" | "mp4" | "avi" | "bik" |
        "ttf" | "otf" | "exe" | "dll" | "pdb" | "data" | "dat" | "sev" | "nmd" |
        "stck" | "ski" | "bon" | "mox" | "ecm" | "smd" | "chf" | "chd" | "lit" | "bmd")
}
pub(super) fn content_matcher(query: String, regexp: bool, case_sensitive: bool, whole_word: bool) -> Result<regex::Regex> {
    if query.is_empty() { return Err("Enter a search query".into()); }
    let pattern = if regexp { query } else { regex::escape(&query) };
    let pattern = if whole_word { format!(r"\b(?:{})\b", pattern) } else { pattern };
    regex::RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive).multi_line(true).build().map_err(err)
}
#[tauri::command]
pub(super) async fn search_contents(
    search_id: u64, control: tauri::State<'_, SearchControl>, query: String, regexp: bool, case_sensitive: bool, whole_word: bool,
    encoding: String, include_binary: bool, state: tauri::State<'_, App>, app: tauri::AppHandle,
) -> Result<SearchResults> {
    let matcher = content_matcher(query, regexp, case_sensitive, whole_word)?;
    let state = state.inner().clone();
    let cancellation = control.token(search_id);
    background(app, "Content search", move |app| {
        let archive = state.0.lock().map_err(err)?.as_ref().ok_or("Open an archive")?.clone();
        let candidates: Vec<usize> = archive.entries.iter().enumerate()
            .filter(|(_, entry)| include_binary || !known_binary(&entry.name))
            .map(|(index, _)| index).collect();
        let total = candidates.len();
        let mut pck = File::open(&archive.path).map_err(err)?;
        let mut pkx: Option<File> = None;
        let mut found = Vec::new();
        let mut truncated = false;
        let mut cancelled = false;
        let mut sent = 0;
        let mut last_emit = std::time::Instant::now();
        let mut errors = Vec::new();
        report(&app, "Content search", "Checking files", 0, total);
        for (position, index) in candidates.into_iter().enumerate() {
            if cancellation.load(std::sync::atomic::Ordering::Relaxed) == search_id {
                cancelled = true;
                break;
            }
            let entry = &archive.entries[index];
            let read = (|| -> Result<Vec<u8>> {
                if let Some(data) = &entry.data { return Ok(data.clone()); }
                if entry.len > 256 * 1024 * 1024 { return Err("Search limit: 256 MiB per file".into()); }
                let offset = entry.offset as u64;
                let len = entry.packed.min(entry.len) as usize;
                let first = if offset < SPLIT { len.min((SPLIT - offset) as usize) } else { 0 };
                let mut packed = vec![0; len];
                if first > 0 {
                    pck.seek(SeekFrom::Start(offset)).map_err(err)?;
                    pck.read_exact(&mut packed[..first]).map_err(err)?;
                }
                if first < len {
                    if pkx.is_none() { pkx = Some(File::open(archive.path.with_extension("pkx")).map_err(err)?); }
                    let file = pkx.as_mut().unwrap();
                    file.seek(SeekFrom::Start(offset + first as u64 - SPLIT)).map_err(err)?;
                    file.read_exact(&mut packed[first..]).map_err(err)?;
                }
                archive.decode_entry(entry, packed)
            })();
            let data = match read {
                Ok(data) => data,
                Err(error) => {
                    errors.push(format!("{}: {}", archive.entries[index].name, error));
                    report(&app, "Content search", &archive.entries[index].name, position + 1, total);
                    continue;
                }
            };
            if cancellation.load(std::sync::atomic::Ordering::Relaxed) == search_id {
                cancelled = true;
                break;
            }
            let codec = match encoding.as_str() {
                "utf-8" => encoding_rs::UTF_8,
                "gbk" => encoding_rs::GBK,
                "utf-16le" => encoding_rs::UTF_16LE,
                "utf-16be" => encoding_rs::UTF_16BE,
                "auto" => {
                    if data.starts_with(&[255, 254]) { encoding_rs::UTF_16LE } else if data.starts_with(&[254, 255]) { encoding_rs::UTF_16BE } else {
                        let sample = &data[..data.len().min(4096)];
                        let odd = sample.iter().skip(1).step_by(2).filter(|&&b| b == 0).count();
                        let even = sample.iter().step_by(2).filter(|&&b| b == 0).count();
                        if sample.len() >= 16 && odd > sample.len() / 4 && even < sample.len() / 20 { encoding_rs::UTF_16LE } else if sample.len() >= 16 && even > sample.len() / 4 && odd < sample.len() / 20 { encoding_rs::UTF_16BE } else if std::str::from_utf8(&data).is_ok() { encoding_rs::UTF_8 } else { encoding_rs::GBK }
                    }
                }
                _ => return Err("Unknown search encoding".into()),
            };
            let (text, _) = codec.decode_without_bom_handling(&data);
            let encoding = if codec == encoding_rs::UTF_16LE { "utf-16le" } else if codec == encoding_rs::UTF_16BE { "utf-16be" } else if codec == encoding_rs::GBK { "gbk" } else { "utf-8" };
            truncated = collect_hits(&text, &matcher, index, encoding, &mut found);
            if found.len() > sent && (sent == 0 || last_emit.elapsed().as_millis() >= 75 || truncated) {
                let _ = app.emit("pck-search-results", SearchBatch { search_id, matches: &found[sent..] });
                sent = found.len();
                last_emit = std::time::Instant::now();
            }
            if truncated { break; }
            if position % 32 == 0 || position + 1 == total {
                report(&app, "Content search", &archive.entries[index].name, position + 1, total);
            }
        }
        if found.len() > sent { let _ = app.emit("pck-search-results", SearchBatch { search_id, matches: &found[sent..] }); }
        cancelled |= cancellation.load(std::sync::atomic::Ordering::Relaxed) == search_id;
        Ok(SearchResults { matches: found, errors, truncated, cancelled })
    }).await
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod cancellation_tests {
    use super::*;
    use std::sync::atomic::Ordering;
    #[test]
    fn cancelling_overlapping_searches_keeps_both_cancelled() {
        let control = SearchControl::default();
        let first = control.token(100);
        let second = control.token(101);
        control.token(100).store(100, Ordering::Relaxed);
        control.token(101).store(101, Ordering::Relaxed);
        assert_eq!(first.load(Ordering::Relaxed), 100);
        assert_eq!(second.load(Ordering::Relaxed), 101);
        assert_eq!(control.token(102).load(Ordering::Relaxed), 0);
    }
    #[test]
    fn cancellation_before_worker_starts_is_preserved() {
        let control = SearchControl::default();
        control.token(200).store(200, Ordering::Relaxed);
        assert_eq!(control.token(200).load(Ordering::Relaxed), 200);
    }
    #[test]
    fn cancelled_collection_does_not_add_matches() {
        let matcher = content_matcher("hello".into(), false, true, false).unwrap();
        let mut hits = Vec::new();
        assert!(!collect_hits_cancellable("hello hello", &matcher, 0, "utf-8", &mut hits, &|| true));
        assert!(hits.is_empty());
    }
    #[test]
    fn engine_binary_resources_are_excluded() {
        for name in ["model.STCK", "terrain.sev", "skin.ski", "unknown.data", "image.dds"] {
            assert!(known_binary(name), "{name}");
        }
        assert!(!known_binary("dialog.xml"));
    }
}
