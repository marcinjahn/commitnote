#![allow(clippy::single_range_in_vec_init)]

use std::ops::Range;

use commitnote_editor_text::TextSelection;
use commitnote_markdown::{ImageReference, Placement, PreviewStyle, RenderOutput, StyleRun, parse};

const ID: &str = "abcdefghijklmnopqrstuvwxyz";

fn render_with(text: &str, selection: &[TextSelection]) -> RenderOutput {
    commitnote_markdown::render(&parse(text), selection)
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
