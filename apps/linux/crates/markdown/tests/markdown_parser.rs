use std::time::{Duration, Instant};

use commitnote_markdown::{SyntaxKind as K, SyntaxNode};

fn parse(text: &str) -> Vec<SyntaxNode> {
    commitnote_markdown::parse(text).nodes
}

fn n(kind: K, from: usize, to: usize) -> SyntaxNode {
    SyntaxNode::new(kind, from..to)
}

fn generated_note(count: usize) -> String {
    let patterns = [
        "# Heading with *emphasis*",
        "Some paragraph text with **bold**, _italic_ and `code` and a [link](https://example.com).",
        "- [ ] open task with ~~strike~~",
        "- [x] done task",
        "  - nested item www.example.com",
        "1. ordered item <https://example.com/a>",
        "> quoted text with ![image](image:abcdefghijklmnopqrstuvwxyz#640x480)",
        "```swift",
        "let value = items.map { $0 * 2 }",
        "```",
        "",
        "## Second *level* heading",
        "Plain text 😀 continues here with mail@example.com",
        "",
    ];
    (0..count)
        .map(|index| patterns[index % patterns.len()])
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn atx_heading_levels() {
    for level in 1..=6u8 {
        let marks = "#".repeat(usize::from(level));
        let size = usize::from(level);
        assert_eq!(
            parse(&format!("{marks} Title")),
            [
                n(K::AtxHeading { level }, 0, size + 6),
                n(K::HeaderMark, 0, size)
            ]
        );
    }
    assert_eq!(parse("####### Title"), [n(K::Paragraph, 0, 13)]);
}

#[test]
fn hashtag_is_not_a_heading() {
    assert_eq!(parse("#hashtag"), [n(K::Paragraph, 0, 8)]);
}

#[test]
fn atx_heading_closing_sequence_is_a_header_mark() {
    assert_eq!(
        parse("# Title ##"),
        [
            n(K::AtxHeading { level: 1 }, 0, 10),
            n(K::HeaderMark, 0, 1),
            n(K::HeaderMark, 8, 10)
        ]
    );
}

#[test]
fn setext_headings() {
    assert_eq!(
        parse("Title\n==="),
        [
            n(K::SetextHeading { level: 1 }, 0, 9),
            n(K::HeaderMark, 6, 9)
        ]
    );
    assert_eq!(
        parse("Title\n---"),
        [
            n(K::SetextHeading { level: 2 }, 0, 9),
            n(K::HeaderMark, 6, 9)
        ]
    );
}

#[test]
fn dashes_after_a_blank_line_or_a_non_paragraph_block_are_a_rule() {
    assert_eq!(
        parse("Title\n\n---"),
        [n(K::Paragraph, 0, 5), n(K::HorizontalRule, 7, 10)]
    );
    assert_eq!(
        parse("# H\n---"),
        [
            n(K::AtxHeading { level: 1 }, 0, 3),
            n(K::HeaderMark, 0, 1),
            n(K::HorizontalRule, 4, 7)
        ]
    );
    assert_eq!(parse("* * *"), [n(K::HorizontalRule, 0, 5)]);
}

#[test]
fn nested_blockquote_with_lazy_continuation() {
    assert_eq!(
        parse("> a\n> > b\nlazy"),
        [
            n(K::Blockquote, 0, 14),
            n(K::QuoteMark, 0, 1),
            n(K::Paragraph, 2, 3),
            n(K::QuoteMark, 4, 5),
            n(K::Blockquote, 6, 14),
            n(K::QuoteMark, 6, 7),
            n(K::Paragraph, 8, 14),
        ]
    );
}

#[test]
fn nested_bullet_list() {
    assert_eq!(
        parse("- a\n  - b\n- c"),
        [
            n(K::BulletList, 0, 13),
            n(K::ListItem, 0, 9),
            n(K::ListMark, 0, 1),
            n(K::Paragraph, 2, 3),
            n(K::BulletList, 6, 9),
            n(K::ListItem, 6, 9),
            n(K::ListMark, 6, 7),
            n(K::Paragraph, 8, 9),
            n(K::ListItem, 10, 13),
            n(K::ListMark, 10, 11),
            n(K::Paragraph, 12, 13),
        ]
    );
}

#[test]
fn nested_ordered_list() {
    assert_eq!(
        parse("1. a\n2. b\n   1) c"),
        [
            n(K::OrderedList, 0, 17),
            n(K::ListItem, 0, 4),
            n(K::ListMark, 0, 2),
            n(K::Paragraph, 3, 4),
            n(K::ListItem, 5, 17),
            n(K::ListMark, 5, 7),
            n(K::Paragraph, 8, 9),
            n(K::OrderedList, 13, 17),
            n(K::ListItem, 13, 17),
            n(K::ListMark, 13, 15),
            n(K::Paragraph, 16, 17),
        ]
    );
}

#[test]
fn task_items() {
    assert_eq!(
        parse("- [ ] task\n- [x] done\n* [X] Done\n1. [ ] numbered"),
        [
            n(K::BulletList, 0, 21),
            n(K::ListItem, 0, 10),
            n(K::ListMark, 0, 1),
            n(K::Task, 2, 10),
            n(K::TaskMarker { checked: false }, 2, 5),
            n(K::ListItem, 11, 21),
            n(K::ListMark, 11, 12),
            n(K::Task, 13, 21),
            n(K::TaskMarker { checked: true }, 13, 16),
            n(K::BulletList, 22, 32),
            n(K::ListItem, 22, 32),
            n(K::ListMark, 22, 23),
            n(K::Task, 24, 32),
            n(K::TaskMarker { checked: true }, 24, 27),
            n(K::OrderedList, 33, 48),
            n(K::ListItem, 33, 48),
            n(K::ListMark, 33, 35),
            n(K::Task, 36, 48),
            n(K::TaskMarker { checked: false }, 36, 39),
        ]
    );
}

#[test]
fn marker_without_space_is_not_a_task() {
    assert_eq!(parse("-[ ] no"), [n(K::Paragraph, 0, 7)]);
}

#[test]
fn fenced_code_with_info() {
    assert_eq!(
        parse("```swift\nlet x = 1\n```"),
        [
            n(K::FencedCode, 0, 22),
            n(K::CodeMark, 0, 3),
            n(K::CodeInfo, 3, 8),
            n(K::CodeText, 9, 18),
            n(K::CodeMark, 19, 22),
        ]
    );
}

#[test]
fn unclosed_fence_runs_to_the_end() {
    assert_eq!(
        parse("~~~\nopen\n**still**"),
        [
            n(K::FencedCode, 0, 18),
            n(K::CodeMark, 0, 3),
            n(K::CodeText, 4, 18)
        ]
    );
}

#[test]
fn indented_code() {
    assert_eq!(
        parse("    code\n    more"),
        [
            n(K::IndentedCode, 4, 17),
            n(K::CodeText, 4, 9),
            n(K::CodeText, 13, 17)
        ]
    );
    assert_eq!(parse("para\n    not code"), [n(K::Paragraph, 0, 17)]);
}

#[test]
fn inline_code_content_is_not_parsed() {
    assert_eq!(
        parse("`a*b*`"),
        [
            n(K::Paragraph, 0, 6),
            n(K::InlineCode, 0, 6),
            n(K::CodeMark, 0, 1),
            n(K::CodeMark, 5, 6)
        ]
    );
    assert_eq!(
        parse("``a ` b``"),
        [
            n(K::Paragraph, 0, 9),
            n(K::InlineCode, 0, 9),
            n(K::CodeMark, 0, 2),
            n(K::CodeMark, 7, 9)
        ]
    );
    assert_eq!(parse("`open"), [n(K::Paragraph, 0, 5)]);
}

#[test]
fn strong_and_emphasis() {
    assert_eq!(
        parse("**bold** *italic* _italic_"),
        [
            n(K::Paragraph, 0, 26),
            n(K::StrongEmphasis, 0, 8),
            n(K::EmphasisMark, 0, 2),
            n(K::EmphasisMark, 6, 8),
            n(K::Emphasis, 9, 17),
            n(K::EmphasisMark, 9, 10),
            n(K::EmphasisMark, 16, 17),
            n(K::Emphasis, 18, 26),
            n(K::EmphasisMark, 18, 19),
            n(K::EmphasisMark, 25, 26),
        ]
    );
}

#[test]
fn intraword_underscores_are_not_emphasis() {
    assert_eq!(parse("snake_case_word"), [n(K::Paragraph, 0, 15)]);
}

#[test]
fn triple_delimiters_nest_strong_inside_emphasis() {
    assert_eq!(
        parse("***both***"),
        [
            n(K::Paragraph, 0, 10),
            n(K::Emphasis, 0, 10),
            n(K::EmphasisMark, 0, 1),
            n(K::StrongEmphasis, 1, 9),
            n(K::EmphasisMark, 1, 3),
            n(K::EmphasisMark, 7, 9),
            n(K::EmphasisMark, 9, 10),
        ]
    );
}

#[test]
fn strikethrough_needs_two_tildes() {
    assert_eq!(
        parse("~~strike~~ ~single~"),
        [
            n(K::Paragraph, 0, 19),
            n(K::Strikethrough, 0, 10),
            n(K::StrikethroughMark, 0, 2),
            n(K::StrikethroughMark, 8, 10),
        ]
    );
}

#[test]
fn escaped_delimiters_are_literal() {
    assert_eq!(parse("\\*not\\*"), [n(K::Paragraph, 0, 7)]);
}

#[test]
fn link_with_title() {
    assert_eq!(
        parse("[link](https://x.com \"title\")"),
        [
            n(K::Paragraph, 0, 29),
            n(K::Link, 0, 29),
            n(K::LinkMark, 0, 1),
            n(K::LinkLabel, 1, 5),
            n(K::LinkMark, 5, 6),
            n(K::LinkMark, 6, 7),
            n(K::Url, 7, 20),
            n(K::LinkMark, 28, 29),
        ]
    );
}

#[test]
fn link_with_angle_bracket_destination() {
    assert_eq!(
        parse("[link](<a b>)"),
        [
            n(K::Paragraph, 0, 13),
            n(K::Link, 0, 13),
            n(K::LinkMark, 0, 1),
            n(K::LinkLabel, 1, 5),
            n(K::LinkMark, 5, 6),
            n(K::LinkMark, 6, 7),
            n(K::Url, 7, 12),
            n(K::LinkMark, 12, 13),
        ]
    );
}

#[test]
fn bare_destination_keeps_balanced_parentheses() {
    let nodes = parse("[a](b(c)d) x");
    assert!(nodes.contains(&n(K::Link, 0, 10)));
    assert!(nodes.contains(&n(K::Url, 4, 9)));
}

#[test]
fn image_url_range_is_exactly_the_destination() {
    let text = "![alt](image:abcdefghijklmnopqrstuvwxyz#640x480)";
    let document = commitnote_markdown::parse(text);
    assert_eq!(
        document.nodes,
        [
            n(K::Paragraph, 0, 48),
            n(K::Image, 0, 48),
            n(K::LinkMark, 0, 2),
            n(K::LinkLabel, 2, 5),
            n(K::LinkMark, 5, 6),
            n(K::LinkMark, 6, 7),
            n(K::Url, 7, 47),
            n(K::LinkMark, 47, 48),
        ]
    );
    assert_eq!(
        document.slice(7..47),
        "image:abcdefghijklmnopqrstuvwxyz#640x480"
    );
}

#[test]
fn reference_style_links_are_plain_text() {
    assert_eq!(parse("[ref]\n\n[ref]: /url"), [n(K::Paragraph, 0, 5)]);
    assert_eq!(parse("[a][ref]"), [n(K::Paragraph, 0, 8)]);
}

#[test]
fn autolink() {
    assert_eq!(
        parse("<https://example.com>"),
        [
            n(K::Paragraph, 0, 21),
            n(K::Autolink, 0, 21),
            n(K::LinkMark, 0, 1),
            n(K::Url, 1, 20),
            n(K::LinkMark, 20, 21),
        ]
    );
}

#[test]
fn extended_autolink_literals() {
    assert_eq!(
        parse("see www.example.com."),
        [n(K::Paragraph, 0, 20), n(K::Url, 4, 19)]
    );
    assert_eq!(
        parse("https://a.b/c?"),
        [n(K::Paragraph, 0, 14), n(K::Url, 0, 13)]
    );
    assert_eq!(parse("a@b.co"), [n(K::Paragraph, 0, 6), n(K::Url, 0, 6)]);
}

#[test]
fn table() {
    assert_eq!(
        parse("| a | b |\n| - | - |\n| *1* | 2 |"),
        [
            n(K::Table, 0, 31),
            n(K::Emphasis, 22, 25),
            n(K::EmphasisMark, 22, 23),
            n(K::EmphasisMark, 24, 25),
        ]
    );
}

#[test]
fn hard_break() {
    assert_eq!(
        parse("a  \nb"),
        [n(K::Paragraph, 0, 5), n(K::HardBreak, 1, 4)]
    );
}

#[test]
fn html_is_plain_text() {
    assert_eq!(
        parse("<div>\n*x*\n</div>\n\n*y*"),
        [
            n(K::Paragraph, 18, 21),
            n(K::Emphasis, 18, 21),
            n(K::EmphasisMark, 18, 19),
            n(K::EmphasisMark, 20, 21),
        ]
    );
}

#[test]
fn offsets_are_utf16() {
    assert_eq!(
        parse("😀 **b**"),
        [
            n(K::Paragraph, 0, 8),
            n(K::StrongEmphasis, 3, 8),
            n(K::EmphasisMark, 3, 5),
            n(K::EmphasisMark, 6, 8),
        ]
    );
    assert!(parse("# 𝄞 é *x*").contains(&n(K::Emphasis, 7, 10)));
}

#[test]
fn lines() {
    let document = commitnote_markdown::parse("ab\n😀\n\nlast");
    assert_eq!(document.lines, [0, 3, 6, 7]);
    assert_eq!(document.line_containing(0), 0..2);
    assert_eq!(document.line_containing(2), 0..2);
    assert_eq!(document.line_containing(4), 3..5);
    assert_eq!(document.line_containing(6), 6..6);
    assert_eq!(document.line_containing(11), 7..11);
    assert_eq!(commitnote_markdown::parse("").line_containing(0), 0..0);
}

#[test]
fn nodes_overlapping() {
    let document = commitnote_markdown::parse("# A\n\n**b** c");
    let kinds = |range| {
        document
            .nodes_overlapping(range)
            .into_iter()
            .map(|node| node.kind)
            .collect::<Vec<_>>()
    };
    assert_eq!(kinds(0..1), [K::AtxHeading { level: 1 }, K::HeaderMark]);
    assert_eq!(kinds(7..8), [K::Paragraph, K::StrongEmphasis]);
    assert_eq!(
        kinds(10..10),
        [K::Paragraph, K::StrongEmphasis, K::EmphasisMark]
    );
    assert!(kinds(4..5).is_empty());
}

#[test]
fn nodes_are_in_document_order_with_parents_first() {
    let nodes = parse(&generated_note(300));
    for pair in nodes.windows(2) {
        let (previous, next) = (&pair[0].range, &pair[1].range);
        assert!(previous.start <= next.start, "{pair:?}");
        if previous.start == next.start {
            assert!(previous.end >= next.end, "{pair:?}");
        }
    }
}

#[test]
fn large_note_parses_quickly() {
    let text = generated_note(2_000);
    let bound = if cfg!(debug_assertions) {
        Duration::from_secs(5)
    } else {
        Duration::from_millis(500)
    };
    let start = Instant::now();
    let document = commitnote_markdown::parse(&text);
    let elapsed = start.elapsed();
    assert_eq!(document.lines.len(), 2_000);
    assert!(
        document
            .nodes
            .iter()
            .any(|node| node.kind == K::TaskMarker { checked: true })
    );
    assert!(document.nodes.iter().any(|node| node.kind == K::FencedCode));
    assert!(elapsed < bound, "{elapsed:?}");
}

#[test]
fn arbitrary_input_keeps_ranges_ordered_and_inside_the_text() {
    let pieces = [
        "#",
        "##",
        " ",
        "  ",
        "\t",
        "\n",
        "\n\n",
        ">",
        "> ",
        "-",
        "- ",
        "1.",
        "2) ",
        "*",
        "**",
        "_",
        "~~",
        "~",
        "`",
        "```",
        "~~~",
        "[",
        "]",
        "(",
        ")",
        "![",
        "<",
        ">",
        "|",
        "| - |",
        "\\",
        "[ ]",
        "[x]",
        "a",
        "word",
        "www.a.com",
        "https://b.c/d",
        "x@y.zz",
        "😀",
        "é",
        "&amp;",
        "<div>",
        "===",
        "---",
        "    ",
    ];
    let mut seed = 0x2545_f491_u64;
    for _ in 0..3_000 {
        let mut text = String::new();
        for _ in 0..24 {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            text.push_str(pieces[(seed % pieces.len() as u64) as usize]);
        }
        let document = commitnote_markdown::parse(&text);
        for node in &document.nodes {
            assert!(
                node.range.start <= node.range.end && node.range.end <= document.length(),
                "{text:?} {node:?}"
            );
        }
        for pair in document.nodes.windows(2) {
            let (previous, next) = (&pair[0].range, &pair[1].range);
            assert!(
                previous.start < next.start
                    || (previous.start == next.start && previous.end >= next.end),
                "{text:?} {pair:?}"
            );
        }
    }
}
