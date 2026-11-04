use super::{err, ide, reject_link, Result};
#[path = "locale_batch.rs"]
pub(super) mod batch;
pub(super) type ReplaceText<'a> = dyn FnMut(&str, &str) -> Result<Option<String>> + 'a;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufReader, BufWriter, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::SystemTime,
};

pub(super) fn paths(scope: &ide::Scope, language: &str) -> Result<PathBuf> {
    if language.is_empty()
        || language.len() > 24
        || !language.as_bytes()[0].is_ascii_alphabetic()
        || !language
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("Укажите код локали, например ru или pt-BR".into());
    }
    let source = PathBuf::from(scope.path()?);
    let root = source.parent().ok_or("Нет папки источника")?;
    let directory = root.join("locales");
    fs::create_dir_all(&directory).map_err(err)?;
    reject_link(&directory)?;
    let filename = if scope.manifest().is_some() {
        format!("{language}.json")
    } else {
        let name = source
            .file_name()
            .ok_or("Нет имени источника")?
            .to_string_lossy();
        format!("{name}.{language}.json")
    };
    let path = directory.join(filename);
    if fs::symlink_metadata(&path).is_ok() {
        reject_link(&path)?;
    }
    Ok(path)
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
struct Segment {
    color: Option<String>,
    text: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Entry {
    file: String,
    path: String,
    segments: Vec<Segment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_segments: Option<Vec<Segment>>,
}
#[derive(Deserialize)]
struct Source {
    entries: Vec<Entry>,
}
#[derive(Serialize, Deserialize)]
struct Locale {
    version: u32,
    language: String,
    entries: Vec<Entry>,
}
struct CachedSource {
    path: PathBuf,
    size: u64,
    modified: SystemTime,
    source: Arc<Source>,
}
static SOURCE: Mutex<Option<CachedSource>> = Mutex::new(None);
static LOCALE_WRITES: Mutex<()> = Mutex::new(());

pub(super) fn invalidate(path: &Path) {
    if let Ok(mut cache) = SOURCE.lock() {
        if cache.as_ref().is_some_and(|entry| entry.path == path) {
            *cache = None;
        }
    }
}

fn source(path: &Path) -> Result<Arc<Source>> {
    let metadata = fs::metadata(path).map_err(err)?;
    let size = metadata.len();
    let modified = metadata.modified().map_err(err)?;
    let mut cache = SOURCE.lock().map_err(err)?;
    if let Some(entry) = cache
        .as_ref()
        .filter(|entry| entry.path == path && entry.size == size && entry.modified == modified)
    {
        return Ok(entry.source.clone());
    }
    let file = File::open(path).map_err(err)?;
    let source: Arc<Source> = Arc::new(serde_json::from_reader(BufReader::new(file)).map_err(err)?);
    *cache = Some(CachedSource {
        path: path.into(),
        size,
        modified,
        source: source.clone(),
    });
    Ok(source)
}

fn locale(path: &Path, language: &str) -> Result<Locale> {
    match File::open(path) {
        Ok(file) => serde_json::from_reader(BufReader::new(file)).map_err(err),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Locale {
            version: 1,
            language: language.into(),
            entries: Vec::new(),
        }),
        Err(error) => Err(err(error)),
    }
}

fn translated_path(scope: &ide::Scope, language: &str) -> Result<PathBuf> {
    if language.eq_ignore_ascii_case("source") {
        return Err("Укажите код языка перевода".into());
    }
    paths(scope, language)
}

#[derive(Serialize)]
struct Row {
    index: usize,
    #[serde(flatten)]
    entry: Entry,
    translation: Option<Vec<Segment>>,
}
#[derive(Serialize)]
pub struct Page {
    rows: Vec<Row>,
    total: Option<usize>,
    next: Option<usize>,
    ready: bool,
    path: String,
}

type LocaleIndex = HashMap<String, HashMap<String, Entry>>;
struct CachedLocale {
    path: PathBuf,
    size: u64,
    modified: SystemTime,
    index: Arc<LocaleIndex>,
}
static PAGE_LOCALE: Mutex<Option<CachedLocale>> = Mutex::new(None);

