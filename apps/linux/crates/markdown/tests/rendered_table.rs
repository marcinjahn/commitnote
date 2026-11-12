use std::fs;
use std::path::PathBuf;

use commitnote_markdown::{
    ImageReference, MarkdownTable, Placement, RenderMode, RenderedTable, TableAlignment as A,
    TableCellContent, TableCellPiece, TableTextStyle, parse, render,
};
use serde::Deserialize;

const ID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";

fn rendered_tables(text: &str) -> Vec<RenderedTable> {
    render(&parse(text), &[], RenderMode::Editable)
        .placements
        .into_iter()
        .filter_map(|placement| match placement {
            Placement::Table { table } => Some(table),
            _ => None,
        })
        .collect()
}

fn build(text: &str) -> Option<RenderedTable> {
    rendered_tables(text).into_iter().next()
}

fn table(text: &str) -> RenderedTable {
    build(text).unwrap_or_else(|| panic!("no rendered table in {text:?}"))
}

fn source(text: &str) -> MarkdownTable {
    parse(text).tables().remove(0)
}

const PLAIN: TableTextStyle = TableTextStyle {
    emphasis: false,
    strong: false,
    strikethrough: false,
    code: false,
};
const EM: TableTextStyle = TableTextStyle {
    emphasis: true,
    ..PLAIN
};
const STRONG: TableTextStyle = TableTextStyle {
    strong: true,
    ..PLAIN
};
const EM_STRONG: TableTextStyle = TableTextStyle {
    emphasis: true,
    strong: true,
    ..PLAIN
};
const STRIKE: TableTextStyle = TableTextStyle {
    strikethrough: true,
    ..PLAIN
};
const EM_STRIKE: TableTextStyle = TableTextStyle {
    emphasis: true,
    strikethrough: true,
    ..PLAIN
};
const STRONG_CODE: TableTextStyle = TableTextStyle {
    strong: true,
    code: true,
    ..PLAIN
};
const CODE: TableTextStyle = TableTextStyle {
    code: true,
    ..PLAIN
};

/// A piece as shown, comparing an image by its id, size and alt only.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Shown {
    Text(String, TableTextStyle, Option<String>),
    Image(String, Option<u32>, Option<u32>, String),
}

fn text(text: &str) -> Shown {
    Shown::Text(text.to_owned(), PLAIN, None)
}

fn styled(text: &str, style: TableTextStyle) -> Shown {
    Shown::Text(text.to_owned(), style, None)
}

fn linked(text: &str, style: TableTextStyle, url: &str) -> Shown {
    Shown::Text(text.to_owned(), style, Some(url.to_owned()))
}

fn image(alt: &str) -> Shown {
    Shown::Image(ID.to_owned(), None, None, alt.to_owned())
}

fn shown(cell: &TableCellContent) -> Vec<Shown> {
    cell.pieces
        .iter()
        .map(|piece| match piece {
            TableCellPiece::Text { text, style, link } => {
                Shown::Text(text.clone(), *style, link.clone())
            }
            TableCellPiece::Image { reference } => Shown::Image(
                reference.image_id.clone(),
                reference.width,
                reference.height,
                reference.alt.clone(),
            ),
        })
        .collect()
}

fn plain_texts(row: &[TableCellContent]) -> Vec<&str> {
    row.iter().map(|cell| cell.plain_text.as_str()).collect()
}

fn carets(row: &[TableCellContent]) -> Vec<usize> {
    row.iter().map(|cell| cell.caret_offset).collect()
}

/// The cell of the web's single-column table `| h |\n| - |\n| <source> |`.
fn web_cell(source: &str) -> TableCellContent {
    table(&format!("| h |\n| - |\n| {source} |")).rows[1].remove(0)
}

#[test]
fn inactive_table_renders_with_styled_cells() {
    let rendered = table("| a | b |\n| - | :-: |\n| *x* | `y` |\n\nend");
    assert_eq!(rendered.alignments(), [A::Unspecified, A::Center]);
    assert_eq!(rendered.row_count(), 2);
    assert_eq!(rendered.column_count(), 2);
    assert_eq!(
        rendered.rows[0].iter().map(shown).collect::<Vec<_>>(),
        [vec![text("a")], vec![text("b")]]
    );
    assert_eq!(carets(&rendered.rows[0]), [3, 7]);
    assert_eq!(
        rendered.rows[1].iter().map(shown).collect::<Vec<_>>(),
        [vec![styled("x", EM)], vec![styled("y", CODE)]]
    );
    assert_eq!(carets(&rendered.rows[1]), [27, 33]);
    assert_eq!(rendered.range(), 0..35);
    assert_eq!(rendered.container_prefix(), "");
    assert_eq!(rendered.list_prefix(), "");
    assert_eq!(rendered.quote_level, 0);
}

