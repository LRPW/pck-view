use super::{
    err, ide, locale, paths, reject_link, source, translated_path, Entry, Locale, Result, Segment,
    Source, LOCALE_WRITES,
};
use crate::app::translation::{translate, Settings};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, BufWriter, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock, RwLock,
    },
    time::Instant,
};
use tauri::Emitter;

#[derive(Clone, Default, Serialize)]
pub struct Progress {
    id: u64,
    language: String,
    completed: usize,
    total: usize,
    translated: usize,
    failed: usize,
}
pub(super) struct Job {
    stop: AtomicBool,
    progress: Mutex<Progress>,
    pub(super) live: RwLock<HashMap<usize, Arc<Vec<String>>>>,
}
pub(super) fn live_job(id: u64, language: &str) -> Result<Option<Arc<Job>>> {
    Ok(jobs()
        .lock()
        .map_err(err)?
        .get(&(id, language.to_owned()))
        .cloned())
}
type Jobs = HashMap<(u64, String), Arc<Job>>;
fn jobs() -> &'static Mutex<Jobs> {
    static JOBS: OnceLock<Mutex<Jobs>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Serialize)]
pub struct Outcome {
    progress: Progress,
    cancelled: bool,
    error: Option<String>,
}

fn journal_path(target: &Path) -> PathBuf {
    target.with_extension("pending.jsonl")
}
fn entries_index(locale: Locale) -> HashMap<(String, String), Entry> {
    locale
        .entries
        .into_iter()
        .map(|entry| ((entry.file.clone(), entry.path.clone()), entry))
        .collect()
}
fn persist(target: &Path, language: &str, entries: HashMap<(String, String), Entry>) -> Result<()> {
    let mut entries: Vec<_> = entries.into_values().collect();
    entries.sort_by(|a, b| (&a.file, &a.path).cmp(&(&b.file, &b.path)));
    let locale = Locale {
        version: 1,
        language: language.into(),
        entries,
    };
    let mut file = tempfile::NamedTempFile::new_in(target.parent().ok_or("Нет папки локалей")?)
        .map_err(err)?;
    {
        let mut out = BufWriter::new(file.as_file_mut());
        serde_json::to_writer(&mut out, &locale).map_err(err)?;
        out.flush().map_err(err)?;
    }
    file.as_file().sync_all().map_err(err)?;
    file.persist(target).map_err(err)?;
    Ok(())
}

fn compatible(entry: &Entry, source: &Entry) -> bool {
    entry.segments.len() == source.segments.len()
        && entry
            .source_segments
            .as_ref()
            .map_or(true, |parts| parts == &source.segments)
}

fn merge_checkpoint(target: &Path, language: &str, source: &Source) -> Result<()> {
    let journal = journal_path(target);
    if !journal.exists() {
        return Ok(());
    }
    reject_link(&journal)?;
    let _lock = LOCALE_WRITES.lock().map_err(err)?;
    let index: HashMap<_, _> = source
        .entries
        .iter()
        .map(|entry| ((entry.file.as_str(), entry.path.as_str()), entry))
        .collect();
    let mut entries = entries_index(locale(target, language)?);
    let mut changed = false;
    for line in BufReader::new(File::open(&journal).map_err(err)?).lines() {
        let line = line.map_err(err)?;
        let Ok(candidate) = serde_json::from_str::<Entry>(&line) else {
            continue;
        };
        let Some(original) = index.get(&(candidate.file.as_str(), candidate.path.as_str())) else {
            continue;
        };
        if !compatible(&candidate, original) {
            continue;
        }
        let key = (candidate.file.clone(), candidate.path.clone());
        if let Some(existing) = entries.get_mut(&key) {
            if !compatible(existing, original) {
                continue;
            }
            for (old, new) in existing.segments.iter_mut().zip(candidate.segments) {
                if old.text.is_empty() && !new.text.is_empty() {
                    old.text = new.text;
                    changed = true;
                }
            }
        } else {
            entries.insert(key, candidate);
            changed = true;
        }
    }
    if changed {
        persist(target, language, entries)?;
    }
    fs::remove_file(journal).map_err(err)?;
    Ok(())
}

