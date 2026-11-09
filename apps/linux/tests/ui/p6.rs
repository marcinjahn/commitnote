use std::path::Path;

use adw::prelude::*;
use commitnote::config;
use commitnote::launch::action_from_arguments;
use commitnote::model::Route;
use commitnote::pages::notes::ImageViewer;
use gtk4::{self as gtk, gdk, glib};
use libadwaita as adw;

use crate::flows::{ensure, launch_and_log_in, log_in, wait_tree};
use crate::p2::{finish_loading, focus_within, reopen_held, title_entry, wait_draft};
use crate::p3::{open_note_at, search_entry_focused};
use crate::p5::menu_actions;
use crate::support::{Case, Harness};

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
];

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
