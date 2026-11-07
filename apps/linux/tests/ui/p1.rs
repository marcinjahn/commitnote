use adw::prelude::*;
use commitnote::model::Route;
use gtk4 as gtk;
use libadwaita as adw;

use crate::flows::{
    NOTES_URL, UNLOCK_TIMEOUT, choose_repository, ensure, launch_and_log_in, open_first_note,
    split_view, submit_token, unlock, wait_tree,
};
use crate::support::{ALL_VARIANTS, Case, Harness, NARROW_VARIANTS, Theme, WIDE_VARIANTS, Width};

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

const EMPTY_URL: &str = "https://github.com/sample/empty";
const FOREIGN_URL: &str = "https://github.com/sample/foreign";
const NEW_PASSPHRASE: &str = "harbour lantern copper meadow violin";
const EMPTY_PASSPHRASE_MESSAGE: &str = "Enter the passphrase.";
const MISMATCH_MESSAGE: &str = "Passphrases do not match.";
const REMOTE_EDIT_LINE: &str = "Edited on another device";
const HELD_LOADING_MESSAGE: &str = "Checking repository…";

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
        h.text_view_text("note-editor-view")
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
        split.shows_content() && h.shown("note-title-entry")
    })?;
    let text_view = h.widget_as::<gtk::TextView>("note-editor-view")?;
    h.wait("the note text to fit its wrapped height", || {
        let width = text_view.width();
        width > 0 && {
            let (_, natural, _, _) = text_view.measure(gtk::Orientation::Vertical, width);
            text_view.height() >= natural
        }
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
