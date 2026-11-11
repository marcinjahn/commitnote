use adw::prelude::*;
use commitnote::editor::{NoteEditor, TableWidget};
use gtk4 as gtk;
use libadwaita as adw;

use crate::flows::ensure;
use crate::p2::{make_conflict, open_conflict_dialog};
use crate::p3::{focus_tree, search_rows, search_with};
use crate::p4::{
    HISTORY_DIALOG, VERSION_PREVIEW, open_history, open_version, wait_history_ready,
    welcome_with_versions,
};
use crate::support::{Harness, descendants};

const OLDER: &str = "# Welcome\n\nThis is your notes repo.\n\n\
| Item | Qty | Note |\n| :-- | :-: | --: |\n| tea | 2 | hot |\n| milk | 1 | cold |\n";
const NEWER: &str = "# Welcome\n\nThis is your notes repo.\n\n\
| Item | Qty | Note |\n| :-- | :-: | --: |\n| tea | 2 | hot |\n| milk | 1 | quokka |\n";
const CELL_WORD: &str = "quokka";
const CHANGED_ROW: &str = "| milk | 1 |";
const NEWER_ROW: &str = "| milk | 1 | quokka |";
const CONFLICT_DIALOG: &str = "conflict-dialog";
const MERGED_TEXT: &str = "conflict-merged-text";
/// The current version and the two saved ones.
const VERSIONS: usize = 3;
const OLDER_VERSION: usize = 1;

pub(super) fn raw_surfaces(h: &mut Harness) -> Result<(), String> {
    let editor = welcome_with_versions(h, &[OLDER, NEWER])?;
    h.wait("the newer version in the editor", || editor.text() == NEWER)?;
    search_snippet(h)?;
    version_diff(h)?;
    conflict(h, &editor)
}

fn search_snippet(h: &Harness) -> Result<(), String> {
    focus_tree(h)?;
    search_with(h, "<Control>f", CELL_WORD)?;
    let mut snippets = Vec::new();
    h.wait("a snippet with the table row", || {
        snippets = search_rows(h)
            .1
            .iter()
            .filter_map(|row| row.snippet.as_ref().map(|label| label.text().to_string()))
            .collect();
        snippets.iter().any(|snippet| snippet.contains(NEWER_ROW))
    })
    .map_err(|error| format!("{error}: the snippets are {snippets:?}"))?;
    h.press_keys("Escape")?;
    h.wait("the search to close", || !h.shown("search-entry"))
}

fn version_diff(h: &Harness) -> Result<(), String> {
    open_history(h)?;
    wait_history_ready(h, VERSIONS)?;
    open_version(h, OLDER_VERSION)?;
    let preview = h.widget(VERSION_PREVIEW)?;
    let widgets = descendants(&preview);
    ensure(no_table_widget(&widgets), || {
        "the version preview renders a table".to_owned()
    })?;
    let lines: Vec<String> = widgets
        .iter()
        .filter(|widget| widget.has_css_class("diff-added") || widget.has_css_class("diff-removed"))
        .flat_map(descendants)
        .filter_map(|widget| widget.downcast::<gtk::Label>().ok())
        .map(|label| label.text().to_string())
        .collect();
    ensure(
        lines.iter().any(|line| line.starts_with(CHANGED_ROW)),
        || format!("the changed lines are {lines:?}, with no raw table row"),
    )?;

    h.widget_as::<adw::Dialog>(HISTORY_DIALOG)?.close();
    h.wait("the history dialog to close", || !h.shown(HISTORY_DIALOG))?;
    let model = h.model()?;
    h.wait("the history to be closed", || model.history().is_none())
}

fn conflict(h: &Harness, editor: &NoteEditor) -> Result<(), String> {
    let (_, conflict) = make_conflict(h, editor)?;
    open_conflict_dialog(h, &conflict)?;
    ensure(
        no_table_widget(&descendants(&h.widget(CONFLICT_DIALOG)?)),
        || "the conflict dialog renders a table".to_owned(),
    )?;
    let merged = h.text_view_text(MERGED_TEXT)?;
    ensure(merged.contains(NEWER_ROW), || {
        format!("the merged text shows no raw table row:\n{merged}")
    })?;
    h.widget_as::<adw::AlertDialog>(CONFLICT_DIALOG)?.close();
    h.wait("the conflict dialog to close", || !h.shown(CONFLICT_DIALOG))
}

fn no_table_widget(widgets: &[gtk::Widget]) -> bool {
    !widgets.iter().any(|widget| widget.is::<TableWidget>())
}
