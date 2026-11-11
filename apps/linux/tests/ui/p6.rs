use std::path::Path;

use adw::prelude::*;
use commitnote::a11y::testing_take_announcements;
use commitnote::config;
use commitnote::editor::OverlayKind;
use commitnote::launch::action_from_arguments;
use commitnote::links;
use commitnote::model::Route;
use commitnote::pages::notes::ImageViewer;
use commitnote::pages::unlock::StrengthMeter;
use commitnote_core_api::shapes::{ColorTag, TagOptionView};
use gtk4::{self as gtk, gdk, gio, glib};
use libadwaita as adw;

use crate::flows::{
    NOTES_URL, choose_repository, ensure, launch_and_log_in, log_in, open_first_note, split_view,
    submit_token, wait_tree,
};
use crate::p1::HELD_LOADING_MESSAGE;
use crate::p2::{
    FAILED_ICON, OFFLINE_ICON, SYNCED_ICON, fail_commits, finish_loading, focus_within,
    reopen_held, save_now, set_note_text, show_saved, sync_text, title_entry, type_at_end,
    wait_draft, wait_sync_icon,
};
use crate::p3::{
    TRASH_DIALOG, click_labelled, close_menu, focus_tree, has_node, is_shared,
    launch_search_repository, open_menu, open_note_at, path, row_expander, search_entry_focused,
    search_with, string_attribute, trash_entry, trash_node_action, wait_search_shot_ready,
};
use crate::p4::{
    FIRST_TEXT, HISTORY_DIALOG, SECOND_TEXT, SHARE_LABEL, SHARE_PASSWORD, SHARED_LINKS_DIALOG,
    WELCOME as WELCOME_NOTE, WHITEBOARD as WHITEBOARD_NOTE, activate_page_action, open_editor,
    open_history, open_shared_links, open_viewer, run_animation, share_note_with,
    wait_history_ready, wait_images_ready, wait_shares, welcome_with_versions,
    whiteboard_with_inserted_image, with_animated_gif,
};
use crate::p5::{
    capture_preferences, choose_existing, close_preferences, import_zip_dialog, launch_notes,
    menu_actions, select_target,
};
use crate::support::{
    ALL_VARIANTS, Case, Harness, NARROW_VARIANTS, WIDE_VARIANTS, Width, assert_checked,
    assert_named, assert_presentation, descendants, restoring,
};

pub const CASES: &[Case] = &[
    ("p6-launch-desktop-new-note", launch_desktop_new_note),
    ("p6-launch-desktop-search", launch_desktop_search),
    ("p6-launch-scheme", launch_scheme),
    ("p6-launch-app-actions", launch_app_actions),
    ("p6-launch-before-login", launch_before_login),
    ("p6-launch-while-starting", launch_while_starting),
    ("p6-launch-while-loading", launch_while_loading),
    ("p6-launch-second-instance", launch_second_instance),
    ("p6-shortcuts-dialog-opens", shortcuts_dialog_opens),
    ("p6-shortcuts-dialog-menu", shortcuts_dialog_menu),
    ("p6-shortcuts-dialog-matches", shortcuts_dialog_matches),
    ("p6-about-dialog", about_dialog),
    ("p6-about-menu", about_menu),
    ("p6-a11y-names-notes", a11y_names_notes),
    ("p6-a11y-names-dialogs", a11y_names_dialogs),
    ("p6-a11y-presentation", a11y_presentation),
    ("p6-a11y-spinners", a11y_spinners),
    ("p6-announce-sync", announce_sync),
    ("p6-announce-search", announce_search),
    ("p6-announce-loading", announce_loading),
    ("p6-announce-strength", announce_strength),
    ("p6-announce-no-toast-repeat", announce_no_toast_repeat),
    ("p6-comfort-text-scaling", comfort_text_scaling),
    ("p6-comfort-high-contrast", comfort_high_contrast),
    ("p6-comfort-reduced-motion", comfort_reduced_motion),
    ("p6-touch-open-link", touch_open_link),
    ("p6-touch-editor-long-press", touch_editor_long_press),
    ("p6-touch-tree-long-press", touch_tree_long_press),
    ("p6-touch-swipe-back", touch_swipe_back),
    ("p6-shots-pre-session", shots_pre_session),
    ("p6-shots-notes", shots_notes),
    ("p6-shots-dialogs", shots_dialogs),
    ("p6-shots-app", shots_app),
];

type Announcement = (String, gtk::AccessibleAnnouncementPriority);

const DESKTOP_FILE: &str = "data/io.github.marcinjahn.commitnote.desktop.in";
const EARLY_NAME_ENTRY: &str = "early-draft-name-entry";
const SEARCH_BAR: &str = "search-bar";

fn desktop_entry() -> Result<glib::KeyFile, String> {
    let file = glib::KeyFile::new();
    file.load_from_file(
        Path::new(env!("CARGO_MANIFEST_DIR")).join(DESKTOP_FILE),
        glib::KeyFileFlags::NONE,
    )
    .map_err(|error| format!("cannot read the desktop file: {error}"))?;
    Ok(file)
}

fn exec_arguments(group: &str) -> Result<Vec<String>, String> {
    let exec = desktop_entry()?
        .string(group, "Exec")
        .map_err(|error| format!("{group} has no Exec line: {error}"))?;
    let argv = glib::shell_parse_argv(exec.as_str())
        .map_err(|error| format!("cannot split the Exec line of {group}: {error}"))?;
    Ok(argv
        .iter()
        .skip(1)
        .map(|argument| argument.to_string_lossy().into_owned())
        .collect())
}

fn launch_with(h: &Harness, arguments: &[&str]) -> Result<(), String> {
    h.window()?.launch(action_from_arguments(arguments));
    Ok(())
}

fn core_round_trip(h: &Harness) -> Result<(), String> {
    h.run(
        "the core to answer",
        h.model()?
            .testing_send("forges.list", serde_json::json!({})),
    )?
    .map(|_| ())
    .map_err(|error| error.message)
}

fn search_active(h: &Harness) -> bool {
    h.shown("search-entry") && search_entry_focused(h)
}

fn wait_new_draft(h: &Harness) -> Result<(), String> {
    wait_draft(h)?;
    let entry = title_entry(h)?;
    h.wait("the new draft's name to take focus", || {
        focus_within(h, &entry)
    })
}

fn wait_search(h: &Harness) -> Result<(), String> {
    h.wait("the search entry to show with focus", || search_active(h))
}

fn ensure_no_launch_effect(h: &Harness) -> Result<(), String> {
    core_round_trip(h)?;
    h.settle()?;
    ensure(!h.model()?.editor_target().is_draft(), || {
        "a draft was started".to_owned()
    })?;
    ensure(!h.shown("search-entry"), || "the search opened".to_owned())
}

fn launch_desktop_new_note(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let arguments = exec_arguments("Desktop Action new-note")?;
    launch_with(h, &arguments.iter().map(String::as_str).collect::<Vec<_>>())?;
    wait_new_draft(h)
}

fn launch_desktop_search(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let arguments = exec_arguments("Desktop Action search")?;
    launch_with(h, &arguments.iter().map(String::as_str).collect::<Vec<_>>())?;
    wait_search(h)
}

