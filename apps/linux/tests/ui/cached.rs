use std::cell::Cell;
use std::rc::Rc;
use std::time::Instant;

use commitnote::editor::NoteEditor;
use commitnote::model::{EditorTarget, Route};
use commitnote_core_api::shapes::OpenNote;
use gtk4::glib;

use crate::flows::{
    SAMPLE_REPO_KEY, UNLOCK_TIMEOUT, ensure, first_top_level_note, launch_and_log_in,
    open_first_note, wait_tree,
};
use crate::p2::{EDITOR, type_at_end};
use crate::support::{Case, Harness, WIDE_VARIANTS};

pub const CASES: &[Case] = &[
    ("cached_start_shows_last_view", cached_start_shows_last_view),
    (
        "cached_start_refresh_updates_note",
        cached_start_refresh_updates_note,
    ),
    (
        "cached_start_stale_edit_merges",
        cached_start_stale_edit_merges,
    ),
    ("cached_start_refresh_failed", cached_start_refresh_failed),
    (
        "cached_start_revoked_keeps_edits",
        cached_start_revoked_keeps_edits,
    ),
    ("cached_start_key_changed", cached_start_key_changed),
];

const REMOTE_EDIT_LINE: &str = "Edited on another device";
const NETWORK_MESSAGE: &str = "Could not reach GitHub. Showing the last loaded notes.";
const UNAUTHORIZED_MESSAGE: &str =
    "Your access token is no longer valid. Log out and log in again.";

/// Logs in with a remembered session, opens the first note, waits for the core to keep the tree
/// and relaunches with the forge refresh held, so the notes can only come from the kept tree.
fn relaunch_from_cache(h: &Harness) -> Result<Vec<String>, String> {
    launch_and_log_in(h, true)?;
    open_first_note(h)?;
    let (_, note) = first_top_level_note(h)?;
    wait_tree_kept(h)?;
    h.close();

    unsafe { std::env::set_var("COMMITNOTE_TESTING_HOLD_REFRESH", "1") };
    let started = Instant::now();
    let shown = h.launch().and_then(|()| wait_note_shown(h, &note));
    unsafe { std::env::remove_var("COMMITNOTE_TESTING_HOLD_REFRESH") };
    shown?;
    println!(
        "  time to content from the kept tree: {} ms",
        started.elapsed().as_millis()
    );
    ensure(refreshing(h), || {
        "the held refresh already finished".to_owned()
    })?;
    Ok(note)
}

fn wait_tree_kept(h: &Harness) -> Result<(), String> {
    let model = h.model()?;
    let kept = Rc::new(Cell::new(false));
    let in_flight = Rc::new(Cell::new(false));
    h.wait_until("the core to keep the tree", UNLOCK_TIMEOUT, || {
        if !kept.get() && !in_flight.replace(true) {
            let model = model.clone();
            let kept = kept.clone();
            let in_flight = in_flight.clone();
            glib::spawn_future_local(async move {
                kept.set(model.testing_has_cached_tree().await.unwrap_or(false));
                in_flight.set(false);
            });
        }
        kept.get()
    })
}

fn wait_note_shown(h: &Harness, note: &[String]) -> Result<(), String> {
    let model = h.model()?;
    h.wait_page("notes")?;
    wait_tree(h)?;
    h.wait("the last note to reopen", || {
        model.editor_target() == EditorTarget::Note(note.to_vec())
            && matches!(model.open_note_state(), Some(OpenNote::Loaded { path, .. }) if path == note)
    })
}

fn refreshing(h: &Harness) -> bool {
    h.model()
        .ok()
        .and_then(|model| model.sync_state())
        .is_some_and(|sync| sync.refreshing)
}

fn release_refresh(h: &Harness) -> Result<(), String> {
    let model = h.model()?;
    h.run("the refresh release", async move {
        model.testing_release_refresh().await
    })?
    .map_err(|error| error.message)
}

