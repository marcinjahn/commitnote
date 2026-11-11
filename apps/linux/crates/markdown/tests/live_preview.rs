#![allow(clippy::single_range_in_vec_init)]

use std::ops::Range;

use commitnote_editor_text::TextSelection;
use commitnote_markdown::{
    ImageReference, Placement, PreviewStyle, RenderMode, RenderOutput, RenderedTable, StyleRun,
    parse, rendered_table,
};

const ID: &str = "abcdefghijklmnopqrstuvwxyz";

fn render_in(text: &str, selection: &[TextSelection], mode: RenderMode) -> RenderOutput {
    commitnote_markdown::render(&parse(text), selection, mode)
}

fn render_with(text: &str, selection: &[TextSelection]) -> RenderOutput {
    render_in(text, selection, RenderMode::Editable)
}

fn render(text: &str, caret: Option<usize>) -> RenderOutput {
    let selection: Vec<TextSelection> = caret
        .map(|location| TextSelection::new(location, 0))
        .into_iter()
        .collect();
    render_with(text, &selection)
}

fn styled(runs: &[StyleRun], style: PreviewStyle) -> Vec<Range<usize>> {
    runs.iter()
        .filter(|run| run.style == style)
        .map(|run| run.range.clone())
        .collect()
}

fn hidden(text: &str, caret: Option<usize>) -> Vec<Range<usize>> {
    styled(&render(text, caret).runs, PreviewStyle::Hidden)
}

fn hidden_with(text: &str, selection: &[TextSelection]) -> Vec<Range<usize>> {
    styled(&render_with(text, selection).runs, PreviewStyle::Hidden)
}

#[test]
fn atx_header_mark_and_space_hidden_off_line() {
    let text = "para\n## Title";
    assert_eq!(hidden(text, Some(0)), [5..8]);
    assert_eq!(hidden(text, Some(8)), []);
    assert_eq!(hidden(text, Some(5)), []);
    assert_eq!(hidden(text, None), [5..8]);
}

#[test]
fn heading_styles_by_level() {
    for level in 1..=6u8 {
        let marks = "#".repeat(usize::from(level));
        let runs = render(&format!("{marks} T"), None).runs;
        assert_eq!(
            styled(&runs, PreviewStyle::Heading { level }),
            [0..usize::from(level) + 2]
        );
    }
}

#[test]
fn setext_heading_styled_and_underline_never_hidden() {
    let text = "Title\n===";
    let runs = render(text, None).runs;
    assert_eq!(styled(&runs, PreviewStyle::Heading { level: 1 }), [0..9]);
    assert_eq!(styled(&runs, PreviewStyle::MutedMarker), [6..9]);
    assert_eq!(hidden(text, None), []);
    assert_eq!(
        styled(
            &render("Title\n---", None).runs,
            PreviewStyle::Heading { level: 2 }
        ),
        [0..9]
    );
}

#[test]
fn quote_mark_hidden_off_line_with_space_and_lines_styled() {
    let text = "> a\n> b\n\nz";
    let result = render(text, Some(10));
    assert_eq!(styled(&result.runs, PreviewStyle::Hidden), [0..2, 4..6]);
    assert_eq!(styled(&result.runs, PreviewStyle::QuoteLine), [0..3, 4..7]);
    assert_eq!(hidden(text, Some(1)), [4..6]);
    assert_eq!(hidden(text, Some(5)), [0..2]);
}

#[test]
fn emphasis_and_strikethrough_marks_hidden_off_line() {
    let text = "x\n*a* **b** ~~c~~";
    assert_eq!(
        hidden(text, Some(0)),
        [2..3, 4..5, 6..8, 9..11, 12..14, 15..17]
    );
    assert_eq!(hidden(text, Some(5)), []);
    let runs = render(text, None).runs;
    assert_eq!(styled(&runs, PreviewStyle::Emphasis), [2..5]);
    assert_eq!(styled(&runs, PreviewStyle::Strong), [6..11]);
    assert_eq!(styled(&runs, PreviewStyle::Strikethrough), [12..17]);
}

