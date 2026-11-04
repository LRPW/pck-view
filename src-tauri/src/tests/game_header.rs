use super::*;
#[test]
fn game_layout_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let k = keys(171);
    let mut h = vec![0; 272];
    put(&mut h, 0, k.g0);
    put(&mut h, 4, VERSION);
    put(&mut h, 268, k.g1);
    let a = Archive {
        path: PathBuf::new(),
        entries: vec![],
        header: h,
        keys: k,
        encrypted: false,
    };
    let p = dir.path().join("game.pck");
    a.save(&p).unwrap();
    let b = Archive::open(p).unwrap();
    assert_eq!(b.header.len(), 272);
}
#[test]
#[ignore = "requires local game installation"]
fn installed_archives() {
    for name in ["configs", "interfaces", "surfaces", "shaders"] {
        let p = test_client_root().join(format!("{name}.pck"));
        let a = Archive::open(p).unwrap_or_else(|e| panic!("{name}: {e}"));
        println!(
            "{name}: {} entries, header {}",
            a.entries.len(),
            a.header.len()
        );
        if !a.entries.is_empty() {
            a.data(0).unwrap();
        }
    }
}
