use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use commitnote::model::{AppModel, Route};
use commitnote_core_api::shapes::{OpenNote, TreeNode};
use gtk4::glib;
use libadwaita as adw;

use crate::support::{Harness, route_name};

pub const NOTES_URL: &str = "https://github.com/sample/notes";
pub const SHOWCASE_URL: &str = "https://github.com/sample/showcase";
pub const PASSPHRASE: &str = "sample notes repo passphrase";
pub const UNLOCK_TIMEOUT: Duration = Duration::from_secs(60);
pub const SAMPLE_REPO_KEY: &str = "sample/notes";

pub fn ensure(condition: bool, message: impl FnOnce() -> String) -> Result<(), String> {
    if condition { Ok(()) } else { Err(message()) }
}

pub fn submit_token(h: &Harness) -> Result<(), String> {
    h.wait_page("token")?;
    h.set_text("login-token-row", "token")?;
    h.click("login-continue-button")?;
    h.wait_page("repositories")
}

pub fn choose_repository(h: &Harness, url: &str) -> Result<(), String> {
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

pub fn unlock(h: &Harness, remember: bool) -> Result<(), String> {
    h.wait_page("unlock")?;
    h.set_text("unlock-passphrase-row", PASSPHRASE)?;
    h.set_switch("unlock-remember-row", remember)?;
    h.click("unlock-button")?;
    h.wait_page_for("notes", UNLOCK_TIMEOUT)
}

pub fn log_in(h: &Harness, remember: bool) -> Result<(), String> {
    submit_token(h)?;
    choose_repository(h, NOTES_URL)?;
    unlock(h, remember)
}

pub fn launch_and_log_in(h: &Harness, remember: bool) -> Result<(), String> {
    h.launch()?;
    log_in(h, remember)?;
    wait_tree(h)
}

pub fn launch_repository(h: &Harness, url: &str) -> Result<(), String> {
    h.launch()?;
    submit_token(h)?;
    choose_repository(h, url)?;
    unlock(h, false)?;
    wait_tree(h)
}

pub fn wait_tree(h: &Harness) -> Result<(), String> {
    h.wait("the note tree", || {
        h.shown("notes-tree-list") && h.list_len("notes-tree-list").is_ok_and(|len| len > 0)
    })
}

/// The list position and path of the first top-level note; folders start collapsed, so a
/// top-level node's position in the model is its row.
pub fn first_top_level_note(h: &Harness) -> Result<(u32, Vec<String>), String> {
    let tree = h.model()?.tree().ok_or("the tree has not loaded")?;
    tree.iter()
        .enumerate()
        .find_map(|(index, node)| match node {
            TreeNode::Note { path, .. } => Some((index as u32, path.clone())),
            TreeNode::Folder { .. } => None,
        })
        .ok_or_else(|| "the sample repository has no top-level note".to_owned())
}

pub fn open_first_note(h: &Harness) -> Result<String, String> {
    let (position, path) = first_top_level_note(h)?;
    let title = path.last().cloned().unwrap_or_default();
    h.activate_list_item("notes-tree-list", position)?;
    let model = h.model()?;
    h.wait("the note to open", || {
        model.open_note_path().as_ref() == Some(&path)
            && h.stack_page("note-view").ok().flatten().as_deref() == Some("loaded")
            && h.text("note-title-entry").is_ok_and(|label| label == title)
            && h.text_view_text("note-editor-view")
                .is_ok_and(|text| !text.is_empty())
    })?;
    Ok(title)
}

pub fn split_view(h: &Harness) -> Result<adw::NavigationSplitView, String> {
    h.widget_as::<adw::NavigationSplitView>("notes-split-view")
}

pub fn export_repo(model: &AppModel) -> impl Future<Output = Option<serde_json::Value>> + use<> {
    let repo = model
        .testing_repo_key()
        .unwrap_or_else(|| SAMPLE_REPO_KEY.to_owned());
    let export = model.testing_send("fake.exportRepo", serde_json::json!({ "repoKey": repo }));
    async move {
        let result = export.await.ok()?;
        serde_json::from_str(result["exported"].as_str()?).ok()
    }
}

pub fn export_main(model: &AppModel) -> impl Future<Output = Option<serde_json::Value>> + use<> {
    let export = export_repo(model);
    async move { Some(export.await?["main"].clone()) }
}

/// The fake forge's branch head, which moves with every commit; the note contents in it are
/// encrypted.
pub fn exported_main(h: &Harness) -> Result<serde_json::Value, String> {
    let model = h.model()?;
    h.run("the repository export", export_main(&model))?
        .ok_or_else(|| "the fake forge did not export the repository".to_owned())
}

pub fn wait_exported_change(h: &Harness, before: &serde_json::Value) -> Result<(), String> {
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

pub fn wait_open_note(h: &Harness, text: &str) -> Result<(), String> {
    let model = h.model()?;
    h.wait("the open note to hold the edited text", || {
        matches!(model.open_note_state(), Some(OpenNote::Loaded { content, .. }) if content == text)
    })
}