#[test]
fn table_renders_without_selection() {
    assert_eq!(
        table("| a | b |\n| - | :-: |\n| *x* | `y` |\n\nend").row_count(),
        2
    );
}

#[test]
fn escapes_drop_their_backslash() {
    let header = table("| a \\| b | c\\*d |\n| - | - |").rows.remove(0);
    assert_eq!(shown(&header[0]), [text("a | b")]);
    assert_eq!(plain_texts(&header), ["a | b", "c*d"]);
}

#[test]
fn escaped_backslash_keeps_the_next_backslash_literal() {
    assert_eq!(table("| a\\\\\\* |\n| - |").rows[0][0].plain_text, "a\\*");
}

#[test]
fn image_label_and_autolink_keep_backslashes() {
    let rendered = table("| ![a\\*b](https://e.com/p.png) | <https://e.com/a\\*b> |\n| - | - |");
    assert_eq!(
        plain_texts(&rendered.rows[0]),
        ["a\\*b", "https://e.com/a\\*b"]
    );
    assert_eq!(
        shown(&rendered.rows[0][1]),
        [linked("https://e.com/a\\*b", PLAIN, "https://e.com/a\\*b")]
    );
}

#[test]
fn inline_code_keeps_backslash() {
    assert_eq!(
        shown(&table("| `a\\|b` |\n| - |").rows[0][0]),
        [styled("a\\|b", CODE)]
    );
}

#[test]
fn link_label_only() {
    let cell = table("| [t](https://e.com) |\n| - |")
        .rows
        .remove(0)
        .remove(0);
    assert_eq!(shown(&cell), [linked("t", PLAIN, "https://e.com")]);
    assert_eq!(cell.caret_offset, 20);

    let cell = table("| [label](https://e.x/a) |\n| - |")
        .rows
        .remove(0)
        .remove(0);
    assert_eq!(shown(&cell), [linked("label", PLAIN, "https://e.x/a")]);
    assert_eq!(cell.caret_offset, 24);
}

#[test]
fn reference_image_becomes_cell_piece() {
    let cell = table(&format!("| ![cat](image:{ID}) |\n| - |"))
        .rows
        .remove(0)
        .remove(0);
    assert_eq!(
        cell.pieces,
        [TableCellPiece::Image {
            reference: ImageReference {
                image_id: ID.to_owned(),
                width: None,
                height: None,
                alt: "cat".to_owned(),
                range: 2..42,
            }
        }]
    );
    assert_eq!(cell.plain_text, "cat");
    assert_eq!(cell.accessible_label, "cat");
    assert_eq!(cell.caret_offset, 42);
}

#[test]
fn strong_autolink_and_plain_image() {
    let rendered =
        table("| **H** | x |\n| --- | ---: |\n| <https://e.x/b> | ![p](https://e.x/p.png) |");
    assert_eq!(rendered.alignments(), [A::Unspecified, A::Right]);
    assert_eq!(shown(&rendered.rows[0][0]), [styled("H", STRONG)]);
    assert_eq!(
        shown(&rendered.rows[1][0]),
        [linked("https://e.x/b", PLAIN, "https://e.x/b")]
    );
    assert_eq!(shown(&rendered.rows[1][1]), [text("p")]);
}

#[test]
fn short_row_is_padded() {
    let row = table("| a | b |\n| - | - |\n| 1 |").rows.remove(1);
    assert_eq!(row.len(), 2);
    assert_eq!(carets(&row), [23, 25]);
    assert_eq!(row[1].pieces, []);
    assert_eq!(row[1].plain_text, "");
    assert_eq!(row[1].accessible_label, "Empty");
}

#[test]
fn blank_cell() {
    let cell = table("| a | |\n| - | - |").rows.remove(0).remove(1);
    assert_eq!(cell.caret_offset, 6);
    assert_eq!(cell.pieces, []);
    assert_eq!(cell.accessible_label, "Empty");
}

