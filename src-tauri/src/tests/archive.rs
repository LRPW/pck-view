use super::*;
#[test]
#[ignore = "requires a local game archive"]
fn inspect_native_gfx_fixture() {
    let path = std::env::var("PCKVIEW_GFX_FIXTURE").expect("PCKVIEW_GFX_FIXTURE");
    let archive = Archive::open(path.into()).unwrap();
    if std::env::var_os("PCKVIEW_FIND_STCK").is_some() {
        for (index, entry) in archive.entries.iter().enumerate() {
            if !entry.name.to_lowercase().ends_with(".smd") || entry.len > 250000 { continue; }
            let data = archive.data(index).unwrap();
            if data.windows(5).any(|bytes| bytes.eq_ignore_ascii_case(b".stck")) { println!("STCK MODEL: {}", entry.name); break; }
        }
        return;
    }
    if std::env::var_os("PCKVIEW_FIND_UI_GFX").is_some() {
        let mut found = 0;
        for (index, entry) in archive.entries.iter().enumerate() {
            if !entry.name.to_lowercase().ends_with(".gfx") || entry.len > 250000 { continue; }
            let data = archive.data(index).unwrap();
            if data.windows(11).any(|bytes| bytes == b"2DRender: 1") {
                println!("UI GFX: {}", entry.name);
                found += 1;
                if found == 3 { break; }
            }
        }
        return;
    }
    if let Ok(name) = std::env::var("PCKVIEW_GFX_ENTRY") {
        let index = archive.entries.iter().position(|e| e.name == name).unwrap();
        let data = archive.data(index).unwrap();
        println!("HEADER={:02x?}", &data[..data.len().min(32)]);
        let (text, _, _) = encoding_rs::GBK.decode(&data);
        println!("{}", text.chars().take(6000).collect::<String>());
        return;
    }
    let filter = std::env::var("PCKVIEW_GFX_FILTER").unwrap_or_default();
    for entry in archive.entries.iter().filter(|e| e.name.contains(&filter) && [".gfx", ".ecm", ".smd", ".ski", ".bon"].iter().any(|ext| e.name.to_lowercase().ends_with(ext))).take(15) {
        println!("{}", entry.name);
        let (encoded, _, _) = encoding_rs::GBK.encode(entry.name.trim_start_matches("gfx\\"));
        println!("HEX={}", encoded.iter().map(|b| format!("{b:02x}")).collect::<String>());
    }
}
#[test]
fn sibling_surfaces_texture_lookup() {
    let dir = tempfile::tempdir().unwrap();
    let mut texture = fixture();
    let name = "surfaces\\Version02\\背景.tga";
    texture.entries[0].name = name.into();
    texture.entries[0].raw[..260].fill(0);
    let (encoded, _, _) = encoding_rs::GBK.encode(name);
    texture.entries[0].raw[..encoded.len()].copy_from_slice(&encoded);
    texture.save(&dir.path().join("Surfaces.PCK")).unwrap();
    let mut interface = fixture();
    interface.path = dir.path().join("interfaces.pck");
    let state = App::default();
    *state.0.lock().unwrap() = Some(interface);
    let cache = SurfaceCache::default();
    assert_eq!(read_surface_impl("version02/背景.tga", &state, &cache).unwrap(), texture.data(0).unwrap());
    assert!(read_surface_impl("missing.tga", &state, &cache).is_err());
    let other = tempfile::tempdir().unwrap();
    state.0.lock().unwrap().as_mut().unwrap().path = other.path().join("interfaces.pck");
    assert!(read_surface_impl("version02/背景.tga", &state, &cache).is_err());
}
fn fixture() -> Archive {
    let mut header = vec![0; 276];
    let k = keys(171);
    put(&mut header, 0, k.g0);
    put(&mut header, 4, VERSION);
    put(&mut header, 272, k.g1);
    let mut raw = vec![0; 276];
    raw[..8].copy_from_slice(b"test.txt");
    let data = b"hello world hello world".to_vec();
    Archive {
        path: PathBuf::new(),
        header,
        keys: k,
        encrypted: false,
        entries: vec![Entry {
            raw,
            name: "test.txt".into(),
            offset: 0,
            len: data.len() as u32,
            packed: 0,
            data: Some(data),
        }],
    }
}
#[test]
fn roundtrip_edit_delete() {
    let dir = tempfile::tempdir().unwrap();
    let a = fixture();
    let p = dir.path().join("one.pck");
    a.save(&p).unwrap();
    let mut b = Archive::open(p).unwrap();
    assert_eq!(b.data(0).unwrap(), a.data(0).unwrap());
    b.entries[0].data = Some(vec![42; 4096]);
    b.entries[0].len = 4096;
    let p2 = dir.path().join("two.pck");
    b.save(&p2).unwrap();
    let c = Archive::open(p2).unwrap();
    assert_eq!(c.data(0).unwrap(), vec![42; 4096]);
    b.entries.clear();
    let p3 = dir.path().join("empty.pck");
    b.save(&p3).unwrap();
    assert!(Archive::open(p3).unwrap().entries.is_empty());
}
#[test]
fn overwrite_open_archive_and_read_again() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("overwrite.pck");
    fixture().save(&path).unwrap();
    let mut archive = Archive::open(path.clone()).unwrap();
    archive.entries[0].data = Some(vec![7; 8192]);
    archive.entries[0].len = 8192;
    let saved = archive.save_progress(&path, &|_, _, _| {}).unwrap();
    assert_eq!(saved.path, path);
    assert!(saved.entries[0].data.is_none());
    assert_eq!(saved.data(0).unwrap(), vec![7; 8192]);
    saved.save(&path).unwrap();
    assert_eq!(Archive::open(path).unwrap().data(0).unwrap(), vec![7; 8192]);
}
#[test]
fn rejects_truncated() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("bad.pck");
    std::fs::write(&p, vec![0; 300]).unwrap();
    assert!(Archive::open(p).is_err());
}
#[test]
fn gbk_rejects_unrepresentable() {
    assert!(encode_text("😀".into(), "gbk".into()).is_err());
    assert_eq!(
        encode_text("中文".into(), "gbk".into()).unwrap(),
        vec![0xd6, 0xd0, 0xce, 0xc4]
    );
}

