use std::cell::{Cell, RefCell};
use std::collections::BTreeSet;
use std::rc::Rc;
use std::time::{Duration, Instant};

use adw::prelude::*;
use commitnote::close_guard::unsaved_body;
use commitnote::editor::{NoteEditor, OverlayKind};
use commitnote::links;
use commitnote::model::{AppModel, EditorTarget, Route};
use commitnote::type_to_start::handle_type_to_start_key;
use commitnote_core_api::events::RemoteChange;
use commitnote_core_api::shapes::{OpenNote, OpenNoteConflict, SyncState, TreeNode};
use commitnote_editor_text::Utf16Index;
use gtk4 as gtk;
use gtk4::gdk;
use libadwaita as adw;

use crate::flows::{
    PASSPHRASE, UNLOCK_TIMEOUT, ensure, launch_and_log_in, open_first_note, split_view,
};
use crate::support::{
    Case, Harness, NARROW_LIGHT, NARROW_VARIANTS, Theme, WIDE_LIGHT, WIDE_VARIANTS, Width,
    write_read_back,
};

pub const CASES: &[Case] = &[
    ("editor_preview", editor_preview),
    ("editor_overlays", editor_overlays),
    ("edit_saves", edit_saves),
    ("remote_merge_keeps_caret", remote_merge_keeps_caret),
    ("undo_across_remote_edit", undo_across_remote_edit),
    ("echo_does_not_move_caret", echo_does_not_move_caret),
    ("checkbox_click_edits", checkbox_click_edits),
    ("format_bold_shortcut", format_bold_shortcut),
    (
        "format_italic_strike_shortcuts",
        format_italic_strike_shortcuts,
    ),
    ("insert_link_shortcut", insert_link_shortcut),
    ("toggle_task_shortcut", toggle_task_shortcut),
    ("paste_link", paste_link),
    ("ctrl_click_opens_link", ctrl_click_opens_link),
    ("formatting_bar_narrow", formatting_bar_narrow),
    ("vim_status_line", vim_status_line),
    ("vim_edit_undo", vim_edit_undo),
    ("vim_no_corruption", vim_no_corruption),
    ("title_rename", title_rename),
    ("title_rename_error", title_rename_error),
    ("new_note_named", new_note_named),
    ("new_note_ctrl_n_body_only", new_note_ctrl_n_body_only),
    ("draft_leave", draft_leave),
    ("early_draft_created", early_draft_created),
    ("early_draft_body_only", early_draft_body_only),
    ("type_to_start_starts_note", type_to_start_starts_note),
    ("type_to_start_blocked", type_to_start_blocked),
    ("sync_status_states", sync_status_states),
    ("offline_and_recover", offline_and_recover),
    ("failed_and_retry", failed_and_retry),
    ("conflict_resolve", conflict_resolve),
    ("remote_change_toast", remote_change_toast),
    ("close_saved_closes", close_saved_closes),
    ("close_unsaved_asks", close_unsaved_asks),
    ("close_early_draft_asks", close_early_draft_asks),
    ("close_shortcuts", close_shortcuts),
    ("logout_unsaved_warns", logout_unsaved_warns),
    ("logout_inhibit", logout_inhibit),
    ("early_draft_logout_inhibit", early_draft_logout_inhibit),
    ("editor_read_back", editor_read_back),
];

const EDITOR: &str = "note-editor";
const VIEW: &str = "note-editor-view";
const HIDDEN: &str = "preview-hidden";
const STRONG: &str = "preview-strong";
const SAMPLE: &str = "# Heading\n\nSome **bold** words and a [link](https://example.com).\n\nUse `code` here.\n\n> A quoted line\n\n😀 then **styled** text\n\n- [ ] write the report\n- [x] review the draft\n\n```rust\nfn main() {}\n```\n\n---\n";
const TASKS: &str = "- [ ] one\n- [x] two\n\n---\n\nend";
const TASKS_TOGGLED: &str = "- [x] one\n- [x] two\n\n---\n\nend";
const TASK: &str = "- [ ] task";
const TASK_DONE: &str = "- [x] task";
const TYPED: &str = "typed here ";
const REMOTE_LINE: &str = "Edited on another device";
const LARGE_NOTE_BYTES: usize = 100 * 1024;
const LARGE_NOTE_BUDGET: Duration = Duration::from_millis(50);
const PROSE_BLOCK: &str = "## Weekly review\n\nThe migration went better than expected. Most of the services moved over without any downtime, and the two that needed a restart came back within a minute. The remaining work is mostly cleanup: old dashboards, a few alerts that still point at the previous cluster, and the runbook pages that describe the manual failover. None of it is urgent, but leaving it for too long makes the next incident harder to read.\n\nWe agreed to keep the **old cluster** running for another two weeks so that anything we missed can still be compared side by side. After that it goes away for good, together with the credentials that only it used. See the [migration notes](https://example.com/migration) for the full list.\n\nOpen questions:\n\n- who owns the nightly export once the old cron host is gone\n- whether the staging database should follow the same layout\n- how long to keep the snapshots\n\n> Measure twice, cut once, and write down which one you measured.\n\nThe query that was slow last month now finishes in a few seconds after adding the index on `created_at`, so the report can run hourly again.\n\n";
const DENSE_BLOCK: &str = "## Section heading\n\nA paragraph with **strong text**, *emphasis*, ~~struck~~, `inline code` and a [link](https://example.com/page) next to plain words.\n\n- [ ] an open task with **bold**\n- [x] a done task\n1. an ordered item\n\n> A quoted line with *emphasis*\n\n```rust\nfn main() {}\n```\n\n";

/// The character offset of the first `needle` in `text`, after `from` characters.
fn offset_of(text: &str, needle: &str, from: usize) -> Result<i32, String> {
    let skip = text
        .char_indices()
        .nth(from)
        .map_or(text.len(), |(index, _)| index);
    let byte = text[skip..]
        .find(needle)
        .ok_or_else(|| format!("the sample has no {needle:?}"))?;
    Ok(text[..skip + byte].chars().count() as i32)
}

fn expect_tag(
    h: &Harness,
    offset: i32,
    tag: &str,
    present: bool,
    what: &str,
) -> Result<(), String> {
    let tags = h.tags_at(VIEW, offset)?;
    ensure(tags.iter().any(|name| name == tag) == present, || {
        let verb = if present { "lacks" } else { "carries" };
        format!("{what} at {offset} {verb} {tag}; it has {tags:?}")
    })
}

/// Saves `text` as the open note, waits for the editor to show it and puts the caret at the start.
fn show_saved(h: &Harness, editor: &NoteEditor, text: &str) -> Result<(), String> {
    let model = h.model()?;
    model.edit(text.to_owned());
    h.run("the sample to be saved", {
        let model = model.clone();
        async move { model.flush_edits().await }
    })?;
    h.wait("the editor to show the sample", || editor.text() == text)?;
    let buffer = editor.view().buffer();
    buffer.place_cursor(&buffer.start_iter());
    h.settle()
}