fn locale_index(path: &Path, language: &str) -> Result<Arc<LocaleIndex>> {
    let metadata = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Arc::new(HashMap::new()))
        }
        Err(error) => return Err(err(error)),
    };
    let size = metadata.len();
    let modified = metadata.modified().map_err(err)?;
    let mut cache = PAGE_LOCALE.lock().map_err(err)?;
    if let Some(entry) = cache
        .as_ref()
        .filter(|entry| entry.path == path && entry.size == size && entry.modified == modified)
    {
        return Ok(entry.index.clone());
    }
    let mut index = LocaleIndex::new();
    for entry in locale(path, language)?.entries {
        index
            .entry(entry.file.clone())
            .or_default()
            .insert(entry.path.clone(), entry);
    }
    let index = Arc::new(index);
    *cache = Some(CachedLocale {
        path: path.into(),
        size,
        modified,
        index: index.clone(),
    });
    Ok(index)
}

#[tauri::command]
pub async fn ide_locale_page(
    id: u64,
    language: String,
    query: String,
    cursor: usize,
    only_empty: bool,
    state: tauri::State<'_, ide::Ide>,
) -> Result<Page> {
    let scope = state.scope(id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let target = translated_path(&scope, &language)?;
        let source_path = paths(&scope, "source")?;
        let path = target.to_string_lossy().into_owned();
        if !source_path.is_file() {
            return Ok(Page {
                rows: vec![],
                total: Some(0),
                next: None,
                ready: false,
                path,
            });
        }
        let source = source(&source_path)?;
        let translations = locale_index(&target, &language)?;
        let job = batch::live_job(id, &language)?;
        let live = job
            .as_ref()
            .map(|job| job.live.read().map_err(err))
            .transpose()?;
        let term = query.trim().to_lowercase();
        let mut rows = Vec::new();
        let mut next = None;
        for (index, entry) in source.entries.iter().enumerate().skip(cursor) {
            let translation = translations
                .get(&entry.file)
                .and_then(|entries| entries.get(&entry.path))
                .filter(|translated| {
                    translated
                        .source_segments
                        .as_ref()
                        .map_or(true, |old| old == &entry.segments)
                })
                .map(|translated| &translated.segments);
            let pending = live.as_ref().and_then(|live| live.get(&index));
            let translated_part = |index: usize| {
                translation
                    .and_then(|parts| parts.get(index))
                    .map(|part| part.text.as_str())
                    .filter(|text| !text.is_empty())
                    .or_else(|| {
                        pending
                            .and_then(|parts| parts.get(index))
                            .map(String::as_str)
                    })
            };
            if only_empty
                && !entry.segments.iter().enumerate().any(|(index, part)| {
                    !part.text.trim().is_empty()
                        && translated_part(index).map_or(true, str::is_empty)
                })
            {
                continue;
            }
            if !term.is_empty()
                && !entry.file.to_lowercase().contains(&term)
                && !entry.path.to_lowercase().contains(&term)
                && !entry
                    .segments
                    .iter()
                    .any(|part| part.text.to_lowercase().contains(&term))
                && !(0..entry.segments.len()).any(|index| {
                    translated_part(index).is_some_and(|text| text.to_lowercase().contains(&term))
                })
            {
                continue;
            }
            if rows.len() == 50 {
                next = Some(index);
                break;
            }
            rows.push(Row {
                index,
                entry: entry.clone(),
                translation: (translation.is_some() || pending.is_some()).then(|| {
                    entry
                        .segments
                        .iter()
                        .enumerate()
                        .map(|(index, part)| Segment {
                            color: part.color.clone(),
                            text: translated_part(index).unwrap_or("").to_owned(),
                        })
                        .collect()
                }),
            });
        }
        Ok(Page {
            rows,
            total: (term.is_empty() && !only_empty).then_some(source.entries.len()),
            next,
            ready: true,
            path,
        })
    })
    .await
    .map_err(err)?
}