#[test]
fn inline_code_marks_hidden_but_fence_marks_never() {
    let text = "a `b`\n```\nc\n```";
    let off = render(text, Some(12));
    assert_eq!(styled(&off.runs, PreviewStyle::Hidden), [2..3, 4..5]);
    assert_eq!(styled(&off.runs, PreviewStyle::InlineCode), [2..5]);
    assert_eq!(
        styled(&off.runs, PreviewStyle::CodeBlockLine),
        [6..9, 10..11, 12..15]
    );
    assert_eq!(styled(&off.runs, PreviewStyle::MutedMarker), [6..9, 12..15]);
    assert_eq!(hidden(text, Some(3)), []);
    assert_eq!(hidden("```\nc\n```", None), []);
}

#[test]
fn link_marks_and_destination_hidden_off_line() {
    let text = "x\n[label](https://a.b)";
    assert_eq!(hidden(text, Some(0)), [2..3, 8..9, 9..10, 10..21, 21..22]);
    assert_eq!(hidden(text, Some(6)), []);
    let runs = render(text, Some(0)).runs;
    assert_eq!(styled(&runs, PreviewStyle::Link), [3..8]);
}

#[test]
fn bare_url_and_autolink_are_styled_not_hidden() {
    let text = "see https://a.b and <https://c.d>";
    let result = render(text, None);
    let urls = styled(&result.runs, PreviewStyle::Url);
    assert!(urls.contains(&(4..15)));
    assert!(urls.contains(&(21..32)));
    assert_eq!(hidden(text, None), []);
}

#[test]
fn multi_line_selection_activates_every_touched_line() {
    let text = "*a*\n*b*\n*c*";
    assert_eq!(
        hidden_with(text, &[TextSelection::new(2, 3)]),
        [8..9, 10..11]
    );
    assert_eq!(hidden_with(text, &[TextSelection::new(0, 11)]), []);
}

#[test]
fn any_of_several_selections_activates_its_line() {
    let text = "*a*\n*b*\n*c*";
    let selection = [TextSelection::new(1, 0), TextSelection::new(9, 0)];
    assert_eq!(hidden_with(text, &selection), [4..5, 6..7]);
}

#[test]
fn activity_is_decided_per_marker_line() {
    let text = "**a\nb**\n\nz";
    assert_eq!(hidden(text, Some(9)), [0..2, 5..7]);
    assert_eq!(hidden(text, Some(5)), [0..2]);
    assert_eq!(hidden(text, Some(1)), [5..7]);
}

#[test]
fn list_marks_are_never_hidden() {
    let text = "- a\n1. b";
    for caret in [Some(0), Some(5), None] {
        let runs = render(text, caret).runs;
        assert_eq!(styled(&runs, PreviewStyle::ListMark), [0..1, 4..6]);
        assert_eq!(styled(&runs, PreviewStyle::Hidden), []);
    }
}

#[test]
fn checkbox_placement_even_on_active_line() {
    let text = "- [ ] a\n- [x] b\n- [X] c";
    for caret in [Some(0), Some(5), None] {
        assert_eq!(
            render(text, caret).placements,
            [
                Placement::Checkbox {
                    range: 2..5,
                    checked: false
                },
                Placement::Checkbox {
                    range: 10..13,
                    checked: true
                },
                Placement::Checkbox {
                    range: 18..21,
                    checked: true
                },
            ]
        );
    }
    assert_eq!(hidden(text, Some(0)), []);
}

#[test]
fn horizontal_rule_hidden_with_placement_off_line() {
    let text = "a\n\n---\n\nb";
    let off = render(text, Some(0));
    assert_eq!(styled(&off.runs, PreviewStyle::Hidden), [3..6]);
    assert_eq!(off.placements, [Placement::Rule { line_range: 3..6 }]);
    let on = render(text, Some(4));
    assert_eq!(styled(&on.runs, PreviewStyle::Hidden), []);
    assert_eq!(on.placements, []);
}

#[test]
fn image_reference_hidden_off_line_and_placed_either_way() {
    let text = format!("a\n![alt](image:{ID}#10x20)");
    let end = text.encode_utf16().count();
    let reference = ImageReference {
        image_id: ID.to_owned(),
        width: Some(10),
        height: Some(20),
        alt: "alt".to_owned(),
        range: 2..end,
    };
    let off = render(&text, Some(0));
    assert_eq!(styled(&off.runs, PreviewStyle::Hidden), [2..end]);
    assert_eq!(
        off.placements,
        [Placement::Image {
            reference: reference.clone(),
            line_range: 2..end,
            source_visible: false
        }]
    );
    let on = render(&text, Some(5));
    assert_eq!(styled(&on.runs, PreviewStyle::Hidden), []);
    assert_eq!(
        on.placements,
        [Placement::Image {
            reference,
            line_range: 2..end,
            source_visible: true
        }]
    );
}