fn launch_scheme(h: &mut Harness) -> Result<(), String> {
    let exec = desktop_entry()?
        .string("Desktop Entry", "Exec")
        .map_err(|error| format!("the desktop entry has no Exec line: {error}"))?;
    ensure(exec.split_whitespace().any(|part| part == "%U"), || {
        "the main Exec line does not take URLs".to_owned()
    })?;

    launch_and_log_in(h, false)?;
    launch_with(h, &["commitnote://bogus"])?;
    ensure_no_launch_effect(h)?;

    launch_with(h, &["commitnote://search"])?;
    wait_search(h)?;
    h.widget_as::<gtk::SearchBar>(SEARCH_BAR)?
        .set_search_mode(false);
    h.wait("the search to close", || !h.shown("search-entry"))?;

    launch_with(h, &["commitnote://new-note"])?;
    wait_new_draft(h)
}

fn launch_app_actions(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    h.application().activate_action("new-note", None);
    wait_new_draft(h)?;

    h.application().activate_action("search", None);
    wait_search(h)
}

fn launch_before_login(h: &mut Harness) -> Result<(), String> {
    h.launch()?;
    h.wait_page("token")?;
    launch_with(h, &["--action", "search"])?;
    ensure_no_launch_effect(h)?;

    log_in(h, false)?;
    wait_tree(h)?;
    wait_search(h)?;
    ensure(!h.model()?.editor_target().is_draft(), || {
        "a draft was started".to_owned()
    })
}

fn launch_while_starting(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, true)?;
    h.close();

    unsafe { std::env::set_var("COMMITNOTE_TESTING_HOLD_LOADING", "1") };
    let held = h.launch().and_then(|()| {
        launch_with(h, &["--action=new-note"])?;
        h.wait_route("the held loading route", |route| {
            *route == Route::Loading { failure: None }
        })
        .map(|_| ())
    });
    unsafe { std::env::remove_var("COMMITNOTE_TESTING_HOLD_LOADING") };
    held?;
    h.wait_page("loading")?;
    let entry = h.widget_as::<gtk::Entry>(EARLY_NAME_ENTRY)?;
    h.wait("the early draft's name to take focus", || {
        focus_within(h, &entry)
    })?;
    finish_loading(h)
}

fn launch_while_loading(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, true)?;
    reopen_held(h)?;
    let entry = h.widget_as::<gtk::Entry>(EARLY_NAME_ENTRY)?;
    GtkWindowExt::set_focus(&h.window()?, None::<&gtk::Widget>);
    ensure(!focus_within(h, &entry), || {
        "the early draft's name had focus before the launch".to_owned()
    })?;

    launch_with(h, &["--action", "new-note"])?;
    h.wait("the early draft's name to take focus", || {
        focus_within(h, &entry)
    })?;
    finish_loading(h)
}

fn launch_second_instance(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let window = h.window()?;
    ensure(h.application().windows().len() == 1, || {
        "the application starts with another window count".to_owned()
    })?;

    launch_with(h, &["--action", "search"])?;
    wait_search(h)?;
    ensure(h.application().windows().len() == 1, || {
        "launching again opened another window".to_owned()
    })?;
    ensure(h.window()? == window, || {
        "launching again replaced the window".to_owned()
    })?;

    h.widget_as::<gtk::SearchBar>(SEARCH_BAR)?
        .set_search_mode(false);
    h.wait("the search to close", || !h.shown("search-entry"))?;
    h.wait("the Preferences action", || {
        window
            .lookup_action("preferences")
            .is_some_and(|action| action.is_enabled())
    })?;
    h.window_action("preferences")?;
    h.wait("Preferences to show", || window.visible_dialog().is_some())?;

    launch_with(h, &["--action", "new-note"])?;
    ensure_no_launch_effect(h)
}

const SHORTCUTS_RESOURCE: &str = "/io/github/marcinjahn/commitnote/shortcuts-dialog.ui";
const SHORTCUT_SECTIONS: [&str; 4] = [
    "general_section",
    "notes_section",
    "editor_section",
    "image_viewer_section",
];
const WELCOME: &[&str] = &["Welcome"];

