use std::path::Path;

use adw::prelude::*;
use commitnote::launch::action_from_arguments;
use commitnote::model::Route;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use crate::flows::{ensure, launch_and_log_in, log_in, wait_tree};
use crate::p2::{finish_loading, focus_within, reopen_held, title_entry, wait_draft};
use crate::p3::search_entry_focused;
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
