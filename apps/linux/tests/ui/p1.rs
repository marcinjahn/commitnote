use std::time::Duration;

use adw::prelude::*;
use commitnote::model::Route;
use commitnote_core_api::shapes::TreeNode;
use gtk4 as gtk;
use libadwaita as adw;

use crate::support::{
    ALL_VARIANTS, Case, Harness, NARROW_VARIANTS, Theme, WIDE_VARIANTS, Width, route_name,
};

pub const CASES: &[Case] = &[
    ("login_unlock_tree", login_unlock_tree),
    ("remembered_restart", remembered_restart),
    ("initialize", initialize),
    ("unusable", unusable),
    ("loading", loading),
    ("read_note", read_note),
    ("narrow_navigation", narrow_navigation),
    ("key_changed", key_changed),
];

const NOTES_URL: &str = "https://github.com/sample/notes";
const EMPTY_URL: &str = "https://github.com/sample/empty";
const FOREIGN_URL: &str = "https://github.com/sample/foreign";
const PASSPHRASE: &str = "sample notes repo passphrase";
const NEW_PASSPHRASE: &str = "harbour lantern copper meadow violin";
const EMPTY_PASSPHRASE_MESSAGE: &str = "Enter the passphrase.";
const MISMATCH_MESSAGE: &str = "Passphrases do not match.";
const REMOTE_EDIT_LINE: &str = "Edited on another device";
const HELD_LOADING_MESSAGE: &str = "Checking repository…";
const UNLOCK_TIMEOUT: Duration = Duration::from_secs(60);

fn ensure(condition: bool, message: impl FnOnce() -> String) -> Result<(), String> {
    if condition { Ok(()) } else { Err(message()) }
}

fn submit_token(h: &Harness) -> Result<(), String> {
    h.wait_page("token")?;
    h.set_text("login-token-row", "token")?;
    h.click("login-continue-button")?;
    h.wait_page("repositories")
}

fn choose_repository(h: &Harness, url: &str) -> Result<(), String> {
    let Route::RepositoryList { repositories } = h.route()? else {
        return Err(format!(
            "expected the repository list, got {}",
            route_name(&h.route()?)
        ));
    };
    let index = repositories
        .iter()
        .position(|choice| choice.url == url)
        .ok_or_else(|| format!("{url} is not listed"))?;
    h.activate_row(&format!("repository-row-{index}"))
}

fn unlock(h: &Harness, remember: bool) -> Result<(), String> {
    h.wait_page("unlock")?;
    h.set_text("unlock-passphrase-row", PASSPHRASE)?;
    h.set_switch("unlock-remember-row", remember)?;
    h.click("unlock-button")?;
    h.wait_page_for("notes", UNLOCK_TIMEOUT)
}

fn log_in(h: &Harness, remember: bool) -> Result<(), String> {
    submit_token(h)?;
    choose_repository(h, NOTES_URL)?;
    unlock(h, remember)
}

fn launch_and_log_in(h: &Harness, remember: bool) -> Result<(), String> {
    h.launch()?;
    log_in(h, remember)?;
    wait_tree(h)
}

fn wait_tree(h: &Harness) -> Result<(), String> {
    h.wait("the note tree", || {
        h.shown("notes-tree-list") && h.list_len("notes-tree-list").is_ok_and(|len| len > 0)
    })
}

/// The list position and path of the first top-level note; folders start collapsed, so a
/// top-level node's position in the model is its row.
fn first_top_level_note(h: &Harness) -> Result<(u32, Vec<String>), String> {
    let tree = h.model()?.tree().ok_or("the tree has not loaded")?;
    tree.iter()
        .enumerate()
        .find_map(|(index, node)| match node {
            TreeNode::Note { path, .. } => Some((index as u32, path.clone())),
            TreeNode::Folder { .. } => None,
        })
        .ok_or_else(|| "the sample repository has no top-level note".to_owned())
}