#[derive(Deserialize)]
pub struct Translation {
    file: String,
    path: String,
    texts: Vec<String>,
}

#[tauri::command]
pub async fn ide_locale_save(
    id: u64,
    language: String,
    changes: Vec<Translation>,
    state: tauri::State<'_, ide::Ide>,
) -> Result<String> {
    let scope = state.scope(id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _write = LOCALE_WRITES.lock().map_err(err)?;
        let target = translated_path(&scope, &language)?;
        let source = source(&paths(&scope, "source")?)?;
        let index: HashMap<_, _> = source
            .entries
            .iter()
            .map(|entry| ((entry.file.as_str(), entry.path.as_str()), entry))
            .collect();
        let mut locale = locale(&target, &language)?;
        let mut entries: HashMap<_, _> = locale
            .entries
            .into_iter()
            .map(|entry| ((entry.file.clone(), entry.path.clone()), entry))
            .collect();
        for change in changes {
            let entry = index
                .get(&(change.file.as_str(), change.path.as_str()))
                .ok_or("Исходный текст изменился. Обновите вкладку.")?;
            if entry.segments.len() != change.texts.len() {
                return Err("Число цветовых фрагментов изменилось".into());
            }
            let key = (change.file.clone(), change.path.clone());
            if change.texts.iter().all(|text| text.is_empty()) {
                entries.remove(&key);
                continue;
            }
            let segments = entry
                .segments
                .iter()
                .zip(change.texts)
                .map(|(part, text)| Segment {
                    color: part.color.clone(),
                    text,
                })
                .collect();
            entries.insert(
                key,
                Entry {
                    file: entry.file.clone(),
                    path: entry.path.clone(),
                    segments,
                    source_segments: Some(entry.segments.clone()),
                },
            );
        }
        locale.entries = entries.into_values().collect();
        locale
            .entries
            .sort_by(|a, b| (&a.file, &a.path).cmp(&(&b.file, &b.path)));
        let mut file = tempfile::NamedTempFile::new_in(target.parent().ok_or("Нет папки локалей")?)
            .map_err(err)?;
        {
            let mut writer = BufWriter::new(file.as_file_mut());
            serde_json::to_writer_pretty(&mut writer, &locale).map_err(err)?;
            writer.flush().map_err(err)?;
        }
        file.as_file().sync_all().map_err(err)?;
        file.persist(&target).map_err(err)?;
        Ok(target.to_string_lossy().into_owned())
    })
    .await
    .map_err(err)?
}

#[derive(Serialize)]
pub struct ApplyResult {
    updated: Vec<usize>,
    errors: Vec<String>,
}

fn rendered(parts: &[Segment], translated: Option<&[Segment]>) -> String {
    let mut out = String::new();
    for (index, part) in parts.iter().enumerate() {
        if let Some(color) = &part.color {
            out.push('^');
            out.push_str(color);
        }
        let text = translated
            .and_then(|parts| parts.get(index))
            .filter(|part| !part.text.is_empty())
            .map_or(part.text.as_str(), |part| part.text.as_str());
        out.push_str(text);
    }
    out
}

