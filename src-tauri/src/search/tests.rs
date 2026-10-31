#[test]
fn hit_offsets_use_utf16_and_track_lines() {
    let matcher = super::content_matcher("猫".into(), false, true, false).unwrap();
    let mut hits = Vec::new();
    assert!(!super::collect_hits("😀猫\n猫猫", &matcher, 7, "utf-16le", &mut hits));
    assert_eq!(hits.len(), 3);
    assert_eq!((hits[0].start, hits[0].end, hits[0].line, hits[0].column), (2, 3, 1, 2));
    assert_eq!((hits[1].start, hits[1].line, hits[1].column), (4, 2, 1));
    assert_eq!((hits[2].start, hits[2].line, hits[2].column), (5, 2, 2));
}
use super::*;
#[test]
fn literal_case_and_word_options() {
    let literal = content_matcher("a.b".into(), false, false, false).unwrap();
    assert!(literal.is_match("A.B"));
    assert!(!literal.is_match("axb"));
    assert!(!content_matcher("Alpha".into(), false, true, false).unwrap().is_match("alpha"));
    let word = content_matcher("кот".into(), false, false, true).unwrap();
    assert!(word.is_match("КОТ спит"));
    assert!(!word.is_match("котёнок"));
}
#[test]
fn regexp_validation_and_multiline() {
    assert!(content_matcher("[".into(), true, false, false).is_err());
    assert!(content_matcher("".into(), false, false, false).is_err());
    assert!(content_matcher(r"^id=\d+$".into(), true, true, false).unwrap().is_match("header\nid=42\nend"));
}
