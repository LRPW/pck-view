use super::*;
#[test]
fn folder_pack_extract_roundtrip() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    let output = temp.path().join("output");
    std::fs::create_dir_all(source.join("nested")).unwrap();
    std::fs::create_dir(&output).unwrap();
    std::fs::write(source.join("nested/data.bin"), [0, 255, 42, 0]).unwrap();
    std::fs::write(source.join("empty.txt"), []).unwrap();
    std::fs::write(source.join("text.txt"), vec![b'a'; 10000]).unwrap();
    let target = temp.path().join("test.pck");
    let archive = pack_folder_impl(&source, &target, &|_, _, _| {}).unwrap();
    assert_eq!(archive.header.len(), 272);
    assert_eq!(archive.entries.len(), 3);
    assert_eq!(
        extract_all_impl(&archive, &output, &|_, _, _| {}).unwrap(),
        3
    );
    for path in ["nested/data.bin", "empty.txt", "text.txt"] {
        assert_eq!(
            std::fs::read(source.join(path)).unwrap(),
            std::fs::read(output.join(path)).unwrap()
        );
    }
    pack_folder_impl(&source, &target, &|_, _, _| {}).unwrap();
}
#[test]
fn rejects_unsafe_archive_paths() {
    for name in [
        "../escape",
        "C:\\escape",
        "/absolute",
        "a/../../escape",
        "a/CON.txt",
        "a/file:stream",
        "a/file.",
    ] {
        assert!(archive_relative(name).is_err(), "{name}");
    }
    assert_eq!(
        archive_relative("a\\b.txt").unwrap(),
        PathBuf::from("a").join("b.txt")
    );
}