#[test]
fn blank_cell_without_a_space_keeps_its_caret_at_the_start() {
    let rows = table("| a ||\n| - | - |\n|\t| x |").rows;
    assert_eq!(rows[0][1].caret_offset, 5);
    assert_eq!(rows[1][0].caret_offset, 18);
    assert_eq!(rows[1][0].accessible_label, "Empty");
}

#[test]
fn quoted_table_keeps_quote_lines() {
    let rendered = table("> | a |\n> | - |\n> | 1 |");
    assert_eq!(rendered.quote_level, 1);
    assert_eq!(rendered.container_prefix(), "> ");
    assert_eq!(rendered.list_prefix(), "");
    assert_eq!(rendered.rows[1][0].caret_offset, 21);
    assert_eq!(plain_texts(&rendered.rows[1]), ["1"]);
}

#[test]
fn list_nested_table() {
    let rendered = table("- x\n\n  | a |\n  | - |");
    assert_eq!(rendered.range(), 5..20);
    assert_eq!(rendered.container_prefix(), "  ");
    assert_eq!(rendered.list_prefix(), "  ");
    assert_eq!(rendered.quote_level, 0);
}

#[test]
fn list_prefix_follows_the_last_quote_mark() {
    for (text, prefix, list_prefix, quote_level) in [
        ("> > | a |\n> > | - |", "> > ", "", 2),
        ("> - x\n>\n>   | a |\n>   | - |", ">   ", "  ", 1),
        (">\t| a |\n>\t| - |", ">\t", "", 1),
        ("- x\n\n  > | a |\n  > | - |", "  > ", "", 1),
    ] {
        let rendered = table(text);
        assert_eq!(rendered.container_prefix(), prefix, "{text:?}");
        assert_eq!(rendered.list_prefix(), list_prefix, "{text:?}");
        assert_eq!(rendered.quote_level, quote_level, "{text:?}");
    }
}

#[test]
fn image_without_alt_is_spoken_as_image() {
    let cell = table(&format!("| ![](image:{ID}) |\n| - |"))
        .rows
        .remove(0)
        .remove(0);
    assert_eq!(cell.plain_text, "");
    assert_eq!(cell.accessible_label, "Image");
}

#[test]
fn irregular_prefix_gives_no_table() {
    for text in [
        "> | a | b |\n> | - | - |\n| 1 | 2 |",
        "- a\n\n  | x |\n  | - |\n  | 1 |\n| 2 |",
    ] {
        assert_eq!(source(text).container_prefix, None, "{text:?}");
        assert_eq!(build(text), None, "{text:?}");
    }
}

#[test]
fn extra_cells_are_dropped_and_alignments_follow_the_delimiter() {
    let rendered = table("| a | b |\n| :-- | --: |\n| 1 | 2 | 3 |");
    assert_eq!(rendered.alignments(), [A::Left, A::Right]);
    assert_eq!(plain_texts(&rendered.rows[1]), ["1", "2"]);
}

#[test]
fn renders_plain_text() {
    assert_eq!(shown(&web_cell("plain words")), [text("plain words")]);
}

#[test]
fn renders_emphasis_strong_and_strikethrough() {
    assert_eq!(shown(&web_cell("*a*")), [styled("a", EM)]);
    assert_eq!(shown(&web_cell("**a**")), [styled("a", STRONG)]);
    assert_eq!(shown(&web_cell("~~a~~")), [styled("a", STRIKE)]);
}

#[test]
fn renders_superscript_and_subscript_as_typed() {
    assert_eq!(shown(&web_cell("x^2^")), [text("x^2^")]);
    assert_eq!(shown(&web_cell("H~2~O")), [text("H~2~O")]);
}

#[test]
fn renders_inline_code_unchanged() {
    assert_eq!(shown(&web_cell("`a *b* <c>`")), [styled("a *b* <c>", CODE)]);
}

#[test]
fn mixes_several_kinds() {
    assert_eq!(
        shown(&web_cell("**a** and *b*")),
        [styled("a", STRONG), text(" and "), styled("b", EM)]
    );
}

#[test]
fn renders_nested_formatting() {
    assert_eq!(
        shown(&web_cell("**bold *both***")),
        [styled("bold ", STRONG), styled("both", EM_STRONG)]
    );
}

#[test]
fn renders_a_link_with_an_openable_destination() {
    assert_eq!(
        shown(&web_cell("[site](https://example.com)")),
        [linked("site", PLAIN, "https://example.com")]
    );
}

