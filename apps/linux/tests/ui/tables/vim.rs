use commitnote::editor::{MarkdownView, NoteEditor};
use commitnote_markdown::{VerticalDirection, parse, table_entry_target};
use gtk4::{self as gtk, graphene, prelude::*};

use super::paging::{landing_row, wait_caret_shown};
use super::{
    KEYS_COLUMN, KEYS_TABLE, PAGE_COLUMN, focus_view, open_note, page_table, place_caret, rendered,
    table_line_offset, view_window, wait_caret, wait_revealed,
};
use crate::flows::ensure;
use crate::p2::{set_note_text, set_vim_mode};
use crate::support::Harness;

const TALL_TABLE_ROWS: usize = 32;
const LINES_BESIDE_TABLE: usize = 40;
/// How far inside the page edge a page key leaves from the caret starts, so the editor's own
/// scrolling to the caret leaves the page alone.
const CARET_INSET: i32 = 2;

struct Motion {
    prefix: &'static str,
    down: &'static str,
    up: &'static str,
}

const MOTIONS: [Motion; 3] = [
    Motion {
        prefix: "",
        down: "Down",
        up: "Up",
    },
    Motion {
        prefix: "",
        down: "j",
        up: "k",
    },
    Motion {
        prefix: "g",
        down: "j",
        up: "k",
    },
];

fn top_level_note() -> String {
    format!("Paragraph above the table.\n{KEYS_TABLE}\n## Heading below the table")
}