#[test]
fn raw_entry_uses_original_size_when_stored_size_is_larger() {
    let dir = tempfile::tempdir().unwrap();
    let mut archive = fixture();
    let payload = b"7z payload";
    archive.path = dir.path().join("raw.pck");
    std::fs::write(&archive.path, [payload.as_slice(), b"unused-padding"].concat()).unwrap();
    archive.entries[0].data = None;
    archive.entries[0].offset = 0;
    archive.entries[0].len = payload.len() as u32;
    archive.entries[0].packed = payload.len() as u32 + 14;
    assert_eq!(archive.data(0).unwrap(), payload);
    let saved = dir.path().join("normalized.pck");
    archive.save(&saved).unwrap();
    assert_eq!(Archive::open(saved).unwrap().data(0).unwrap(), payload);
}
#[test]
fn encrypted_raw_entry_uses_original_size_for_decryption_mask() {
    let dir = tempfile::tempdir().unwrap();
    let mut archive = fixture();
    let payload = b"abcdefgh";
    let mask = (payload.len() as u32).wrapping_add(0x739802ab);
    let mut encrypted = payload.to_vec();
    for chunk in encrypted.chunks_exact_mut(4) {
        let value = (u32::from_be_bytes(chunk.try_into().unwrap()) ^ mask).rotate_right(16);
        chunk.copy_from_slice(&value.to_be_bytes());
    }
    encrypted.extend_from_slice(b"padding");
    archive.path = dir.path().join("encrypted.pck");
    std::fs::write(&archive.path, &encrypted).unwrap();
    archive.encrypted = true;
    archive.entries[0].data = None;
    archive.entries[0].offset = 0;
    archive.entries[0].len = payload.len() as u32;
    archive.entries[0].packed = encrypted.len() as u32;
    assert_eq!(archive.data(0).unwrap(), payload);
}

#[test]
fn standalone_save_replaces_data_and_removes_stale_companion() {
    let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
    let files = temp.path().join("files");
    std::fs::create_dir(&files).unwrap();
    std::fs::write(files.join("entry.xml"), b"<DIALOG/>").unwrap();
    let target = temp.path().join("standalone.pck");
    let mut archive = pack_folder_impl(&files, &target, &|_, _, _| {}).unwrap();
    let companion = target.with_extension("pkx");
    std::fs::write(&companion, b"stale").unwrap();
    let replacement = b"<DIALOG Width=\"10\"/>";
    archive.entries[0].data = Some(replacement.to_vec());
    archive.entries[0].len = replacement.len() as u32;
    assert!(archive.save_new(&target).is_err());
    assert_eq!(std::fs::read(&companion).unwrap(), b"stale");
    archive.save(&target).unwrap();
    assert!(!companion.exists());
    assert_eq!(Archive::open(target).unwrap().data(0).unwrap(), replacement);
}

#[test]
fn standalone_pair_publication_restores_companion_on_failure() {
    let temp = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
    let target = temp.path().join("blocked.pck");
    std::fs::create_dir(&target).unwrap();
    let companion = target.with_extension("pkx");
    std::fs::write(&companion, b"old companion").unwrap();
    let stage = tempfile::tempdir_in(temp.path()).unwrap();
    let staged = stage.path().join("archive.pck");
    std::fs::write(&staged, b"new primary").unwrap();
    std::fs::write(staged.with_extension("pkx"), b"new companion").unwrap();
    assert!(publish_archive(stage, &staged, &target, true).is_err());
    assert_eq!(std::fs::read(companion).unwrap(), b"old companion");
}