fn open_first_note(h: &Harness) -> Result<String, String> {
    let (position, path) = first_top_level_note(h)?;
    let title = path.last().cloned().unwrap_or_default();
    h.activate_list_item("notes-tree-list", position)?;
    let model = h.model()?;
    h.wait("the note to open", || {
        model.open_note_path().as_ref() == Some(&path)
            && h.stack_page("note-view").ok().flatten().as_deref() == Some("loaded")
            && h.label("note-title-label")
                .is_ok_and(|label| label == title)
            && h.text_view_text("note-text-view")
                .is_ok_and(|text| !text.is_empty())
    })?;
    Ok(title)
}

fn split_view(h: &Harness) -> Result<adw::NavigationSplitView, String> {
    h.widget_as::<adw::NavigationSplitView>("notes-split-view")
}

fn login_unlock_tree(h: &mut Harness) -> Result<(), String> {
    h.launch()?;
    h.wait_page("token")?;
    h.screenshots("token", ALL_VARIANTS)?;

    submit_token(h)?;
    let Route::RepositoryList { repositories } = h.route()? else {
        return Err("the token did not lead to the repository list".to_owned());
    };
    ensure(
        repositories.iter().any(|choice| choice.url == NOTES_URL),
        || "the sample repository is not listed".to_owned(),
    )?;
    h.screenshots("repositories", ALL_VARIANTS)?;

    choose_repository(h, NOTES_URL)?;
    h.wait_page("unlock")?;
    h.screenshots("unlock", ALL_VARIANTS)?;

    h.set_text("unlock-passphrase-row", "")?;
    h.click("unlock-button")?;
    h.wait("the empty passphrase message", || {
        h.label("unlock-error-label")
            .is_ok_and(|text| text == EMPTY_PASSPHRASE_MESSAGE)
    })?;

    h.set_text("unlock-passphrase-row", "not the passphrase")?;
    h.click("unlock-button")?;
    h.wait("the wrong passphrase message", || {
        h.label("unlock-error-label")
            .is_ok_and(|text| !text.is_empty() && text != EMPTY_PASSPHRASE_MESSAGE)
            && h.widget("unlock-button")
                .is_ok_and(|button| button.is_sensitive())
    })?;
    ensure(h.text("unlock-passphrase-row")?.is_empty(), || {
        "the wrong passphrase was left in the field".to_owned()
    })?;
    ensure(matches!(h.route()?, Route::Unlock { .. }), || {
        "a wrong passphrase left the unlock page".to_owned()
    })?;

    unlock(h, false)?;
    wait_tree(h)
}

fn remembered_restart(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, true)?;
    h.close();

    h.launch()?;
    h.wait_page_for("notes", UNLOCK_TIMEOUT)?;
    wait_tree(h)?;
    ensure(
        !h.routes_seen()
            .iter()
            .any(|route| matches!(route, Route::Token)),
        || "the remembered session asked for a token".to_owned(),
    )?;

    h.window_action("log-out")?;
    h.wait_page("token")?;
    h.close();

    h.launch()?;
    h.wait_page("token")
}

fn initialize(h: &mut Harness) -> Result<(), String> {
    h.launch()?;
    submit_token(h)?;
    choose_repository(h, EMPTY_URL)?;
    h.wait_page("initialize")?;
    h.screenshots("initialize", ALL_VARIANTS)?;

    h.resize(Width::Wide)?;
    h.set_text("init-passphrase-row", NEW_PASSPHRASE)?;
    h.wait_shown("init-strength-label")?;

    h.set_text("init-repeat-row", "a different passphrase")?;
    h.click("init-button")?;
    h.wait("the mismatch message", || {
        h.shown("init-error-label")
            && h.label("init-error-label")
                .is_ok_and(|text| text == MISMATCH_MESSAGE)
    })?;

    h.set_text("init-repeat-row", NEW_PASSPHRASE)?;
    h.click("init-button")?;
    h.wait_page_for("notes", UNLOCK_TIMEOUT)?;
    h.wait("the empty repository placeholder", || {
        h.stack_page("notes-tree").ok().flatten().as_deref() == Some("empty")
    })
}