fn send_fake(h: &Harness, command: &str, params: serde_json::Value) -> Result<(), String> {
    let model = h.model()?;
    h.run(command, model.testing_send(command, params))?
        .map(|_| ())
        .map_err(|error| format!("{command} failed: {}", error.message))
}

fn fail_refresh(h: &Harness, kind: &str) -> Result<(), String> {
    send_fake(
        h,
        "fake.failNext",
        serde_json::json!({ "repo": SAMPLE_REPO_KEY, "operation": "getHead", "kind": kind, "count": 50 }),
    )
}

fn remote_edit(h: &Harness) -> Result<(), String> {
    let model = h.model()?;
    h.run("the remote edit", async move {
        model.testing_remote_edit().await
    })?
    .map_err(|error| error.message)
}

fn editor_text(h: &Harness) -> Result<String, String> {
    Ok(h.widget_as::<NoteEditor>(EDITOR)?.text())
}

fn cached_start_shows_last_view(h: &mut Harness) -> Result<(), String> {
    relaunch_from_cache(h)?;
    ensure(
        !h.routes_seen()
            .iter()
            .any(|route| matches!(route, Route::Token)),
        || "the cached start asked for a token".to_owned(),
    )?;
    h.session_screenshots("cached-start", WIDE_VARIANTS)?;

    release_refresh(h)?;
    h.wait("the refresh to finish", || !refreshing(h))
}

fn cached_start_refresh_updates_note(h: &mut Harness) -> Result<(), String> {
    relaunch_from_cache(h)?;
    remote_edit(h)?;

    release_refresh(h)?;
    h.wait("the refresh to bring the remote edit", || {
        editor_text(h).is_ok_and(|text| text.starts_with(REMOTE_EDIT_LINE))
    })
}

fn cached_start_stale_edit_merges(h: &mut Harness) -> Result<(), String> {
    relaunch_from_cache(h)?;
    remote_edit(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    let typed = type_at_end(h, &editor)?;
    let local_tail = typed
        .lines()
        .last()
        .ok_or("the typed note is empty")?
        .to_owned();

    release_refresh(h)?;
    h.wait("the editor to hold both edits", || {
        let text = editor.text();
        text.starts_with(REMOTE_EDIT_LINE) && text.ends_with(&local_tail)
    })?;
    let model = h.model()?;
    h.run(
        "saving the merged note",
        async move { model.save_now().await },
    )?;
    h.wait("the merged note to be saved", || {
        h.model()
            .ok()
            .and_then(|model| model.sync_state())
            .is_some_and(|sync| sync.unsaved_count == 0)
    })
}

fn cached_start_refresh_failed(h: &mut Harness) -> Result<(), String> {
    relaunch_from_cache(h)?;
    fail_refresh(h, "Network")?;

    release_refresh(h)?;
    h.wait("the refresh failure notice", || {
        h.label_shown_with(NETWORK_MESSAGE)
    })?;
    ensure(h.route()? == Route::Notes, || {
        "the failed refresh left the notes".to_owned()
    })?;
    wait_tree(h)
}

fn cached_start_revoked_keeps_edits(h: &mut Harness) -> Result<(), String> {
    relaunch_from_cache(h)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    let typed = type_at_end(h, &editor)?;
    fail_refresh(h, "Unauthorized")?;

    release_refresh(h)?;
    h.wait("the revoked token notice", || {
        h.label_shown_with(UNAUTHORIZED_MESSAGE)
    })?;
    ensure(h.route()? == Route::Notes, || {
        "the revoked token left the notes".to_owned()
    })?;
    ensure(editor.text() == typed, || {
        "the revoked token dropped the local edit".to_owned()
    })
}

fn cached_start_key_changed(h: &mut Harness) -> Result<(), String> {
    relaunch_from_cache(h)?;
    send_fake(
        h,
        "fake.changeRepoKey",
        serde_json::json!({ "repo": SAMPLE_REPO_KEY }),
    )?;

    release_refresh(h)?;
    h.wait_route("the key change", |route| {
        matches!(route, Route::KeyChanged { .. })
    })?;
    h.wait_page("key-changed")
}
