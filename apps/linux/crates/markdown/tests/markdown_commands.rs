use commitnote_editor_text::{TextSelection, apply};
use commitnote_markdown::{
    CommandResult, insert_link, link_url, openable_url, parse, paste_link, toggle_bold,
    toggle_checkbox, toggle_italic, toggle_strikethrough, toggle_task,
};

type Command = fn(&str, TextSelection) -> Option<CommandResult>;

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn select(text: &str, word: &str) -> TextSelection {
    let from = utf16_len(&text[..text.find(word).unwrap()]);
    TextSelection::new(from, utf16_len(word))
}

fn caret(at: usize) -> TextSelection {
    TextSelection::new(at, 0)
}

fn run(command: Command, text: &str, selection: TextSelection) -> Option<(String, TextSelection)> {
    let result = command(text, selection)?;
    Some((apply(&result.edits, text), result.selection))
}

fn selected_text(text: &str, selection: TextSelection) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16_lossy(&units[selection.location..selection.location + selection.length])
}

fn text_of(result: Option<(String, TextSelection)>) -> Option<String> {
    result.map(|(text, _)| text)
}

fn formats() -> [(&'static str, Command, &'static str); 3] {
    [
        ("bold", toggle_bold, "**"),
        ("italic", toggle_italic, "*"),
        ("strikethrough", toggle_strikethrough, "~~"),
    ]
}

#[test]
fn format_wraps_and_keeps_selection() {
    for (name, command, marker) in formats() {
        let text = "a word b";
        let result = run(command, text, select(text, "word")).unwrap();
        assert_eq!(result.0, format!("a {marker}word{marker} b"), "{name}");
        assert_eq!(selected_text(&result.0, result.1), "word", "{name}");
    }
}

#[test]
fn format_unwraps_markers_inside_selection() {
    for (name, command, marker) in formats() {
        let text = format!("a {marker}word{marker} b");
        let result = run(
            command,
            &text,
            select(&text, &format!("{marker}word{marker}")),
        )
        .unwrap();
        assert_eq!(result.0, "a word b", "{name}");
        assert_eq!(selected_text(&result.0, result.1), "word", "{name}");
    }
}

#[test]
fn format_removes_markers_outside_selection() {
    for (name, command, marker) in formats() {
        let text = format!("a {marker}word{marker} b");
        let result = run(command, &text, select(&text, "word")).unwrap();
        assert_eq!(result.0, "a word b", "{name}");
        assert_eq!(selected_text(&result.0, result.1), "word", "{name}");
    }
}

#[test]
fn format_empty_selection_inserts_pair() {
    for (name, command, marker) in formats() {
        let result = run(command, "ab", caret(1)).unwrap();
        assert_eq!(result.0, format!("a{marker}{marker}b"), "{name}");
        assert_eq!(result.1, caret(1 + utf16_len(marker)), "{name}");
    }
}

#[test]
fn format_skips_multi_line_and_code() {
    for (name, command, _) in formats() {
        assert!(
            command("one\ntwo", TextSelection::new(1, 5)).is_none(),
            "{name}"
        );
        let inline = "a `word` b";
        assert!(command(inline, select(inline, "word")).is_none(), "{name}");
        let fenced = "```\nword\n```";
        assert!(command(fenced, select(fenced, "word")).is_none(), "{name}");
        assert!(command("a `b` c", caret(4)).is_none(), "{name}");
    }
}

#[test]
fn format_link_text() {
    for (name, command, marker) in formats() {
        let text = "[word](https://x.y)";
        assert_eq!(
            text_of(run(command, text, select(text, "word"))).as_deref(),
            Some(format!("[{marker}word{marker}](https://x.y)").as_str()),
            "{name}"
        );
    }
}

#[test]
fn italic_versus_bold() {
    let cases: [(Command, &str, &str, &str); 5] = [
        (toggle_italic, "a **word** b", "word", "a ***word*** b"),
        (toggle_italic, "a ***word*** b", "word", "a **word** b"),
        (
            toggle_italic,
            "a ***word*** b",
            "***word***",
            "a **word** b",
        ),
        (toggle_bold, "a ***word*** b", "word", "a *word* b"),
        (toggle_italic, "a **word** b", "**word**", "a ***word*** b"),
    ];
    for (command, text, word, expected) in cases {
        assert_eq!(
            text_of(run(command, text, select(text, word))).as_deref(),
            Some(expected)
        );
    }
}