fn unusable(h: &mut Harness) -> Result<(), String> {
    h.launch()?;
    submit_token(h)?;
    choose_repository(h, FOREIGN_URL)?;
    let route = h.wait_route("the unusable route", |route| {
        matches!(route, Route::Unusable { .. })
    })?;
    let Route::Unusable { outcome } = route else {
        unreachable!()
    };
    h.wait_page("unusable")?;
    h.wait("the core's error message", || {
        h.label_shown_with(&outcome.error.message)
    })?;
    h.screenshots("unusable", ALL_VARIANTS)
}

fn loading(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, true)?;
    h.close();

    unsafe { std::env::set_var("COMMITNOTE_TESTING_HOLD_LOADING", "1") };
    let launched = h.launch();
    let held = launched.and_then(|()| {
        h.wait_route("the held loading route", |route| {
            *route == Route::Loading { failure: None }
        })
    });
    unsafe { std::env::remove_var("COMMITNOTE_TESTING_HOLD_LOADING") };
    held?;
    h.wait_page("loading")?;
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
    h.screenshots(
        "loading",
        &[(Width::Narrow, Theme::Light), (Width::Wide, Theme::Dark)],
    )?;
    ensure(!h.shown("loading-finish-button"), || {
        "the finish button came back during capture".to_owned()
    })?;
    ensure(h.route()? == Route::Loading { failure: None }, || {
        "loading finished while it was held".to_owned()
    })?;

    h.window_action("testing-finish-loading")?;
    h.wait_page_for("notes", UNLOCK_TIMEOUT)?;
    wait_tree(h)
}

fn read_note(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    open_first_note(h)?;

    h.window_action("testing-remote-edit")?;
    h.refresh_until("the remote edit to show", || {
        h.text_view_text("note-text-view")
            .is_ok_and(|text| text.lines().next() == Some(REMOTE_EDIT_LINE))
    })?;

    h.session_screenshots("notes", WIDE_VARIANTS)
}

fn narrow_navigation(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    h.resize(Width::Narrow)?;
    let split = split_view(h)?;
    h.wait("the collapsed tree", || {
        split.is_collapsed() && !split.shows_content() && h.shown("notes-tree-list")
    })?;

    open_first_note(h)?;
    h.wait("the note to replace the tree", || {
        split.shows_content() && h.shown("note-title-label")
    })?;
    let text_view = h.widget_as::<gtk::TextView>("note-text-view")?;
    h.wait("the note text to fit its wrapped height", || {
        let (_, natural, _, _) = text_view.measure(gtk::Orientation::Vertical, text_view.width());
        text_view.height() >= natural
    })?;
    h.session_screenshots("note", NARROW_VARIANTS)?;

    h.page("note")?
        .activate_action("navigation.pop", None)
        .map_err(|error| format!("cannot go back: {error}"))?;
    let model = h.model()?;
    h.wait("the tree after going back", || {
        !split.shows_content() && h.shown("notes-tree-list")
    })?;
    ensure(model.open_note_path().is_some(), || {
        "going back closed the note".to_owned()
    })?;
    h.session_screenshots("notes", NARROW_VARIANTS)?;

    let notes_page = h.page("notes")?;
    h.press_shortcut(notes_page.upcast_ref(), "F9")?;
    h.wait("F9 to show the note", || split.shows_content())?;
    h.press_shortcut(notes_page.upcast_ref(), "F9")?;
    h.wait("F9 to show the tree", || !split.shows_content())
}

fn key_changed(h: &mut Harness) -> Result<(), String> {
    launch_and_log_in(h, false)?;
    h.window_action("testing-change-passphrase")?;
    h.refresh_until("the key change to be noticed", || {
        h.route()
            .is_ok_and(|route| matches!(route, Route::KeyChanged { .. }))
    })?;
    h.wait_page("key-changed")?;
    h.session_screenshots("key-changed", ALL_VARIANTS)?;

    h.click("key-changed-log-in-again-button")?;
    h.wait_page("token")
}