#[test]
fn ordinary_image_is_not_placed_or_hidden() {
    let result = render("![a](https://x.y/a.png)", None);
    assert_eq!(result.placements, []);
    assert_eq!(styled(&result.runs, PreviewStyle::Hidden), []);
}

#[test]
fn run_order_puts_hidden_last() {
    let runs = render("# *a*", None).runs;
    assert_eq!(runs.last().unwrap().style, PreviewStyle::Hidden);
    let first_hidden = runs
        .iter()
        .position(|run| run.style == PreviewStyle::Hidden)
        .unwrap();
    assert!(
        runs[first_hidden..]
            .iter()
            .all(|run| run.style == PreviewStyle::Hidden)
    );
}

fn caret(location: usize) -> [TextSelection; 1] {
    [TextSelection::new(location, 0)]
}

fn tables(output: &RenderOutput) -> Vec<&RenderedTable> {
    output
        .placements
        .iter()
        .filter_map(|placement| match placement {
            Placement::Table { table } => Some(table),
            _ => None,
        })
        .collect()
}

fn table_source(text: &str, caret: Option<usize>) -> (Vec<Range<usize>>, Vec<Range<usize>>) {
    let runs = render(text, caret).runs;
    (
        styled(&runs, PreviewStyle::TableSourceLine),
        styled(&runs, PreviewStyle::MutedMarker),
    )
}

fn assert_revealed(output: &RenderOutput, table_lines: &[Range<usize>]) {
    assert!(tables(output).is_empty(), "{:?}", output.placements);
    assert_eq!(
        styled(&output.runs, PreviewStyle::TableSourceLine),
        table_lines
    );
    let hidden = styled(&output.runs, PreviewStyle::Hidden);
    let hides_a_line = |range: &Range<usize>| {
        table_lines
            .iter()
            .any(|line| range.start <= line.start && line.end <= range.end)
    };
    assert!(
        !hidden.iter().any(hides_a_line),
        "{hidden:?} hides table lines {table_lines:?}"
    );
}

#[test]
fn table_without_selection_renders_over_hidden_source() {
    let text = "before\n\n| a | *b* |\n| :- | -: |\n| 1 | 2 |\n\nafter";
    let d = parse(text);
    let output = commitnote_markdown::render(&d, &[], RenderMode::Editable);
    let table_hidden = [8..19, 20..42];
    assert_eq!(
        styled(&output.runs, PreviewStyle::Hidden),
        [
            14..15,
            16..17,
            table_hidden[0].clone(),
            table_hidden[1].clone()
        ]
    );
    assert_eq!(styled(&output.runs, PreviewStyle::TableSourceLine), []);
    assert_eq!(styled(&output.runs, PreviewStyle::Emphasis), [14..17]);
    assert!(
        output
            .runs
            .iter()
            .all(|run| run.range.start >= 8 && run.range.end <= 42),
        "text around the table is styled: {:?}",
        output.runs
    );

    let gathered: Vec<StyleRun> = output
        .runs
        .iter()
        .filter(|run| !(run.style == PreviewStyle::Hidden && table_hidden.contains(&run.range)))
        .cloned()
        .collect();
    assert_eq!(gathered.len(), output.runs.len() - 2);
    let expected = rendered_table(&d, &d.tables()[0], &gathered).unwrap();
    assert_eq!(tables(&output), [&expected]);
    assert_eq!(expected.rows[0][1].plain_text, "b");
}

#[test]
fn table_at_the_end_hides_up_to_its_last_line() {
    let text = "| a | b |\n| - | - |\n| 1 | 2 |";
    let output = render(text, None);
    assert_eq!(styled(&output.runs, PreviewStyle::Hidden), [0..9, 10..29]);
    assert_eq!(tables(&output).len(), 1);
}

#[test]
fn caret_on_any_table_line_reveals_the_source() {
    let text = "| a | b |\n| - | - |\n| 1 | 2 |\n\nz";
    let lines = [0..9, 10..19, 20..29];
    for location in [0, 5, 9, 10, 15, 20, 29] {
        assert_revealed(&render(text, Some(location)), &lines);
    }
    assert_eq!(tables(&render(text, Some(31))).len(), 1);
    assert_eq!(tables(&render(text, Some(30))).len(), 1);
}