type Group<'a> = (Vec<String>, Vec<(usize, &'a Entry)>);
fn work<'a>(source: &'a Source, existing: &HashMap<(String, String), Entry>) -> Vec<Group<'a>> {
    let by_key: HashMap<_, _> = existing
        .values()
        .map(|entry| ((entry.file.as_str(), entry.path.as_str()), entry))
        .collect();
    let mut groups: Vec<Group<'a>> = Vec::new();
    let mut seen: HashMap<Vec<String>, usize> = HashMap::new();
    for (row, entry) in source.entries.iter().enumerate() {
        let old = by_key.get(&(entry.file.as_str(), entry.path.as_str()));
        if old.is_some_and(|old| !compatible(old, entry)) {
            continue;
        }
        if !entry.segments.iter().enumerate().any(|(i, part)| {
            !part.text.trim().is_empty() && old.map_or(true, |old| old.segments[i].text.is_empty())
        }) {
            continue;
        }
        let texts = entry
            .segments
            .iter()
            .map(|part| part.text.clone())
            .collect::<Vec<_>>();
        if let Some(&index) = seen.get(&texts) {
            groups[index].1.push((row, entry));
        } else {
            seen.insert(texts.clone(), groups.len());
            groups.push((texts, vec![(row, entry)]));
        }
    }
    groups
}

fn write_group(out: &mut BufWriter<File>, group: &Group<'_>, texts: &[String]) -> Result<()> {
    for (_, entry) in &group.1 {
        let segments = entry
            .segments
            .iter()
            .zip(texts)
            .map(|(part, text)| Segment {
                color: part.color.clone(),
                text: if part.text.trim().is_empty() {
                    String::new()
                } else {
                    text.clone()
                },
            })
            .collect();
        let candidate = Entry {
            file: entry.file.clone(),
            path: entry.path.clone(),
            segments,
            source_segments: Some(entry.segments.clone()),
        };
        serde_json::to_writer(&mut *out, &candidate).map_err(err)?;
        out.write_all(b"\n").map_err(err)?;
    }
    Ok(())
}

fn publish(job: &Job, app: &tauri::AppHandle, progress: &Progress) {
    if let Ok(mut value) = job.progress.lock() {
        *value = progress.clone();
    }
    let _ = app.emit("locale-batch-progress", progress);
}