fn quoted(text: &str) -> String {
    text.lines()
        .map(|line| format!("> {line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn line_start(text: &str, line: usize) -> i32 {
    text.split('\n')
        .take(line)
        .map(|text| text.chars().count() as i32 + 1)
        .sum()
}

fn pending(editor: &NoteEditor) -> String {
    editor.vim_status().1
}

/// Waits until the note's one table shows as a widget. A quoted table's overlay ends a few
/// pixels above the next line, so this does not check the placement the way `wait_placed` does.
fn wait_shown(h: &Harness, view: &MarkdownView) -> Result<(), String> {
    h.wait("the table widget to show", || {
        let shown = view.shown_tables();
        shown.len() == 1 && shown[0].widget.is_mapped()
    })?;
    h.settle()
}

fn show_note(
    h: &Harness,
    editor: &NoteEditor,
    view: &MarkdownView,
    text: &str,
) -> Result<(), String> {
    set_note_text(editor, text, 0, 0);
    h.wait("the editor to hold the note", || editor.text() == text)?;
    wait_shown(h, view)
}

/// Presses `accelerator` without waiting for its release: the editor stops a key it takes from
/// Vim, and GTK stops that key's release with it. Each press is followed by a wait on its effect.
fn press(h: &Harness, view: &MarkdownView, accelerator: &str) -> Result<(), String> {
    h.press_keys_in(&view_window(view)?, accelerator)
}

/// Types the count and prefix of a Vim command and waits until Vim holds them as pending.
fn type_pending(h: &Harness, editor: &NoteEditor, typed: &str) -> Result<(), String> {
    if typed.is_empty() {
        return Ok(());
    }
    h.type_keys(typed)?;
    h.wait(&format!("Vim to hold {typed:?} as pending"), || {
        pending(editor) == typed
    })
}

/// Vim's vertical motions in normal mode, with real keys: each lands where the table entry rule
/// says, with the arrows, `j` and `k` left to Vim and `gj` and `gk` entering through the view,
/// and an entry through the view leaves no pending command behind.
pub(super) fn vim(h: &mut Harness) -> Result<(), String> {
    let top = top_level_note();
    let (editor, view) = open_note(h, &top, 0)?;
    set_vim_mode(h, &editor, true)?;
    focus_view(h, &view)?;
    for note in [top.clone(), quoted(&top)] {
        show_note(h, &editor, &view, &note)?;
        motions(h, &editor, &view, &note)?;
    }
    show_note(h, &editor, &view, &top)?;
    pending_cleared(h, &editor, &view, &top)?;
    operator(h, &editor, &view, &top)?;
    insert(h, &editor, &view, &top)?;
    paging(h, &editor, &view)?;
    plain_paging(h, &editor, &view)
}

fn motions(
    h: &Harness,
    editor: &NoteEditor,
    view: &MarkdownView,
    note: &str,
) -> Result<(), String> {
    let document = parse(note);
    let table = rendered(note)?.source;
    let first = document
        .lines
        .partition_point(|&start| start <= table.range.start)
        - 1;
    let lines = first..first + table.lines.len();
    let column = KEYS_COLUMN as usize;
    for motion in &MOTIONS {
        for count in 1..=3 {
            for direction in [VerticalDirection::Down, VerticalDirection::Up] {
                let (line, key) = match direction {
                    VerticalDirection::Down => (lines.start - 1, motion.down),
                    VerticalDirection::Up => (lines.end, motion.up),
                };
                let target = table_entry_target(
                    &document,
                    line,
                    column,
                    direction,
                    count,
                    std::slice::from_ref(&lines),
                )
                .ok_or_else(|| format!("no table entry from line {line} {direction:?}"))?;
                let typed = match count {
                    1 => motion.prefix.to_owned(),
                    _ => format!("{count}{}", motion.prefix),
                };
                place_caret(view, line_start(note, line) + KEYS_COLUMN);
                wait_shown(h, view)?;
                type_pending(h, editor, &typed)?;
                press(h, view, key)?;
                let pressed = format!("{typed}{key} from line {line}");
                wait_caret(
                    h,
                    view,
                    &format!("{pressed} to enter the table"),
                    line_start(note, target.line) + target.column as i32,
                )?;
                wait_revealed(h, view)?;
                ensure(pending(editor).is_empty(), || {
                    format!("{pressed} left {:?} pending", pending(editor))
                })?;
            }
        }
    }
    Ok(())
}

/// After `3gj` enters the table, Vim holds nothing pending, so `j` moves one line.
fn pending_cleared(
    h: &Harness,
    editor: &NoteEditor,
    view: &MarkdownView,
    note: &str,
) -> Result<(), String> {
    place_caret(view, KEYS_COLUMN);
    wait_shown(h, view)?;
    type_pending(h, editor, "3g")?;
    press(h, view, "j")?;
    wait_caret(
        h,
        view,
        "3gj to enter the table on its third line",
        line_start(note, 3) + KEYS_COLUMN,
    )?;
    ensure(pending(editor).is_empty(), || {
        format!("3gj left {:?} pending", pending(editor))
    })?;
    press(h, view, "j")?;
    wait_caret(
        h,
        view,
        "the next j to move one line",
        line_start(note, 4) + KEYS_COLUMN,
    )
}

/// `dj` on the line above the table deletes it and the header as Vim does, and `u` restores them.
fn operator(
    h: &Harness,
    editor: &NoteEditor,
    view: &MarkdownView,
    note: &str,
) -> Result<(), String> {
    let rest: String = note.split_inclusive('\n').skip(2).collect();
    place_caret(view, KEYS_COLUMN);
    wait_shown(h, view)?;
    type_pending(h, editor, "d")?;
    press(h, view, "j")?;
    h.wait(
        "dj to delete the line above the table and the header",
        || editor.text() == rest,
    )?;
    press(h, view, "u")?;
    h.wait("u to restore both lines", || editor.text() == note)
}

/// In insert mode `j` types a `j`.
fn insert(h: &Harness, editor: &NoteEditor, view: &MarkdownView, note: &str) -> Result<(), String> {
    show_note(h, editor, view, note)?;
    place_caret(view, KEYS_COLUMN);
    wait_shown(h, view)?;
    h.type_keys("i")?;
    h.wait("Vim to enter insert mode", || {
        editor.vim_status().0.contains("INSERT")
    })?;
    press(h, view, "j")?;
    let typed = format!(
        "{}j{}",
        &note[..KEYS_COLUMN as usize],
        &note[KEYS_COLUMN as usize..]
    );
    h.wait("j to type a j in insert mode", || editor.text() == typed)?;
    press(h, view, "Escape")?;
    h.wait("Vim to leave insert mode", || {
        editor.vim_status().0.is_empty()
    })
}

fn beside_table(place: &str) -> String {
    (1..=LINES_BESIDE_TABLE)
        .map(|line| format!("Line {line} {place} the table."))
        .collect::<Vec<_>>()
        .join("\n")
}

fn note_scroller(view: &MarkdownView) -> Result<gtk::ScrolledWindow, String> {
    view.ancestor(gtk::ScrolledWindow::static_type())
        .and_downcast::<gtk::ScrolledWindow>()
        .ok_or_else(|| "the note view is not in a scroller".to_owned())
}

/// The scroll value at which the buffer height `y` shows at the top of `scroller`'s page.
fn value_at(view: &MarkdownView, scroller: &gtk::ScrolledWindow, y: i32) -> Result<f64, String> {
    let (x, y) = view.buffer_to_window_coords(gtk::TextWindowType::Widget, 0, y);
    let point = view
        .compute_point(scroller, &graphene::Point::new(x as f32, y as f32))
        .ok_or("the view is not in the scroller")?;
    Ok(scroller.vadjustment().value() + f64::from(point.y()))
}

struct Page {
    key: &'static str,
    typed: &'static str,
    /// Lines to try the caret on, nearest to the table first.
    from: std::ops::Range<i32>,
    up: bool,
}

/// Vim's page keys from above and below a table taller than the page, the caret placed by the
/// page edge it leaves from: each lands on the row at the height Vim's paging moves it to, at the
/// goal column, and reveals the table.
fn paging(h: &Harness, editor: &NoteEditor, view: &MarkdownView) -> Result<(), String> {
    let note = format!(
        "{}\n\n{}\n\n{}",
        beside_table("above"),
        page_table(TALL_TABLE_ROWS),
        beside_table("below")
    );
    let above = 0..LINES_BESIDE_TABLE as i32;
    let first_below = LINES_BESIDE_TABLE as i32 + TALL_TABLE_ROWS as i32 + 4;
    let below = first_below..first_below + LINES_BESIDE_TABLE as i32;
    let pages = [
        Page {
            key: "<Control>f",
            typed: "",
            from: above.clone(),
            up: false,
        },
        Page {
            key: "<Control>d",
            typed: "",
            from: above.clone(),
            up: false,
        },
        Page {
            key: "<Control>d",
            typed: "2",
            from: above,
            up: false,
        },
        Page {
            key: "<Control>b",
            typed: "",
            from: below.clone(),
            up: true,
        },
        Page {
            key: "<Control>u",
            typed: "",
            from: below,
            up: true,
        },
    ];
    let scroller = note_scroller(view)?;
    let adjustment = scroller.vadjustment();
    for page in pages {
        show_note(h, editor, view, &note)?;
        let shown = view
            .shown_tables()
            .into_iter()
            .next()
            .ok_or("no table is shown")?;
        let page_size = adjustment.page_size();
        ensure(shown.widget.height() as f64 > page_size, || {
            format!("the table is not taller than the page of {page_size}")
        })?;
        let buffer = view.buffer();
        let lines: Vec<i32> = if page.up {
            page.from.collect()
        } else {
            page.from.rev().collect()
        };
        let count = page.typed.parse::<i32>().unwrap_or(1);
        let half = page.key.ends_with('d') || page.key.ends_with('u');
        let (caret, value, row) = lines
            .into_iter()
            .filter_map(|line| buffer.iter_at_line(line))
            .find_map(|mut caret| {
                caret.forward_chars(PAGE_COLUMN);
                let (cursor, _) = view.cursor_locations(Some(&caret));
                let edge = if page.up {
                    cursor.y() + cursor.height() + CARET_INSET - page_size as i32
                } else {
                    cursor.y() - CARET_INSET
                };
                let value = value_at(view, &scroller, edge).ok()?;
                let shift = if half {
                    (f64::from(count) * page_size / 2.0).round() as i32
                } else {
                    page_size as i32
                };
                let landing = match (half, page.up) {
                    (true, false) => cursor.y() + cursor.height() / 2 + shift,
                    (true, true) => cursor.y() + cursor.height() / 2 - shift,
                    (false, false) => edge + shift,
                    (false, true) => edge - 1,
                };
                landing_row(&shown, landing).map(|row| (caret.offset(), value, row))
            })
            .ok_or_else(|| format!("no line pages {} into a body row", page.key))?;
        place_caret(view, caret);
        adjustment.set_value(value);
        h.settle()?;
        ensure((adjustment.value() - value).abs() < 0.5, || {
            format!(
                "the page moved from {value} to {} before {}",
                adjustment.value(),
                page.key
            )
        })?;
        let pressed = format!("{}{}", page.typed, page.key);
        type_pending(h, editor, page.typed)?;
        press(h, view, page.key)?;
        let target = table_line_offset(view, row as i32 + 1)? + PAGE_COLUMN;
        wait_caret(
            h,
            view,
            &format!("{pressed} to put the caret on row {row} at the goal column"),
            target,
        )?;
        wait_revealed(h, view)?;
        wait_caret_shown(h, view, &scroller, &pressed)?;
        ensure(pending(editor).is_empty(), || {
            format!("{pressed} left {:?} pending", pending(editor))
        })?;
    }
    Ok(())
}

/// `<C-f>` in a note with no table scrolls one page and takes the caret to the line at its top.
fn plain_paging(h: &Harness, editor: &NoteEditor, view: &MarkdownView) -> Result<(), String> {
    let text = (1..=120)
        .map(|line| format!("Line {line} of a note without a table."))
        .collect::<Vec<_>>()
        .join("\n");
    set_note_text(editor, &text, PAGE_COLUMN, PAGE_COLUMN);
    h.wait("the editor to hold the note without a table", || {
        editor.text() == text
    })?;
    let scroller = note_scroller(view)?;
    let adjustment = scroller.vadjustment();
    adjustment.set_value(adjustment.lower());
    h.settle()?;
    let origin = value_at(view, &scroller, 0)?;
    let value = adjustment.lower() + adjustment.page_size();
    let (line, _) = view.line_at_y((value - origin).floor() as i32);
    press(h, view, "<Control>f")?;
    wait_caret(
        h,
        view,
        "<C-f> to take the caret to the line at the page top",
        line.offset(),
    )?;
    h.wait("<C-f> to scroll one page", || {
        (adjustment.value() - value).abs() <= 1.0
    })
    .map_err(|error| format!("{error}: the note is at {}", adjustment.value()))
}