#[test]
fn partial_selections_reveal_the_source() {
    let text = "x\n\n| a | b |\n| - | - |\n\ny";
    let lines = [3..12, 13..22];
    for selection in [
        TextSelection::new(15, 10),
        TextSelection::new(0, 3),
        TextSelection::new(5, 2),
    ] {
        assert_revealed(&render_with(text, &[selection]), &lines);
    }
    assert_eq!(
        tables(&render_with(text, &[TextSelection::new(0, 2)])).len(),
        1
    );
}

#[test]
fn read_only_always_renders_and_still_reveals_other_markers() {
    let text = "*x*\n\n| a | *b* |\n| - | - |";
    let rendered = render(text, None);
    let selections = [caret(1), caret(7), [TextSelection::new(0, 27)]];
    for selection in &selections {
        let output = render_in(text, selection, RenderMode::ReadOnly);
        assert_eq!(output.placements, rendered.placements, "{selection:?}");
        assert!(styled(&output.runs, PreviewStyle::Hidden).contains(&(5..16)));
        assert_eq!(styled(&output.runs, PreviewStyle::TableSourceLine), []);
    }
    let on_first_line = render_in(text, &caret(1), RenderMode::ReadOnly);
    assert!(!styled(&on_first_line.runs, PreviewStyle::Hidden).contains(&(0..1)));
    let muted = styled(&on_first_line.runs, PreviewStyle::MutedMarker);
    assert!(
        muted.contains(&(0..1)) && muted.contains(&(2..3)),
        "{muted:?}"
    );
    assert!(
        styled(
            &render_in(text, &[], RenderMode::ReadOnly).runs,
            PreviewStyle::Hidden
        )
        .contains(&(0..1))
    );
}

#[test]
fn quoted_table_renders_and_keeps_its_quote_lines() {
    let text = "> | a |\n> | - |\n\nz";
    let output = render(text, None);
    assert_eq!(
        styled(&output.runs, PreviewStyle::Hidden),
        [0..2, 8..10, 0..7, 8..16]
    );
    assert_eq!(styled(&output.runs, PreviewStyle::QuoteLine), [0..7, 8..15]);
    let rendered = tables(&output);
    assert_eq!(rendered.len(), 1);
    assert_eq!(rendered[0].quote_level, 1);
    assert_revealed(&render(text, Some(3)), &[0..7, 8..15]);
}

#[test]
fn table_in_a_list_item_hides_only_its_own_lines() {
    let text = "- x\n\n  | a |\n  | - |";
    let output = render(text, None);
    assert_eq!(styled(&output.runs, PreviewStyle::Hidden), [5..12, 13..20]);
    assert_eq!(styled(&output.runs, PreviewStyle::ListMark), [0..1]);
    assert_eq!(tables(&output)[0].list_prefix(), "  ");
    assert_revealed(&render(text, Some(14)), &[5..12, 13..20]);
}

#[test]
fn table_with_irregular_prefixes_stays_source() {
    let text = "> | a | b |\n> | - | - |\n| 1 | 2 |";
    for mode in [RenderMode::Editable, RenderMode::ReadOnly] {
        let output = render_in(text, &[], mode);
        assert!(tables(&output).is_empty());
        assert_eq!(
            styled(&output.runs, PreviewStyle::TableSourceLine),
            [0..11, 12..23, 24..33]
        );
    }
}

#[test]
fn images_in_a_rendered_table_belong_to_the_table() {
    let text = format!("| ![cat](image:{ID}) |\n| - |\n\n![dog](image:{ID})");
    let rendered = render(&text, None);
    assert_eq!(rendered.placements.len(), 2);
    assert!(matches!(rendered.placements[0], Placement::Table { .. }));
    assert!(matches!(
        &rendered.placements[1],
        Placement::Image { reference, .. } if reference.alt == "dog"
    ));

    let revealed = render(&text, Some(3));
    assert!(tables(&revealed).is_empty());
    assert!(matches!(
        &revealed.placements[..],
        [
            Placement::Image { reference: cat, source_visible: true, .. },
            Placement::Image { reference: dog, source_visible: false, .. },
        ] if cat.alt == "cat" && dog.alt == "dog"
    ));
}

