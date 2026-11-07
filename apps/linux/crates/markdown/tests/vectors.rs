use std::collections::BTreeSet;
use std::fs;
use std::ops::Range;
use std::path::PathBuf;

use commitnote_editor_text::TextSelection;
use commitnote_markdown::{
    MarkdownDocument, Placement, RenderOutput, SyntaxKind, SyntaxNode, parse, render,
};
use serde::Deserialize;

#[derive(Deserialize)]
struct Vectors {
    entries: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    name: String,
    text: String,
    nodes: Vec<VectorNode>,
}

#[derive(Deserialize)]
struct VectorNode {
    kind: String,
    level: Option<u8>,
    checked: Option<bool>,
    from: usize,
    to: usize,
}

impl VectorNode {
    fn syntax_node(&self) -> SyntaxNode {
        let level = || self.level.expect("heading level");
        let kind = match self.kind.as_str() {
            "atxHeading" => SyntaxKind::AtxHeading { level: level() },
            "setextHeading" => SyntaxKind::SetextHeading { level: level() },
            "headerMark" => SyntaxKind::HeaderMark,
            "blockquote" => SyntaxKind::Blockquote,
            "quoteMark" => SyntaxKind::QuoteMark,
            "bulletList" => SyntaxKind::BulletList,
            "orderedList" => SyntaxKind::OrderedList,
            "listItem" => SyntaxKind::ListItem,
            "listMark" => SyntaxKind::ListMark,
            "task" => SyntaxKind::Task,
            "taskMarker" => SyntaxKind::TaskMarker {
                checked: self.checked.expect("task marker state"),
            },
            "fencedCode" => SyntaxKind::FencedCode,
            "codeMark" => SyntaxKind::CodeMark,
            "codeInfo" => SyntaxKind::CodeInfo,
            "codeText" => SyntaxKind::CodeText,
            "indentedCode" => SyntaxKind::IndentedCode,
            "horizontalRule" => SyntaxKind::HorizontalRule,
            "paragraph" => SyntaxKind::Paragraph,
            "emphasis" => SyntaxKind::Emphasis,
            "strongEmphasis" => SyntaxKind::StrongEmphasis,
            "emphasisMark" => SyntaxKind::EmphasisMark,
            "strikethrough" => SyntaxKind::Strikethrough,
            "strikethroughMark" => SyntaxKind::StrikethroughMark,
            "inlineCode" => SyntaxKind::InlineCode,
            "link" => SyntaxKind::Link,
            "linkMark" => SyntaxKind::LinkMark,
            "linkLabel" => SyntaxKind::LinkLabel,
            "url" => SyntaxKind::Url,
            "autolink" => SyntaxKind::Autolink,
            "image" => SyntaxKind::Image,
            "table" => SyntaxKind::Table,
            "hardBreak" => SyntaxKind::HardBreak,
            other => panic!("unknown vector kind {other}"),
        };
        SyntaxNode::new(kind, self.from..self.to)
    }
}

/// Differences that stem from the Rust parser following CommonMark/GFM where the web parser
/// deviates. Each entry must still differ from the vector, so stale rows fail the test.
const ALLOWED: &[(&str, &str)] = &[
    (
        "atx-tab",
        "a tab after # opens a heading in CommonMark; lezer needs a space, so the web leaves the line as plain text",
    ),
    (
        "task-not-task",
        "lezer treats any bracket pair such as [y] as a link and hides its brackets; the parser keeps an undefined reference as plain text",
    ),
    (
        "link-nested-brackets",
        "CommonMark links the outer brackets around a bracketed span; lezer links the inner pair and leaves the outer text unstyled",
    ),
    (
        "link-reference-full",
        "lezer hides the label brackets of a reference link; the parser leaves reference links as plain text",
    ),
    (
        "link-reference-collapsed",
        "lezer hides the label brackets of a reference link; the parser leaves reference links as plain text",
    ),
    (
        "link-reference-shortcut",
        "lezer hides the brackets of a shortcut reference; the parser leaves reference links as plain text",
    ),
    (
        "link-reference-undefined",
        "lezer hides brackets around text with no definition; CommonMark keeps them as literal text",
    ),
    (
        "image-reference-style",
        "lezer mutes the markers of a reference-style image; the parser leaves it as plain text, and neither shows an image",
    ),
    (
        "table-no-outer-pipes",
        "a delimiter row of single hyphens makes a table in GFM; lezer reads the row as a list item and styles its marker",
    ),
];

fn load() -> Vec<Entry> {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../markdown-vectors/vectors.json");
    let json = fs::read_to_string(&path).expect("read vectors.json");
    serde_json::from_str::<Vectors>(&json)
        .expect("parse vectors.json")
        .entries
}

fn document_from(entry: &Entry) -> MarkdownDocument {
    let nodes = entry.nodes.iter().map(VectorNode::syntax_node).collect();
    MarkdownDocument::from_nodes(&entry.text, nodes)
}

type Run = (Range<usize>, String);

