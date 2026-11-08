use std::fs;

use commitnote_editor_text::{TextSelection, apply};
use commitnote_markdown::insert_image_references;
use serde::Deserialize;

#[derive(Deserialize)]
struct Vectors {
    insertions: Vec<Insertion>,
}

#[derive(Deserialize)]
struct Insertion {
    name: String,
    text: String,
    selection: Selection,
    argument: Vec<String>,
    expected: Expected,
}

#[derive(Deserialize)]
struct Selection {
    head: usize,
}

#[derive(Deserialize)]
struct Expected {
    text: String,
    selection: Anchored,
}

#[derive(Deserialize)]
struct Anchored {
    anchor: usize,
    head: usize,
}

const REFERENCE: &str = "![](image:abcdefghijklmnopqrstuvwxy2#640x480)";

fn reference() -> Vec<String> {
    vec![REFERENCE.to_owned()]
}

#[test]
fn every_shared_insertion_vector_matches() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../test-vectors/image-insertion.json"
    );
    let raw = fs::read_to_string(path).expect("image-insertion.json");
    let json: serde_json::Value = serde_json::from_str(&raw).expect("valid json");
    let expected_count = json["insertions"].as_array().expect("insertions").len();
    let vectors: Vectors = serde_json::from_value(json).expect("vector shape");

    let mut failures = Vec::new();
    let mut checked = 0;
    for vector in &vectors.insertions {
        checked += 1;
        let result = insert_image_references(&vector.text, vector.selection.head, &vector.argument);
        let text = apply(&result.edits, &vector.text);
        let expected = &vector.expected;
        let collapsed = result.selection.length == 0;
        if text != expected.text
            || !collapsed
            || result.selection.location != expected.selection.head
            || expected.selection.anchor != expected.selection.head
        {
            failures.push(format!(
                "{}: got {:?} at {}, expected {:?} at {}",
                vector.name,
                text,
                result.selection.location,
                expected.text,
                expected.selection.head
            ));
        }
    }

    assert_eq!(checked, expected_count);
    assert!(
        failures.is_empty(),
        "{} of {checked} insertion vectors failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn counts_text_before_the_caret_in_utf16_units() {
    let result = insert_image_references("😀 ab", 3, &reference());
    assert_eq!(
        apply(&result.edits, "😀 ab"),
        format!("😀 \n{REFERENCE}\nab")
    );
    assert_eq!(
        result.selection,
        TextSelection::new(2 + 1 + 1 + REFERENCE.len() + 1, 0)
    );
}

#[test]
fn inserts_after_the_emoji_not_inside_it() {
    let result = insert_image_references("😀", 2, &reference());
    assert_eq!(apply(&result.edits, "😀"), format!("😀\n{REFERENCE}\n"));
    assert_eq!(result.selection.location, 2 + 1 + REFERENCE.len() + 1);
}

#[test]
fn clamps_a_caret_past_the_end() {
    let result = insert_image_references("text", 99, &reference());
    assert_eq!(apply(&result.edits, "text"), format!("text\n{REFERENCE}\n"));
    assert_eq!(
        result.selection,
        TextSelection::new(4 + 1 + REFERENCE.len() + 1, 0)
    );
}