#[test]
fn two_tables_keep_document_order_among_placements() {
    let text = "| a |\n| - |\n\n---\n\n- [ ] t\n\n| b |\n| - |";
    let output = render(text, None);
    assert!(matches!(
        &output.placements[..],
        [
            Placement::Table { table: first },
            Placement::Rule { .. },
            Placement::Checkbox { .. },
            Placement::Table { table: second },
        ] if first.rows[0][0].plain_text == "a" && second.rows[0][0].plain_text == "b"
    ));
    let first_revealed = render(text, Some(0));
    assert!(matches!(
        &first_revealed.placements[..],
        [
            Placement::Rule { .. },
            Placement::Checkbox { .. },
            Placement::Table { table },
        ] if table.rows[0][0].plain_text == "b"
    ));
}

#[test]
fn revealed_table_lines_are_source_lines_with_muted_pipes_and_delimiter_row() {
    let text = "| a | b |\n| - | - |\n| 1 | 2 |";
    let (lines, mut muted) = table_source(text, Some(0));
    assert_eq!(lines, [0..9, 10..19, 20..29]);
    muted.sort_by_key(|range| range.start);
    assert_eq!(muted, [0..1, 4..5, 8..9, 10..19, 20..21, 24..25, 28..29]);
}

#[test]
fn escaped_pipe_in_a_cell_stays_unmuted() {
    let text = "| a \\| b | c |\n| - | - |";
    let (lines, mut muted) = table_source(text, Some(0));
    assert_eq!(lines, [0..14, 15..24]);
    muted.sort_by_key(|range| range.start);
    assert_eq!(muted, [0..1, 9..10, 13..14, 15..24]);
}

#[test]
fn escaped_pipe_in_a_code_span_stays_unmuted() {
    let text = "| `a\\|b` | c |\n| - | - |";
    let (_, mut muted) = table_source(text, Some(0));
    muted.retain(|range| range.len() == 1);
    muted.sort_by_key(|range| range.start);
    assert_eq!(muted, [0..1, 2..3, 7..8, 9..10, 13..14]);
}

#[test]
fn revealed_quoted_table_keeps_quote_lines_and_styles_whole_lines() {
    let runs = render("> | a |\n> | - |", Some(0)).runs;
    assert_eq!(styled(&runs, PreviewStyle::TableSourceLine), [0..7, 8..15]);
    assert_eq!(styled(&runs, PreviewStyle::QuoteLine), [0..7, 8..15]);
}

#[test]
fn cell_inline_styles_stay_under_a_rendered_and_a_revealed_table() {
    let text = "| **a** | `b` |\n| - | - |";
    let rendered = render(text, None).runs;
    assert_eq!(styled(&rendered, PreviewStyle::Strong), [2..7]);
    assert_eq!(styled(&rendered, PreviewStyle::InlineCode), [10..13]);
    assert_eq!(
        styled(&rendered, PreviewStyle::Hidden),
        [2..4, 5..7, 10..11, 12..13, 0..15, 16..25]
    );

    let revealed = render(text, Some(0)).runs;
    assert_eq!(styled(&revealed, PreviewStyle::Strong), [2..7]);
    assert_eq!(styled(&revealed, PreviewStyle::InlineCode), [10..13]);
    assert_eq!(
        styled(&revealed, PreviewStyle::TableSourceLine),
        [0..15, 16..25]
    );
    let muted = styled(&revealed, PreviewStyle::MutedMarker);
    for marker in [0..1, 2..4, 5..7, 8..9, 10..11, 12..13, 14..15, 16..25] {
        assert!(muted.contains(&marker), "{marker:?} not muted in {muted:?}");
    }
    assert_eq!(styled(&revealed, PreviewStyle::Hidden), []);
}

#[test]
fn text_that_is_not_a_table_has_no_table_source() {
    for text in ["a | b", "a | b\n- | -"] {
        let output = render(text, Some(0));
        assert_eq!(styled(&output.runs, PreviewStyle::TableSourceLine), []);
        assert!(
            tables(&render(text, None)).is_empty(),
            "{text:?} rendered as a table"
        );
    }
}

#[test]
fn revealed_source_is_the_same_from_every_table_line() {
    let text = "| a | b |\n| - | - |\n| 1 | 2 |";
    let expected = table_source(text, Some(0));
    for caret in [5, 12, 22, 29] {
        assert_eq!(table_source(text, Some(caret)), expected);
    }
}