#[tauri::command]
pub async fn ide_locale_apply(
    id: u64,
    language: String,
    state: tauri::State<'_, ide::Ide>,
    app: tauri::AppHandle,
) -> Result<ApplyResult> {
    let scope = state.scope(id)?;
    if scope.manifest().is_none() {
        return Err("Применить перевод можно только к проекту".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let manifest = scope.manifest().ok_or("Нет проекта")?;
        let target = translated_path(&scope, &language)?;
        let locale = locale(&target, &language)?;
        if locale.entries.is_empty() {
            return Err("В локали нет сохранённых переводов".into());
        }
        let source = source(&paths(&scope, "source")?)?;
        let source_index: HashMap<_, _> = source
            .entries
            .iter()
            .map(|entry| ((entry.file.as_str(), entry.path.as_str()), entry))
            .collect();
        let scope_index: HashMap<_, _> = scope
            .entries
            .iter()
            .enumerate()
            .map(|(i, entry)| (entry.path.as_str(), i))
            .collect();
        let mut files: std::collections::BTreeMap<&str, Vec<&Entry>> =
            std::collections::BTreeMap::new();
        for entry in &locale.entries {
            files.entry(&entry.file).or_default().push(entry);
        }
        let total = files.len();
        let mut result = ApplyResult {
            updated: Vec::new(),
            errors: Vec::new(),
        };
        for (completed, (file, entries)) in files.into_iter().enumerate() {
            super::report(&app, "Применение перевода", file, completed, total);
            let attempt = (|| -> Result<Option<usize>> {
                let index = *scope_index.get(file).ok_or("Файл отсутствует в проекте")?;
                let entry = &scope.entries[index];
                let mut translations = HashMap::new();
                for translated in entries {
                    let original = source_index
                        .get(&(file, translated.path.as_str()))
                        .ok_or("Строки нет в исходном экспорте")?;
                    if translated
                        .source_segments
                        .as_ref()
                        .is_some_and(|old| old != &original.segments)
                    {
                        return Err(format!("Исходный текст изменился · {}", translated.path));
                    }
                    if translated.segments.len() != original.segments.len() {
                        return Err(format!(
                            "Не совпадает число фрагментов · {}",
                            translated.path
                        ));
                    }
                    if translations
                        .insert(
                            translated.path.as_str(),
                            (
                                rendered(&original.segments, None),
                                rendered(&original.segments, Some(&translated.segments)),
                            ),
                        )
                        .is_some()
                    {
                        return Err(format!("Повторяющийся путь · {}", translated.path));
                    }
                }
                let rows = translations
                    .keys()
                    .filter_map(|path| {
                        path.strip_prefix("/tasks/")?
                            .split('/')
                            .next()?
                            .parse::<usize>()
                            .ok()
                    })
                    .collect();
                let mut replace = |path: &str, current: &str| -> Result<Option<String>> {
                    let Some((original, translated)) = translations.remove(path) else {
                        return Ok(None);
                    };
                    if current == translated {
                        return Ok(None);
                    }
                    if current != original {
                        return Err(format!("Текст в файле изменился · {path}"));
                    }
                    Ok(Some(translated))
                };
                let original = ide::read(&scope, index)?;
                let basename = entry
                    .name
                    .rsplit(['/', '\\'])
                    .next()
                    .unwrap_or("")
                    .to_ascii_lowercase();
                let updated = if matches!(basename.as_str(), "tasks.data" | "dyn_tasks.data") {
                    super::tasks::translate_texts(&scope, index, &original, &rows, &mut replace)?
                } else if (basename.starts_with("elements") || basename.starts_with("gshop"))
                    && basename.ends_with(".data")
                {
                    super::elements::translate_texts(&entry.name, &original, &mut replace)?
                } else if matches!(
                    basename.as_str(),
                    "domain.data" | "domain2.data" | "domain2_cross.data"
                ) {
                    super::text_export::translate_territories(
                        &original,
                        basename != "domain.data",
                        &mut replace,
                    )?
                } else if basename.ends_with(".txt") || basename.ends_with(".xml") {
                    super::text_export::translate_text_file(
                        &original,
                        basename.ends_with(".xml"),
                        &mut replace,
                    )?
                } else {
                    return Err("Формат файла не поддерживается".into());
                };
                if let Some(path) = translations.keys().next() {
                    return Err(format!("Поле не найдено · {path}"));
                }
                if original == updated {
                    return Ok(None);
                }
                super::project::store_edit(manifest, &entry.path, &original, &updated)?;
                Ok(Some(index))
            })();
            match attempt {
                Ok(Some(index)) => result.updated.push(index),
                Ok(None) => {}
                Err(error) => result.errors.push(format!("{file} · {error}")),
            }
        }
        super::report(&app, "Применение перевода", "Готово", total, total);
        Ok(result)
    })
    .await
    .map_err(err)?
}
