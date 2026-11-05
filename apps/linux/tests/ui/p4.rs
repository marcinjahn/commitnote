use std::cell::Cell;
use std::path::PathBuf;
use std::rc::Rc;

use adw::prelude::*;
use commitnote::editor::NoteEditor;
use commitnote::model::{DraftFocus, EditorTarget, ImageState};
use commitnote::pages::notes::{ImageViewer, NotesPage};
use commitnote_core_api::commands::{HistoryPhase, HistoryRow, HistoryVersionView};
use commitnote_editor_text::apply;
use commitnote_markdown::insert_image_references;
use gtk4::{self as gtk, gdk, gio, glib};
use libadwaita as adw;

use crate::flows::{ensure, launch_and_log_in, split_view};
use crate::p3::{action_enabled, click_labelled, focus_editor, has_node, open_note_at, path};
use crate::support::{
    ALL_VARIANTS, Case, Harness, NARROW_VARIANTS, Theme, WIDE_LIGHT, WIDE_VARIANTS, Width,
};

pub const CASES: &[Case] = &[
    ("p4-insert-file-dialog", insert_file_dialog),
    ("p4-insert-file", insert_file),
    ("p4-paste-texture", paste_texture),
    ("p4-paste-file-list", paste_file_list),
    ("p4-paste-references", paste_references),
    ("p4-drop-files", drop_files),
    ("p4-too-many-images", too_many_images),
    ("p4-not-an-image", not_an_image),
    ("p4-inline-states", inline_states),
    ("p4-image-viewer-keys", image_viewer_keys),
    ("p4-gif-animation", gif_animation),
    ("p4-shot-note-images", shot_note_images),
    ("p4-shot-image-viewer", shot_image_viewer),
    ("p4-history-open", history_open),
    ("p4-history-shared-mark", history_shared_mark),
    ("p4-history-unsaved", history_unsaved),
    ("p4-history-preview-restore", history_preview_restore),
    ("p4-history-restore-title", history_restore_title),
    ("p4-history-keys", history_keys),
    ("p4-shot-history", shot_history),
    ("p4-shot-version-preview", shot_version_preview),
];

const WELCOME: &[&str] = &["Welcome"];
const WHITEBOARD: &[&str] = &["Journal", "2026", "Whiteboard"];
const UNKNOWN_IMAGE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const IMAGE_LIMIT: usize = 10;

// Core copy, from src/ui/images/image-messages.ts.
const COUNT_LIMIT_NOTICE: &str = "You can add up to 10 images at a time.";
const NOT_AN_IMAGE_NOTICE: &str = "This file is not an image.";

struct Scratch(PathBuf);

