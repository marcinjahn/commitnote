use std::collections::BTreeSet;
use std::fs;
use std::ops::Range;
use std::path::PathBuf;

use commitnote_editor_text::TextSelection;
use commitnote_markdown::{
    MarkdownDocument, MarkdownTable, Placement, RenderOutput, SyntaxKind, SyntaxNode,
    TableAlignment, parse, render,
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
    tables: Vec<VectorTable>,
}

#[derive(Deserialize)]
struct VectorNode {
    kind: String,
    level: Option<u8>,
    checked: Option<bool>,
    from: usize,
    to: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorTable {
    range: VectorRange,
    container_prefix: Option<String>,
    column_count: usize,
    alignments: Vec<String>,
    lines: Vec<VectorTableLine>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorTableLine {
    range: VectorRange,
    row_start: usize,
    trailing_pipe: bool,
    cells: Vec<VectorTableCell>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorTableCell {
    range: VectorRange,
    content_range: VectorRange,
    text: String,
}

#[derive(Deserialize)]
struct VectorRange {
    from: usize,
    to: usize,
}

impl VectorRange {
    fn range(&self) -> Range<usize> {
        self.from..self.to
    }
}

fn alignment_name(alignment: TableAlignment) -> &'static str {
    match alignment {
        TableAlignment::Unspecified => "",
        TableAlignment::Left => "left",
        TableAlignment::Center => "center",
        TableAlignment::Right => "right",
    }
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
    (
        "table-irregular-prefix",
        "lezer keeps an unprefixed row after a quoted table inside the blockquote and styles it as a quote line; GFM ends the table at the lazy line, so the parser leaves it a paragraph outside the quote",
    ),
    (
        "table-setext-underline",
        "lezer lets a --- line underline the pipe paragraph as a level 2 setext heading; GFM ends the table before it, so the parser styles the line as a thematic break",
    ),
    (
        "table-setext-equals",
        "lezer lets a = line underline the pipe paragraph as a level 1 setext heading; GFM keeps the line as a table row, so the parser leaves the text unstyled",
    ),
];

/// Differences in the table model that stem from the web readers disagreeing with each other. Each
/// entry must still differ, and must match once the vector alignments are cut to the column count.
const TABLE_ALLOWED: &[(&str, &str)] = &[(
    "table-trailing-blank",
    "readTable counts a column for the blank after the last header pipe; the table source reader and the Rust table structure do not",
)];

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

fn table_differences(
    document: &MarkdownDocument,
    expected: &VectorTable,
    actual: &MarkdownTable,
    truncate_alignments: bool,
) -> Vec<String> {
    let mut differences = Vec::new();
    let mut compare = |what: &str, expected: String, actual: String| {
        if expected != actual {
            differences.push(format!("{what}: vector {expected}, parser {actual}"));
        }
    };
    compare(
        "range",
        format!("{:?}", expected.range.range()),
        format!("{:?}", actual.range),
    );
    compare(
        "container prefix",
        format!("{:?}", expected.container_prefix),
        format!("{:?}", actual.container_prefix),
    );
    compare(
        "column count",
        expected.column_count.to_string(),
        actual.column_count.to_string(),
    );
    let vector_alignments = if truncate_alignments {
        &expected.alignments[..expected.column_count.min(expected.alignments.len())]
    } else {
        &expected.alignments[..]
    };
    compare(
        "alignments",
        format!("{vector_alignments:?}"),
        format!(
            "{:?}",
            actual
                .alignments
                .iter()
                .map(|alignment| alignment_name(*alignment))
                .collect::<Vec<_>>()
        ),
    );
    compare(
        "line count",
        expected.lines.len().to_string(),
        actual.lines.len().to_string(),
    );
    for (index, (expected, actual)) in expected.lines.iter().zip(&actual.lines).enumerate() {
        compare(
            &format!("line {index} range"),
            format!("{:?}", expected.range.range()),
            format!("{:?}", actual.range),
        );
        compare(
            &format!("line {index} row start"),
            expected.row_start.to_string(),
            actual.row_start.to_string(),
        );
        compare(
            &format!("line {index} trailing pipe"),
            expected.trailing_pipe.to_string(),
            actual.trailing_pipe.to_string(),
        );
        compare(
            &format!("line {index} cell count"),
            expected.cells.len().to_string(),
            actual.cells.len().to_string(),
        );
        for (column, (expected, actual)) in expected.cells.iter().zip(&actual.cells).enumerate() {
            compare(
                &format!("line {index} cell {column} range"),
                format!("{:?}", expected.range.range()),
                format!("{:?}", actual.range),
            );
            compare(
                &format!("line {index} cell {column} content range"),
                format!("{:?}", expected.content_range.range()),
                format!("{:?}", actual.content_range),
            );
            compare(
                &format!("line {index} cell {column} text"),
                format!("{:?}", expected.text),
                format!("{:?}", document.slice(actual.content_range.clone())),
            );
        }
    }
    differences
}

fn first_table_difference(
    entry: &Entry,
    document: &MarkdownDocument,
    truncate_alignments: bool,
) -> Option<String> {
    let actual = document.tables();
    if actual.len() != entry.tables.len() {
        return Some(format!(
            "table count: vector {}, parser {}",
            entry.tables.len(),
            actual.len()
        ));
    }
    entry
        .tables
        .iter()
        .zip(&actual)
        .enumerate()
        .find_map(|(index, (expected, actual))| {
            table_differences(document, expected, actual, truncate_alignments)
                .into_iter()
                .next()
                .map(|difference| format!("table {index} {difference}"))
        })
}

#[test]
fn tables_match_the_web_table_model() {
    let entries = load();
    let mut failures = Vec::new();
    for entry in &entries {
        let document = parse(&entry.text);
        let allowed = TABLE_ALLOWED.iter().any(|(name, _)| *name == entry.name);
        let exact = first_table_difference(entry, &document, false);
        if allowed {
            if exact.is_none() {
                failures.push(format!(
                    "{} is allowed to differ but matches the vector",
                    entry.name
                ));
            } else if let Some(difference) = first_table_difference(entry, &document, true) {
                failures.push(format!(
                    "{} differs beyond the allowed alignments: {difference}",
                    entry.name
                ));
            }
        } else if let Some(difference) = exact {
            failures.push(format!("{} differs: {difference}", entry.name));
        }
    }
    for (name, reason) in TABLE_ALLOWED {
        if !entries.iter().any(|entry| entry.name == *name) {
            failures.push(format!(
                "allowed table entry {name} ({reason}) has no vector"
            ));
        }
    }
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}

#[test]
fn allowed_table_entries_are_unique_and_explained() {
    let entries = load();
    let mut names = BTreeSet::new();
    for (name, reason) in TABLE_ALLOWED {
        assert!(names.insert(*name), "{name} is listed twice");
        assert!(!reason.is_empty(), "{name} has no reason");
        assert!(
            entries.iter().any(|entry| entry.name == *name),
            "{name} is not a corpus entry"
        );
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
