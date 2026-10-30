use std::time::Duration;

use commitnote::model::Route;
use commitnote_core_api::shapes::TreeNode;
use libadwaita as adw;

use crate::support::{Harness, route_name};

pub const NOTES_URL: &str = "https://github.com/sample/notes";
pub const PASSPHRASE: &str = "sample notes repo passphrase";
pub const UNLOCK_TIMEOUT: Duration = Duration::from_secs(60);

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