#[test]
fn renders_formatting_inside_a_link_label() {
    assert_eq!(
        shown(&web_cell("[**site**](https://example.com)")),
        [linked("site", STRONG, "https://example.com")]
    );
    assert_eq!(
        shown(&web_cell("[a *b*](https://example.com)")),
        [
            linked("a ", PLAIN, "https://example.com"),
            linked("b", EM, "https://example.com")
        ]
    );
}

#[test]
fn adds_a_scheme_to_a_www_link() {
    assert_eq!(
        shown(&web_cell("[site](www.example.com)")),
        [linked("site", PLAIN, "https://www.example.com")]
    );
}

#[test]
fn renders_a_link_with_a_non_openable_destination_as_its_label() {
    assert_eq!(
        shown(&web_cell("[x](javascript:alert(1))")),
        [Shown::Text("x".to_owned(), PLAIN, None)]
    );
}

#[test]
fn does_not_nest_links_for_a_url_shaped_label() {
    assert_eq!(
        shown(&web_cell("[https://a.com](https://b.com)")),
        [linked("https://a.com", PLAIN, "https://b.com")]
    );
}

#[test]
fn adjacent_links_keep_their_own_destinations() {
    assert_eq!(
        shown(&web_cell("[a](https://e.x/1)[b](https://e.x/2)")),
        [
            linked("a", PLAIN, "https://e.x/1"),
            linked("b", PLAIN, "https://e.x/2")
        ]
    );
    assert_eq!(
        shown(&web_cell("<https://e.x/1><https://e.x/2>")),
        [
            linked("https://e.x/1", PLAIN, "https://e.x/1"),
            linked("https://e.x/2", PLAIN, "https://e.x/2")
        ]
    );
}

#[test]
fn renders_an_autolink() {
    assert_eq!(
        shown(&web_cell("<https://example.com>")),
        [linked("https://example.com", PLAIN, "https://example.com")]
    );
}

#[test]
fn renders_a_bare_url() {
    assert_eq!(
        shown(&web_cell("see https://example.com now")),
        [
            text("see "),
            linked("https://example.com", PLAIN, "https://example.com"),
            text(" now")
        ]
    );
}

#[test]
fn renders_an_image_as_its_alt_text() {
    assert_eq!(shown(&web_cell("![a cat](cat.png)")), [text("a cat")]);
}

#[test]
fn renders_an_image_reference_as_an_image_piece() {
    let cell = web_cell(&format!("![a cat](image:{ID}#800x600)"));
    assert_eq!(
        shown(&cell),
        [Shown::Image(
            ID.to_owned(),
            Some(800),
            Some(600),
            "a cat".to_owned()
        )]
    );
    assert_eq!(cell.plain_text, "a cat");
}

#[test]
fn unescapes_the_alt_text_of_an_image_reference() {
    let cell = web_cell(&format!("![a \\*cat\\*](image:{ID})"));
    assert_eq!(shown(&cell), [image("a *cat*")]);
    assert_eq!(cell.accessible_label, "a *cat*");
}

#[test]
fn keeps_the_label_of_an_external_image_as_typed() {
    assert_eq!(
        shown(&web_cell("![a cat](https://example.com/cat.png)")),
        [text("a cat")]
    );
    assert_eq!(
        shown(&web_cell("![*a* \\*b](https://example.com/cat.png)")),
        [text("*a* \\*b")]
    );
}

#[test]
fn renders_an_escaped_pipe_and_other_escapes() {
    assert_eq!(shown(&web_cell("a \\| b")), [text("a | b")]);
    assert_eq!(shown(&web_cell("\\*x\\*")), [text("*x*")]);
}

#[test]
fn keeps_an_emoji_shortcode_as_typed() {
    assert_eq!(shown(&web_cell(":smile:")), [text(":smile:")]);
}

#[test]
fn keeps_an_entity_as_source() {
    assert_eq!(shown(&web_cell("&amp;")), [text("&amp;")]);
}

#[test]
fn keeps_an_html_tag_as_source_text() {
    assert_eq!(shown(&web_cell("<b>x</b>")), [text("<b>x</b>")]);
}

#[test]
fn keeps_characters_outside_the_basic_plane() {
    let cell = web_cell("😀 *é😀*");
    assert_eq!(shown(&cell), [text("😀 "), styled("é😀", EM)]);
    assert_eq!(cell.caret_offset, 22);
}