#[test]
fn format_clamps_out_of_range_selection() {
    assert_eq!(
        text_of(run(toggle_bold, "ab", TextSelection::new(1, 10))).as_deref(),
        Some("a**b**")
    );
}

#[test]
fn insert_link_wraps_selection_with_caret_in_parentheses() {
    let text = "a word b";
    let result = run(insert_link, text, select(text, "word")).unwrap();
    assert_eq!(result.0, "a [word]() b");
    assert_eq!(result.1, caret(utf16_len("a [word](")));
}

#[test]
fn insert_link_escapes_brackets() {
    let text = "a x] b";
    assert_eq!(
        text_of(run(insert_link, text, select(text, "x]"))).as_deref(),
        Some("a [x\\]]() b")
    );
}

#[test]
fn insert_link_empty_selection() {
    let result = run(insert_link, "ab", caret(1)).unwrap();
    assert_eq!(result.0, "a[]()b");
    assert_eq!(result.1, caret(2));
}

#[test]
fn insert_link_skipped_over_links_code_and_multiple_lines() {
    let link = "[word](https://x.y)";
    assert!(insert_link(link, select(link, "word")).is_none());
    let bare = "see https://x.y now";
    assert!(insert_link(bare, select(bare, "https://x.y")).is_none());
    assert!(insert_link("one\ntwo", TextSelection::new(1, 5)).is_none());
    let code = "a `word` b";
    assert!(insert_link(code, select(code, "word")).is_none());
    assert!(insert_link(link, caret(3)).is_none());
}

fn toggled(text: &str, at: usize, length: usize) -> Option<(String, TextSelection)> {
    run(toggle_task, text, TextSelection::new(at, length))
}

fn toggled_text(text: &str, at: usize) -> Option<String> {
    text_of(toggled(text, at, 0))
}

#[test]
fn task_flips_marker() {
    assert_eq!(toggled_text("- [ ] milk", 3).as_deref(), Some("- [x] milk"));
    assert_eq!(toggled_text("- [x] milk", 3).as_deref(), Some("- [ ] milk"));
    assert_eq!(toggled_text("- [X] milk", 3).as_deref(), Some("- [ ] milk"));
}

#[test]
fn task_adds_checkbox_to_list_items() {
    assert_eq!(toggled_text("- milk", 4).as_deref(), Some("- [ ] milk"));
    assert_eq!(toggled_text("1. milk", 5).as_deref(), Some("1. [ ] milk"));
    assert_eq!(toggled_text("-", 0).as_deref(), Some("- [ ] "));
}

#[test]
fn task_turns_paragraph_and_empty_lines_into_tasks() {
    assert_eq!(toggled_text("milk", 2).as_deref(), Some("- [ ] milk"));
    assert_eq!(toggled_text("", 0).as_deref(), Some("- [ ] "));
    assert_eq!(
        toggled_text("# t\n\nmilk", 5).as_deref(),
        Some("# t\n\n- [ ] milk")
    );
    assert_eq!(toggled_text("  milk", 3).as_deref(), Some("  - [ ] milk"));
    assert_eq!(toggled_text("a\n", 2).as_deref(), Some("a\n- [ ] "));
}

#[test]
fn task_skips_headings_code_tables_quotes_and_blank_lines() {
    let skipped = [
        ("# title", 3),
        ("```\ncode\n```", 5),
        ("| a | b |\n| - | - |\n| 1 | 2 |", 3),
        ("- item\n  more", 10),
        ("> quote", 4),
        ("---", 1),
        ("    indented", 6),
        ("a\n   \nb", 3),
        ("Title\n===", 1),
    ];
    for (text, at) in skipped {
        assert!(toggled(text, at, 0).is_none(), "{text}");
    }
}

#[test]
fn task_toggles_every_touched_line() {
    let text = "- [ ] a\n# h\nplain\n- b";
    assert_eq!(
        text_of(toggled(text, 3, utf16_len(text) - 3)).as_deref(),
        Some("- [x] a\n# h\n- [ ] plain\n- [ ] b")
    );
}

