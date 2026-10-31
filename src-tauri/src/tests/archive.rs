use super::*;
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