#[test]
fn accessible_label_is_trimmed() {
    let cell = web_cell("[ a ](https://e.x)");
    assert_eq!(cell.plain_text, " a ");
    assert_eq!(cell.accessible_label, "a");
}

struct Construct {
    source: String,
    pieces: Vec<Shown>,
}

fn construct(source: &str, pieces: Vec<Shown>) -> Construct {
    Construct {
        source: source.to_owned(),
        pieces,
    }
}

fn constructs() -> Vec<Construct> {
    vec![
        construct("plain", vec![text("plain")]),
        construct("*em*", vec![styled("em", EM)]),
        construct("_em_", vec![styled("em", EM)]),
        construct("**st**", vec![styled("st", STRONG)]),
        construct("***both***", vec![styled("both", EM_STRONG)]),
        construct("~~del~~", vec![styled("del", STRIKE)]),
        construct("`c\\*d`", vec![styled("c\\*d", CODE)]),
        construct(
            "[lab](https://e.x/a)",
            vec![linked("lab", PLAIN, "https://e.x/a")],
        ),
        construct(
            "**[l](https://e.x/s)**",
            vec![linked("l", STRONG, "https://e.x/s")],
        ),
        construct(
            "<https://e.x/b>",
            vec![linked("https://e.x/b", PLAIN, "https://e.x/b")],
        ),
        construct(
            "https://e.x/c",
            vec![linked("https://e.x/c", PLAIN, "https://e.x/c")],
        ),
        construct("\\*lit\\*", vec![text("*lit*")]),
        construct("a\\\\b", vec![text("a\\b")]),
        construct(&format!("![cat](image:{ID})"), vec![image("cat")]),
        construct("![p](https://e.x/p.png)", vec![text("p")]),
        construct("![a\\*b](https://e.x/p.png)", vec![text("a\\*b")]),
        construct("^sup^", vec![text("^sup^")]),
        construct("x<sub>2</sub>", vec![text("x<sub>2</sub>")]),
        construct("&amp;", vec![text("&amp;")]),
        construct("<b>x</b>", vec![text("<b>x</b>")]),
        construct(":smile:", vec![text(":smile:")]),
        construct(
            "[a\\*b](https://e.x/a)",
            vec![linked("a*b", PLAIN, "https://e.x/a")],
        ),
        construct("~~*x*~~", vec![styled("x", EM_STRIKE)]),
        construct("**`c`**", vec![styled("c", STRONG_CODE)]),
        construct("a\\b\\", vec![text("a\\b\\")]),
    ]
}

/// Adds unstyled text before or after, merged with an unstyled neighbour.
fn surrounded(mut pieces: Vec<Shown>, before: &str, after: &str) -> Vec<Shown> {
    if !before.is_empty() {
        match unstyled_text(pieces.first_mut()) {
            Some(first) => first.insert_str(0, before),
            None => pieces.insert(0, text(before)),
        }
    }
    if !after.is_empty() {
        match unstyled_text(pieces.last_mut()) {
            Some(last) => last.push_str(after),
            None => pieces.push(text(after)),
        }
    }
    pieces
}

fn unstyled_text(piece: Option<&mut Shown>) -> Option<&mut String> {
    match piece {
        Some(Shown::Text(text, PLAIN, None)) => Some(text),
        _ => None,
    }
}

fn plain_text_of(pieces: &[Shown]) -> String {
    pieces
        .iter()
        .map(|piece| match piece {
            Shown::Text(text, ..) | Shown::Image(_, _, _, text) => text.as_str(),
        })
        .collect()
}

