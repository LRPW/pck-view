use std::{ffi::OsString, path::Path};

pub fn target(args: impl IntoIterator<Item = OsString>) -> Option<(String, String)> {
    let mut args = args.into_iter().skip(1);
    let mut explicit_archive = None;
    let mut positional_archive = None;
    let mut entry = String::new();
    while let Some(arg) = args.next() {
        match arg.to_str() {
            Some("--open-archive") => {
                let path = args.next()?;
                if path.is_empty() || path.to_string_lossy().starts_with("--") { return None; }
                explicit_archive = Some(path);
            }
            Some("--select-entry") => {
                entry = args.next().unwrap_or_default().to_string_lossy().into_owned();
            }
            Some(value) if value.starts_with('-') => {}
            _ => {
                if positional_archive.is_none()
                    && Path::new(&arg).extension().is_some_and(|ext| ext.eq_ignore_ascii_case("pck"))
                {
                    positional_archive = Some(arg);
                }
            }
        }
    }
    let path = explicit_archive.or(positional_archive)?;
    Some((path.to_string_lossy().into_owned(), entry))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(args: &[&str]) -> Option<(String, String)> {
        target(args.iter().map(OsString::from))
    }
    #[test]
    fn association_accepts_unicode_spaces_and_uppercase_extension() {
        assert_eq!(parse(&["pckview.exe", r"D:\游戏 文件\Models.PCK"]),
            Some((r"D:\游戏 文件\Models.PCK".into(), String::new())));
    }
    #[test]
    fn explicit_open_no_longer_requires_entry() {
        assert_eq!(parse(&["pckview.exe", "--open-archive", "models.pck"]),
            Some(("models.pck".into(), String::new())));
    }
    #[test]
    fn resource_navigation_preserves_explicit_target_and_entry() {
        assert_eq!(parse(&["pckview.exe", "other.pck", "--select-entry", r"models\怪物\model.ecm", "--open-archive", "models.pck"]),
            Some(("models.pck".into(), r"models\怪物\model.ecm".into())));
    }
    #[test]
    fn no_archive_or_missing_explicit_path_has_no_startup_target() {
        assert_eq!(parse(&["pckview.exe"]), None);
        assert_eq!(parse(&["pckview.exe", "--open-archive"]), None);
        assert_eq!(parse(&["pckview.exe", "--open-archive", "--select-entry", "x"]), None);
        assert_eq!(parse(&["pckview.exe", "--select-entry", "resource.pck"]), None);
    }
}