#[test]
fn task_maps_selection_through_edits() {
    assert_eq!(toggled("- [ ] milk", 8, 0).unwrap().1, caret(8));
    assert_eq!(toggled("- milk", 4, 0).unwrap().1, caret(8));
    assert_eq!(toggled("milk", 0, 0).unwrap().1, caret(6));
    let ranged = toggled("a\nb", 0, 3).unwrap();
    assert_eq!(ranged.0, "- [ ] a\n- [ ] b");
    assert_eq!(ranged.1, TextSelection::new(6, 9));
}

#[test]
fn task_does_not_add_blank_line() {
    assert_eq!(toggled("a\nb", 1, 0).unwrap().0.split('\n').count(), 2);
}

#[test]
fn toggle_checkbox_writes_lowercase_marker() {
    let text = "- [ ] a\n- [x] b\n- [X] c";
    let cases = [
        (2..5, "- [x] a\n- [x] b\n- [X] c"),
        (10..13, "- [ ] a\n- [ ] b\n- [X] c"),
        (18..21, "- [ ] a\n- [x] b\n- [ ] c"),
    ];
    for (range, expected) in cases {
        let result = toggle_checkbox(text, range);
        assert_eq!(apply(&result.edits, text), expected);
    }
}

#[test]
fn openable_url_accepts_web_and_mail_links() {
    let cases = [
        ("https://a.b/c", "https://a.b/c"),
        ("http://a.b", "http://a.b"),
        ("www.a.b", "https://www.a.b"),
        ("WWW.A.B", "https://WWW.A.B"),
        ("me+x@a-b.co.uk", "mailto:me+x@a-b.co.uk"),
        ("mailto:me@a.b", "mailto:me@a.b"),
        ("HTTPS://a.b", "HTTPS://a.b"),
    ];
    for (raw, expected) in cases {
        assert_eq!(openable_url(raw).as_deref(), Some(expected), "{raw}");
    }
}

#[test]
fn openable_url_rejects_other_schemes_and_text() {
    for raw in [
        "javascript:alert(1)",
        "ftp://a.b",
        "file:///etc/passwd",
        "image:abc",
        "foo",
        "a@b",
        "relative/path",
        "",
        "@a.b",
    ] {
        assert_eq!(openable_url(raw), None, "{raw}");
    }
}

#[test]
fn openable_url_rejects_strings_a_url_parser_refuses() {
    for raw in [
        "https://exa mple.com",
        "https://a.b:xx/",
        "https://[::1",
        "https://a%zz.b/",
        "https://a<b>.c/",
    ] {
        assert_eq!(openable_url(raw), None, "{raw}");
    }
    for raw in [
        "https://a.b/a b",
        "https://a.b/é?q=1 2#x",
        "https://[::1]:80/x",
        "https://u@a.b:/",
        "https://é.com/",
        "mailto:a b@c.d",
    ] {
        assert_eq!(openable_url(raw).as_deref(), Some(raw), "{raw}");
    }
}

fn link_at(text: &str, offset: usize) -> Option<String> {
    link_url(&parse(text), offset)
}

#[test]
fn link_url_for_inline_link_at_any_part() {
    let text = "x [label](https://a.b/c) y";
    for offset in [3, 5, 8, 9, 12, 20, 23] {
        assert_eq!(
            link_at(text, offset).as_deref(),
            Some("https://a.b/c"),
            "{offset}"
        );
    }
    assert_eq!(link_at(text, 0), None);
    assert_eq!(link_at(text, 25), None);
}

#[test]
fn link_url_for_autolink_and_bare_urls() {
    assert_eq!(
        link_at("a <https://a.b> b", 5).as_deref(),
        Some("https://a.b")
    );
    assert_eq!(
        link_at("see https://a.b now", 6).as_deref(),
        Some("https://a.b")
    );
    assert_eq!(
        link_at("see www.a.b now", 6).as_deref(),
        Some("https://www.a.b")
    );
    assert_eq!(
        link_at("mail a@b.co now", 6).as_deref(),
        Some("mailto:a@b.co")
    );
}