#[test]
fn construct_matrix() {
    let positions = [("", ""), ("x ", ""), ("", " y")];
    let containers: [(&str, &str); 3] = [("", ""), ("", "> "), ("- item\n\n", "  ")];
    for construct in constructs() {
        for (before, after) in positions {
            let cell = format!("{before}{}{after}", construct.source);
            let expected = surrounded(construct.pieces.clone(), before, after);
            let plain_text = plain_text_of(&expected);
            for column in 0..3 {
                let mut others = ["p", "q"].into_iter();
                let row: Vec<&str> = (0..3)
                    .map(|index| {
                        if index == column {
                            cell.as_str()
                        } else {
                            others.next().unwrap()
                        }
                    })
                    .collect();
                let row = format!("| {} |", row.join(" | "));
                for (lead, prefix) in containers {
                    let text = format!("{lead}{prefix}{row}\n{prefix}| - | - | - |\n{prefix}{row}");
                    let source = source(&text);
                    let rendered = table(&text);
                    assert_eq!(rendered.row_count(), 2, "{text:?}");
                    for (index, line) in [source.header(), &source.rows()[0]].iter().enumerate() {
                        let cells = &rendered.rows[index];
                        let cell = &cells[column];
                        assert_eq!(shown(cell), expected, "{text:?} row {index}");
                        assert_eq!(cell.plain_text, plain_text, "{text:?} row {index}");
                        assert_eq!(cell.accessible_label, plain_text, "{text:?} row {index}");
                        assert_eq!(
                            cell.caret_offset, line.cells[column].content_range.end,
                            "{text:?} row {index}"
                        );
                        let others: Vec<&str> = cells
                            .iter()
                            .enumerate()
                            .filter(|(other, _)| *other != column)
                            .map(|(_, cell)| cell.plain_text.as_str())
                            .collect();
                        assert_eq!(others, ["p", "q"], "{text:?} row {index}");
                    }
                }
            }
        }
    }
}

#[derive(Deserialize)]
struct Vectors {
    entries: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    name: String,
    text: String,
}

#[test]
fn corpus_tables_render() {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../markdown-vectors/vectors.json");
    let json = fs::read_to_string(&path).expect("read vectors.json");
    let entries = serde_json::from_str::<Vectors>(&json)
        .expect("parse vectors.json")
        .entries;
    let mut checked = 0;
    for entry in &entries {
        let name = &entry.name;
        let d = parse(&entry.text);
        let tables: Vec<MarkdownTable> = d
            .tables()
            .into_iter()
            .filter(|table| table.container_prefix.is_some())
            .collect();
        let rendered_tables = rendered_tables(&entry.text);
        assert_eq!(rendered_tables.len(), tables.len(), "{name}");
        for (table, rendered) in tables.iter().zip(rendered_tables) {
            assert_eq!(rendered.source, *table, "{name}");
            assert_eq!(rendered.row_count(), 1 + table.rows().len(), "{name}");
            let lines = std::iter::once(table.header()).chain(table.rows());
            for (row, line) in rendered.rows.iter().zip(lines) {
                assert_eq!(row.len(), table.column_count, "{name}");
                for cell in row {
                    assert!(
                        line.range.contains(&cell.caret_offset)
                            || cell.caret_offset == line.range.end,
                        "{name}: caret {} outside {:?}",
                        cell.caret_offset,
                        line.range
                    );
                    let label = &cell.accessible_label;
                    assert!(
                        !label.is_empty() && label.trim() == label,
                        "{name}: label {label:?}"
                    );
                }
            }
            assert!(rendered.same_content(&rendered), "{name}");
            checked += 1;
        }
    }
    assert!(checked > 0);
}

#[test]
fn same_content_ignores_ranges_and_carets() {
    let text = format!("| a | ![cat](image:{ID}) |\n| - | :-: |\n| *x* | |");
    let rendered = table(&text);
    let moved = table(&format!("typed above\n\n{text}"));
    assert_ne!(rendered, moved);
    assert!(rendered.same_content(&moved));
    assert!(moved.same_content(&rendered));

    let mut caret_moved = rendered.clone();
    caret_moved.rows[1][0].caret_offset += 1;
    assert!(rendered.same_content(&caret_moved));
}

#[test]
fn same_content_sees_changed_text_alignment_and_alt() {
    let rendered = table(&format!(
        "| a | ![cat](image:{ID}) |\n| - | :-: |\n| *x* | |"
    ));
    for changed in [
        format!("| b | ![cat](image:{ID}) |\n| - | :-: |\n| *x* | |"),
        format!("| a | ![cat](image:{ID}) |\n| - | --: |\n| *x* | |"),
        format!("| a | ![dog](image:{ID}) |\n| - | :-: |\n| *x* | |"),
        format!("| a | ![cat](image:{ID}) |\n| - | :-: |\n| **x** | |"),
        format!("| a | ![cat](image:{ID}#10x20) |\n| - | :-: |\n| *x* | |"),
        format!("> | a | ![cat](image:{ID}) |\n> | - | :-: |\n> | *x* | |"),
    ] {
        assert!(!rendered.same_content(&table(&changed)), "{changed:?}");
    }
}