fn editor_preview(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    open_first_note(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    let view = editor.view();
    ensure(view.is_editable(), || {
        "the open note is not editable".to_owned()
    })?;

    show_saved(h, &editor, SAMPLE)?;
    ensure(h.text_view_text(VIEW)? == SAMPLE, || {
        "the buffer differs from the note text".to_owned()
    })?;
    ensure(editor.text() == SAMPLE, || {
        "the editor reports a different text".to_owned()
    })?;

    let bold_line = offset_of(SAMPLE, "Some", 0)?;
    let open = offset_of(SAMPLE, "**bold", 0)?;
    let close = offset_of(SAMPLE, "** words", 0)?;
    for marker in [open, open + 1, close, close + 1] {
        expect_tag(h, marker, HIDDEN, true, "a bold marker off the caret line")?;
    }
    for letter in open + 2..close {
        expect_tag(h, letter, STRONG, true, "the bold text")?;
        expect_tag(h, letter, HIDDEN, false, "the bold text")?;
    }
    expect_tag(
        h,
        offset_of(SAMPLE, "Heading", 0)?,
        "preview-heading-1",
        true,
        "the heading",
    )?;
    expect_tag(
        h,
        offset_of(SAMPLE, "link]", 0)?,
        "preview-link",
        true,
        "the link label",
    )?;
    expect_tag(
        h,
        offset_of(SAMPLE, "https", 0)?,
        HIDDEN,
        true,
        "the link destination",
    )?;
    expect_tag(
        h,
        offset_of(SAMPLE, "code`", 0)?,
        "preview-inline-code",
        true,
        "the inline code",
    )?;
    expect_tag(
        h,
        offset_of(SAMPLE, "A quoted", 0)?,
        "preview-quote-line",
        true,
        "the quote",
    )?;

    let emoji_line = offset_of(SAMPLE, "😀", 0)? as usize;
    let styled_open = offset_of(SAMPLE, "**styled", emoji_line)?;
    let styled_close = offset_of(SAMPLE, "** text", emoji_line)?;
    for marker in [styled_open, styled_open + 1, styled_close, styled_close + 1] {
        expect_tag(h, marker, HIDDEN, true, "a marker after the emoji")?;
    }
    for letter in styled_open + 2..styled_close {
        expect_tag(h, letter, STRONG, true, "the text after the emoji")?;
        expect_tag(h, letter, HIDDEN, false, "the text after the emoji")?;
    }
    expect_tag(
        h,
        styled_close + 2,
        STRONG,
        false,
        "the plain text after the emoji",
    )?;

    let buffer = view.buffer();
    buffer.place_cursor(&buffer.iter_at_offset(bold_line));
    h.wait("the bold markers to show on the caret line", || {
        [open, open + 1, close, close + 1].iter().all(|&marker| {
            h.tags_at(VIEW, marker)
                .is_ok_and(|tags| !tags.iter().any(|name| name == HIDDEN))
        })
    })?;
    expect_tag(h, open + 2, STRONG, true, "the bold text on the caret line")?;
    expect_tag(h, styled_open, HIDDEN, true, "a marker off the caret line")?;
    ensure(editor.text() == SAMPLE, || {
        "moving the caret changed the text".to_owned()
    })?;

    let pictured = SAMPLE.replacen("😀 then", "Then", 1);
    show_saved(h, &editor, &pictured)?;
    buffer.place_cursor(&buffer.iter_at_offset(bold_line));
    h.wait("the bold markers to show for the picture", || {
        h.tags_at(VIEW, open)
            .is_ok_and(|tags| !tags.iter().any(|name| name == HIDDEN))
    })?;
    h.session_screenshots("editor", WIDE_VARIANTS)?;
    h.resize(Width::Narrow)?;
    split_view(h)?.set_show_content(true);
    h.wait_shown("formatting-bar")?;
    h.session_screenshots("editor-narrow", NARROW_VARIANTS)?;
    ensure(editor.text() == pictured, || {
        "the note text changed while the sample was shown".to_owned()
    })?;
    h.resize(Width::Wide)?;

    measure_large_note(&editor)
}

/// The fastest of three full renders of `block` repeated up to the large note size.
fn time_large_note(editor: &NoteEditor, block: &str) -> Result<Duration, String> {
    let mut note = String::with_capacity(LARGE_NOTE_BYTES + block.len());
    while note.len() < LARGE_NOTE_BYTES {
        note.push_str(block);
    }
    let mut best = Duration::MAX;
    for _ in 0..3 {
        editor.set_text("");
        let started = Instant::now();
        editor.set_text(&note);
        best = best.min(started.elapsed());
    }
    ensure(editor.text() == note, || {
        "the large note differs from the buffer".to_owned()
    })?;
    Ok(best)
}

fn measure_large_note(editor: &NoteEditor) -> Result<(), String> {
    let prose = time_large_note(editor, PROSE_BLOCK)?;
    let dense = time_large_note(editor, DENSE_BLOCK)?;
    println!(
        "rendering a {} kB note took {} ms; with markup on every line, {} ms",
        LARGE_NOTE_BYTES / 1024,
        prose.as_millis(),
        dense.as_millis()
    );
    ensure(prose < LARGE_NOTE_BUDGET, || {
        format!(
            "rendering a {} kB note took {} ms",
            LARGE_NOTE_BYTES / 1024,
            prose.as_millis()
        )
    })
}

fn count_overlays(editor: &NoteEditor, kind: OverlayKind) -> usize {
    editor
        .view()
        .overlay_rects()
        .iter()
        .filter(|(found, rect)| *found == kind && rect.width() > 0.0 && rect.height() > 0.0)
        .count()
}

/// Whether any tag over `offset` hides its character or paints it transparent.
fn masked(editor: &NoteEditor, offset: i32) -> bool {
    editor
        .view()
        .buffer()
        .iter_at_offset(offset)
        .tags()
        .iter()
        .any(|tag| {
            (tag.is_invisible_set() && tag.is_invisible())
                || (tag.is_foreground_set()
                    && tag
                        .foreground_rgba()
                        .is_some_and(|color| color.alpha() < 0.01))
        })
}

fn editor_overlays(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    open_first_note(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    let view = editor.view();
    show_saved(h, &editor, TASKS)?;
    let buffer = view.buffer();
    buffer.place_cursor(&buffer.end_iter());
    h.wait("two checkboxes and a rule", || {
        count_overlays(&editor, OverlayKind::Checkbox) == 2
            && count_overlays(&editor, OverlayKind::Rule) == 1
    })?;
    h.settle()?;
    for marker in ["[ ]", "[x]"] {
        let at = offset_of(TASKS, marker, 0)?;
        for offset in at..at + 3 {
            ensure(masked(&editor, offset), || {
                format!("the {marker} marker shows at {offset}")
            })?;
        }
    }
    let rects = view.overlay_rects();
    let first = rects
        .iter()
        .filter(|(kind, _)| *kind == OverlayKind::Checkbox)
        .map(|(_, rect)| *rect)
        .min_by(|a, b| a.y().total_cmp(&b.y()))
        .ok_or("no checkbox overlay")?;
    let rule = rects
        .iter()
        .find(|(kind, _)| *kind == OverlayKind::Rule)
        .map(|(_, rect)| *rect)
        .ok_or("no rule overlay")?;
    println!(
        "checkbox {}x{} at {},{}; rule {}x{} at {},{}; view {}",
        first.width(),
        first.height(),
        first.x(),
        first.y(),
        rule.width(),
        rule.height(),
        rule.x(),
        rule.y(),
        view.width()
    );
    ensure(rule.width() > view.width() as f32 / 2.0, || {
        format!("the rule is only {} wide", rule.width())
    })?;
    h.session_screenshots("overlays", WIDE_VARIANTS)?;
    ensure(editor.text() == TASKS, || {
        "painting changed the text".to_owned()
    })?;

    let centre = first.center();
    let result = view
        .toggle_at_point(f64::from(centre.x()), f64::from(centre.y()))
        .ok_or("no checkbox under the first checkbox's centre")?;
    editor.apply_command(result);
    ensure(editor.text() == TASKS_TOGGLED, || {
        format!("toggling gave {:?}", editor.text())
    })?;
    ensure(
        view.toggle_at_point(
            f64::from(rule.x() + rule.width() / 2.0),
            f64::from(rule.y()),
        )
        .is_none(),
        || "the rule toggles something".to_owned(),
    )?;

    let rule_at = offset_of(TASKS_TOGGLED, "---", 0)?;
    buffer.place_cursor(&buffer.iter_at_offset(rule_at));
    h.wait("the rule source on the caret line", || {
        count_overlays(&editor, OverlayKind::Rule) == 0
            && (rule_at..rule_at + 3).all(|offset| !masked(&editor, offset))
    })?;
    ensure(count_overlays(&editor, OverlayKind::Checkbox) == 2, || {
        "the checkboxes went away with the rule".to_owned()
    })
}

fn caret(editor: &NoteEditor) -> i32 {
    let buffer = editor.view().buffer();
    buffer.iter_at_mark(&buffer.get_insert()).offset()
}

fn type_text(editor: &NoteEditor, text: &str) {
    let buffer = editor.view().buffer();
    buffer.begin_user_action();
    buffer.insert_at_cursor(text);
    buffer.end_user_action();
}

/// Waits until the core reports `text` back as the open note's content.
fn wait_echo(h: &Harness, text: &str) -> Result<(), String> {
    let model = h.model()?;
    h.wait("the core to hold the typed text", || {
        model
            .note_update()
            .is_some_and(|update| update.content == text)
    })
}

fn save_now(h: &Harness) -> Result<(), String> {
    let model = h.model()?;
    h.run("saving", async move { model.save_now().await })
}

fn remote_edit(h: &Harness, editor: &NoteEditor) -> Result<(), String> {
    let model = h.model()?;
    h.run("the remote edit", async move {
        model.testing_remote_edit().await
    })?
    .map_err(|error| format!("cannot edit remotely: {}", error.message))?;
    h.refresh_until("the remote edit to reach the editor", || {
        editor.text().starts_with(REMOTE_LINE)
    })
}

/// The text after a remote edit of its first line.
fn remotely_edited(text: &str) -> String {
    match text.split_once('\n') {
        Some((_, rest)) => format!("{REMOTE_LINE}\n{rest}"),
        None => REMOTE_LINE.to_owned(),
    }
}

fn export_repo(model: &AppModel) -> impl Future<Output = Option<serde_json::Value>> + use<> {
    let repo = model
        .testing_repo_key()
        .unwrap_or_else(|| SAMPLE_REPO_KEY.to_owned());
    let export = model.testing_send("fake.exportRepo", serde_json::json!({ "repoKey": repo }));
    async move {
        let result = export.await.ok()?;
        serde_json::from_str(result["exported"].as_str()?).ok()
    }
}

fn export_main(model: &AppModel) -> impl Future<Output = Option<serde_json::Value>> + use<> {
    let export = export_repo(model);
    async move { Some(export.await?["main"].clone()) }
}

/// The (encrypted) file paths in the fake forge's branch head.
fn head_paths(exported: &serde_json::Value) -> Option<BTreeSet<String>> {
    let main = exported["main"].as_str()?;
    let objects = &exported["objects"];
    let find = |kind: &str, sha: &str| {
        objects[kind]
            .as_array()?
            .iter()
            .find(|entry| entry[0].as_str() == Some(sha))
            .map(|entry| entry[1].clone())
    };
    let commit = find("commits", main)?;
    let files = find("trees", commit["tree"].as_str()?)?;
    files
        .as_array()?
        .iter()
        .map(|file| file[0].as_str().map(str::to_owned))
        .collect()
}

fn wait_head(
    h: &Harness,
    description: &str,
    predicate: impl Fn(&BTreeSet<String>) -> bool,
) -> Result<BTreeSet<String>, String> {
    let model = h.model()?;
    let latest = Rc::new(RefCell::new(None::<BTreeSet<String>>));
    let in_flight = Rc::new(Cell::new(false));
    h.wait(description, || {
        if latest.borrow().as_ref().is_some_and(&predicate) {
            return true;
        }
        if !in_flight.replace(true) {
            let export = export_repo(&model);
            let latest = latest.clone();
            let in_flight = in_flight.clone();
            glib::spawn_future_local(async move {
                latest.replace(export.await.as_ref().and_then(head_paths));
                in_flight.set(false);
            });
        }
        false
    })?;
    Ok(latest.take().unwrap_or_default())
}

fn head_files(h: &Harness) -> Result<BTreeSet<String>, String> {
    wait_head(h, "the repository export", |_| true)
}

/// The fake forge's branch head, which moves with every commit; the note contents in it are
/// encrypted.
fn exported_main(h: &Harness) -> Result<serde_json::Value, String> {
    let model = h.model()?;
    h.run("the repository export", export_main(&model))?
        .ok_or_else(|| "the fake forge did not export the repository".to_owned())
}

fn wait_exported_change(h: &Harness, before: &serde_json::Value) -> Result<(), String> {
    let model = h.model()?;
    let latest = Rc::new(RefCell::new(None::<serde_json::Value>));
    let in_flight = Rc::new(Cell::new(false));
    h.wait("a new commit on the fake forge", || {
        if latest.borrow().as_ref().is_some_and(|main| main != before) {
            return true;
        }
        if !in_flight.replace(true) {
            let export = export_main(&model);
            let latest = latest.clone();
            let in_flight = in_flight.clone();
            glib::spawn_future_local(async move {
                latest.replace(export.await);
                in_flight.set(false);
            });
        }
        false
    })
}

fn wait_open_note(h: &Harness, text: &str) -> Result<(), String> {
    let model = h.model()?;
    h.wait("the open note to hold the edited text", || {
        matches!(model.open_note_state(), Some(OpenNote::Loaded { content, .. }) if content == text)
    })
}

fn edit_saves(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    open_first_note(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    let before = exported_main(h)?;
    let buffer = editor.view().buffer();
    buffer.insert(&mut buffer.end_iter(), TYPED);
    let text = editor.text();
    h.window_action("save-now")?;
    wait_exported_change(h, &before)?;
    wait_open_note(h, &text)
}

fn remote_merge_keeps_caret(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    open_first_note(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    let buffer = editor.view().buffer();
    let mut line_start = buffer.end_iter();
    line_start.set_line_offset(0);
    buffer.place_cursor(&line_start);
    type_text(&editor, TYPED);
    let typed = editor.text();
    let from_end = typed.chars().count() as i32 - caret(&editor);
    wait_echo(h, &typed)?;
    save_now(h)?;

    remote_edit(h, &editor)?;
    let text = editor.text();
    ensure(text == remotely_edited(&typed), || {
        "the remote line did not merge with the typed text".to_owned()
    })?;
    ensure(
        text.chars().count() as i32 - caret(&editor) == from_end,
        || {
            format!(
                "the caret moved from {from_end} to {} before the end",
                text.chars().count() as i32 - caret(&editor)
            )
        },
    )?;
    let before_caret: String = text.chars().take(caret(&editor) as usize).collect();
    ensure(before_caret.ends_with(TYPED), || {
        "the caret is no longer after the typed text".to_owned()
    })
}

fn undo_across_remote_edit(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    open_first_note(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    let original = editor.text();
    let buffer = editor.view().buffer();
    buffer.place_cursor(&buffer.end_iter());
    type_text(&editor, TYPED);
    let typed = editor.text();
    wait_echo(h, &typed)?;
    save_now(h)?;

    remote_edit(h, &editor)?;
    let merged = editor.text();
    ensure(merged == remotely_edited(&typed), || {
        "the remote line did not merge with the typed text".to_owned()
    })?;
    let widget = editor.upcast_ref::<gtk::Widget>();
    h.press_shortcut(widget, "<Control>z")?;
    ensure(editor.text() == remotely_edited(&original), || {
        "undo did not take back exactly the typed text".to_owned()
    })?;
    ensure(!editor.can_undo(), || {
        "the remote edit became undoable".to_owned()
    })?;
    h.press_shortcut(widget, "<Control><Shift>z")?;
    ensure(editor.text() == merged, || {
        "redo did not bring the typed text back".to_owned()
    })?;
    wait_echo(h, &merged)
}

fn echo_does_not_move_caret(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    open_first_note(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    let original = editor.text();
    let buffer = editor.view().buffer();
    buffer.place_cursor(&buffer.end_iter());
    for character in TYPED.chars() {
        type_text(&editor, &character.to_string());
        h.run("a moment between keys", async {})?;
    }
    let typed = editor.text();
    let at = caret(&editor);
    wait_echo(h, &typed)?;
    h.settle()?;
    ensure(editor.text() == typed, || {
        "the echo changed the text".to_owned()
    })?;
    ensure(caret(&editor) == at, || {
        format!("the echo moved the caret from {at} to {}", caret(&editor))
    })?;
    ensure(editor.can_undo(), || {
        "the echo cleared the history".to_owned()
    })?;
    h.press_shortcut(editor.upcast_ref::<gtk::Widget>(), "<Control>z")?;
    ensure(editor.text() == original, || {
        "undo did not take back the typing as one step".to_owned()
    })
}

fn checkbox_click_edits(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    open_first_note(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    let view = editor.view();
    let buffer = view.buffer();
    buffer.begin_user_action();
    buffer.set_text(TASK);
    buffer.end_user_action();
    wait_echo(h, TASK)?;
    save_now(h)?;
    let before = exported_main(h)?;

    h.wait("the checkbox", || {
        count_overlays(&editor, OverlayKind::Checkbox) == 1
    })?;
    let rect = view
        .overlay_rects()
        .into_iter()
        .find(|(kind, _)| *kind == OverlayKind::Checkbox)
        .map(|(_, rect)| rect)
        .ok_or("no checkbox overlay")?;
    let centre = rect.center();
    let result = view
        .toggle_at_point(f64::from(centre.x()), f64::from(centre.y()))
        .ok_or("no checkbox under the checkbox's centre")?;
    editor.apply_command(result);
    ensure(editor.text() == TASK_DONE, || {
        format!("toggling gave {:?}", editor.text())
    })?;
    h.window_action("save-now")?;
    wait_exported_change(h, &before)?;
    wait_open_note(h, TASK_DONE)?;

    h.press_shortcut(editor.upcast_ref::<gtk::Widget>(), "<Control>z")?;
    ensure(editor.text() == TASK, || {
        "undo did not take back the toggle".to_owned()
    })
}

const WORDS: &str = "one two three";

fn set_note_text(editor: &NoteEditor, text: &str, from: i32, to: i32) {
    let buffer = editor.view().buffer();
    buffer.begin_user_action();
    buffer.set_text(text);
    buffer.end_user_action();
    buffer.select_range(&buffer.iter_at_offset(to), &buffer.iter_at_offset(from));
}

fn selection(editor: &NoteEditor) -> (i32, i32) {
    let buffer = editor.view().buffer();
    buffer.selection_bounds().map_or_else(
        || {
            let at = caret(editor);
            (at, at)
        },
        |(start, end)| (start.offset(), end.offset()),
    )
}

fn expect_text(editor: &NoteEditor, text: &str, selected: (i32, i32)) -> Result<(), String> {
    ensure(editor.text() == text, || {
        format!("the text is {:?}, not {text:?}", editor.text())
    })?;
    ensure(selection(editor) == selected, || {
        format!("the selection is {:?}, not {selected:?}", selection(editor))
    })
}

fn open_editor(h: &Harness) -> Result<NoteEditor, String> {
    launch_and_log_in(h, false)?;
    open_first_note(h)?;
    h.widget_as::<NoteEditor>(EDITOR)
}

fn format_with_shortcut(
    h: &Harness,
    editor: &NoteEditor,
    accelerator: &str,
    expected: (&str, (i32, i32)),
) -> Result<(), String> {
    set_note_text(editor, WORDS, 4, 7);
    h.press_shortcut(editor.upcast_ref::<gtk::Widget>(), accelerator)?;
    expect_text(editor, expected.0, expected.1)?;
    h.press_shortcut(editor.upcast_ref::<gtk::Widget>(), "<Control>z")?;
    expect_text(editor, WORDS, (4, 7))
}

fn format_bold_shortcut(h: &mut Harness) -> Result<(), String> {
    let editor = open_editor(h)?;
    format_with_shortcut(h, &editor, "<Control>b", ("one **two** three", (6, 9)))?;
    h.press_shortcut(editor.upcast_ref::<gtk::Widget>(), "<Control><Shift>z")?;
    expect_text(&editor, "one **two** three", (6, 9))?;
    wait_echo(h, "one **two** three")
}

fn format_italic_strike_shortcuts(h: &mut Harness) -> Result<(), String> {
    let editor = open_editor(h)?;
    format_with_shortcut(h, &editor, "<Control>i", ("one *two* three", (5, 8)))?;
    format_with_shortcut(
        h,
        &editor,
        "<Control><Shift>x",
        ("one ~~two~~ three", (6, 9)),
    )
}

fn insert_link_shortcut(h: &mut Harness) -> Result<(), String> {
    let editor = open_editor(h)?;
    format_with_shortcut(h, &editor, "<Control>k", ("one [two]() three", (10, 10)))
}

fn toggle_task_shortcut(h: &mut Harness) -> Result<(), String> {
    let editor = open_editor(h)?;
    set_note_text(&editor, TASK, 0, 0);
    let widget = editor.upcast_ref::<gtk::Widget>();
    h.press_shortcut(widget, "<Control>Return")?;
    expect_text(&editor, TASK_DONE, (0, 0))?;
    h.press_shortcut(widget, "<Control>z")?;
    expect_text(&editor, TASK, (0, 0))?;

    links::testing_clear_opened_uris();
    let linked = "- [ ] see [site](https://example.com/x) now";
    set_note_text(&editor, linked, 14, 14);
    h.press_shortcut(widget, "<Control>Return")?;
    ensure(
        links::testing_opened_uris() == ["https://example.com/x"],
        || format!("opened {:?}", links::testing_opened_uris()),
    )?;
    expect_text(&editor, linked, (14, 14))
}

fn paste_link(h: &mut Harness) -> Result<(), String> {
    let editor = open_editor(h)?;
    let view = editor.view();
    let clipboard = view.clipboard();
    clipboard.set_text("https://example.com/p");
    set_note_text(&editor, "visit docs today", 6, 10);
    view.emit_paste_clipboard();
    let linked = "visit [docs](https://example.com/p) today";
    h.wait("the pasted link", || editor.text() == linked)?;
    expect_text(&editor, linked, (35, 35))?;
    h.press_shortcut(editor.upcast_ref::<gtk::Widget>(), "<Control>z")?;
    expect_text(&editor, "visit docs today", (6, 10))?;

    clipboard.set_text("words");
    view.emit_paste_clipboard();
    h.wait("the pasted text", || editor.text() == "visit words today")?;
    expect_text(&editor, "visit words today", (11, 11))?;
    h.press_shortcut(editor.upcast_ref::<gtk::Widget>(), "<Control>z")?;
    expect_text(&editor, "visit docs today", (6, 10))
}

fn ctrl_click_opens_link(h: &mut Harness) -> Result<(), String> {
    let editor = open_editor(h)?;
    let view = editor.view();
    let text = "plain text then [site](https://example.com/x) end";
    set_note_text(&editor, text, 0, 0);
    h.settle()?;
    let at = view.iter_location(&view.buffer().iter_at_offset(18));
    let (x, y) = view.buffer_to_window_coords(
        gtk::TextWindowType::Widget,
        at.x() + at.width() / 2,
        at.y() + at.height() / 2,
    );
    let (x, y) = (f64::from(x), f64::from(y));

    links::testing_clear_opened_uris();
    ensure(!view.handle_primary_press(x, y, false), || {
        "a click without Control opened a link".to_owned()
    })?;
    ensure(links::testing_opened_uris().is_empty(), || {
        "a click without Control launched something".to_owned()
    })?;
    ensure(view.handle_primary_press(x, y, true), || {
        "Ctrl+click did not claim the click".to_owned()
    })?;
    ensure(
        links::testing_opened_uris() == ["https://example.com/x"],
        || format!("opened {:?}", links::testing_opened_uris()),
    )?;

    let plain = view.iter_location(&view.buffer().iter_at_offset(2));
    let (px, py) = view.buffer_to_window_coords(
        gtk::TextWindowType::Widget,
        plain.x() + plain.width() / 2,
        plain.y() + plain.height() / 2,
    );
    ensure(
        !view.handle_primary_press(f64::from(px), f64::from(py), true),
        || "Ctrl+click on plain text claimed the click".to_owned(),
    )
}

fn formatting_bar_narrow(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    h.resize(Width::Narrow)?;
    open_first_note(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    h.wait_shown("formatting-bar")?;
    for name in [
        "format-bold-button",
        "format-italic-button",
        "format-strikethrough-button",
        "format-link-button",
        "format-task-button",
    ] {
        ensure(h.shown(name), || format!("{name} is not shown"))?;
    }
    set_note_text(&editor, WORDS, 4, 7);
    h.click("format-bold-button")?;
    expect_text(&editor, "one **two** three", (6, 9))?;
    h.press_shortcut(editor.upcast_ref::<gtk::Widget>(), "<Control>z")?;
    expect_text(&editor, WORDS, (4, 7))?;

    h.resize(Width::Wide)?;
    h.wait("the formatting bar to hide", || !h.shown("formatting-bar"))?;
    h.wait_shown("note-menu-button")
}

const VIM_TEXT: &str = "first line\nsecond line 😀\nthird line\n";
const VIM_RENAMED: &str = "first line\n2nd 😀é line 😀\nthird line\n";

fn set_vim_mode(h: &Harness, editor: &NoteEditor, on: bool) -> Result<(), String> {
    let model = h.model()?;
    let value = if on { "true" } else { "false" };
    h.run(
        "the Vim setting to change",
        model.testing_send(
            "settings.change",
            serde_json::json!({ "key": "vimMode", "value": value }),
        ),
    )?
    .map_err(|error| format!("cannot change vimMode: {}", error.message))?;
    h.wait("the editor to follow the Vim setting", || {
        editor.vim_active() == on && h.shown("vim-status-line") == on
    })
}

fn vim_context(editor: &NoteEditor) -> Result<sourceview5::VimIMContext, String> {
    editor
        .vim_context()
        .ok_or_else(|| "Vim is not active".to_owned())
}

fn key_controllers(editor: &NoteEditor) -> usize {
    let controllers = editor.view().observe_controllers();
    (0..controllers.n_items())
        .filter_map(|index| controllers.item(index))
        .filter(|controller| controller.is::<gtk::EventControllerKey>())
        .count()
}

/// Delivers a key to the editor's own capture controller, the one that sends undo and redo
/// keys to the app's history. The headless compositor has no seat, so there is no input device
/// to build an event for the input method, and keys meant for Vim itself cannot be sent.
fn press_key(
    editor: &NoteEditor,
    keyval: gdk::Key,
    state: gdk::ModifierType,
) -> Result<bool, String> {
    let controllers = editor.observe_controllers();
    let routing = (0..controllers.n_items())
        .filter_map(|index| controllers.item(index))
        .find_map(|controller| controller.downcast::<gtk::EventControllerKey>().ok())
        .ok_or("the editor has no key controller")?;
    Ok(routing.emit_by_name::<bool>("key-pressed", &[&keyval, &0_u32, &state]))
}

/// Emits what GtkSourceView emits when an ex command is entered, without the keystrokes.
fn run_ex_command(context: &sourceview5::VimIMContext, command: &str) -> bool {
    context.emit_by_name::<bool>("execute-command", &[&command])
}

fn press_u(editor: &NoteEditor) -> Result<bool, String> {
    press_key(editor, gdk::Key::u, gdk::ModifierType::empty())
}

fn press_ctrl_r(editor: &NoteEditor) -> Result<bool, String> {
    press_key(editor, gdk::Key::r, gdk::ModifierType::CONTROL_MASK)
}

fn expect_handled(handled: bool, key: &str) -> Result<(), String> {
    ensure(handled, || format!("{key} did not reach the app's history"))
}

/// Checks that the buffer holds exactly `text` and that the editor's own record of the text
/// and the selection agrees with the buffer in UTF-16 units.
fn expect_consistent(editor: &NoteEditor, text: &str, what: &str) -> Result<(), String> {
    ensure(editor.text() == text, || {
        format!("{what}: the text is {:?}, not {text:?}", editor.text())
    })?;
    let (tracked, location, length) = editor.tracked_state();
    ensure(tracked == text, || {
        format!("{what}: the tracked text is {tracked:?}, not {text:?}")
    })?;
    let index = Utf16Index::new(text);
    let chars = index.len_chars() as i32;
    let (from, to) = selection(editor);
    ensure(
        (0..=chars).contains(&from) && (0..=chars).contains(&to),
        || format!("{what}: the selection {from}..{to} is outside 0..={chars}"),
    )?;
    let start = index.char_to_utf16(from as usize);
    let end = index.char_to_utf16(to as usize);
    ensure(location == start && length == end - start, || {
        format!("{what}: the tracked selection {location}+{length} does not match {from}..{to}")
    })
}

fn vim_status_line(h: &mut Harness) -> Result<(), String> {
    let editor = open_editor(h)?;
    ensure(
        !h.shown("vim-status-line") && !h.shown("vim-command-text"),
        || "the Vim status line shows while Vim is off".to_owned(),
    )?;
    let plain_controllers = key_controllers(&editor);
    buffer_end(&editor);
    type_text(&editor, TYPED);
    let typed = editor.text();
    let at = caret(&editor);

    set_vim_mode(h, &editor, true)?;
    ensure(h.shown("vim-command-text"), || {
        "the pending command is hidden while Vim is on".to_owned()
    })?;
    ensure(editor.text() == typed && caret(&editor) == at, || {
        "turning Vim on changed the text or the caret".to_owned()
    })?;
    ensure(editor.can_undo(), || {
        "turning Vim on cleared the history".to_owned()
    })?;
    ensure(
        h.label("vim-status-line")?.is_empty() && h.label("vim-command-text")?.is_empty(),
        || "the status line has text in normal mode".to_owned(),
    )?;
    ensure(key_controllers(&editor) == plain_controllers + 1, || {
        "Vim did not add exactly one key controller".to_owned()
    })?;
    h.session_screenshots("vim", WIDE_LIGHT)?;

    set_vim_mode(h, &editor, false)?;
    ensure(editor.vim_context().is_none(), || {
        "the Vim context outlived the setting".to_owned()
    })?;
    ensure(key_controllers(&editor) == plain_controllers, || {
        "turning Vim off left its key controller behind".to_owned()
    })?;
    ensure(!editor.view().property::<bool>("overwrite"), || {
        "turning Vim off left the block caret".to_owned()
    })?;
    ensure(editor.text() == typed, || {
        "turning Vim off changed the text".to_owned()
    })?;
    ensure(!press_u(&editor)?, || "u was taken without Vim".to_owned())?;

    set_vim_mode(h, &editor, true)?;
    set_vim_mode(h, &editor, false)?;
    ensure(key_controllers(&editor) == plain_controllers, || {
        "toggling Vim again leaked a key controller".to_owned()
    })?;
    h.press_shortcut(editor.upcast_ref::<gtk::Widget>(), "<Control>z")?;
    ensure(editor.text() != typed, || {
        "undo did nothing after Vim was turned off".to_owned()
    })
}

fn buffer_end(editor: &NoteEditor) {
    let buffer = editor.view().buffer();
    buffer.place_cursor(&buffer.end_iter());
}

fn vim_edit_undo(h: &mut Harness) -> Result<(), String> {
    let editor = open_editor(h)?;
    show_saved(h, &editor, VIM_TEXT)?;
    set_vim_mode(h, &editor, true)?;
    let context = vim_context(&editor)?;
    expect_consistent(&editor, VIM_TEXT, "before editing")?;

    context.execute_command("%s/second line/2nd 😀é line/");
    h.wait("the Vim substitution", || editor.text() != VIM_TEXT)?;
    expect_consistent(&editor, VIM_RENAMED, "after the substitution")?;
    ensure(editor.can_undo(), || {
        "the Vim edit is not in the app's history".to_owned()
    })?;

    expect_handled(press_u(&editor)?, "u")?;
    expect_consistent(&editor, VIM_TEXT, "after u")?;
    expect_handled(press_ctrl_r(&editor)?, "Ctrl+R")?;
    expect_consistent(&editor, VIM_RENAMED, "after Ctrl+R")?;

    for (command, text) in [
        ("undo", VIM_TEXT),
        ("redo", VIM_RENAMED),
        (":u", VIM_TEXT),
        (":red", VIM_RENAMED),
    ] {
        ensure(run_ex_command(&context, command), || {
            format!("{command:?} was not handled")
        })?;
        expect_consistent(&editor, text, command)?;
    }
    for command in ["w", "s/line/row/", "undoo", "re"] {
        ensure(!run_ex_command(&context, command), || {
            format!("{command:?} was taken from Vim")
        })?;
    }
    expect_consistent(&editor, VIM_RENAMED, "after the other commands")?;

    let before = exported_main(h)?;
    context.emit_by_name::<()>("write", &[&editor.view(), &None::<String>]);
    wait_exported_change(h, &before)?;
    wait_open_note(h, VIM_RENAMED)?;
    ensure(!editor.view().buffer().enables_undo(), || {
        "the buffer's own undo was switched on".to_owned()
    })
}

fn vim_no_corruption(h: &mut Harness) -> Result<(), String> {
    let editor = open_editor(h)?;
    let base = "alpha beta\ngamma delta\n";
    show_saved(h, &editor, base)?;
    set_vim_mode(h, &editor, true)?;
    let context = vim_context(&editor)?;

    context.execute_command("%s/mm/😀é/");
    let first = "alpha beta\nga😀éa delta\n";
    h.wait("the first Vim substitution", || editor.text() != base)?;
    expect_consistent(&editor, first, "after the first substitution")?;
    wait_echo(h, first)?;
    save_now(h)?;

    remote_edit(h, &editor)?;
    let merged = remotely_edited(first);
    expect_consistent(&editor, &merged, "after the remote edit")?;

    context.execute_command("%s/delta/δ/");
    let second = remotely_edited("alpha beta\nga😀éa δ\n");
    h.wait("the second Vim substitution", || editor.text() != merged)?;
    expect_consistent(&editor, &second, "after the second substitution")?;

    expect_handled(press_u(&editor)?, "u")?;
    expect_consistent(&editor, &merged, "after the first u")?;
    expect_handled(press_u(&editor)?, "u")?;
    expect_consistent(&editor, &remotely_edited(base), "after the second u")?;
    ensure(!editor.can_undo(), || {
        "the remote edit became undoable".to_owned()
    })?;
    expect_handled(press_ctrl_r(&editor)?, "Ctrl+R")?;
    expect_consistent(&editor, &merged, "after the first Ctrl+R")?;
    expect_handled(press_ctrl_r(&editor)?, "Ctrl+R")?;
    expect_consistent(&editor, &second, "after the second Ctrl+R")?;

    editor.undo();
    context.execute_command("%s/ga/γ/");
    ensure(editor.text() != merged, || {
        "the substitution after an app undo did nothing".to_owned()
    })?;
    let third = remotely_edited("alpha beta\nγ😀éa delta\n");
    expect_consistent(
        &editor,
        &third,
        "after the substitution that follows an app undo",
    )?;
    ensure(!editor.can_redo(), || {
        "the redo stack survived a new Vim edit".to_owned()
    })?;

    save_now(h)?;
    wait_open_note(h, &third)
}

const TITLE: &str = "note-title-entry";
const NAME_ERROR: &str = "note-name-error";
const NEW_NAME: &str = "Renamed by the title";
const DRAFT_NAME: &str = "Named in a draft";
const DRAFT_BODY: &str = "Typed after naming";
const BODY_ONLY: &str = "First line of a fresh note\nSecond line of it";

fn note_paths(nodes: &[TreeNode]) -> Vec<Vec<String>> {
    nodes
        .iter()
        .flat_map(|node| match node {
            TreeNode::Note { path, .. } => vec![path.clone()],
            TreeNode::Folder { children, .. } => note_paths(children),
        })
        .collect()
}

fn tree_notes(model: &AppModel) -> Vec<Vec<String>> {
    note_paths(&model.tree().unwrap_or_default())
}

fn title_entry(h: &Harness) -> Result<gtk::Entry, String> {
    h.widget_as::<gtk::Entry>(TITLE)
}

fn focus_within(h: &Harness, widget: &impl IsA<gtk::Widget>) -> bool {
    h.window()
        .ok()
        .and_then(|window| GtkWindowExt::focus(&window))
        .is_some_and(|focus| &focus == widget.upcast_ref() || focus.is_ancestor(widget))
}

fn submit_title(h: &Harness, text: &str) -> Result<(), String> {
    let entry = title_entry(h)?;
    entry.grab_focus();
    h.set_text(TITLE, text)?;
    entry.emit_activate();
    Ok(())
}

fn wait_draft(h: &Harness) -> Result<(), String> {
    let model = h.model()?;
    h.wait("a draft to start", || {
        model.editor_target().is_draft()
            && h.stack_page("note-view").ok().flatten().as_deref() == Some("loaded")
    })
}

fn title_rename(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let title = open_first_note(h)?;
    let model = h.model()?;
    let path = model.open_note_path().ok_or("no note is open")?;
    let renamed = vec![NEW_NAME.to_owned()];
    ensure(path.len() == 1 && title != NEW_NAME, || {
        "the first note is not a top-level note with another name".to_owned()
    })?;
    let before = head_files(h)?;

    submit_title(h, NEW_NAME)?;
    h.wait("the tree and the title to show the new name", || {
        let notes = tree_notes(&model);
        notes.contains(&renamed)
            && !notes.contains(&path)
            && model.open_note_path().as_ref() == Some(&renamed)
            && h.text(TITLE).is_ok_and(|text| text == NEW_NAME)
    })?;
    ensure(!h.shown(NAME_ERROR), || {
        "a successful rename shows an error".to_owned()
    })?;
    save_now(h)?;
    wait_head(h, "the rename on the fake forge", |files| {
        files.len() == before.len() && *files != before
    })?;
    Ok(())
}

fn title_rename_error(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let title = open_first_note(h)?;
    let model = h.model()?;
    let path = model.open_note_path().ok_or("no note is open")?;
    let sibling = tree_notes(&model)
        .into_iter()
        .find(|other| {
            other.len() == path.len()
                && other[..path.len() - 1] == path[..path.len() - 1]
                && *other != path
        })
        .and_then(|other| other.last().cloned())
        .ok_or("the first note has no sibling note")?;
    let before = exported_main(h)?;
    let notes_before = tree_notes(&model);

    submit_title(h, &sibling)?;
    h.wait("the name error", || {
        model.note_name_error().is_some_and(|error| {
            h.shown(NAME_ERROR) && h.label(NAME_ERROR).is_ok_and(|label| label == error)
        })
    })?;
    ensure(model.open_note_path().as_ref() == Some(&path), || {
        "a refused name moved the note".to_owned()
    })?;

    h.set_text(TITLE, &title)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    editor.view().grab_focus();
    h.wait("the name error to clear", || {
        model.note_name_error().is_none() && !h.shown(NAME_ERROR)
    })?;
    ensure(h.text(TITLE)? == title, || {
        "the title lost the note's name".to_owned()
    })?;
    ensure(model.open_note_path().as_ref() == Some(&path), || {
        "restoring the name moved the note".to_owned()
    })?;
    ensure(tree_notes(&model) == notes_before, || {
        "the tree changed after a refused rename".to_owned()
    })?;
    save_now(h)?;
    ensure(exported_main(h)? == before, || {
        "a refused rename reached the fake forge".to_owned()
    })
}

fn new_note_named(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    show_light(h)?;
    open_first_note(h)?;
    let model = h.model()?;
    let before = head_files(h)?;

    h.click("new-note-button")?;
    wait_draft(h)?;
    let entry = title_entry(h)?;
    h.wait("the empty title to take focus", || {
        focus_within(h, &entry) && entry.text().is_empty()
    })?;
    h.capture_variant("draft", Width::Wide, Theme::Light)?;

    let created = vec![DRAFT_NAME.to_owned()];
    submit_title(h, DRAFT_NAME)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    h.wait("the note to be created with the editor focused", || {
        tree_notes(&model).contains(&created)
            && model.editor_target() == EditorTarget::Note(created.clone())
            && focus_within(h, &editor.view())
    })?;
    ensure(h.text(TITLE)? == DRAFT_NAME, || {
        "the title does not show the new name".to_owned()
    })?;
    save_now(h)?;
    wait_head(h, "the new note on the fake forge", |files| {
        files.len() > before.len()
    })?;

    let committed = exported_main(h)?;
    type_text(&editor, DRAFT_BODY);
    let text = editor.text();
    save_now(h)?;
    wait_exported_change(h, &committed)?;
    wait_open_note(h, &text)?;
    ensure(model.open_note_path().as_ref() == Some(&created), || {
        "the body went to another note".to_owned()
    })
}

fn new_note_ctrl_n_body_only(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let window = h.window()?;
    let application = window
        .application()
        .ok_or("the window has no application")?;
    let accels = application.accels_for_action("win.new-note");
    ensure(accels.iter().any(|accel| accel == "<Control>n"), || {
        format!("win.new-note is bound to {accels:?}")
    })?;
    let model = h.model()?;
    let notes_before = tree_notes(&model);
    let before = head_files(h)?;

    h.window_action("new-note")?;
    wait_draft(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    editor.view().grab_focus();
    type_text(&editor, BODY_ONLY);
    let typed_caret = caret(&editor);
    save_now(h)?;

    h.wait("the note to be created from its body", || {
        model
            .editor_target()
            .note_path()
            .is_some_and(|path| !notes_before.iter().any(|note| note == path))
            && tree_notes(&model).len() == notes_before.len() + 1
    })?;
    let path = model.open_note_path().ok_or("no note is open")?;
    ensure(tree_notes(&model).contains(&path), || {
        "the tree lacks the created note".to_owned()
    })?;
    ensure(path.len() == 1 && !path[0].is_empty(), || {
        "the created note has no top-level name".to_owned()
    })?;
    wait_open_note(h, BODY_ONLY)?;
    save_now(h)?;
    wait_head(h, "the new note on the fake forge", |files| {
        files.len() > before.len()
    })?;
    ensure(editor.text() == BODY_ONLY, || {
        "the editor lost the typed body".to_owned()
    })?;
    ensure(caret(&editor) == typed_caret, || {
        format!("the caret moved from {typed_caret} to {}", caret(&editor))
    })
}

fn draft_leave(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let model = h.model()?;
    let notes_before = tree_notes(&model);
    let before = exported_main(h)?;

    h.window_action("new-note")?;
    wait_draft(h)?;
    let title = open_first_note(h)?;
    ensure(!model.editor_target().is_draft(), || {
        "opening a note kept the draft".to_owned()
    })?;
    ensure(h.text(TITLE)? == title, || {
        "the title does not show the opened note".to_owned()
    })?;
    save_now(h)?;
    ensure(tree_notes(&model) == notes_before, || {
        "leaving the draft changed the tree".to_owned()
    })?;
    ensure(exported_main(h)? == before, || {
        "leaving the draft reached the fake forge".to_owned()
    })
}

const SAMPLE_REPO_KEY: &str = "sample/notes";
const EARLY_NAME: &str = "Typed while loading";
const EARLY_BODY: &str = "Body typed before the notes were ready";
const EARLY_NAME_ENTRY: &str = "early-draft-name-entry";
const EARLY_BODY_VIEW: &str = "early-draft-body";

fn hold_loading(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, true)?;
    reopen_held(h)
}

fn reopen_held(h: &mut Harness) -> Result<(), String> {
    h.close();

    unsafe { std::env::set_var("COMMITNOTE_TESTING_HOLD_LOADING", "1") };
    let held = h.launch().and_then(|()| {
        h.wait_route("the held loading route", |route| {
            *route == Route::Loading { failure: None }
        })
    });
    unsafe { std::env::remove_var("COMMITNOTE_TESTING_HOLD_LOADING") };
    held?;
    h.wait_page("loading")?;
    h.wait_shown(EARLY_NAME_ENTRY)?;
    h.wait_shown(EARLY_BODY_VIEW)
}

fn set_early_body(h: &Harness, text: &str) -> Result<(), String> {
    h.widget_as::<gtk::TextView>(EARLY_BODY_VIEW)?
        .buffer()
        .set_text(text);
    Ok(())
}

fn finish_loading(h: &Harness) -> Result<(), String> {
    h.window_action("testing-finish-loading")?;
    h.wait_page_for("notes", UNLOCK_TIMEOUT)
}

fn early_draft_created(h: &mut Harness) -> Result<(), String> {
    hold_loading(h)?;
    let model = h.model()?;
    let body_view = h.widget_as::<gtk::TextView>(EARLY_BODY_VIEW)?;
    h.wait("the early body to be at least 200 px tall", || {
        body_view.height() >= 200
    })?;

    let entry = h.widget_as::<gtk::Entry>(EARLY_NAME_ENTRY)?;
    ensure(entry.placeholder_text().as_deref() == Some("Name"), || {
        "the early name has no Name placeholder".to_owned()
    })?;
    entry.grab_focus();
    h.set_text(EARLY_NAME_ENTRY, EARLY_NAME)?;
    entry.emit_activate();
    h.wait("the early body to take focus", || {
        focus_within(h, &body_view)
    })?;
    set_early_body(h, EARLY_BODY)?;
    let early = model.early_draft();
    ensure(
        early.name == EARLY_NAME && early.body == EARLY_BODY && early.name_confirmed,
        || format!("the model holds {early:?}"),
    )?;
    let finish = h.widget("loading-finish-button")?;
    finish.set_opacity(0.0);
    let pictured = h.screenshots("early-draft", NARROW_LIGHT);
    finish.set_opacity(1.0);
    pictured?;
    h.resize(Width::Wide)?;

    finish_loading(h)?;
    let created = vec![EARLY_NAME.to_owned()];
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    h.wait("the early draft to become a focused note", || {
        model.editor_target() == EditorTarget::Note(created.clone())
            && editor.text() == EARLY_BODY
            && focus_within(h, &editor.view())
    })?;
    ensure(tree_notes(&model).contains(&created), || {
        "the tree lacks the early note".to_owned()
    })?;
    ensure(caret(&editor) == EARLY_BODY.chars().count() as i32, || {
        format!("the caret is at {}, not at the end", caret(&editor))
    })?;
    ensure(model.early_draft().is_empty(), || {
        "the early draft was not cleared".to_owned()
    })?;
    ensure(h.text(TITLE)? == EARLY_NAME, || {
        "the title does not show the early name".to_owned()
    })?;

    let before = exported_main(h)?;
    type_text(&editor, "!");
    save_now(h)?;
    wait_exported_change(h, &before)?;
    wait_open_note(h, &format!("{EARLY_BODY}!"))
}

fn early_draft_body_only(h: &mut Harness) -> Result<(), String> {
    hold_loading(h)?;
    let model = h.model()?;
    set_early_body(h, BODY_ONLY)?;
    ensure(model.early_draft().body == BODY_ONLY, || {
        "the model does not hold the early body".to_owned()
    })?;

    finish_loading(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    h.wait("the early body to become a note", || {
        model.editor_target().note_path().is_some()
    })?;
    h.wait("the early body to reach the editor", || {
        editor.text() == BODY_ONLY
    })?;
    h.wait("the editor to take focus", || {
        focus_within(h, &editor.view())
    })?;
    let path = model.open_note_path().ok_or("no note is open")?;
    ensure(
        path.len() == 1 && !path[0].is_empty() && tree_notes(&model).contains(&path),
        || format!("the created note is at {path:?}"),
    )?;
    ensure(caret(&editor) == BODY_ONLY.chars().count() as i32, || {
        format!("the caret is at {}, not at the end", caret(&editor))
    })?;
    ensure(model.early_draft().is_empty(), || {
        "the early draft was not cleared".to_owned()
    })?;

    let before = exported_main(h)?;
    type_text(&editor, "!");
    save_now(h)?;
    wait_exported_change(h, &before)?;
    wait_open_note(h, &format!("{BODY_ONLY}!"))
}

fn press_to_start(
    h: &Harness,
    key: gdk::Key,
    state: gdk::ModifierType,
    is_repeat: bool,
) -> Result<gtk::glib::Propagation, String> {
    Ok(handle_type_to_start_key(
        &h.model()?,
        &h.window()?,
        key,
        state,
        is_repeat,
    ))
}

fn type_to_start_starts_note(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let model = h.model()?;
    ensure(
        model.editor_target() == EditorTarget::None && h.window()?.notes_placeholder_visible(),
        || "a note is already open".to_owned(),
    )?;
    let before = head_files(h)?;

    let none = gdk::ModifierType::empty();
    let keys = [
        (gdk::Key::H, gdk::ModifierType::SHIFT_MASK),
        (gdk::Key::i, none),
        (gdk::Key::Return, none),
    ];
    for (key, state) in keys {
        ensure(
            press_to_start(h, key, state, false)? == gtk::glib::Propagation::Stop,
            || format!("{} was not taken", key.name().unwrap_or_default()),
        )?;
    }

    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    h.wait("the typed keys to reach the focused draft", || {
        model.editor_target().is_draft()
            && editor.text() == "Hi\n"
            && focus_within(h, &editor.view())
            && !model.type_to_start_pending()
    })?;
    ensure(caret(&editor) == 3, || {
        format!("the caret is at {}", caret(&editor))
    })?;
    ensure(editor.can_undo(), || {
        "the typed keys are not undoable".to_owned()
    })?;
    editor.undo();
    ensure(editor.text().is_empty() && !editor.can_undo(), || {
        "the held keys were not one undoable edit".to_owned()
    })?;
    h.press_shortcut(editor.upcast_ref::<gtk::Widget>(), "<Control><Shift>z")?;
    ensure(editor.text() == "Hi\n", || {
        "redo did not bring the keys back".to_owned()
    })?;

    save_now(h)?;
    wait_head(h, "the typed note on the fake forge", |files| {
        files.len() > before.len()
    })?;
    wait_open_note(h, "Hi\n")
}

fn set_type_to_start(h: &Harness, on: bool) -> Result<(), String> {
    let model = h.model()?;
    let value = if on { "true" } else { "false" };
    h.run(
        "the type-to-start setting to change",
        model.testing_send(
            "settings.change",
            serde_json::json!({ "key": "typeToStart", "value": value }),
        ),
    )?
    .map_err(|error| format!("cannot change typeToStart: {}", error.message))?;
    h.wait("the model to follow the type-to-start setting", || {
        model.type_to_start() == on
    })
}

fn expect_not_started(
    h: &Harness,
    why: &str,
    key: gdk::Key,
    state: gdk::ModifierType,
    is_repeat: bool,
) -> Result<(), String> {
    let model = h.model()?;
    let target = model.editor_target();
    ensure(
        press_to_start(h, key, state, is_repeat)? == gtk::glib::Propagation::Proceed,
        || format!("a key was taken {why}"),
    )?;
    ensure(
        !model.type_to_start_pending() && model.editor_target() == target,
        || format!("a draft started {why}"),
    )
}

fn type_to_start_blocked(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let model = h.model()?;
    let none = gdk::ModifierType::empty();
    ensure(model.editor_target() == EditorTarget::None, || {
        "a note is already open".to_owned()
    })?;

    expect_not_started(
        h,
        "with Control held",
        gdk::Key::x,
        gdk::ModifierType::CONTROL_MASK,
        false,
    )?;
    expect_not_started(h, "for a repeated key", gdk::Key::x, none, true)?;
    expect_not_started(h, "for a space", gdk::Key::space, none, false)?;

    set_type_to_start(h, false)?;
    expect_not_started(h, "with the setting off", gdk::Key::x, none, false)?;
    set_type_to_start(h, true)?;

    let title = open_first_note(h)?;
    expect_not_started(h, "while a note is open", gdk::Key::x, none, false)?;
    ensure(h.text(TITLE)? == title, || {
        "the open note changed".to_owned()
    })?;

    h.window_action("new-note")?;
    wait_draft(h)?;
    let entry = title_entry(h)?;
    entry.grab_focus();
    expect_not_started(h, "while the title is focused", gdk::Key::x, none, false)?;
    ensure(entry.text().is_empty(), || {
        "the title took a typed key".to_owned()
    })
}

const SYNC_BUTTON: &str = "sync-status-button";
const CONTENT_SYNC_BUTTON: &str = "content-sync-status-button";
const BANNER: &str = "note-banner";
const SYNCED_ICON: &str = "object-select-symbolic";
const SYNCING_ICON: &str = "emblem-synchronizing-symbolic";
const PENDING_ICON: &str = "preferences-system-time-symbolic";
const OFFLINE_ICON: &str = "network-offline-symbolic";
const FAILED_ICON: &str = "dialog-warning-symbolic";
const CONFLICT_ICON: &str = "dialog-error-symbolic";
const LOCAL_LINE_START: &str = "Changed here ";
const MERGED_BY_HAND: &str = "Merged by hand\n";
const REMOTE_CHANGE_MESSAGE: &str = "This note was moved to the trash on another device.";

fn sync_icon(h: &Harness, name: &str) -> Option<String> {
    h.widget_as::<gtk::MenuButton>(name)
        .ok()?
        .icon_name()
        .map(|icon| icon.to_string())
}

fn wait_sync_icon(h: &Harness, icon: &str) -> Result<(), String> {
    h.wait(&format!("the sync status to show {icon}"), || {
        h.shown(SYNC_BUTTON) && sync_icon(h, SYNC_BUTTON).as_deref() == Some(icon)
    })
}

fn sync_text(model: &AppModel) -> Option<String> {
    let sync = model.sync_state()?;
    Some(sync.status.unwrap_or(sync.label))
}

fn banner_shows(h: &Harness, title: &str) -> bool {
    h.widget_as::<adw::Banner>(BANNER)
        .is_ok_and(|banner| banner.is_revealed() && banner.is_mapped() && banner.title() == title)
}

fn wait_banner_hidden(h: &Harness) -> Result<(), String> {
    h.wait("the note banner to hide", || {
        h.widget_as::<adw::Banner>(BANNER)
            .is_ok_and(|banner| !banner.is_revealed())
    })
}

/// Applies the screenshot appearance and waits for the settings it saves to reach the forge, so
/// later checks of the forge's head see only the commits they trigger.
fn show_light(h: &Harness) -> Result<(), String> {
    let before = exported_main(h)?;
    h.show_variant(Width::Wide, Theme::Light)?;
    wait_exported_change(h, &before)
}

fn fail_commits(h: &Harness, fail: bool) -> Result<(), String> {
    let model = h.model()?;
    let repo = model
        .testing_repo_key()
        .unwrap_or_else(|| SAMPLE_REPO_KEY.to_owned());
    let (command, params) = if fail {
        (
            "fake.failNext",
            serde_json::json!({ "repo": repo, "operation": "commit", "kind": "Network", "count": 50 }),
        )
    } else {
        (
            "fake.clearFailures",
            serde_json::json!({ "repo": repo, "operation": "commit" }),
        )
    };
    h.run(
        "the fake forge failures",
        model.testing_send(command, params),
    )?
    .map(|_| ())
    .map_err(|error| format!("cannot set the fake forge failures: {}", error.message))
}

fn type_at_end(h: &Harness, editor: &NoteEditor) -> Result<String, String> {
    let buffer = editor.view().buffer();
    buffer.place_cursor(&buffer.end_iter());
    type_text(editor, TYPED);
    let typed = editor.text();
    wait_echo(h, &typed)?;
    Ok(typed)
}

fn sync_status_states(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    wait_sync_icon(h, SYNCED_ICON)?;
    open_first_note(h)?;
    let model = h.model()?;
    let icons = Rc::new(RefCell::new(Vec::<String>::new()));
    let button = h.widget_as::<gtk::MenuButton>(SYNC_BUTTON)?;
    let handler = model.connect_sync_state_changed({
        let icons = icons.clone();
        let button = button.clone();
        move |_| {
            icons
                .borrow_mut()
                .extend(button.icon_name().map(|icon| icon.to_string()))
        }
    });
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    let outcome = (|| {
        type_at_end(h, &editor)?;
        h.wait("the unsaved edit to show", || {
            icons
                .borrow()
                .iter()
                .any(|icon| icon == PENDING_ICON || icon == SYNCING_ICON)
        })?;
        ensure(
            button.tooltip_text().map(|text| text.to_string()) == sync_text(&model),
            || "the sync status does not describe the state".to_owned(),
        )?;
        save_now(h)?;
        wait_sync_icon(h, SYNCED_ICON)
    })();
    model.disconnect(handler);
    outcome?;

    h.resize(Width::Narrow)?;
    let split = split_view(h)?;
    split.set_show_content(true);
    h.wait("the sync status to move to the note header", || {
        h.shown(CONTENT_SYNC_BUTTON)
            && !h.shown(SYNC_BUTTON)
            && sync_icon(h, CONTENT_SYNC_BUTTON).as_deref() == Some(SYNCED_ICON)
    })?;
    split.set_show_content(false);
    h.wait("the sync status to show in the narrow sidebar", || {
        h.shown(SYNC_BUTTON) && !h.shown(CONTENT_SYNC_BUTTON)
    })?;
    h.resize(Width::Wide)?;
    h.wait("the sync status to return to the sidebar", || {
        h.shown(SYNC_BUTTON) && !h.shown(CONTENT_SYNC_BUTTON)
    })
}

fn offline_and_recover(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    show_light(h)?;
    open_first_note(h)?;
    let model = h.model()?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    let before = exported_main(h)?;
    model.set_online(false);
    wait_sync_icon(h, OFFLINE_ICON)?;
    h.wait("the offline banner", || {
        sync_text(&model).is_some_and(|text| banner_shows(h, &text))
    })?;
    ensure(
        h.widget_as::<adw::Banner>(BANNER)?.button_label().is_none(),
        || "the offline banner offers an action".to_owned(),
    )?;
    h.capture_variant("sync-offline", Width::Wide, Theme::Light)?;

    let typed = type_at_end(h, &editor)?;
    save_now(h)?;
    ensure(exported_main(h)? == before, || {
        "an edit was committed while offline".to_owned()
    })?;
    ensure(editor.view().is_editable(), || {
        "the note cannot be edited while offline".to_owned()
    })?;

    model.set_online(true);
    wait_exported_change(h, &before)?;
    wait_open_note(h, &typed)?;
    wait_banner_hidden(h)?;
    wait_sync_icon(h, SYNCED_ICON)
}

fn failed_and_retry(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    show_light(h)?;
    open_first_note(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    let before = exported_main(h)?;
    fail_commits(h, true)?;
    let typed = type_at_end(h, &editor)?;
    save_now(h)?;
    wait_sync_icon(h, FAILED_ICON)?;
    let banner = h.widget_as::<adw::Banner>(BANNER)?;
    h.wait("the failure banner", || {
        banner.is_revealed() && banner.button_label().as_deref() == Some("_Retry Now")
    })?;

    h.wait("the retry item in the sync status menu", || {
        h.widget("sync-status-retry").is_ok()
    })?;
    let popover = h
        .widget_as::<gtk::MenuButton>(SYNC_BUTTON)?
        .popover()
        .ok_or("the sync status has no menu")?;
    // Without an input seat an autohiding popover cannot take its grab and closes at once.
    popover.set_autohide(false);
    popover.popup();
    let shown = h.wait_shown("sync-status-retry").and_then(|()| {
        h.capture_variant_with_popover("sync-failed", Width::Wide, Theme::Light, &popover)
    });
    popover.popdown();
    popover.set_autohide(true);
    shown?;

    fail_commits(h, false)?;
    banner.emit_by_name::<()>("button-clicked", &[]);
    wait_exported_change(h, &before)?;
    wait_open_note(h, &typed)?;
    wait_sync_icon(h, SYNCED_ICON)?;
    wait_banner_hidden(h)
}

fn find_button(root: &gtk::Widget, label: &str) -> Option<gtk::Button> {
    let mut child = root.first_child();
    while let Some(widget) = child {
        if let Some(button) = widget.downcast_ref::<gtk::Button>()
            && button.label().as_deref() == Some(label)
        {
            return Some(button.clone());
        }
        if let Some(found) = find_button(&widget, label) {
            return Some(found);
        }
        child = widget.next_sibling();
    }
    None
}

fn open_conflict(model: &AppModel) -> Option<OpenNoteConflict> {
    match model.open_note_state()? {
        OpenNote::Loaded { conflict, .. } => conflict,
        _ => None,
    }
}

/// Edits the first line here and on another device, then saves, which leaves the open note in
/// conflict.
fn make_conflict(h: &Harness, editor: &NoteEditor) -> Result<(String, OpenNoteConflict), String> {
    let model = h.model()?;
    h.run("the remote edit", async move {
        model.testing_remote_edit().await
    })?
    .map_err(|error| format!("cannot edit remotely: {}", error.message))?;
    let buffer = editor.view().buffer();
    buffer.place_cursor(&buffer.start_iter());
    type_text(editor, LOCAL_LINE_START);
    let typed = editor.text();
    wait_echo(h, &typed)?;
    save_now(h)?;
    let model = h.model()?;
    h.wait("the conflict", || {
        open_conflict(&model).is_some_and(|conflict| !conflict.editing)
    })?;
    let conflict = open_conflict(&model).ok_or("the conflict went away")?;
    Ok((typed, conflict))
}

fn open_conflict_dialog(h: &Harness, conflict: &OpenNoteConflict) -> Result<(), String> {
    let banner = h.widget_as::<adw::Banner>(BANNER)?;
    banner.emit_by_name::<()>("button-clicked", &[]);
    h.wait_shown("conflict-dialog")?;
    let dialog = h.widget_as::<adw::AlertDialog>("conflict-dialog")?;
    for response in ["keep-this", "keep-other", "edit-merged", "cancel"] {
        ensure(dialog.has_response(response), || {
            format!("the conflict dialog has no {response} response")
        })?;
    }
    ensure(
        h.text_view_text("conflict-merged-text")? == conflict.merged,
        || "the conflict dialog does not show the merged text".to_owned(),
    )?;
    if let Some(at) = conflict.merged.find("<<<<<<<") {
        let offset = conflict.merged[..at].chars().count() as i32;
        ensure(
            h.tags_at("conflict-merged-text", offset)?
                .iter()
                .any(|tag| tag == "conflict-marker"),
            || "the conflict markers are not dimmed".to_owned(),
        )?;
    }
    Ok(())
}

fn choose_resolution(h: &Harness, label: &str) -> Result<(), String> {
    let dialog = h.widget_as::<adw::AlertDialog>("conflict-dialog")?;
    find_button(dialog.upcast_ref(), label)
        .ok_or_else(|| format!("the conflict dialog has no {label} button"))?
        .emit_clicked();
    h.wait("the conflict dialog to close", || {
        !h.shown("conflict-dialog")
    })
}

fn resolve_with(h: &Harness, conflict: &OpenNoteConflict, label: &str) -> Result<(), String> {
    open_conflict_dialog(h, conflict)?;
    choose_resolution(h, label)
}

fn conflict_resolve(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    open_first_note(h)?;
    let model = h.model()?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    let title = h.widget_as::<gtk::Entry>("note-title-entry")?;

    let (typed, conflict) = make_conflict(h, &editor)?;
    h.wait("the conflict banner and a locked note", || {
        banner_shows(h, &conflict.heading) && !editor.view().is_editable() && !title.is_editable()
    })?;
    wait_sync_icon(h, CONFLICT_ICON)?;
    let before = exported_main(h)?;
    open_conflict_dialog(h, &conflict)?;
    h.session_screenshots("conflict", WIDE_VARIANTS)?;
    choose_resolution(h, &conflict.keep_this_label)?;
    wait_exported_change(h, &before)?;
    wait_open_note(h, &typed)?;
    h.wait("the note to unlock", || {
        open_conflict(&model).is_none() && editor.view().is_editable() && title.is_editable()
    })?;
    wait_banner_hidden(h)?;

    let (_, conflict) = make_conflict(h, &editor)?;
    resolve_with(h, &conflict, &conflict.edit_merged_label)?;
    h.wait("the merged text to open for editing", || {
        editor.text() == conflict.merged
            && editor.view().is_editable()
            && banner_shows(h, &conflict.edit_hint)
    })?;
    let before = exported_main(h)?;
    set_note_text(&editor, MERGED_BY_HAND, 0, 0);
    wait_echo(h, MERGED_BY_HAND)?;
    save_now(h)?;
    wait_exported_change(h, &before)?;
    h.wait("the conflict to clear", || {
        open_conflict(&model).is_none() && title.is_editable()
    })?;
    wait_banner_hidden(h)
}

fn remote_change_toast(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    open_first_note(h)?;
    h.model()?
        .testing_remote_change(RemoteChange::Trashed, REMOTE_CHANGE_MESSAGE);
    h.wait("the remote change toast", || {
        h.label_shown_with(REMOTE_CHANGE_MESSAGE)
    })
}

const CLOSE_DIALOG: &str = "close-unsaved-dialog";
const LOGOUT_DIALOG: &str = "logout-unsaved-dialog";

fn count_named(root: &gtk::Widget, name: &str) -> usize {
    let mut count = 0;
    let mut child = root.first_child();
    while let Some(widget) = child {
        count += usize::from(widget.widget_name() == name) + count_named(&widget, name);
        child = widget.next_sibling();
    }
    count
}

fn wait_window_closed(h: &Harness) -> Result<(), String> {
    let window = h.window()?;
    h.wait("the window to close", || !window.is_visible())
}

fn answer(h: &Harness, name: &str, label: &str) -> Result<(), String> {
    let dialog = h.widget_as::<adw::AlertDialog>(name)?;
    find_button(dialog.upcast_ref(), label)
        .ok_or_else(|| format!("{name} has no {label} button"))?
        .emit_clicked();
    h.wait(&format!("{name} to close"), || !h.shown(name))
}

fn expect_responses(h: &Harness, name: &str, responses: &[&str]) -> Result<(), String> {
    let dialog = h.widget_as::<adw::AlertDialog>(name)?;
    for response in responses {
        ensure(dialog.has_response(response), || {
            format!("{name} has no {response} response")
        })?;
    }
    ensure(
        dialog.heading().as_deref() == Some("Some Changes Are Not Saved"),
        || format!("{name} has the wrong heading"),
    )
}

/// Opens a note and leaves an edit that the fake forge refuses to save.
fn unsaved_edit(h: &Harness) -> Result<serde_json::Value, String> {
    open_first_note(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    let before = exported_main(h)?;
    fail_commits(h, true)?;
    type_at_end(h, &editor)?;
    Ok(before)
}

fn close_saved_closes(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    open_first_note(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    let before = exported_main(h)?;
    type_at_end(h, &editor)?;
    h.window()?.close();
    wait_window_closed(h)?;
    ensure(!h.shown(CLOSE_DIALOG), || {
        "a saved close asked about unsaved changes".to_owned()
    })?;
    wait_exported_change(h, &before)
}

fn close_unsaved_asks(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    show_light(h)?;
    let before = unsaved_edit(h)?;
    let window = h.window()?;
    h.window_action("quit")?;
    window.close();
    h.wait_shown(CLOSE_DIALOG)?;
    h.capture_variant("close-guard", Width::Wide, Theme::Light)?;
    ensure(
        window.is_visible() && count_named(window.upcast_ref(), CLOSE_DIALOG) == 1,
        || "a second close request changed the guarded close".to_owned(),
    )?;
    expect_responses(h, CLOSE_DIALOG, &["keep-trying", "quit-anyway"])?;
    let dialog = h.widget_as::<adw::AlertDialog>(CLOSE_DIALOG)?;
    ensure(dialog.body() == unsaved_body(1), || {
        "the close dialog does not count one unsaved note".to_owned()
    })?;

    let model = h.model()?;
    let syncing = Rc::new(Cell::new(false));
    let handler = model.connect_sync_state_changed({
        let syncing = syncing.clone();
        move |model| {
            if model
                .sync_state()
                .is_some_and(|sync| sync.state == SyncState::Syncing)
            {
                syncing.set(true);
            }
        }
    });
    let retried = answer(h, CLOSE_DIALOG, "_Keep Trying")
        .and_then(|()| h.wait("the save to be retried", || syncing.get()));
    model.disconnect(handler);
    retried?;
    ensure(window.is_visible(), || {
        "keep trying closed the window".to_owned()
    })?;

    fail_commits(h, false)?;
    window.close();
    wait_window_closed(h)?;
    wait_exported_change(h, &before)?;

    launch_and_log_in(h, false)?;
    let before = unsaved_edit(h)?;
    h.window()?.close();
    h.wait_shown(CLOSE_DIALOG)?;
    answer(h, CLOSE_DIALOG, "_Quit Anyway")?;
    wait_window_closed(h)?;
    ensure(h.model()?.unsaved_count() > 0, || {
        "quitting anyway saved the note".to_owned()
    })?;
    ensure(exported_main(h)? == before, || {
        "quitting anyway committed the note".to_owned()
    })
}

fn close_early_draft_asks(h: &mut Harness) -> Result<(), String> {
    hold_loading(h)?;
    h.window()?.close();
    wait_window_closed(h)?;
    ensure(!h.shown(CLOSE_DIALOG), || {
        "an empty early draft asked before closing".to_owned()
    })?;

    reopen_held(h)?;
    let model = h.model()?;
    let window = h.window()?;
    set_early_body(h, EARLY_BODY)?;
    h.window_action("quit")?;
    window.close();
    h.wait_shown(CLOSE_DIALOG)?;
    ensure(
        window.is_visible() && count_named(window.upcast_ref(), CLOSE_DIALOG) == 1,
        || "a second close request changed the guarded close".to_owned(),
    )?;
    expect_responses(h, CLOSE_DIALOG, &["keep-trying", "quit-anyway"])?;
    let dialog = h.widget_as::<adw::AlertDialog>(CLOSE_DIALOG)?;
    ensure(dialog.body() == unsaved_body(1), || {
        "the close dialog does not count one unsaved note".to_owned()
    })?;
    answer(h, CLOSE_DIALOG, "_Keep Trying")?;
    ensure(
        window.is_visible() && model.early_draft().body == EARLY_BODY,
        || "keep trying closed the window or lost the text".to_owned(),
    )?;

    finish_loading(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    h.wait("the early body to reach the editor", || {
        editor.text() == EARLY_BODY
    })?;
    ensure(model.early_draft().is_empty(), || {
        "the early draft was not handed off".to_owned()
    })?;
    ensure(!h.shown(CLOSE_DIALOG), || {
        "the close dialog stayed open".to_owned()
    })?;

    reopen_held(h)?;
    let before = exported_main(h)?;
    set_early_body(h, EARLY_BODY)?;
    h.window()?.close();
    h.wait_shown(CLOSE_DIALOG)?;
    answer(h, CLOSE_DIALOG, "_Quit Anyway")?;
    wait_window_closed(h)?;
    ensure(exported_main(h)? == before, || {
        "quitting anyway committed the early draft".to_owned()
    })
}

fn close_shortcuts(h: &mut Harness) -> Result<(), String> {
    h.launch()?;
    let application = h
        .window()?
        .application()
        .ok_or("the window has no application")?;
    for (action, accel) in [
        ("window.close", "<Control>w"),
        ("win.quit", "<Control>q"),
        ("win.save-now", "<Control>s"),
        ("win.new-note", "<Control>n"),
    ] {
        let accels = application.accels_for_action(action);
        ensure(accels.iter().any(|found| found == accel), || {
            format!("{action} is not on {accel}")
        })?;
    }
    Ok(())
}

fn logout_unsaved_warns(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    unsaved_edit(h)?;
    h.window_action("log-out")?;
    h.wait_shown(LOGOUT_DIALOG)?;
    expect_responses(
        h,
        LOGOUT_DIALOG,
        &["cancel", "keep-trying", "log-out-anyway"],
    )?;
    answer(h, LOGOUT_DIALOG, "_Cancel")?;
    ensure(h.route()? == Route::Notes, || {
        "cancelling the logout ended the session".to_owned()
    })?;
    h.window_action("log-out")?;
    h.wait_shown(LOGOUT_DIALOG)?;
    answer(h, LOGOUT_DIALOG, "_Log Out Anyway")?;
    h.wait_page("token")
}

fn logout_inhibit(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let window = h.window()?;
    ensure(!window.holds_logout_inhibit(), || {
        "a saved session inhibits logout".to_owned()
    })?;
    unsaved_edit(h)?;
    h.wait("the logout inhibit", || window.holds_logout_inhibit())?;
    fail_commits(h, false)?;
    save_now(h)?;
    wait_sync_icon(h, SYNCED_ICON)?;
    h.wait("the logout inhibit to be released", || {
        !window.holds_logout_inhibit()
    })
}

fn early_draft_logout_inhibit(h: &mut Harness) -> Result<(), String> {
    hold_loading(h)?;
    let window = h.window()?;
    ensure(!window.holds_logout_inhibit(), || {
        "an empty early draft inhibits logout".to_owned()
    })?;
    set_early_body(h, EARLY_BODY)?;
    ensure(window.holds_logout_inhibit(), || {
        "early draft text does not inhibit logout".to_owned()
    })?;
    set_early_body(h, "")?;
    ensure(!window.holds_logout_inhibit(), || {
        "clearing the early draft kept the logout inhibit".to_owned()
    })?;
    set_early_body(h, EARLY_BODY)?;
    ensure(window.holds_logout_inhibit(), || {
        "typing again did not inhibit logout".to_owned()
    })?;

    finish_loading(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    h.wait("the early body to reach the editor", || {
        editor.text() == EARLY_BODY
    })?;
    save_now(h)?;
    wait_sync_icon(h, SYNCED_ICON)?;
    h.wait("the logout inhibit to be released", || {
        !window.holds_logout_inhibit()
    })
}

const READ_BACK_TYPED: &str = "Typed in the editor 😀\n- [ ] ship it\n";
const READ_BACK_TASK_DONE: &str = "Typed in the editor 😀\n- [x] ship it\n";
const READ_BACK_RENAMED: &str = "Renamed in the editor";
const READ_BACK_CREATED: &str = "Created in the editor";
const READ_BACK_BODY: &str = "Body with an emoji 😀\nand a second line";
const READ_BACK_FILE: &str = "p2-editor.json";

/// The fake forge's repository, in the string form the read-back scenarios carry.
fn exported_string(h: &Harness) -> Result<String, String> {
    let model = h.model()?;
    let repo = model
        .testing_repo_key()
        .unwrap_or_else(|| SAMPLE_REPO_KEY.to_owned());
    let export = model.testing_send("fake.exportRepo", serde_json::json!({ "repoKey": repo }));
    h.run("the repository export", export)?
        .map_err(|error| format!("cannot export the repository: {}", error.message))?["exported"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "the export has no repository".to_owned())
}

fn editor_read_back(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    open_first_note(h)?;
    let model = h.model()?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    let view = editor.view();
    let buffer = view.buffer();

    buffer.place_cursor(&buffer.start_iter());
    type_text(&editor, READ_BACK_TYPED);
    h.wait("the checkbox", || {
        count_overlays(&editor, OverlayKind::Checkbox) > 0
    })?;
    h.settle()?;
    let checkbox = view
        .overlay_rects()
        .into_iter()
        .filter(|(kind, _)| *kind == OverlayKind::Checkbox)
        .map(|(_, rect)| rect)
        .min_by(|a, b| a.y().total_cmp(&b.y()))
        .ok_or("no checkbox overlay")?
        .center();
    let toggled = view
        .toggle_at_point(f64::from(checkbox.x()), f64::from(checkbox.y()))
        .ok_or("no checkbox under the typed task")?;
    editor.apply_command(toggled);
    ensure(editor.text().starts_with(READ_BACK_TASK_DONE), || {
        "the checkbox did not tick the typed task".to_owned()
    })?;
    let first_text = editor.text();
    wait_echo(h, &first_text)?;

    let renamed = vec![READ_BACK_RENAMED.to_owned()];
    submit_title(h, READ_BACK_RENAMED)?;
    h.wait("the note to take its new name", || {
        model.open_note_path().as_ref() == Some(&renamed)
            && h.text(TITLE).is_ok_and(|text| text == READ_BACK_RENAMED)
    })?;

    h.window_action("new-note")?;
    wait_draft(h)?;
    let entry = title_entry(h)?;
    h.wait("the empty title to take focus", || {
        focus_within(h, &entry) && entry.text().is_empty()
    })?;
    let created = vec![READ_BACK_CREATED.to_owned()];
    submit_title(h, READ_BACK_CREATED)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    h.wait("the new note to open with the editor focused", || {
        model.editor_target() == EditorTarget::Note(created.clone())
            && focus_within(h, &editor.view())
    })?;
    type_text(&editor, READ_BACK_BODY);
    let second_text = editor.text();
    wait_echo(h, &second_text)?;

    h.window_action("save-now")?;
    wait_sync_icon(h, SYNCED_ICON)?;
    h.wait("every edit to be saved", || model.unsaved_count() == 0)?;
    wait_open_note(h, &second_text)?;

    let exported = exported_string(h)?;
    write_read_back(
        READ_BACK_FILE,
        "p2 editor",
        PASSPHRASE,
        &exported,
        &[(renamed, first_text), (created, second_text)],
    )?;
    Ok(())
}