fn normalized(output: &RenderOutput) -> (Vec<Run>, Vec<String>) {
    let mut runs: Vec<Run> = output
        .runs
        .iter()
        .map(|run| (run.range.clone(), format!("{:?}", run.style)))
        .collect();
    runs.sort_by(|a, b| (a.0.start, a.0.end, &a.1).cmp(&(b.0.start, b.0.end, &b.1)));
    let mut placements: Vec<String> = output
        .placements
        .iter()
        .map(|placement: &Placement| format!("{placement:?}"))
        .collect();
    placements.sort();
    (runs, placements)
}

fn describe_diff(expected: &(Vec<Run>, Vec<String>), actual: &(Vec<Run>, Vec<String>)) -> String {
    let mut lines = Vec::new();
    for run in &expected.0 {
        if !actual.0.contains(run) {
            lines.push(format!("  vector only: {run:?}"));
        }
    }
    for run in &actual.0 {
        if !expected.0.contains(run) {
            lines.push(format!("  parser only: {run:?}"));
        }
    }
    for placement in &expected.1 {
        if !actual.1.contains(placement) {
            lines.push(format!("  vector only: {placement}"));
        }
    }
    for placement in &actual.1 {
        if !expected.1.contains(placement) {
            lines.push(format!("  parser only: {placement}"));
        }
    }
    lines.join("\n")
}

fn first_difference(entry: &Entry) -> Option<String> {
    let from_vector = document_from(entry);
    let from_parser = parse(&entry.text);
    let mut selections: Vec<(String, Vec<TextSelection>)> = vec![("no selection".into(), vec![])];
    for &start in &from_vector.lines {
        selections.push((
            format!("caret at {start}"),
            vec![TextSelection::new(start, 0)],
        ));
    }
    for (label, selection) in selections {
        let expected = normalized(&render(&from_vector, &selection));
        let actual = normalized(&render(&from_parser, &selection));
        if expected != actual {
            return Some(format!("{label}\n{}", describe_diff(&expected, &actual)));
        }
    }
    None
}

#[test]
fn parser_matches_vectors() {
    let entries = load();
    let mut failures = Vec::new();
    let mut seen_allowed = BTreeSet::new();
    for entry in &entries {
        let allowed = ALLOWED.iter().any(|(name, _)| *name == entry.name);
        match (first_difference(entry), allowed) {
            (Some(diff), false) => failures.push(format!("{} differs at {diff}", entry.name)),
            (None, true) => failures.push(format!(
                "{} is allowed to differ but matches the vector",
                entry.name
            )),
            (Some(_), true) => {
                seen_allowed.insert(entry.name.clone());
            }
            (None, false) => {}
        }
    }
    for (name, reason) in ALLOWED {
        if !entries.iter().any(|entry| entry.name == *name) {
            failures.push(format!("allowed entry {name} ({reason}) has no vector"));
        }
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}

#[test]
fn allowed_entries_are_unique_and_explained() {
    let mut names = BTreeSet::new();
    for (name, reason) in ALLOWED {
        assert!(names.insert(*name), "{name} is listed twice");
        assert!(!reason.is_empty(), "{name} has no reason");
    }
}

#[test]
fn every_syntax_kind_appears_in_the_vectors() {
    let mut expected: Vec<SyntaxKind> = (1..=6)
        .map(|level| SyntaxKind::AtxHeading { level })
        .chain((1..=2).map(|level| SyntaxKind::SetextHeading { level }))
        .chain([true, false].map(|checked| SyntaxKind::TaskMarker { checked }))
        .collect();
    expected.extend([
        SyntaxKind::HeaderMark,
        SyntaxKind::Blockquote,
        SyntaxKind::QuoteMark,
        SyntaxKind::BulletList,
        SyntaxKind::OrderedList,
        SyntaxKind::ListItem,
        SyntaxKind::ListMark,
        SyntaxKind::Task,
        SyntaxKind::FencedCode,
        SyntaxKind::CodeMark,
        SyntaxKind::CodeInfo,
        SyntaxKind::CodeText,
        SyntaxKind::IndentedCode,
        SyntaxKind::HorizontalRule,
        SyntaxKind::Paragraph,
        SyntaxKind::Emphasis,
        SyntaxKind::StrongEmphasis,
        SyntaxKind::EmphasisMark,
        SyntaxKind::Strikethrough,
        SyntaxKind::StrikethroughMark,
        SyntaxKind::InlineCode,
        SyntaxKind::Link,
        SyntaxKind::LinkMark,
        SyntaxKind::LinkLabel,
        SyntaxKind::Url,
        SyntaxKind::Autolink,
        SyntaxKind::Image,
        SyntaxKind::Table,
        SyntaxKind::HardBreak,
    ]);
    let present: BTreeSet<String> = load()
        .iter()
        .flat_map(|entry| {
            entry
                .nodes
                .iter()
                .map(|node| format!("{:?}", node.syntax_node().kind))
        })
        .collect();
    let missing: Vec<String> = expected
        .iter()
        .map(|kind| format!("{kind:?}"))
        .filter(|kind| !present.contains(kind))
        .collect();
    assert!(missing.is_empty(), "no vector contains {missing:?}");
}