impl Scratch {
    fn new(tag: &str) -> Result<Self, String> {
        let directory = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("commitnote-ui-images-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&directory)
            .map_err(|error| format!("cannot create a scratch directory: {error}"))?;
        Ok(Self(directory))
    }

    fn write(&self, name: &str, bytes: &[u8]) -> Result<gio::File, String> {
        let file = self.0.join(name);
        std::fs::write(&file, bytes).map_err(|error| format!("cannot write {name}: {error}"))?;
        Ok(gio::File::for_path(file))
    }

    fn pngs(&self, count: usize) -> Result<Vec<gio::File>, String> {
        (0..count)
            .map(|index| {
                self.write(
                    &format!("picture-{index}.png"),
                    &png_bytes(40 + index as i32, 30, index as u8 * 20),
                )
            })
            .collect()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn texture(width: i32, height: i32, tint: u8) -> gdk::MemoryTexture {
    let mut pixels = Vec::with_capacity(width as usize * height as usize * 4);
    for y in 0..height {
        for x in 0..width {
            pixels.extend_from_slice(&[
                (x * 255 / width) as u8,
                (y * 255 / height) as u8,
                tint,
                255,
            ]);
        }
    }
    gdk::MemoryTexture::new(
        width,
        height,
        gdk::MemoryFormat::R8g8b8a8,
        &glib::Bytes::from_owned(pixels),
        width as usize * 4,
    )
}

fn png_bytes(width: i32, height: i32, tint: u8) -> Vec<u8> {
    texture(width, height, tint).save_to_png_bytes().to_vec()
}

const GIF_PALETTE: [[u8; 3]; 4] = [[220, 40, 40], [40, 180, 60], [50, 80, 220], [240, 200, 40]];

fn animated_gif(width: u16, height: u16, frame_colors: &[u8]) -> Vec<u8> {
    const CLEAR: u32 = 4;
    const END: u32 = 5;
    const DELAY_CENTISECONDS: u8 = 5;

    let mut bytes = b"GIF89a".to_vec();
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
    bytes.extend_from_slice(&[0x81, 0, 0]);
    for color in GIF_PALETTE {
        bytes.extend_from_slice(&color);
    }
    for &color in frame_colors {
        bytes.extend_from_slice(&[0x21, 0xF9, 0x04, 0x00, DELAY_CENTISECONDS, 0, 0, 0]);
        bytes.push(0x2C);
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        bytes.extend_from_slice(&width.to_le_bytes());
        bytes.extend_from_slice(&height.to_le_bytes());
        bytes.push(0);
        bytes.push(2);

        let mut codes = Vec::new();
        let mut pending = usize::from(width) * usize::from(height);
        while pending > 0 {
            let run = pending.min(2);
            codes.push(CLEAR);
            codes.extend(std::iter::repeat_n(u32::from(color), run));
            pending -= run;
        }
        codes.push(END);
        let mut packed = Vec::new();
        let (mut buffer, mut bits) = (0_u32, 0);
        for code in codes {
            buffer |= code << bits;
            bits += 3;
            while bits >= 8 {
                packed.push(buffer as u8);
                buffer >>= 8;
                bits -= 8;
            }
        }
        if bits > 0 {
            packed.push(buffer as u8);
        }
        for block in packed.chunks(255) {
            bytes.push(block.len() as u8);
            bytes.extend_from_slice(block);
        }
        bytes.push(0);
    }
    bytes.push(0x3B);
    bytes
}

fn references(text: &str) -> Vec<String> {
    text.match_indices("](image:")
        .filter_map(|(at, _)| {
            let start = text[..at].rfind("![")?;
            let end = at + text[at..].find(')')? + 1;
            Some(text[start..end].to_owned())
        })
        .collect()
}

fn image_ids(text: &str) -> Vec<String> {
    text.match_indices("](image:")
        .map(|(at, marker)| {
            text[at + marker.len()..]
                .chars()
                .take_while(char::is_ascii_alphanumeric)
                .collect()
        })
        .collect()
}

fn image_states(editor: &NoteEditor) -> Vec<(String, &'static str, usize)> {
    editor.view().testing_images()
}

fn wait_images_ready(h: &Harness, editor: &NoteEditor, count: usize) -> Result<(), String> {
    h.wait(&format!("{count} image(s) to be ready"), || {
        let states = image_states(editor);
        states.len() == count && states.iter().all(|(_, state, _)| *state == "ready")
    })
}

fn open_editor(h: &Harness, target: &[&str]) -> Result<NoteEditor, String> {
    open_note_at(h, target)?;
    let editor = h.widget_as::<NoteEditor>("note-editor")?;
    h.wait("the note text in the editor", || !editor.text().is_empty())?;
    Ok(editor)
}

fn open_welcome(h: &Harness) -> Result<(NoteEditor, String), String> {
    launch_and_log_in(h, false)?;
    let editor = open_editor(h, WELCOME)?;
    focus_editor(h, &editor)?;
    let original = editor.text();
    Ok((editor, original))
}

fn notes_page(editor: &NoteEditor) -> Result<NotesPage, String> {
    editor
        .ancestor(NotesPage::static_type())
        .and_downcast::<NotesPage>()
        .ok_or_else(|| "the editor is not on the notes page".to_owned())
}

fn pick_and_insert(editor: &NoteEditor, files: Vec<gio::File>) -> Result<(), String> {
    notes_page(editor)?.testing_set_next_picked_files(files);
    WidgetExt::activate_action(editor, "editor.insert-image", None)
        .map_err(|error| format!("cannot activate editor.insert-image: {error}"))
}

fn paste(h: &Harness, editor: &NoteEditor) -> Result<(), String> {
    focus_editor(h, editor)?;
    h.press_keys("<Control>v")
}

fn other_toplevels(h: &Harness) -> Result<Vec<gtk::Window>, String> {
    let main = h.window()?;
    Ok(gtk::Window::list_toplevels()
        .into_iter()
        .filter_map(|widget| widget.downcast::<gtk::Window>().ok())
        .filter(|window| window.upcast_ref::<gtk::Window>() != main.upcast_ref::<gtk::Window>())
        .collect())
}

fn insert_file_dialog(h: &mut Harness) -> Result<(), String> {
    let (editor, original) = open_welcome(h)?;
    let before = other_toplevels(h)?.len();

    WidgetExt::activate_action(&editor, "editor.insert-image", None)
        .map_err(|error| format!("cannot activate editor.insert-image: {error}"))?;
    let mut dialog = None;
    h.wait("the file dialog to open", || {
        dialog = other_toplevels(h)
            .ok()
            .filter(|windows| windows.len() > before)
            .and_then(|windows| windows.into_iter().find(|window| window.is_visible()));
        dialog.is_some()
    })?;
    let dialog = dialog.ok_or("no file dialog opened")?;

    h.press_keys_in(&dialog, "Escape")?;
    h.wait("the file dialog to close", || {
        other_toplevels(h).is_ok_and(|windows| windows.len() == before)
    })?;
    ensure(editor.text() == original, || {
        "cancelling the dialog changed the note".to_owned()
    })
}

fn insert_file(h: &mut Harness) -> Result<(), String> {
    let (editor, original) = open_welcome(h)?;
    h.resize(Width::Narrow)?;
    split_view(h)?.set_show_content(true);
    h.wait_shown("format-image-button")?;
    let scratch = Scratch::new("insert-file")?;
    let files = vec![
        scratch.write("first.png", &png_bytes(48, 32, 0))?,
        scratch.write("second.png", &png_bytes(64, 40, 128))?,
    ];
    editor.place_caret(0);
    notes_page(&editor)?.testing_set_next_picked_files(files);

    h.click("format-image-button")?;
    h.wait("two references in the note", || {
        references(&editor.text()).len() == 2
    })?;
    let found = references(&editor.text());
    ensure(
        found[0].ends_with("#48x32)") && found[1].ends_with("#64x40)"),
        || "the references are not in the order of the files".to_owned(),
    )?;
    wait_images_ready(h, &editor, 2)?;

    focus_editor(h, &editor)?;
    h.press_keys("<Control>z")?;
    h.wait("one undo to remove both references", || {
        editor.text() == original
    })
}

fn paste_texture(h: &mut Harness) -> Result<(), String> {
    let (editor, _) = open_welcome(h)?;
    editor.place_caret(0);
    editor.view().clipboard().set_texture(&texture(60, 40, 90));

    paste(h, &editor)?;
    h.wait("the pasted image's reference", || {
        references(&editor.text()).len() == 1
    })?;
    ensure(editor.text().starts_with("![](image:"), || {
        "the reference was not inserted at the caret".to_owned()
    })?;
    wait_images_ready(h, &editor, 1)
}

fn paste_file_list(h: &mut Harness) -> Result<(), String> {
    let (editor, _) = open_welcome(h)?;
    let scratch = Scratch::new("paste-file-list")?;
    let files = [
        scratch.write("still.png", &png_bytes(40, 30, 10))?,
        scratch.write("moving.gif", &animated_gif(24, 16, &[0, 1, 2]))?,
    ];
    editor.place_caret(0);
    editor
        .view()
        .clipboard()
        .set(&gdk::FileList::from_array(&files));

    paste(h, &editor)?;
    h.wait("two references in the note", || {
        references(&editor.text()).len() == 2
    })?;
    wait_images_ready(h, &editor, 2)?;
    let ids = image_ids(&editor.text());
    let model = h.model()?;
    let ImageState::Ready(still) = model.image(&ids[0]) else {
        return Err("the PNG is not ready".to_owned());
    };
    let ImageState::Ready(moving) = model.image(&ids[1]) else {
        return Err("the GIF is not ready".to_owned());
    };
    ensure(still.frames.len() == 1 && moving.frames.len() > 1, || {
        "the GIF lost its frames or the PNG gained some".to_owned()
    })
}

fn paste_references(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let whiteboard = open_editor(h, WHITEBOARD)?;
    let reference = references(&whiteboard.text())
        .into_iter()
        .next()
        .ok_or("the Whiteboard note holds no image")?;
    let original_id = image_ids(&reference)
        .into_iter()
        .next()
        .ok_or("the reference has no id")?;

    let editor = open_editor(h, WELCOME)?;
    focus_editor(h, &editor)?;
    editor.place_caret(0);
    editor
        .view()
        .clipboard()
        .set_text(&format!("{reference}\n"));

    paste(h, &editor)?;
    h.wait("the pasted reference", || {
        references(&editor.text()).len() == 1
    })?;
    let pasted = image_ids(&editor.text());
    ensure(pasted[0] != original_id, || {
        "the pasted reference still points at the copied note's image".to_owned()
    })?;
    wait_images_ready(h, &editor, 1)
}

fn drop_files(h: &mut Harness) -> Result<(), String> {
    let (editor, original) = open_welcome(h)?;
    let scratch = Scratch::new("drop-files")?;
    let value = gdk::FileList::from_array(&scratch.pngs(1)?).to_value();
    let view = editor.view();
    let buffer = view.buffer();
    let second_line = buffer
        .iter_at_line(1)
        .ok_or("the note has no second line")?;
    let line = view.iter_location(&second_line);
    let (x, y) = view.buffer_to_window_coords(
        gtk::TextWindowType::Widget,
        line.x(),
        line.y() + line.height() / 2,
    );

    ensure(
        editor.testing_drop(&value, f64::from(x), f64::from(y)),
        || "the drop was refused".to_owned(),
    )?;
    h.wait("the dropped reference", || {
        references(&editor.text()).len() == 1
    })?;
    let result = insert_image_references(
        &original,
        second_line.offset() as usize,
        &references(&editor.text()),
    );
    ensure(editor.text() == apply(&result.edits, &original), || {
        "the reference is not where the insertion rule puts it".to_owned()
    })?;
    wait_images_ready(h, &editor, 1)
}

fn too_many_images(h: &mut Harness) -> Result<(), String> {
    let (editor, original) = open_welcome(h)?;
    let scratch = Scratch::new("too-many")?;

    pick_and_insert(&editor, scratch.pngs(IMAGE_LIMIT + 1)?)?;
    h.wait("the count notice", || {
        h.label_shown_with(COUNT_LIMIT_NOTICE)
    })?;
    ensure(
        editor.text() == original && image_states(&editor).is_empty(),
        || "images were inserted past the limit".to_owned(),
    )
}

fn not_an_image(h: &mut Harness) -> Result<(), String> {
    let (editor, original) = open_welcome(h)?;
    let scratch = Scratch::new("not-an-image")?;

    pick_and_insert(
        &editor,
        vec![scratch.write("notes.txt", b"just some words")?],
    )?;
    h.wait("the rejection notice", || {
        h.label_shown_with(NOT_AN_IMAGE_NOTICE)
    })?;
    ensure(
        editor.text() == original && image_states(&editor).is_empty(),
        || "a text file was inserted as an image".to_owned(),
    )
}

fn inline_states(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let editor = open_editor(h, WHITEBOARD)?;
    wait_images_ready(h, &editor, 1)?;

    let text = format!("# Welcome\n\n![](image:{UNKNOWN_IMAGE})\n");
    h.run(
        "saving a note with an unknown image",
        h.model()?.testing_send(
            "fake.saveNote",
            serde_json::json!({ "path": path(WELCOME), "text": text }),
        ),
    )?
    .map_err(|error| error.message)?;
    open_editor(h, WELCOME)?;
    h.wait("the unknown image to be unavailable", || {
        image_states(&editor)
            .iter()
            .map(|(id, state, _)| (id.as_str(), *state))
            .eq([(UNKNOWN_IMAGE, "unavailable")])
    })
}

fn open_viewer(h: &Harness, editor: &NoteEditor) -> Result<ImageViewer, String> {
    editor.view().testing_activate_image(0);
    h.wait_shown("image-viewer")?;
    let viewer = h.widget_as::<ImageViewer>("image-viewer")?;
    h.wait("the image to show in the viewer", || {
        h.widget_as::<gtk::Button>("image-zoom-in")
            .is_ok_and(|button| button.is_sensitive())
            && viewer.focus().is_some()
    })?;
    Ok(viewer)
}

fn wait_zoom(h: &Harness, viewer: &ImageViewer, zoom: f64) -> Result<(), String> {
    h.wait(&format!("the zoom to be {zoom}"), || {
        (viewer.testing_zoom() - zoom).abs() < 1e-9
    })
}

fn image_viewer_keys(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let editor = open_editor(h, WHITEBOARD)?;
    wait_images_ready(h, &editor, 1)?;
    let viewer = open_viewer(h, &editor)?;
    wait_zoom(h, &viewer, 1.0)?;

    h.press_keys("<Control>plus")?;
    wait_zoom(h, &viewer, 1.25)?;
    h.press_keys("<Control>0")?;
    wait_zoom(h, &viewer, 1.0)?;
    h.click("image-zoom-in")?;
    h.click("image-zoom-in")?;
    wait_zoom(h, &viewer, 1.5625)?;

    h.press_keys("Escape")?;
    h.wait("the viewer to close", || !h.shown("image-viewer"))
}

fn run_animation(h: &Harness, editor: &NoteEditor) -> Result<(), String> {
    let settings = gtk::Settings::default().ok_or("there are no GTK settings")?;
    settings.set_gtk_enable_animations(true);
    h.wait("the GIF to advance", || image_states(editor)[0].2 > 0)?;

    settings.set_gtk_enable_animations(false);
    h.wait("the GIF to return to its first frame", || {
        image_states(editor)[0].2 == 0
    })?;
    let window = h.window()?;
    let ticks = Rc::new(Cell::new(0_u32));
    let moved = Rc::new(Cell::new(false));
    let callback = window.add_tick_callback({
        let ticks = ticks.clone();
        let moved = moved.clone();
        let view = editor.view();
        move |_, _| {
            ticks.set(ticks.get() + 1);
            if view.testing_images()[0].2 != 0 {
                moved.set(true);
            }
            glib::ControlFlow::Continue
        }
    });
    let waited = h.wait("a few frames to pass", || ticks.get() >= 10);
    callback.remove();
    waited?;
    ensure(!moved.get() && !editor.view().testing_animating(), || {
        "the GIF kept animating with animations off".to_owned()
    })
}

fn gif_animation(h: &mut Harness) -> Result<(), String> {
    let (editor, _) = open_welcome(h)?;
    let scratch = Scratch::new("gif")?;
    editor.place_caret(0);
    pick_and_insert(
        &editor,
        vec![scratch.write("moving.gif", &animated_gif(24, 16, &[0, 1, 2, 3]))?],
    )?;
    wait_images_ready(h, &editor, 1)?;

    let result = run_animation(h, &editor);
    if let Some(settings) = gtk::Settings::default() {
        settings.set_gtk_enable_animations(false);
    }
    result
}

fn shot_note_images(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let editor = open_editor(h, WHITEBOARD)?;
    wait_images_ready(h, &editor, 1)?;
    let scratch = Scratch::new("shot")?;
    let file = scratch.write("gradient.png", &png_bytes(480, 270, 140))?;
    editor.place_caret(i32::MAX);
    pick_and_insert(&editor, vec![file])?;
    wait_images_ready(h, &editor, 2)?;

    h.session_screenshots("note-images", WIDE_VARIANTS)?;
    h.resize(Width::Narrow)?;
    split_view(h)?.set_show_content(true);
    h.session_screenshots("note-images", NARROW_VARIANTS)?;
    wait_images_ready(h, &editor, 2)
}

fn shot_image_viewer(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let editor = open_editor(h, WHITEBOARD)?;
    wait_images_ready(h, &editor, 1)?;
    h.show_variant(Width::Wide, Theme::Light)?;
    let viewer = open_viewer(h, &editor)?;
    h.click("image-zoom-in")?;
    wait_zoom(h, &viewer, 1.25)?;
    for &(width, theme) in WIDE_LIGHT {
        h.capture_variant("image-viewer", width, theme)?;
    }
    Ok(())
}

const HISTORY_DIALOG: &str = "history-dialog";
const VERSION_PREVIEW: &str = "version-preview";
const SHOW_HISTORY: &str = "notes.show-history";
const FIRST_TEXT: &str =
    "# Welcome\n\nThis is your notes repo.\n\n- First bullet\n- Second bullet\n";
const SECOND_TEXT: &str =
    "# Welcome\n\nThis is your notes repo.\n\n- First bullet\n- Third bullet\n";

fn save_version(h: &Harness, target: &[String], text: &str) -> Result<(), String> {
    h.run(
        "saving a version",
        h.model()?.testing_send(
            "fake.saveNote",
            serde_json::json!({ "path": target, "text": text }),
        ),
    )?
    .map_err(|error| error.message)
    .map(|_| ())
}

fn share_note(h: &Harness, target: &[String]) -> Result<(), String> {
    let outcome = h
        .run(
            "sharing the note",
            h.model()?.testing_send(
                "share.create",
                serde_json::json!({
                    "path": target,
                    "password": "correct horse battery staple",
                    "label": "History",
                }),
            ),
        )?
        .map_err(|error| error.message)?;
    ensure(outcome["outcome"]["kind"] == "created", || {
        "the note was not shared".to_owned()
    })
}

fn welcome_with_versions(h: &Harness, texts: &[&str]) -> Result<NoteEditor, String> {
    launch_and_log_in(h, false)?;
    let target = path(WELCOME);
    for text in texts {
        save_version(h, &target, text)?;
    }
    open_editor(h, WELCOME)
}

fn open_history(h: &Harness) -> Result<(), String> {
    let tree = h.widget("notes-tree")?;
    h.wait("History to be available", || {
        action_enabled(h, SHOW_HISTORY).unwrap_or(false)
    })?;
    WidgetExt::activate_action(&tree, SHOW_HISTORY, None)
        .map_err(|error| format!("cannot activate {SHOW_HISTORY}: {error}"))?;
    h.wait_shown(HISTORY_DIALOG)
}

fn listed_versions(h: &Harness) -> Vec<HistoryVersionView> {
    let Some(view) = h.model().ok().and_then(|model| model.history()) else {
        return Vec::new();
    };
    view.sections
        .into_iter()
        .flat_map(|section| section.rows)
        .flat_map(|row| match row {
            HistoryRow::Single { version } => vec![version],
            HistoryRow::Session { versions, .. } => versions,
        })
        .collect()
}

fn wait_history_ready(h: &Harness, count: usize) -> Result<Vec<HistoryVersionView>, String> {
    h.wait("the history to be ready", || {
        h.model()
            .ok()
            .and_then(|model| model.history())
            .is_some_and(|view| {
                view.phase == HistoryPhase::Ready && !view.loading && view.error.is_none()
            })
    })?;
    let versions = listed_versions(h);
    ensure(versions.len() == count, || {
        format!("the history lists {} versions, not {count}", versions.len())
    })?;
    h.wait("the version rows", || {
        h.widget(&version_row(count - 1)).is_ok()
    })?;
    Ok(versions)
}

fn version_row(index: usize) -> String {
    format!("history-version-{index}")
}

fn widgets_under(root: &gtk::Widget) -> Vec<gtk::Widget> {
    let mut found = Vec::new();
    let mut child = root.first_child();
    while let Some(widget) = child {
        child = widget.next_sibling();
        found.extend(widgets_under(&widget));
        found.push(widget);
    }
    found
}

fn row_marks(h: &Harness, index: usize) -> Result<Vec<String>, String> {
    let row = h.widget(&version_row(index))?;
    Ok(widgets_under(&row)
        .into_iter()
        .filter(|widget| widget.has_css_class("history-mark"))
        .flat_map(|mark| widgets_under(&mark))
        .filter_map(|widget| widget.downcast::<gtk::Label>().ok())
        .map(|label| label.label().to_string())
        .collect())
}

fn open_version(h: &Harness, index: usize) -> Result<(), String> {
    h.activate_row(&version_row(index))?;
    h.wait_shown(VERSION_PREVIEW)?;
    h.wait("the preview to load", || {
        h.widget_as::<gtk::Button>("version-restore")
            .is_ok_and(|button| button.is_sensitive() && button.is_mapped())
    })
}

fn diff_lines(h: &Harness, class: &str) -> Result<usize, String> {
    let page = h.widget(VERSION_PREVIEW)?;
    Ok(widgets_under(&page)
        .into_iter()
        .filter(|widget| widget.has_css_class(class))
        .count())
}

fn wait_dialog_focus(h: &Harness) -> Result<(), String> {
    h.wait("the focus to be in the history dialog", || {
        let dialog = h.widget(HISTORY_DIALOG).ok();
        let focus = h
            .window()
            .ok()
            .and_then(|window| GtkWindowExt::focus(&window));
        dialog
            .zip(focus)
            .is_some_and(|(dialog, focus)| focus == dialog || focus.is_ancestor(&dialog))
    })
}

fn history_open(h: &mut Harness) -> Result<(), String> {
    welcome_with_versions(h, &[FIRST_TEXT, SECOND_TEXT])?;
    open_history(h)?;

    let versions = wait_history_ready(h, 3)?;
    ensure(
        versions[0].current && versions[1..].iter().all(|version| !version.current),
        || "only the newest version should be current".to_owned(),
    )?;
    ensure(row_marks(h, 0)? == ["Current"], || {
        "the newest row is not marked current".to_owned()
    })?;
    ensure(
        (1..3).all(|index| row_marks(h, index).is_ok_and(|marks| marks.is_empty())),
        || "an older row carries a mark".to_owned(),
    )
}

fn history_shared_mark(h: &mut Harness) -> Result<(), String> {
    welcome_with_versions(h, &[FIRST_TEXT, SECOND_TEXT])?;
    share_note(h, &path(WELCOME))?;
    open_history(h)?;

    let versions = wait_history_ready(h, 3)?;
    ensure(versions[0].shared && !versions[1].shared, || {
        "the core does not mark the newest version alone as shared".to_owned()
    })?;
    ensure(row_marks(h, 0)?.contains(&"Shared".to_owned()), || {
        "the newest row is not marked shared".to_owned()
    })?;
    ensure(!row_marks(h, 1)?.contains(&"Shared".to_owned()), || {
        "an unshared row is marked shared".to_owned()
    })
}

fn history_unsaved(h: &mut Harness) -> Result<(), String> {
    welcome_with_versions(h, &[FIRST_TEXT])?;
    h.wait("History to be available for the saved note", || {
        action_enabled(h, SHOW_HISTORY).unwrap_or(false)
    })?;

    let model = h.model()?;
    h.run("the draft", async move {
        model.start_draft(Vec::new(), DraftFocus::Name).await
    })?
    .map_err(|error| error.message)?;
    h.wait("History to be unavailable for the draft", || {
        h.model()
            .is_ok_and(|model| !matches!(model.editor_target(), EditorTarget::Note(_)))
            && action_enabled(h, SHOW_HISTORY).is_ok_and(|enabled| !enabled)
    })?;
    ensure(
        h.model()?.history().is_none() && !h.shown(HISTORY_DIALOG),
        || "a history opened for a draft".to_owned(),
    )
}

fn history_preview_restore(h: &mut Harness) -> Result<(), String> {
    let editor = welcome_with_versions(h, &[FIRST_TEXT, SECOND_TEXT])?;
    h.wait("the newest text in the editor", || {
        editor.text() == SECOND_TEXT
    })?;
    open_history(h)?;
    wait_history_ready(h, 3)?;
    open_version(h, 1)?;

    ensure(
        diff_lines(h, "diff-added")? >= 1 && diff_lines(h, "diff-removed")? >= 1,
        || "the preview shows no added and removed lines".to_owned(),
    )?;
    h.click("version-restore")?;
    h.wait("the dialog to close", || !h.shown(HISTORY_DIALOG))?;
    h.wait("the older text in the editor", || {
        editor.text() == FIRST_TEXT
    })?;

    click_labelled(h, "Undo")?;
    h.wait("the newer text back in the editor", || {
        editor.text() == SECOND_TEXT
    })
}

fn history_restore_title(h: &mut Harness) -> Result<(), String> {
    welcome_with_versions(h, &[FIRST_TEXT])?;
    let model = h.model()?;
    let renamed = h
        .run("renaming the note", {
            let model = model.clone();
            async move {
                model
                    .rename_node(path(WELCOME), "Greeting".to_owned())
                    .await
            }
        })?
        .map_err(|error| error.message)?;
    save_version(h, &renamed, SECOND_TEXT)?;
    h.wait("the renamed note in the editor", || {
        model.editor_target() == EditorTarget::Note(renamed.clone())
            && h.text("note-title-entry")
                .is_ok_and(|title| title == "Greeting")
    })?;
    open_history(h)?;
    let versions = wait_history_ready(h, 3)?;
    let older = versions
        .iter()
        .position(|version| version.name.as_deref() == Some("Welcome"))
        .ok_or("no version from before the rename")?;
    open_version(h, older)?;

    h.wait_shown("version-restore-title")?;
    h.set_switch("version-restore-title", true)?;
    h.wait("the preview to reload", || {
        h.widget_as::<gtk::Button>("version-restore")
            .is_ok_and(|button| button.is_sensitive())
    })?;
    h.click("version-restore")?;

    h.wait("the dialog to close", || !h.shown(HISTORY_DIALOG))?;
    h.wait("the note under its old name", || {
        model.editor_target() == EditorTarget::Note(path(WELCOME))
            && has_node(h, &path(WELCOME))
            && !has_node(h, &renamed)
            && h.text("note-title-entry")
                .is_ok_and(|title| title == "Welcome")
    })
}

fn history_keys(h: &mut Harness) -> Result<(), String> {
    welcome_with_versions(h, &[FIRST_TEXT])?;
    open_history(h)?;
    wait_history_ready(h, 2)?;
    wait_dialog_focus(h)?;
    open_version(h, 1)?;
    wait_dialog_focus(h)?;

    h.press_keys("Escape")?;
    h.wait("the preview to close", || !h.shown(VERSION_PREVIEW))?;
    ensure(h.shown(HISTORY_DIALOG) && h.shown(&version_row(1)), || {
        "the first Escape closed the dialog".to_owned()
    })?;
    wait_dialog_focus(h)?;

    h.press_keys("Escape")?;
    h.wait("the dialog to close", || !h.shown(HISTORY_DIALOG))?;
    let model = h.model()?;
    h.wait("the history to be closed", || model.history().is_none())
}

fn shot_history(h: &mut Harness) -> Result<(), String> {
    welcome_with_versions(h, &[FIRST_TEXT, SECOND_TEXT])?;
    share_note(h, &path(WELCOME))?;
    open_history(h)?;
    wait_history_ready(h, 3)?;

    h.session_screenshots("history", ALL_VARIANTS)
}

fn shot_version_preview(h: &mut Harness) -> Result<(), String> {
    welcome_with_versions(h, &[FIRST_TEXT, SECOND_TEXT])?;
    open_history(h)?;
    wait_history_ready(h, 3)?;
    h.show_variant(Width::Wide, Theme::Light)?;
    open_version(h, 2)?;

    ensure(
        diff_lines(h, "diff-added")? >= 1 && diff_lines(h, "diff-removed")? >= 1,
        || "the preview shows no added and removed lines".to_owned(),
    )?;
    for &(width, theme) in WIDE_LIGHT {
        h.capture_variant("version-preview", width, theme)?;
    }
    Ok(())
}