#[test]
fn link_url_normalises_and_rejects() {
    assert_eq!(
        link_at("[a](www.a.b)", 1).as_deref(),
        Some("https://www.a.b")
    );
    assert_eq!(link_at("[a](javascript:alert(1))", 1), None);
    assert_eq!(link_at("[a](relative/path)", 1), None);
    assert_eq!(link_at("[a]()", 1), None);
    assert_eq!(link_at("![a](image:abcdefghijklmnopqrstuvwxyz)", 5), None);
    assert_eq!(
        link_at("[a](<https://a.b/(x)>)", 1).as_deref(),
        Some("https://a.b/(x)")
    );
}

#[test]
fn link_url_of_url_label_opens_destination() {
    assert_eq!(
        link_at("[https://a.b](https://c.d)", 4).as_deref(),
        Some("https://c.d")
    );
}

fn paste(text: &str, selected: &str, pasted: &str) -> Option<(String, TextSelection)> {
    let result = paste_link(text, select(text, selected), pasted)?;
    Some((apply(&result.edits, text), result.selection))
}

fn pasted_text(text: &str, selected: &str, pasted: &str) -> Option<String> {
    text_of(paste(text, selected, pasted))
}

#[test]
fn paste_url_over_selection_makes_link() {
    let result = paste("see docs now", "docs", "https://a.b/c").unwrap();
    assert_eq!(result.0, "see [docs](https://a.b/c) now");
    assert_eq!(result.1, caret(utf16_len("see [docs](https://a.b/c)")));
    assert_eq!(
        pasted_text("a b", "b", "  https://a.b\n").as_deref(),
        Some("a [b](https://a.b)")
    );
}

#[test]
fn paste_normalises_www_and_email() {
    assert_eq!(
        pasted_text("a b", "b", "www.a.b").as_deref(),
        Some("a [b](https://www.a.b)")
    );
    assert_eq!(
        pasted_text("a b", "b", "WWW.a.b").as_deref(),
        Some("a [b](https://WWW.a.b)")
    );
    assert_eq!(
        pasted_text("a b", "b", "me@a.b").as_deref(),
        Some("a [b](mailto:me@a.b)")
    );
    assert_eq!(
        pasted_text("a b", "b", "mailto:me@a.b").as_deref(),
        Some("a [b](mailto:me@a.b)")
    );
}

#[test]
fn paste_wraps_parentheses_and_rejects_angle_brackets() {
    assert_eq!(
        pasted_text("a b", "b", "https://a.b/x_(y)").as_deref(),
        Some("a [b](<https://a.b/x_(y)>)")
    );
    assert_eq!(pasted_text("a b", "b", "https://a.b/<x>"), None);
}

#[test]
fn paste_escapes_label_brackets() {
    assert_eq!(
        pasted_text("a [x] b", "[x]", "https://a.b").as_deref(),
        Some("a [\\[x\\]](https://a.b) b")
    );
}

#[test]
fn paste_rejects_non_urls_and_whitespace() {
    for pasted in [
        "hello",
        "two words",
        "https://a.b and more",
        "",
        "   ",
        "ftp://a.b",
        "javascript:alert(1)",
    ] {
        assert_eq!(pasted_text("a b", "b", pasted), None, "{pasted}");
    }
}

#[test]
fn paste_requires_one_non_empty_single_line_selection() {
    assert!(paste_link("a b", caret(1), "https://a.b").is_none());
    assert!(paste_link("a\nb", TextSelection::new(0, 3), "https://a.b").is_none());
}

#[test]
fn paste_rejected_over_code_and_links() {
    let cases = [
        ("a `code` b", "code"),
        ("```\ncode\n```", "code"),
        ("    code", "code"),
        ("[word](https://x.y)", "word"),
        ("see https://x.y now", "https://x.y"),
        ("<https://x.y>", "https://x.y"),
        ("![alt](image:abcdefghijklmnopqrstuvwxyz)", "alt"),
    ];
    for (text, selected) in cases {
        assert_eq!(pasted_text(text, selected, "https://a.b"), None, "{text}");
    }
}

#[test]
fn paste_allowed_adjacent_to_code() {
    assert_eq!(
        pasted_text("`c` word", "word", "https://a.b").as_deref(),
        Some("`c` [word](https://a.b)")
    );
}
