use super::{elements, tasks, text_export, Result};

pub(super) fn supported(name: &str) -> bool {
    let name = name.rsplit(['/', '\\']).next().unwrap_or("").to_ascii_lowercase();
    matches!(name.as_str(), "tasks.data" | "dyn_tasks.data" | "task_npc.data" |
        "domain.data" | "domain2.data" | "domain2_cross.data")
        || (name.starts_with("elements") && name.ends_with(".data"))
        || matches!(name.as_str(), "gshop.data" | "gshop1.data" | "gshop2.data")
}

/// Search and preview use the same projection, never the bytes of a data file.
pub(super) fn project(
    name: &str,
    bytes: Vec<u8>,
    profile: Option<&elements::ElementsProfile>,
    cancelled: &dyn Fn() -> bool,
) -> Result<String> {
    let name = name.rsplit(['/', '\\']).next().unwrap_or("").to_ascii_lowercase();
    let mut output = String::new();
    let mut emit = |_: String, text: &str| -> Result<()> {
        if cancelled() { return Err("Search cancelled".into()); }
        if !text.trim().is_empty() {
            if !output.is_empty() { output.push_str("\n\n"); }
            output.push_str(text);
        }
        Ok(())
    };
    match name.as_str() {
        "tasks.data" | "dyn_tasks.data" | "task_npc.data" => tasks::export_file_texts(&name, &bytes, &mut emit)?,
        "domain.data" | "domain2.data" | "domain2_cross.data" => {
            text_export::territory_texts(&bytes, name != "domain.data", &mut |path, _, text| emit(path, text))?;
        }
        _ if supported(&name) => elements::export_texts(&name, bytes, profile, &mut emit)?,
        _ => return Err("Unsupported structured data file".into()),
    }
    Ok(output)
}