#[derive(Clone, Copy)]
enum Binding {
    Application(&'static str),
    Page(&'static str),
    Editor(&'static str),
    Viewer(&'static str),
    Tree,
}

type ShortcutRow = (&'static str, &'static [&'static str], Binding);

const EXPECTED_SHORTCUTS: [(&str, &[ShortcutRow]); 4] = [
    (
        "general_section",
        &[
            (
                "New Note",
                &["<Control>n"],
                Binding::Application("win.new-note"),
            ),
            (
                "Search",
                &["<Control>f", "<Control>k"],
                Binding::Page("notes.search"),
            ),
            ("Refresh", &["<Control>r"], Binding::Page("win.refresh")),
            (
                "Save Now",
                &["<Control>s"],
                Binding::Application("win.save-now"),
            ),
            (
                "Toggle Sidebar",
                &["F9"],
                Binding::Page("notes.toggle-sidebar"),
            ),
            (
                "Preferences",
                &["<Control>comma"],
                Binding::Application("win.preferences"),
            ),
            (
                "Keyboard Shortcuts",
                &["<Control>question"],
                Binding::Application("app.shortcuts"),
            ),
            (
                "Close Window",
                &["<Control>w"],
                Binding::Application("window.close"),
            ),
            ("Quit", &["<Control>q"], Binding::Application("win.quit")),
        ],
    ),
    (
        "notes_section",
        &[
            (
                "New Folder",
                &["<Control><Shift>n"],
                Binding::Page("notes.new-folder"),
            ),
            ("Rename", &["F2"], Binding::Tree),
            ("Move to Trash", &["Delete"], Binding::Tree),
            ("Move Up", &["<Alt>Up"], Binding::Tree),
            ("Move Down", &["<Alt>Down"], Binding::Tree),
            ("Print", &["<Control>p"], Binding::Page("notes.print-note")),
        ],
    ),
    (
        "editor_section",
        &[
            ("Bold", &["<Control>b"], Binding::Editor("editor.bold")),
            ("Italic", &["<Control>i"], Binding::Editor("editor.italic")),
            (
                "Strikethrough",
                &["<Control><Shift>x"],
                Binding::Editor("editor.strikethrough"),
            ),
            (
                "Insert Link",
                &["<Control>k"],
                Binding::Editor("editor.insert-link"),
            ),
            (
                "Toggle Task or Open Link",
                &["<Control>Return"],
                Binding::Editor("editor.toggle-task"),
            ),
            ("Undo", &["<Control>z"], Binding::Editor("editor.undo")),
            (
                "Redo",
                &["<Control><Shift>z"],
                Binding::Editor("editor.redo"),
            ),
        ],
    ),
    (
        "image_viewer_section",
        &[
            (
                "Zoom In",
                &["<Control>plus"],
                Binding::Viewer("viewer.zoom-in"),
            ),
            (
                "Zoom Out",
                &["<Control>minus"],
                Binding::Viewer("viewer.zoom-out"),
            ),
            (
                "Best Fit",
                &["<Control>0"],
                Binding::Viewer("viewer.zoom-fit"),
            ),
        ],
    ),
];

type ParsedAccelerator = (gdk::Key, gdk::ModifierType);

fn parse_accelerators<S: AsRef<str>>(
    accelerators: impl IntoIterator<Item = S>,
) -> Result<Vec<ParsedAccelerator>, String> {
    accelerators
        .into_iter()
        .map(|accelerator| {
            gtk::accelerator_parse(accelerator.as_ref())
                .ok_or_else(|| format!("{} is not a valid accelerator", accelerator.as_ref()))
        })
        .collect()
}

fn shortcuts_dialog_shown(h: &Harness) -> bool {
    h.window()
        .ok()
        .and_then(|window| window.visible_dialog())
        .is_some_and(|dialog| dialog.is::<adw::ShortcutsDialog>())
}

fn wait_shortcuts_dialog(h: &Harness) -> Result<(), String> {
    h.wait("the shortcuts dialog to show", || shortcuts_dialog_shown(h))?;
    h.wait("the focus to be in the shortcuts dialog", || {
        h.window()
            .ok()
            .and_then(|window| window.visible_dialog())
            .is_some_and(|dialog| focus_within(h, &dialog))
    })
}

fn close_shortcuts_dialog_with_escape(h: &Harness) -> Result<(), String> {
    h.press_keys("Escape")?;
    h.wait("Escape to close the shortcuts dialog", || {
        !shortcuts_dialog_shown(h)
    })
}

fn shortcuts_open_and_close(h: &Harness) -> Result<(), String> {
    ensure(!shortcuts_dialog_shown(h), || {
        "the shortcuts dialog was already open".to_owned()
    })?;
    h.press_keys("<Control>question")?;
    wait_shortcuts_dialog(h)?;
    close_shortcuts_dialog_with_escape(h)
}

fn shortcuts_dialog_opens(h: &mut Harness) -> Result<(), String> {
    h.launch()?;
    h.wait_page("token")?;
    shortcuts_open_and_close(h)?;

    log_in(h, false)?;
    wait_tree(h)?;
    shortcuts_open_and_close(h)
}

fn shortcuts_dialog_menu(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let sections = menu_actions(h)?;
    ensure(
        sections.iter().any(|section| {
            section
                .windows(2)
                .any(|pair| pair == ["win.preferences", "app.shortcuts"])
        }),
        || format!("Keyboard Shortcuts does not follow Preferences in the main menu: {sections:?}"),
    )?;

    h.application().activate_action("shortcuts", None);
    wait_shortcuts_dialog(h)?;
    let dialog = h
        .window()?
        .visible_dialog()
        .ok_or("the shortcuts dialog vanished")?;
    dialog.close();
    h.wait("the shortcuts dialog to close", || {
        !shortcuts_dialog_shown(h)
    })
}

fn shortcuts_in_dialog(
    h: &Harness,
) -> Result<Vec<(String, String, Vec<ParsedAccelerator>)>, String> {
    let builder = gtk::Builder::from_resource(SHORTCUTS_RESOURCE);
    let mut found = Vec::new();
    for id in SHORTCUT_SECTIONS {
        let section = builder
            .object::<adw::ShortcutsSection>(id)
            .ok_or_else(|| format!("the dialog has no {id}"))?;
        for position in 0..section.n_items() {
            let item = section
                .item(position)
                .and_downcast::<adw::ShortcutsItem>()
                .ok_or_else(|| format!("{id} holds something other than an item"))?;
            let action = item.action_name();
            let accelerators = if action.is_empty() {
                item.accelerator()
                    .split_whitespace()
                    .map(str::to_owned)
                    .collect()
            } else {
                h.application()
                    .accels_for_action(&action)
                    .into_iter()
                    .map(|accelerator| accelerator.to_string())
                    .collect::<Vec<_>>()
            };
            found.push((
                id.to_owned(),
                item.title().to_string(),
                parse_accelerators(accelerators)?,
            ));
        }
    }
    Ok(found)
}

fn expected_shortcuts() -> Result<Vec<(String, String, Vec<ParsedAccelerator>)>, String> {
    let mut expected = Vec::new();
    for (section, rows) in EXPECTED_SHORTCUTS {
        for (title, accelerators, _) in rows {
            expected.push((
                section.to_owned(),
                (*title).to_owned(),
                parse_accelerators(accelerators.iter().copied())?,
            ));
        }
    }
    Ok(expected)
}

fn named_shortcuts(widget: &gtk::Widget) -> Vec<(gtk::ShortcutTrigger, String)> {
    let controllers = widget.observe_controllers();
    (0..controllers.n_items())
        .filter_map(|index| controllers.item(index))
        .filter_map(|controller| controller.downcast::<gtk::ShortcutController>().ok())
        .flat_map(|controller| {
            (0..controller.n_items())
                .filter_map(|index| controller.item(index))
                .filter_map(|item| item.downcast::<gtk::Shortcut>().ok())
                .filter_map(|shortcut| {
                    let trigger = shortcut.trigger()?;
                    let action = shortcut.action()?.downcast::<gtk::NamedAction>().ok()?;
                    Some((trigger, action.action_name().to_string()))
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn ensure_bound(
    owner: &str,
    bound: &[(gtk::ShortcutTrigger, String)],
    title: &str,
    accelerators: &[&str],
    action: &str,
) -> Result<(), String> {
    for accelerator in accelerators {
        let trigger = gtk::ShortcutTrigger::parse_string(accelerator)
            .ok_or_else(|| format!("{accelerator} is not a valid accelerator"))?;
        ensure(
            bound
                .iter()
                .any(|(bound, name)| bound.equal(&trigger) && name == action),
            || format!("{title} lists {accelerator}, which {owner} does not bind to {action}"),
        )?;
    }
    Ok(())
}

fn action_exists(h: &Harness, name: &str) -> Result<bool, String> {
    let window = h.window()?;
    Ok(match name.split_once('.') {
        Some(("win", action)) => window.lookup_action(action).is_some(),
        Some(("app", action)) => h.application().lookup_action(action).is_some(),
        Some(("window", _)) => {
            let probe = gtk::Button::new();
            probe.set_action_name(Some(name));
            probe.set_parent(&window);
            let exists = probe.is_sensitive();
            probe.unparent();
            exists
        }
        _ => false,
    })
}

fn shortcuts_dialog_matches(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    open_note_at(h, WELCOME)?;

    let actual = shortcuts_in_dialog(h)?;
    let expected = expected_shortcuts()?;
    ensure(actual == expected, || {
        format!("the dialog lists {actual:?}, expected {expected:?}")
    })?;

    let page = named_shortcuts(h.page("notes")?.upcast_ref());
    let editor = named_shortcuts(h.widget("note-editor")?.upcast_ref());
    let viewer = named_shortcuts(ImageViewer::new(&h.model()?, "any").upcast_ref());
    for (_, rows) in EXPECTED_SHORTCUTS {
        for (title, accelerators, binding) in rows {
            match *binding {
                Binding::Application(action) => ensure(action_exists(h, action)?, || {
                    format!("{title} names {action}, which does not exist")
                })?,
                Binding::Page(action) => {
                    ensure_bound("the notes page", &page, title, accelerators, action)?
                }
                Binding::Editor(action) => {
                    ensure_bound("the editor", &editor, title, accelerators, action)?
                }
                Binding::Viewer(action) => {
                    ensure_bound("the image viewer", &viewer, title, accelerators, action)?
                }
                Binding::Tree => {}
            }
        }
    }
    Ok(())
}

fn about_dialog_shown(h: &Harness) -> Option<adw::AboutDialog> {
    h.window()
        .ok()
        .and_then(|window| window.visible_dialog())
        .and_then(|dialog| dialog.downcast::<adw::AboutDialog>().ok())
}

fn about_dialog(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    ensure(about_dialog_shown(h).is_none(), || {
        "the about dialog was already open".to_owned()
    })?;
    h.window_action("about")?;
    h.wait("the about dialog to show", || {
        about_dialog_shown(h).is_some()
    })?;
    let dialog = about_dialog_shown(h).ok_or("the about dialog vanished")?;
    h.wait("the focus to be in the about dialog", || {
        focus_within(h, &dialog)
    })?;

    let same = |what: &str, actual: String, expected: &str| {
        ensure(actual == expected, || {
            format!("the about dialog has {what} {actual:?}, expected {expected:?}")
        })
    };
    same("the name", dialog.application_name().into(), "commitnote")?;
    same("the icon", dialog.application_icon().into(), config::APP_ID)?;
    same("the version", dialog.version().into(), config::VERSION)?;
    same(
        "the developer",
        dialog.developer_name().into(),
        "Marcin Jahn",
    )?;
    same(
        "the website",
        dialog.website().into(),
        "https://github.com/marcinjahn/commitnote",
    )?;
    same(
        "the copyright",
        dialog.copyright().into(),
        "© 2026 Marcin Jahn",
    )?;
    same(
        "the licence text",
        dialog.license().into(),
        "All rights reserved.",
    )?;
    same("the issue URL", dialog.issue_url().into(), "")?;
    same(
        "the debug info file name",
        dialog.debug_info_filename().into(),
        "commitnote-debug-info.txt",
    )?;
    ensure(
        dialog
            .developers()
            .iter()
            .map(|developer| developer.as_str())
            .eq(["Marcin Jahn"]),
        || {
            format!(
                "the about dialog lists the developers {:?}",
                dialog.developers()
            )
        },
    )?;
    ensure(dialog.license_type() == gtk::License::Custom, || {
        format!(
            "the about dialog has the licence type {:?}",
            dialog.license_type()
        )
    })?;

    let debug_info = dialog.debug_info();
    let gtk_version = format!(
        "GTK {}.{}.{}",
        gtk::major_version(),
        gtk::minor_version(),
        gtk::micro_version()
    );
    ensure(debug_info.lines().any(|line| line == gtk_version), || {
        format!("the debug info lacks {gtk_version:?}: {debug_info:?}")
    })?;
    for prefix in ["commitnote ", "libadwaita ", "WebKitGTK "] {
        ensure(
            debug_info.lines().any(|line| line.starts_with(prefix)),
            || format!("the debug info lacks a {prefix:?} line: {debug_info:?}"),
        )?;
    }

    let font_sections = descendants(dialog.upcast_ref())
        .into_iter()
        .filter_map(|widget| widget.downcast::<gtk::Label>().ok())
        .filter(|label| label.text().starts_with("Copyright"))
        .count();
    ensure(font_sections == 10, || {
        format!("the legal page shows {font_sections} font copyright labels, expected 10")
    })?;

    h.press_keys("Escape")?;
    h.wait("Escape to close the about dialog", || {
        about_dialog_shown(h).is_none()
    })
}

fn about_menu(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let sections = menu_actions(h)?;
    ensure(
        sections.iter().any(|section| {
            section
                .windows(2)
                .any(|pair| pair == ["app.shortcuts", "win.about"])
        }),
        || format!("About does not follow Keyboard Shortcuts in the main menu: {sections:?}"),
    )
}

const TAGGED: ColorTag = ColorTag::Red;
const TAG_DOT: &str = "tag-dot";
const SHARED_ICON: &str = "emblem-shared-symbolic";
const PASSWORD_ICON: &str = "channel-secure-symbolic";
const CHECK_ICON: &str = "object-select-symbolic";
const NEXT_ICON: &str = "go-next-symbolic";
const TRASH_DIALOG_NAME: &str = "trash-dialog";
const SEARCH_RESULTS: &str = "search-results-list";
const VIEWER_BUTTONS: [(&str, &str); 3] = [
    ("image-zoom-fit", "Best Fit"),
    ("image-zoom-in", "Zoom In"),
    ("image-zoom-out", "Zoom Out"),
];

fn tag_label(h: &Harness, tag: ColorTag) -> Result<String, String> {
    let options: Vec<TagOptionView> = h.model()?.tag_options();
    Ok(options
        .iter()
        .find(|option| option.tag == tag)
        .map_or_else(|| "Red".to_owned(), |option| option.label.clone()))
}

fn tag_note(h: &Harness, target: &[&str], tag: ColorTag) -> Result<(), String> {
    let model = h.model()?;
    let target = path(target);
    h.run("tagging the note", {
        let target = target.clone();
        async move { model.set_color_tag(target, Some(tag)).await }
    })?
    .map_err(|error| error.message)?;
    h.wait("the tag dot in the tree", || {
        row_expander(h, &target[target.len() - 1]).is_ok_and(|row| {
            descendants(row.upcast_ref())
                .iter()
                .any(|widget| widget.has_css_class(TAG_DOT) && widget.is_visible())
        })
    })
}

fn find_image(root: &gtk::Widget, icon: &str) -> Option<gtk::Image> {
    descendants(root)
        .into_iter()
        .filter_map(|widget| widget.downcast::<gtk::Image>().ok())
        .find(|image| image.icon_name().as_deref() == Some(icon))
}

fn tag_dots(root: &gtk::Widget) -> Vec<gtk::Widget> {
    descendants(root)
        .into_iter()
        .filter(|widget| widget.has_css_class(TAG_DOT))
        .collect()
}

fn a11y_names_notes(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    assert_named(&h.widget("notes-main-menu-button")?, "Main Menu")?;

    tag_note(h, WELCOME_NOTE, TAGGED)?;
    share_note_with(h, &path(WELCOME_NOTE), SHARE_PASSWORD, "Names")?;
    h.wait("the note to be marked shared", || {
        is_shared(h, &path(WELCOME_NOTE))
    })?;
    let expected = format!("Welcome, {} tag", tag_label(h, TAGGED)?);
    h.wait("the tree row to be named with its tag", || {
        row_expander(h, "Welcome")
            .ok()
            .and_then(|row| row.parent())
            .is_some_and(|item| assert_named(&item, &expected).is_ok())
    })?;
    let row = row_expander(h, "Welcome")?;
    h.wait("the shared icon in the row", || {
        find_image(row.upcast_ref(), SHARED_ICON).is_some_and(|icon| icon.is_visible())
    })?;
    let icon = find_image(row.upcast_ref(), SHARED_ICON).ok_or("the row has no shared icon")?;
    assert_named(&icon, "Shared")?;

    open_editor(h, WHITEBOARD_NOTE)?;
    assert_named(&h.widget("note-editor-view")?, "Note")?;
    let editor = h.widget_as::<commitnote::editor::NoteEditor>("note-editor")?;
    wait_images_ready(h, &editor, 1)?;
    open_viewer(h, &editor)?;
    for (name, label) in VIEWER_BUTTONS {
        assert_named(&h.widget(name)?, label)?;
    }
    Ok(())
}

fn a11y_names_dialogs(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, true)?;
    reopen_held(h)?;
    let loading = h.page("loading")?;
    let spinners = descendants(loading.upcast_ref())
        .into_iter()
        .filter(|widget| widget.is::<adw::Spinner>())
        .collect::<Vec<_>>();
    ensure(!spinners.is_empty(), || {
        "the loading page shows no spinner".to_owned()
    })?;
    for spinner in &spinners {
        assert_named(spinner, "Loading")?;
    }
    assert_named(&h.widget(EARLY_NAME_ENTRY)?, "Note Name")?;
    finish_loading(h)?;
    wait_tree(h)?;

    share_note_with(h, &path(WELCOME_NOTE), SHARE_PASSWORD, "Names")?;
    wait_shares(h, &path(WELCOME_NOTE), 1)?;
    let dialog = open_shared_links(h)?;
    h.wait("the password image of the share", || {
        find_image(dialog.upcast_ref(), PASSWORD_ICON).is_some()
    })?;
    let lock = find_image(dialog.upcast_ref(), PASSWORD_ICON).ok_or("no password image")?;
    assert_named(&lock, "Password Protected")?;
    dialog.close();
    h.wait("the shared links dialog to close", || {
        !h.shown(SHARED_LINKS_DIALOG)
    })?;

    let model = h.model()?;
    h.wait("the settings", || model.settings_view().is_some())?;
    import_zip_dialog(h)?;
    choose_existing(h)?;
    select_target(h, &["Projects"])?;
    let form = model.import_form().ok_or("no import form")?;
    let selected = form
        .targets
        .iter()
        .position(|target| target.path == path(&["Projects"]))
        .ok_or("the form offers no Projects folder")?;
    let other = usize::from(selected == 0);
    let row = |index: usize| h.widget(&format!("import-target-{index}"));
    h.wait("the selected target to be checked", || {
        row(selected).is_ok_and(|row| assert_checked(&row, true).is_ok())
    })?;
    assert_checked(&row(other)?, false)?;
    let check = find_image(&row(selected)?, CHECK_ICON).ok_or("the row has no check image")?;
    assert_presentation(&check)
}

fn a11y_presentation(h: &mut Harness) -> Result<(), String> {
    welcome_with_versions(h, &[FIRST_TEXT])?;
    open_history(h)?;
    h.wait("the version rows", || h.widget("history-version-0").is_ok())?;
    let history = h.widget(HISTORY_DIALOG)?;
    let next = find_image(&history, NEXT_ICON).ok_or("the history rows have no next image")?;
    assert_presentation(&next)?;
    h.widget_as::<adw::Dialog>(HISTORY_DIALOG)?.close();
    h.wait("the history to close", || !h.shown(HISTORY_DIALOG))?;

    tag_note(h, WELCOME_NOTE, TAGGED)?;
    let tree_dots = tag_dots(row_expander(h, "Welcome")?.upcast_ref());
    ensure(!tree_dots.is_empty(), || {
        "the tree row has no tag dot".to_owned()
    })?;
    for dot in &tree_dots {
        assert_presentation(dot)?;
    }

    let expected = format!("Welcome, {} tag", tag_label(h, TAGGED)?);
    search_with(h, "<Control>f", "welcome")?;
    h.wait("a tagged search result", || {
        h.widget(SEARCH_RESULTS)
            .is_ok_and(|list| !tag_dots(&list).is_empty())
    })?;
    let list = h.widget(SEARCH_RESULTS)?;
    for dot in tag_dots(&list) {
        assert_presentation(&dot)?;
    }
    let result = descendants(&list)
        .into_iter()
        .filter_map(|widget| widget.downcast::<gtk::ListBoxRow>().ok())
        .find(|row| !tag_dots(row.upcast_ref()).is_empty())
        .ok_or("no search row carries the dot")?;
    assert_named(&result, &expected)?;
    h.press_keys("Escape")?;
    h.wait("the search to close", || !h.shown("search-entry"))?;

    let model = h.model()?;
    let welcome = path(WELCOME_NOTE);
    h.run("trashing the note", {
        let (model, welcome) = (model.clone(), welcome.clone());
        async move {
            let preview = model.trash_preview(welcome.clone()).await?;
            model.trash_node(welcome, preview.share_count).await
        }
    })?
    .map_err(|error| error.message)?;
    h.wait("the note in the trash", || {
        model
            .trash()
            .is_some_and(|trash| trash.entries.iter().any(|entry| entry.name == "Welcome"))
    })?;
    WidgetExt::activate_action(&h.widget("notes-tree-list")?, "notes.show-trash", None)
        .map_err(|error| format!("cannot activate notes.show-trash: {error}"))?;
    h.wait_shown(TRASH_DIALOG_NAME)?;
    h.wait("the trashed row", || h.row_titled("Welcome").is_ok())?;
    let row = h.row_titled("Welcome")?;
    let dots = tag_dots(row.upcast_ref());
    ensure(!dots.is_empty(), || {
        "the trash row has no tag dot".to_owned()
    })?;
    for dot in &dots {
        assert_presentation(dot)?;
    }
    assert_named(&row, &expected)
}

fn spinners_in(root: &gtk::Widget) -> Vec<gtk::Widget> {
    descendants(root)
        .into_iter()
        .filter(|widget| widget.is::<adw::Spinner>() || widget.is::<gtk::Spinner>())
        .collect()
}

fn audit_spinners(h: &Harness) -> Result<usize, String> {
    let spinners = spinners_in(h.window()?.upcast_ref());
    for spinner in &spinners {
        assert_named(spinner, "Loading")?;
    }
    Ok(spinners.len())
}

fn close_dialog(h: &Harness, name: &str) -> Result<(), String> {
    h.widget_as::<adw::Dialog>(name)?.close();
    h.wait("the dialog to close", || !h.shown(name))
}

fn a11y_spinners(h: &mut Harness) -> Result<(), String> {
    h.launch()?;
    h.wait_page("token")?;
    let mut audited = audit_spinners(h)?;
    log_in(h, false)?;
    wait_tree(h)?;
    audited += audit_spinners(h)?;

    open_note_at(h, WELCOME_NOTE)?;
    let tree = h.widget("notes-tree-list")?;
    for (action, dialog) in [
        ("notes.show-trash", TRASH_DIALOG_NAME),
        ("notes.show-details", "details-dialog"),
        ("notes.show-history", HISTORY_DIALOG),
        ("notes.show-shared-links", SHARED_LINKS_DIALOG),
    ] {
        h.wait(&format!("{action} to be enabled"), || {
            crate::p3::action_enabled(h, action).unwrap_or(false)
        })?;
        WidgetExt::activate_action(&tree, action, None)
            .map_err(|error| format!("cannot activate {action}: {error}"))?;
        h.wait_shown(dialog)?;
        audited += audit_spinners(h)?;
        close_dialog(h, dialog)?;
    }
    ensure(audited > 0, || {
        "the audit found no spinner at all".to_owned()
    })
}

fn only_announcement(what: &str) -> Result<Announcement, String> {
    let mut announcements = testing_take_announcements();
    ensure(announcements.len() == 1, || {
        format!(
            "{what} produced {} announcements: {announcements:?}",
            announcements.len()
        )
    })?;
    Ok(announcements.remove(0))
}

fn announce_sync(h: &mut Harness) -> Result<(), String> {
    use gtk::AccessibleAnnouncementPriority::{High, Medium};

    launch_and_log_in(h, false)?;
    wait_sync_icon(h, SYNCED_ICON)?;
    open_first_note(h)?;
    let model = h.model()?;
    let editor = h.widget_as::<commitnote::editor::NoteEditor>("note-editor")?;

    testing_take_announcements();
    type_at_end(h, &editor)?;
    save_now(h)?;
    wait_sync_icon(h, SYNCED_ICON)?;
    let announced = testing_take_announcements();
    ensure(announced.is_empty(), || {
        format!("a normal save announced {announced:?}")
    })?;

    model.set_online(false);
    wait_sync_icon(h, OFFLINE_ICON)?;
    let offline_text = sync_text(&model).ok_or("the model has no sync state")?;
    let offline = only_announcement("going offline")?;
    ensure(offline == (offline_text.clone(), Medium), || {
        format!("going offline announced {offline:?}, expected {offline_text:?} with Medium")
    })?;

    model.emit_by_name::<()>("sync-state-changed", &[]);
    h.settle()?;
    let repeated = testing_take_announcements();
    ensure(repeated.is_empty(), || {
        format!("an unchanged state announced {repeated:?}")
    })?;

    model.set_online(true);
    wait_sync_icon(h, SYNCED_ICON)?;
    let recovered = only_announcement("recovering")?;
    ensure(recovered.1 == Medium && recovered.0 != offline_text, || {
        format!("recovering announced {recovered:?}")
    })?;

    fail_commits(h, true)?;
    type_at_end(h, &editor)?;
    save_now(h)?;
    wait_sync_icon(h, FAILED_ICON)?;
    let failed_text = sync_text(&model).ok_or("the model has no sync state")?;
    let failed = only_announcement("a failed push")?;
    let outcome = ensure(failed == (failed_text.clone(), High), || {
        format!("a failed push announced {failed:?}, expected {failed_text:?} with High")
    });
    fail_commits(h, false)?;
    outcome
}

fn announce_search(h: &mut Harness) -> Result<(), String> {
    use gtk::AccessibleAnnouncementPriority::Medium;

    launch_and_log_in(h, false)?;
    let model = h.model()?;
    let count_text = || {
        model
            .search_results()
            .and_then(|results| results.count_text)
            .filter(|_| model.search_status().is_none_or(|status| !status.partial))
    };

    testing_take_announcements();
    search_with(h, "<Control>f", "road")?;
    h.wait("the search to settle", || count_text().is_some())?;
    let text = count_text().ok_or("the search has no count")?;
    h.settle()?;
    let first = testing_take_announcements();
    ensure(first == [(text.clone(), Medium)], || {
        format!("searching announced {first:?}, expected {text:?} once with Medium")
    })?;

    h.type_keys("m")?;
    h.wait("the longer query", || {
        h.text("search-entry").is_ok_and(|query| query == "roadm")
    })?;
    h.settle()?;
    ensure(count_text().as_ref() == Some(&text), || {
        "the longer query changed the count text".to_owned()
    })?;
    let same = testing_take_announcements();
    ensure(same.is_empty(), || {
        format!("an unchanged count announced {same:?}")
    })?;

    h.press_keys("Escape")?;
    h.wait("search to close", || !h.shown("search-entry"))?;
    testing_take_announcements();
    search_with(h, "<Control>f", "road")?;
    h.wait("the second search to settle", || count_text().is_some())?;
    h.settle()?;
    let again = testing_take_announcements();
    ensure(again == [(text.clone(), Medium)], || {
        format!("a new search announced {again:?}, expected {text:?} once with Medium")
    })
}

fn announce_loading(h: &mut Harness) -> Result<(), String> {
    use gtk::AccessibleAnnouncementPriority::Low;

    launch_and_log_in(h, true)?;
    testing_take_announcements();
    reopen_held(h)?;
    let status = h.widget_as::<adw::StatusPage>("loading-status")?;
    let title = status.title().to_string();
    ensure(!title.is_empty(), || {
        "the loading page has no message".to_owned()
    })?;
    let announced = testing_take_announcements();
    ensure(announced.last() == Some(&(title.clone(), Low)), || {
        format!("the loading message {title:?} was announced as {announced:?}")
    })?;
    ensure(
        announced.iter().all(|(_, priority)| *priority == Low),
        || format!("a loading message was announced above Low: {announced:?}"),
    )?;
    finish_loading(h)
}

fn announce_strength(h: &mut Harness) -> Result<(), String> {
    use gtk::AccessibleAnnouncementPriority::Low;

    h.launch()?;
    submit_token(h)?;
    choose_repository(h, "https://github.com/sample/empty")?;
    h.wait_page("initialize")?;
    h.resize(Width::Wide)?;
    let meter = h.widget("init-strength")?;
    let verdicts = meter
        .clone()
        .downcast::<StrengthMeter>()
        .map_err(|_| "init-strength is not a strength meter".to_owned())?;
    let label = || {
        h.widget_in(&meter, "strength-label")
            .and_then(|label| {
                label
                    .downcast::<gtk::Label>()
                    .map_err(|_| "the strength label is not a label".to_owned())
            })
            .map(|label| label.label().to_string())
    };

    testing_take_announcements();
    h.set_text(
        "init-passphrase-row",
        "harbour lantern copper meadow violin",
    )?;
    h.wait("the strength verdict", || {
        label().is_ok_and(|text| !text.is_empty())
    })?;
    let strong = label()?;
    let first = testing_take_announcements();
    ensure(first == [(strong.clone(), Low)], || {
        format!("the verdict announced {first:?}, expected {strong:?} once with Low")
    })?;

    let before = verdicts.testing_verdicts_shown();
    h.set_text(
        "init-passphrase-row",
        "harbour lantern copper meadow violins",
    )?;
    h.wait("the verdict for the second passphrase", || {
        verdicts.testing_verdicts_shown() > before
    })?;
    h.settle()?;
    ensure(label()? == strong, || {
        "the second passphrase changed the verdict".to_owned()
    })?;
    let unchanged = testing_take_announcements();
    ensure(unchanged.is_empty(), || {
        format!("an unchanged verdict announced {unchanged:?}")
    })?;

    h.set_text("init-passphrase-row", "abc")?;
    h.wait("the weaker verdict", || {
        label().is_ok_and(|text| !text.is_empty() && text != strong)
    })?;
    let weak = label()?;
    let changed = testing_take_announcements();
    ensure(changed == [(weak.clone(), Low)], || {
        format!("the weaker verdict announced {changed:?}, expected {weak:?} once with Low")
    })
}

fn announce_no_toast_repeat(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let model = h.model()?;
    let shown = std::rc::Rc::new(std::cell::RefCell::new(Vec::<String>::new()));
    let notices = model.connect_notice({
        let shown = shown.clone();
        move |_, notice| shown.borrow_mut().push(notice.message.clone())
    });
    let toasts = model.connect_toast({
        let shown = shown.clone();
        move |_, message| shown.borrow_mut().push(message.to_owned())
    });

    let welcome = path(&["Welcome"]);
    testing_take_announcements();
    trash_node_action(h, &["Welcome"])?;
    h.wait_shown("trash-confirm-dialog")?;
    let confirm = h
        .widget_as::<adw::AlertDialog>("trash-confirm-dialog")?
        .response_label("confirm");
    click_labelled(h, &confirm)?;
    h.wait("the note to leave the tree", || !has_node(h, &welcome))?;
    h.wait("the undo toast", || !shown.borrow().is_empty())?;
    h.settle()?;
    model.disconnect(notices);
    model.disconnect(toasts);

    let announced = testing_take_announcements();
    let repeated = announced
        .iter()
        .filter(|(message, _)| shown.borrow().contains(message))
        .collect::<Vec<_>>();
    ensure(repeated.is_empty(), || {
        format!("a toast was announced again: {repeated:?}")
    })
}

const COMFORT_TEXT: &str = "- [ ] a task\n- a list item\n\n---\n\nend";
const NARROW_WINDOW_WIDTH: i32 = 360;
pub(crate) const SCALED_XFT_DPI: i32 = 147_456;
const DIM_ALPHA: f32 = 0.55;
const DIM_ALPHA_HIGH_CONTRAST: f32 = 0.8;

fn open_comfort_editor(h: &Harness) -> Result<commitnote::editor::NoteEditor, String> {
    launch_and_log_in(h, false)?;
    let editor = open_editor(h, WELCOME_NOTE)?;
    show_saved(h, &editor, COMFORT_TEXT)?;
    let buffer = editor.view().buffer();
    buffer.place_cursor(&buffer.end_iter());
    h.wait("a checkbox and a rule", || {
        let kinds: Vec<OverlayKind> = editor
            .view()
            .overlay_rects()
            .into_iter()
            .map(|(kind, _)| kind)
            .collect();
        kinds.contains(&OverlayKind::Checkbox) && kinds.contains(&OverlayKind::Rule)
    })?;
    Ok(editor)
}

fn comfort_text_scaling(h: &mut Harness) -> Result<(), String> {
    let settings = gtk::Settings::default().ok_or("there are no GTK settings")?;
    let original = settings.gtk_xft_dpi();
    let editor = open_comfort_editor(h)?;
    h.resize(Width::Narrow)?;
    split_view(h)?.set_show_content(true);
    restoring(
        || settings.set_gtk_xft_dpi(original),
        || {
            let view = editor.view();
            h.wait("the overlays to be measured", || {
                let (measured, current) = view.testing_line_metrics();
                measured == Some(current)
            })?;
            let before = view.testing_line_metrics().1;

            settings.set_gtk_xft_dpi(SCALED_XFT_DPI);
            h.wait(
                "the overlays to be measured at the larger text size",
                || {
                    let (measured, current) = view.testing_line_metrics();
                    current > before && measured == Some(current)
                },
            )?;
            h.settle()?;
            let actual = h.window()?.width();
            ensure(actual == NARROW_WINDOW_WIDTH, || {
                format!(
                    "the window is {actual} wide at the larger text size, not {NARROW_WINDOW_WIDTH}"
                )
            })
        },
    )
}

fn comfort_high_contrast(h: &mut Harness) -> Result<(), String> {
    let style_manager = adw::StyleManager::default();
    let editor = open_comfort_editor(h)?;
    let view = editor.view();
    h.restoring_high_contrast(|h| {
        ensure(
            !style_manager.is_high_contrast() && !view.testing_high_contrast(),
            || "high contrast is already on".to_owned(),
        )?;
        let dims_to = |factor: f32| {
            view.testing_dim_alpha()
                .is_some_and(|alpha| (alpha - view.color().alpha() * factor).abs() < 0.01)
        };
        h.wait("the normal dim alpha", || dims_to(DIM_ALPHA))?;

        h.set_high_contrast(true)?;
        h.wait("the editor to report high contrast", || {
            view.testing_high_contrast()
        })?;
        h.wait("the dim alpha to strengthen", || {
            dims_to(DIM_ALPHA_HIGH_CONTRAST)
        })?;

        h.set_high_contrast(false)?;
        h.wait("the dim alpha to weaken again", || {
            !view.testing_high_contrast() && dims_to(DIM_ALPHA)
        })
    })
}

fn comfort_reduced_motion(h: &mut Harness) -> Result<(), String> {
    let settings = gtk::Settings::default().ok_or("there are no GTK settings")?;
    let original = settings.is_gtk_enable_animations();
    settings.set_gtk_enable_animations(false);
    restoring(
        || settings.set_gtk_enable_animations(original),
        || {
            with_animated_gif(h, |editor| {
                ensure(!editor.view().testing_animating(), || {
                    "the GIF animates while animations are off".to_owned()
                })?;
                run_animation(h, editor)
            })
        },
    )
}

const OPEN_LINK_ACTION: &str = "editor.open-link";
const LINKED_TEXT: &str = "plain text then [site](https://example.com/x) end";
const INSIDE_LINK: i32 = 18;

fn action_sensitive(widget: &impl IsA<gtk::Widget>, action: &str) -> bool {
    let probe = gtk::Button::new();
    probe.set_action_name(Some(action));
    probe.set_parent(widget);
    let sensitive = probe.is_sensitive();
    probe.unparent();
    sensitive
}

fn long_press_gesture(widget: &impl IsA<gtk::Widget>) -> Option<gtk::GestureLongPress> {
    let controllers = widget.observe_controllers();
    (0..controllers.n_items())
        .filter_map(|index| controllers.item(index))
        .filter_map(|controller| controller.downcast::<gtk::GestureLongPress>().ok())
        .find(GestureSingleExt::is_touch_only)
}

fn menu_has_action(menu: &gio::MenuModel, action: &str) -> bool {
    (0..menu.n_items()).any(|index| {
        string_attribute(menu, index, "action").as_deref() == Some(action)
            || menu
                .item_link(index, "section")
                .or_else(|| menu.item_link(index, "submenu"))
                .is_some_and(|nested| menu_has_action(&nested, action))
    })
}

fn touch_open_link(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let editor = open_editor(h, WELCOME_NOTE)?;
    let view = editor.view();
    set_note_text(&editor, LINKED_TEXT, 0, 0);
    h.wait("the link action to stay off outside a link", || {
        !action_sensitive(&editor, OPEN_LINK_ACTION)
    })?;

    set_note_text(&editor, LINKED_TEXT, INSIDE_LINK, INSIDE_LINK);
    h.wait("the link action to turn on inside a link", || {
        action_sensitive(&editor, OPEN_LINK_ACTION)
    })?;

    set_note_text(&editor, LINKED_TEXT, INSIDE_LINK, INSIDE_LINK + 2);
    h.wait("the link action to turn off with a selection", || {
        !action_sensitive(&editor, OPEN_LINK_ACTION)
    })?;

    set_note_text(&editor, LINKED_TEXT, INSIDE_LINK, INSIDE_LINK);
    h.wait("the link action to turn on again", || {
        action_sensitive(&editor, OPEN_LINK_ACTION)
    })?;
    let menu = view.extra_menu().ok_or("the editor has no extra menu")?;
    ensure(menu_has_action(&menu, OPEN_LINK_ACTION), || {
        "the editor menu has no Open Link item".to_owned()
    })?;

    links::testing_clear_opened_uris();
    editor
        .activate_action(OPEN_LINK_ACTION, None)
        .map_err(|error| format!("cannot activate {OPEN_LINK_ACTION}: {error}"))?;
    ensure(
        links::testing_opened_uris() == ["https://example.com/x"],
        || format!("opened {:?}", links::testing_opened_uris()),
    )
}

fn touch_editor_long_press(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let editor = open_editor(h, WELCOME_NOTE)?;
    let view = editor.view();
    let gesture = long_press_gesture(&view).ok_or("the editor has no touch-only long press")?;

    set_note_text(&editor, LINKED_TEXT, 0, 0);
    h.settle()?;
    let at = view.iter_location(&view.buffer().iter_at_offset(INSIDE_LINK));
    let (x, y) = view.buffer_to_window_coords(
        gtk::TextWindowType::Widget,
        at.x() + at.width() / 2,
        at.y() + at.height() / 2,
    );
    gesture.emit_by_name::<()>("pressed", &[&f64::from(x), &f64::from(y)]);
    h.wait("the long press to move the caret into the link", || {
        editor.caret_offset() == INSIDE_LINK && action_sensitive(&editor, OPEN_LINK_ACTION)
    })?;
    h.wait("the editor menu to be built with Open Link", || {
        descendants(view.upcast_ref())
            .into_iter()
            .filter_map(|widget| widget.downcast::<gtk::PopoverMenu>().ok())
            .filter_map(|popover| popover.menu_model())
            .any(|model| menu_has_action(&model, OPEN_LINK_ACTION))
    })
}

fn touch_tree_long_press(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    let row = "Welcome";
    let expander = row_expander(h, row)?;
    let gesture = long_press_gesture(&expander).ok_or("the row has no touch-only long press")?;
    let y = f64::from(expander.height()) / 2.0;
    let menu = open_menu(h, row, |_| {
        gesture.emit_by_name::<()>("pressed", &[&8f64, &y]);
        Ok(())
    })?;
    close_menu(h, &menu)
}

fn touch_swipe_back(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    h.resize(Width::Narrow)?;
    let split = split_view(h)?;
    h.wait("the collapsed tree", || {
        split.is_collapsed() && !split.shows_content()
    })?;

    open_first_note(h)?;
    let page = h.page("note")?;
    h.wait("the note page to be shown and poppable", || {
        split.shows_content() && action_sensitive(&page, "navigation.pop")
    })?;

    page.activate_action("navigation.pop", None)
        .map_err(|error| format!("cannot go back: {error}"))?;
    h.wait("the tree after going back", || {
        !split.shows_content() && h.shown("notes-tree-list")
    })?;
    ensure(h.model()?.open_note_path().is_some(), || {
        "going back closed the note".to_owned()
    })
}

const IDEAS: &[&str] = &["Projects", "commitnote", "Ideas"];
const ROADMAP: &[&str] = &["Projects", "commitnote", "Roadmap"];
const SHOW_TRASH: &str = "notes.show-trash";

fn expand_folder(h: &Harness, name: &str) -> Result<(), String> {
    row_expander(h, name)?
        .list_row()
        .ok_or_else(|| format!("{name} has no tree row"))?
        .set_expanded(true);
    Ok(())
}

fn shots_pre_session(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, true)?;
    let violet = h.session_accent()?;

    reopen_held(h)?;
    h.wait_shown("loading-status")?;
    let model = h.model()?;
    h.wait("the held load to report its last progress", || {
        model.loading_message().as_deref() == Some(HELD_LOADING_MESSAGE)
    })?;
    h.wait_shown("loading-finish-button")?;
    h.widget("loading-finish-button")?.set_visible(false);
    h.wait("the finish button to hide", || {
        !h.shown("loading-finish-button")
    })?;
    h.screenshots_in_accent("loading", ALL_VARIANTS, &violet)?;
    finish_loading(h)?;
    wait_tree(h)?;

    h.window_action("log-out")?;
    h.wait_page("token")?;
    h.screenshots_in_accent("login", ALL_VARIANTS, &violet)?;

    submit_token(h)?;
    choose_repository(h, NOTES_URL)?;
    h.wait_page("unlock")?;
    h.screenshots_in_accent("unlock", ALL_VARIANTS, &violet)
}

fn shots_notes(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    expand_folder(h, "Projects")?;
    expand_folder(h, "Journal")?;
    h.wait("the children of the expanded folders", || {
        row_expander(h, "commitnote").is_ok() && row_expander(h, "2026").is_ok()
    })?;
    h.session_screenshots("tree", ALL_VARIANTS)?;

    let editor = whiteboard_with_inserted_image(h)?;
    h.session_screenshots("note-images", WIDE_VARIANTS)?;
    h.resize(Width::Narrow)?;
    split_view(h)?.set_show_content(true);
    h.session_screenshots("note-images", NARROW_VARIANTS)?;
    wait_images_ready(h, &editor, 2)?;

    launch_search_repository(h)?;
    focus_tree(h)?;
    search_with(h, "<Control>f", "road")?;
    for &(width, theme) in ALL_VARIANTS {
        h.show_variant(width, theme)?;
        wait_search_shot_ready(h, width)?;
        h.capture_variant("search", width, theme)?;
    }
    Ok(())
}

fn shots_dialogs(h: &mut Harness) -> Result<(), String> {
    welcome_with_versions(h, &[FIRST_TEXT, SECOND_TEXT])?;
    share_note_with(h, &path(WELCOME), SHARE_PASSWORD, SHARE_LABEL)?;
    share_note_with(h, &path(IDEAS), "", "")?;
    let welcome = wait_shares(h, &path(WELCOME), 1)?;
    let ideas = wait_shares(h, &path(IDEAS), 1)?;

    open_history(h)?;
    wait_history_ready(h, 3)?;
    h.session_screenshots("history", ALL_VARIANTS)?;
    close_dialog(h, HISTORY_DIALOG)?;

    open_shared_links(h)?;
    h.wait("both shared links to be listed", || {
        [&welcome[0], &ideas[0]]
            .iter()
            .all(|share| h.shown(&format!("share-row-{}", share.id)))
    })?;
    h.session_screenshots("shared-links", ALL_VARIANTS)?;
    close_dialog(h, SHARED_LINKS_DIALOG)?;

    let model = h.model()?;
    for target in [path(ROADMAP), path(WHITEBOARD_NOTE)] {
        let name = target.last().cloned().unwrap_or_default();
        h.run("trashing a note", {
            let model = model.clone();
            async move {
                let preview = model.trash_preview(target.clone()).await?;
                model.trash_node(target, preview.share_count).await
            }
        })?
        .map_err(|error| error.message)?;
        h.wait("the note in the trash", || trash_entry(h, &name).is_some())?;
    }
    activate_page_action(h, SHOW_TRASH)?;
    h.wait_shown(TRASH_DIALOG)?;
    h.wait("the trashed rows", || {
        ["Roadmap", "Whiteboard"]
            .iter()
            .all(|title| h.row_titled(title).is_ok_and(|row| row.is_mapped()))
    })?;
    h.session_screenshots("trash", ALL_VARIANTS)
}

fn shots_app(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    open_note_at(h, WELCOME)?;
    capture_preferences(h)?;
    close_preferences(h)?;

    h.window_action("about")?;
    h.wait("the about dialog to show", || {
        about_dialog_shown(h).is_some()
    })?;
    h.session_screenshots("about", ALL_VARIANTS)?;
    about_dialog_shown(h)
        .ok_or("the about dialog vanished")?
        .close();
    h.wait("the about dialog to close", || {
        about_dialog_shown(h).is_none()
    })?;

    h.application().activate_action("shortcuts", None);
    wait_shortcuts_dialog(h)?;
    h.session_screenshots("shortcuts", ALL_VARIANTS)?;
    close_shortcuts_dialog_with_escape(h)
}
