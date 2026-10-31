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
        extract_all_impl(&archive, &output, &|_, _, _| {}).unwrap().extracted,
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

#[test]
fn extraction_continues_after_bad_entry_and_reports_monotonic_progress() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source");
    let output = temp.path().join("output");
    std::fs::create_dir(&source).unwrap();
    std::fs::create_dir(&output).unwrap();
    for index in 0..80 {
        std::fs::write(source.join(format!("{index:03}.txt")), format!("resource {index}")).unwrap();
    }
    let target = temp.path().join("test.pck");
    let mut archive = pack_folder_impl(&source, &target, &|_, _, _| {}).unwrap();
    archive.entries[0].offset = u32::MAX;
    let updates = Mutex::new(Vec::new());
    let result = extract_all_impl(&archive, &output, &|_, done, total| {
        assert_eq!(total, 80);
        updates.lock().unwrap().push(done);
    }).unwrap();
    assert_eq!(result.extracted, 79);
    assert_eq!(result.errors.len(), 1);
    assert!(result.errors[0].contains(&archive.entries[0].name));
    for entry in archive.entries.iter().skip(1) {
        assert_eq!(std::fs::read(output.join(&entry.name)).unwrap(), archive.data(archive.entries.iter().position(|e| e.name == entry.name).unwrap()).unwrap());
    }
    let updates = updates.into_inner().unwrap();
    assert_eq!(updates.last(), Some(&80));
    assert!(updates.windows(2).all(|pair| pair[0] <= pair[1]));
}