fn run(
    scope: ide::Scope,
    language: String,
    settings: Settings,
    job: &Job,
    app: &tauri::AppHandle,
) -> Result<Outcome> {
    let target = translated_path(&scope, &language)?;
    let source = source(&paths(&scope, "source")?)?;
    merge_checkpoint(&target, &language, &source)?;
    let existing = entries_index(locale(&target, &language)?);
    let groups = work(&source, &existing);
    let mut progress = job.progress.lock().map_err(err)?.clone();
    progress.total = groups.iter().map(|group| group.1.len()).sum();
    publish(job, app, &progress);
    if groups.is_empty() {
        return Ok(Outcome {
            progress,
            cancelled: false,
            error: None,
        });
    }
    let journal = journal_path(&target);
    let mut out = BufWriter::new(
        OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&journal)
            .map_err(err)?,
    );
    let mut error = None;
    let mut cursor = 0;
    let mut last = Instant::now();
    let mut single = false;
    while cursor < groups.len() && !job.stop.load(Ordering::Relaxed) {
        let mut end = cursor;
        let mut count = 0;
        let mut bytes = 0;
        while end < groups.len() {
            let group = &groups[end].0;
            let size = group.iter().map(String::len).sum::<usize>();
            if end > cursor && (single || count + group.len() > 32 || bytes + size > 6000) {
                break;
            }
            count += group.len();
            bytes += size;
            end += 1;
        }
        let chunk = &groups[cursor..end];
        let texts = chunk
            .iter()
            .flat_map(|group| group.0.iter().cloned())
            .collect();
        match translate(settings.clone(), texts, language.clone(), Some(&job.stop)) {
            Ok(translated) => {
                let mut offset = 0;
                for group in chunk {
                    let length = group.0.len();
                    write_group(&mut out, group, &translated[offset..offset + length])?;
                    progress.translated += group.1.len();
                    progress.completed += group.1.len();
                    offset += length;
                }
                out.flush().map_err(err)?;
                out.get_ref().sync_data().map_err(err)?;
                let mut offset = 0;
                for group in chunk {
                    let end = offset + group.0.len();
                    let texts = Arc::new(translated[offset..end].to_vec());
                    let rows = group.1.iter().map(|(index, _)| *index).collect::<Vec<_>>();
                    {
                        let mut live = job.live.write().map_err(err)?;
                        for &row in &rows {
                            live.insert(row, texts.clone());
                        }
                    }
                    for rows in rows.chunks(512) {
                        let _=app.emit("locale-batch-rows",serde_json::json!({
                            "id":progress.id,"language":language,"rows":rows,"texts":texts.as_ref()
                        }));
                    }
                    offset = end;
                }
                cursor = end;
                single = false;
            }
            Err(reason) => {
                if job.stop.load(Ordering::Relaxed) {
                    break;
                }
                let invalid = reason.contains("пустой или недопустимый фрагмент")
                    || reason.contains("число фрагментов")
                    || reason.contains("массив строк")
                    || reason.contains("слишком велика");
                if !invalid {
                    error = Some(reason);
                    break;
                }
                if chunk.len() > 1 {
                    single = true;
                    continue;
                }
                progress.failed += chunk[0].1.len();
                progress.completed += chunk[0].1.len();
                cursor = end;
                single = false;
            }
        }
        if last.elapsed().as_millis() >= 200 {
            publish(job, app, &progress);
            last = Instant::now();
        }
    }
    out.flush().map_err(err)?;
    drop(out);
    merge_checkpoint(&target, &language, &source)?;
    publish(job, app, &progress);
    Ok(Outcome {
        progress,
        cancelled: job.stop.load(Ordering::Relaxed),
        error,
    })
}

#[tauri::command]
pub async fn ide_locale_batch_start(
    id: u64,
    language: String,
    settings: Settings,
    state: tauri::State<'_, ide::Ide>,
    app: tauri::AppHandle,
) -> Result<Outcome> {
    let scope = state.scope(id)?;
    let key = (id, language.clone());
    let job = Arc::new(Job {
        stop: AtomicBool::new(false),
        progress: Mutex::new(Progress {
            id,
            language: language.clone(),
            ..Progress::default()
        }),
        live: RwLock::new(HashMap::new()),
    });
    {
        let mut running = jobs().lock().map_err(err)?;
        if running.contains_key(&key) {
            return Err("Пакетный перевод уже выполняется".into());
        }
        running.insert(key.clone(), job.clone());
    }
    let emitter = app.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || run(scope, language, settings, &job, &app))
            .await
            .map_err(err)
            .and_then(|result| result);
    jobs().lock().map_err(err)?.remove(&key);
    let _ = emitter.emit(
        "locale-batch-finished",
        serde_json::json!({
            "id":id,"language":key.1,"outcome":result.as_ref().ok(),"error":result.as_ref().err()
        }),
    );
    result
}

#[tauri::command]
pub fn ide_locale_batch_cancel(id: u64, language: String) -> Result<()> {
    if let Some(job) = jobs().lock().map_err(err)?.get(&(id, language)) {
        job.stop.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub fn ide_locale_batch_status(id: u64, language: String) -> Result<Option<Progress>> {
    let job = jobs().lock().map_err(err)?.get(&(id, language)).cloned();
    job.map(|job| {
        job.progress
            .lock()
            .map(|progress| progress.clone())
            .map_err(err)
    })
    .transpose()
}
