use commitnote_core_api::commands::{
    FolderCreate, FolderCreateOutcome, FolderCreateParams, MoveDirection, MoveSiblingOutcome,
    MoveTargetView, NodeMove, NodeMoveParams, NodeMoveSibling, NodeMoveSiblingParams,
    NodeMoveTargets, NodePathParams, NodePlace, NodePlaceParams, NodeRename, NodeRenameParams,
    NodeSetColorTag, NodeSetColorTagParams, NodeTrash, NodeTrashParams, NodeTrashPreview,
    StructureOutcome, TagsSetFilter, TagsSetFilterParams, TrashDelete, TrashDeleteParams,
    TrashEmpty, TrashEmptyParams, TrashOutcome, TrashPreview, TrashRestore, TrashRestoreParams,
    TrashRestoreTargets, TrashRestoreTargetsParams,
};
use commitnote_core_api::events::TrashChanged;
use commitnote_core_api::shapes::{ColorTag, TrashConfirmationText, TrashEntryView};
use commitnote_core_runtime::RequestError;
use glib::prelude::*;
use glib::subclass::types::ObjectSubclassIsExt;

use super::{AppModel, UserError, warn};

pub const COLOR_TAGS: [ColorTag; 6] = [
    ColorTag::Red,
    ColorTag::Orange,
    ColorTag::Yellow,
    ColorTag::Green,
    ColorTag::Blue,
    ColorTag::Purple,
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrashResult {
    Trashed,
    Deleted,
    Confirm(TrashPreview),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrashState {
    pub entries: Vec<TrashEntryView>,
    pub delete_confirmation: TrashConfirmationText,
    pub empty_confirmation: TrashConfirmationText,
}

impl AppModel {
    pub fn tag_filter(&self) -> Option<ColorTag> {
        self.state().tag_filter
    }

    pub fn used_tags(&self) -> Vec<ColorTag> {
        self.state().used_tags.clone()
    }

    pub fn tags_writable(&self) -> bool {
        self.state().tags_writable
    }

    /// The used tags plus the active filter, so a filter whose last note lost its tag stays
    /// visible and can be cleared.
    pub fn filter_tags(&self) -> Vec<ColorTag> {
        let state = self.state();
        COLOR_TAGS
            .into_iter()
            .filter(|tag| state.used_tags.contains(tag) || state.tag_filter == Some(*tag))
            .collect()
    }

    pub fn trash(&self) -> Option<TrashState> {
        self.state().trash.clone()
    }

    pub fn connect_trash_changed<F: Fn(&Self) + 'static>(&self, f: F) -> glib::SignalHandlerId {
        self.connect_unit_signal("trash-changed", f)
    }

    pub fn report_error(&self, error: &UserError) {
        self.show_toast(&error.message);
    }

    pub async fn create_folder(
        &self,
        parent: Vec<String>,
        name: String,
    ) -> Result<Vec<String>, UserError> {
        let result = self
            .request::<FolderCreate>(FolderCreateParams { parent, name })
            .await
            .map_err(|error| failed("could not create a folder", error))?;
        match result.outcome {
            FolderCreateOutcome::Created { path } => Ok(path),
            FolderCreateOutcome::Error { message } => Err(UserError { message }),
        }
    }

    pub async fn rename_node(
        &self,
        path: Vec<String>,
        name: String,
    ) -> Result<Vec<String>, UserError> {
        let mut turn = self.imp().editor_lane.reserve(false);
        self.flush_edits().await;
        turn.begin().await;
        let result = self
            .request::<NodeRename>(NodeRenameParams { path, name })
            .await
            .map_err(|error| failed("could not rename an item", error))?;
        new_path(result.outcome)
    }

    pub async fn move_node(
        &self,
        path: Vec<String>,
        parent: Vec<String>,
    ) -> Result<Vec<String>, UserError> {
        let mut turn = self.imp().editor_lane.reserve(false);
        self.flush_edits().await;
        turn.begin().await;
        let result = self
            .request::<NodeMove>(NodeMoveParams { path, parent })
            .await
            .map_err(|error| failed("could not move an item", error))?;
        new_path(result.outcome)
    }

    pub async fn place_node(
        &self,
        path: Vec<String>,
        parent: Vec<String>,
        before: Option<String>,
    ) -> Result<Vec<String>, UserError> {
        let mut turn = self.imp().editor_lane.reserve(false);
        self.flush_edits().await;
        turn.begin().await;
        let result = self
            .request::<NodePlace>(NodePlaceParams {
                path,
                parent,
                before,
            })
            .await
            .map_err(|error| failed("could not place an item", error))?;
        new_path(result.outcome)
    }

    pub async fn move_sibling(
        &self,
        path: Vec<String>,
        direction: MoveDirection,
    ) -> Result<Option<Vec<String>>, UserError> {
        self.flush_edits().await;
        let result = self
            .request::<NodeMoveSibling>(NodeMoveSiblingParams { path, direction })
            .await
            .map_err(|error| failed("could not reorder an item", error))?;
        match result.outcome {
            MoveSiblingOutcome::Ok { path } => Ok(Some(path)),
            MoveSiblingOutcome::None => Ok(None),
            MoveSiblingOutcome::Error { message } => Err(UserError { message }),
        }
    }

    pub async fn move_targets(&self, path: Vec<String>) -> Result<Vec<MoveTargetView>, UserError> {
        self.request::<NodeMoveTargets>(NodePathParams { path })
            .await
            .map(|result| result.targets)
            .map_err(|error| failed("could not list move targets", error))
    }

    pub async fn restore_targets(
        &self,
        entry_id: String,
        sub_path: Vec<String>,
    ) -> Result<Vec<MoveTargetView>, UserError> {
        self.request::<TrashRestoreTargets>(TrashRestoreTargetsParams { entry_id, sub_path })
            .await
            .map(|result| result.targets)
            .map_err(|error| failed("could not list restore targets", error))
    }

    pub async fn trash_preview(&self, path: Vec<String>) -> Result<TrashPreview, UserError> {
        self.request::<NodeTrashPreview>(NodePathParams { path })
            .await
            .map(|result| result.preview)
            .map_err(|error| failed("could not preview moving to trash", error))
    }

    pub async fn trash_node(
        &self,
        path: Vec<String>,
        share_count: u32,
    ) -> Result<TrashResult, UserError> {
        self.flush_edits().await;
        let result = self
            .request::<NodeTrash>(NodeTrashParams { path, share_count })
            .await
            .map_err(|error| failed("could not move an item to trash", error))?;
        match result.outcome {
            TrashOutcome::Trashed { .. } => Ok(TrashResult::Trashed),
            TrashOutcome::Deleted => Ok(TrashResult::Deleted),
            TrashOutcome::Confirm { preview } => Ok(TrashResult::Confirm(preview)),
            TrashOutcome::Error { message } => Err(UserError { message }),
        }
    }

    pub async fn set_color_tag(
        &self,
        path: Vec<String>,
        tag: Option<ColorTag>,
    ) -> Result<Vec<String>, UserError> {
        let result = self
            .request::<NodeSetColorTag>(NodeSetColorTagParams { path, tag })
            .await
            .map_err(|error| failed("could not set a color tag", error))?;
        new_path(result.outcome)
    }

    pub async fn restore(
        &self,
        entry_id: String,
        sub_path: Vec<String>,
        parent: Vec<String>,
    ) -> Result<Vec<String>, UserError> {
        let result = self
            .request::<TrashRestore>(TrashRestoreParams {
                entry_id,
                sub_path,
                parent,
            })
            .await
            .map_err(|error| failed("could not restore from trash", error))?;
        new_path(result.outcome)
    }

    pub async fn delete_trash_entry(&self, entry_id: String) -> Result<(), UserError> {
        self.request::<TrashDelete>(TrashDeleteParams { entry_id })
            .await
            .map(|_| ())
            .map_err(|error| failed("could not delete a trash entry", error))
    }

    pub async fn empty_trash(&self) -> Result<(), UserError> {
        self.request::<TrashEmpty>(TrashEmptyParams {})
            .await
            .map(|_| ())
            .map_err(|error| failed("could not empty the trash", error))
    }

    pub async fn set_tag_filter(&self, tag: Option<ColorTag>) -> Result<(), UserError> {
        self.request::<TagsSetFilter>(TagsSetFilterParams { tag })
            .await
            .map(|_| ())
            .map_err(|error| failed("could not set the tag filter", error))
    }

    pub(super) fn trash_changed(&self, changed: TrashChanged) {
        self.state_mut().trash = Some(TrashState {
            entries: changed.entries,
            delete_confirmation: changed.delete_confirmation,
            empty_confirmation: changed.empty_confirmation,
        });
        self.emit_by_name::<()>("trash-changed", &[]);
    }
}

pub(super) fn failed(what: &str, error: RequestError) -> UserError {
    warn(what, &error);
    UserError::from(error)
}

fn new_path(outcome: StructureOutcome) -> Result<Vec<String>, UserError> {
    match outcome {
        StructureOutcome::Ok { path } => Ok(path),
        StructureOutcome::Error { message } => Err(UserError { message }),
    }
}

#[cfg(all(test, feature = "testing"))]
mod tests {
    use std::cell::Cell;
    use std::rc::Rc;

    use commitnote_core_api::CoreEvent;
    use commitnote_core_api::events::TreeChanged;
    use commitnote_core_api::shapes::TreeNode;

    use super::super::EditorTarget;
    use super::super::tests::{
        Session, all_notes, fake_bundle, open_and_read, open_first_note, renamed, run,
    };
    use super::*;

    const TRASH_URL: &str = "https://github.com/sample/trash";

    fn path(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_owned()).collect()
    }

    fn node_at<'a>(nodes: &'a [TreeNode], path: &[String]) -> Option<&'a TreeNode> {
        nodes.iter().find_map(|node| match node {
            TreeNode::Note { path: at, .. } | TreeNode::Folder { path: at, .. } if at == path => {
                Some(node)
            }
            TreeNode::Folder { children, .. } => node_at(children, path),
            TreeNode::Note { .. } => None,
        })
    }

    fn has_node(model: &AppModel, path: &[String]) -> bool {
        node_at(&model.tree().unwrap_or_default(), path).is_some()
    }

    fn child_names(model: &AppModel, parent: &[String]) -> Vec<String> {
        let tree = model.tree().unwrap_or_default();
        let children = match node_at(&tree, parent) {
            Some(TreeNode::Folder { children, .. }) => children.as_slice(),
            _ => &[],
        };
        children
            .iter()
            .map(|node| match node {
                TreeNode::Note { name, .. } | TreeNode::Folder { name, .. } => name.clone(),
            })
            .collect()
    }

    fn color_of(model: &AppModel, path: &[String]) -> Option<ColorTag> {
        match node_at(&model.tree().unwrap_or_default(), path) {
            Some(TreeNode::Note { color_tag, .. }) => *color_tag,
            _ => None,
        }
    }

    fn entry_id(model: &AppModel, name: &str) -> Option<String> {
        model.trash().and_then(|trash| {
            trash
                .entries
                .into_iter()
                .find(|entry| entry.name == name)
                .map(|entry| entry.id)
        })
    }

    #[test]
    fn creates_folders_and_reports_refused_names() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let model = &session.model;

            let top = model
                .create_folder(Vec::new(), "Plans".to_owned())
                .await
                .expect("a top-level folder is created");
            let nested = model
                .create_folder(path(&["Projects"]), "Plans".to_owned())
                .await
                .expect("a nested folder is created");
            assert_eq!(top, path(&["Plans"]));
            assert_eq!(nested, path(&["Projects", "Plans"]));
            session
                .wait_until("the new folders", |model| {
                    has_node(model, &top) && has_node(model, &nested)
                })
                .await;

            let duplicate = model
                .create_folder(Vec::new(), "Journal".to_owned())
                .await
                .expect_err("a duplicate name is refused");
            assert_eq!(
                duplicate.message,
                "A note or folder with this name already exists here."
            );
            let invalid = model
                .create_folder(Vec::new(), "a/b".to_owned())
                .await
                .expect_err("a name with a slash is refused");
            assert_eq!(invalid.message, "Names can't contain “/”.");
        });
    }

    #[test]
    fn renames_and_moves_nodes_and_lists_move_targets() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let model = &session.model;

            let note = model
                .rename_node(path(&["Welcome"]), "Hello".to_owned())
                .await
                .expect("the note is renamed");
            assert_eq!(note, path(&["Hello"]));
            let folder = model
                .rename_node(path(&["Empty folder"]), "Spare".to_owned())
                .await
                .expect("the folder is renamed");
            assert_eq!(folder, path(&["Spare"]));
            let moved = model
                .move_node(note, path(&["Journal"]))
                .await
                .expect("the note moves into a folder");
            assert_eq!(moved, path(&["Journal", "Hello"]));
            session
                .wait_until("the renamed and moved nodes", |model| {
                    has_node(model, &moved)
                        && has_node(model, &folder)
                        && !has_node(model, &path(&["Welcome"]))
                        && !has_node(model, &path(&["Empty folder"]))
                })
                .await;

            let own = path(&["Projects", "commitnote"]);
            let targets = model
                .move_targets(own.clone())
                .await
                .expect("a folder has move targets");
            assert!(targets.iter().all(|target| !target.path.starts_with(&own)));
            let disabled = |at: &[String]| {
                targets
                    .iter()
                    .find(|target| target.path == at)
                    .map(|target| target.disabled)
            };
            assert_eq!(disabled(&path(&["Projects"])), Some(true));
            assert_eq!(disabled(&path(&["Journal"])), Some(false));
            assert_eq!(disabled(&[]), Some(false));
        });
    }

    #[test]
    fn places_and_moves_nodes_among_siblings() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let model = &session.model;
            let parent = path(&["Projects", "commitnote"]);
            let ideas = path(&["Projects", "commitnote", "Ideas"]);
            let order = |names: &'static [&'static str]| {
                let parent = parent.clone();
                move |model: &AppModel| child_names(model, &parent) == path(names)
            };
            assert!(order(&["Roadmap", "Ideas"])(model));

            let placed = model
                .place_node(ideas.clone(), parent.clone(), Some("Roadmap".to_owned()))
                .await
                .expect("the note is placed before its sibling");
            assert_eq!(placed, ideas);
            session
                .wait_until("the note first", order(&["Ideas", "Roadmap"]))
                .await;
            model
                .place_node(ideas.clone(), parent.clone(), None)
                .await
                .expect("the note is placed at the end");
            session
                .wait_until("the note last", order(&["Roadmap", "Ideas"]))
                .await;

            assert_eq!(
                model.move_sibling(ideas.clone(), MoveDirection::Up).await,
                Ok(Some(ideas.clone()))
            );
            session
                .wait_until("the note moved up", order(&["Ideas", "Roadmap"]))
                .await;
            assert_eq!(
                model.move_sibling(ideas.clone(), MoveDirection::Up).await,
                Ok(None)
            );
        });
    }

    #[test]
    fn trashes_restores_deletes_and_empties() {
        run(|| async {
            let session = Session::start(fake_bundle());
            let model = &session.model;
            let signals = Rc::new(Cell::new(0_u32));
            model.connect_trash_changed({
                let signals = signals.clone();
                move |_| signals.set(signals.get() + 1)
            });
            session.log_in_to(TRASH_URL).await;
            session
                .wait_until("the trash after logging in", |model| {
                    model.trash().is_some()
                })
                .await;
            assert!(signals.get() > 0);
            let trash = model.trash().expect("the trash arrived");
            assert!(trash.entries.iter().all(|entry| entry.name == "Scratch"));
            assert_eq!(trash.delete_confirmation.title, "Delete permanently?");

            let kept = path(&["Archive", "Kept note"]);
            let preview = model
                .trash_preview(kept.clone())
                .await
                .expect("the note has a trash preview");
            assert_eq!((preview.item_count, preview.share_count), (0, 0));
            assert_eq!(
                model.trash_node(kept.clone(), preview.share_count).await,
                Ok(TrashResult::Trashed)
            );
            session
                .wait_until("the note in the trash", |model| {
                    !has_node(model, &kept) && entry_id(model, "Kept note").is_some()
                })
                .await;

            let id = entry_id(model, "Kept note").expect("the entry is listed");
            let targets = model
                .restore_targets(id.clone(), Vec::new())
                .await
                .expect("the entry has restore targets");
            assert!(targets.iter().any(|target| target.path.is_empty()));
            let restored = model
                .restore(id, Vec::new(), Vec::new())
                .await
                .expect("the entry is restored to the top level");
            assert_eq!(restored, path(&["Kept note"]));
            session
                .wait_until("the restored note", |model| {
                    has_node(model, &restored) && entry_id(model, "Kept note").is_none()
                })
                .await;

            for note in [path(&["Welcome"]), restored] {
                assert_eq!(model.trash_node(note, 0).await, Ok(TrashResult::Trashed));
            }
            session
                .wait_until("two entries in the trash", |model| {
                    entry_id(model, "Welcome").is_some() && entry_id(model, "Kept note").is_some()
                })
                .await;
            let welcome = entry_id(model, "Welcome").expect("the entry is listed");
            model
                .delete_trash_entry(welcome)
                .await
                .expect("the entry is deleted");
            session
                .wait_until("the deleted entry gone", |model| {
                    entry_id(model, "Welcome").is_none() && entry_id(model, "Kept note").is_some()
                })
                .await;
            model.empty_trash().await.expect("the trash is emptied");
            session
                .wait_until("an empty trash", |model| {
                    model.trash().is_some_and(|trash| trash.entries.is_empty())
                })
                .await;
        });
    }

    #[test]
    fn sets_color_tags_and_filters_by_them() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let model = &session.model;
            let welcome = path(&["Welcome"]);
            assert!(model.tags_writable());
            assert_eq!(model.tag_filter(), None);

            assert_eq!(
                model
                    .set_color_tag(welcome.clone(), Some(ColorTag::Red))
                    .await,
                Ok(welcome.clone())
            );
            session
                .wait_until("the red tag", |model| {
                    color_of(model, &welcome) == Some(ColorTag::Red)
                        && model.used_tags().contains(&ColorTag::Red)
                })
                .await;

            model
                .set_tag_filter(Some(ColorTag::Red))
                .await
                .expect("the filter is set");
            session
                .wait_until("the red filter", |model| {
                    model.tag_filter() == Some(ColorTag::Red)
                })
                .await;
            assert_eq!(
                all_notes(&model.tree().unwrap_or_default()),
                std::slice::from_ref(&welcome)
            );
            assert_eq!(model.filter_tags()[0], ColorTag::Red);

            model
                .set_tag_filter(None)
                .await
                .expect("the filter is cleared");
            session
                .wait_until("the whole tree", |model| {
                    model.tag_filter().is_none()
                        && all_notes(&model.tree().unwrap_or_default()).len() > 1
                })
                .await;
            model
                .set_color_tag(welcome.clone(), None)
                .await
                .expect("the tag is cleared");
            session
                .wait_until("the tag gone", |model| {
                    color_of(model, &welcome).is_none()
                        && !model.used_tags().contains(&ColorTag::Red)
                })
                .await;
        });
    }

    #[test]
    fn filter_tags_keep_an_active_filter_that_is_no_longer_used() {
        run(|| async {
            let session = Session::start(String::new());
            session
                .model
                .handle_event(CoreEvent::TreeChanged(TreeChanged {
                    tree: Some(Vec::new()),
                    tag_filter: Some(ColorTag::Yellow),
                    used_tags: vec![ColorTag::Blue, ColorTag::Red],
                    tags_writable: true,
                    tag_options: Vec::new(),
                }));

            assert_eq!(session.model.tag_filter(), Some(ColorTag::Yellow));
            assert_eq!(
                session.model.filter_tags(),
                [ColorTag::Red, ColorTag::Yellow, ColorTag::Blue]
            );
        });
    }

    #[test]
    fn renaming_a_note_that_is_still_opening_keeps_the_editor_on_it() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let model = &session.model;
            let path = all_notes(&model.tree().unwrap_or_default())
                .into_iter()
                .next()
                .expect("the sample tree has a note");

            model.open_note(Some(path.clone()));
            let target = model
                .rename_node(path.clone(), "Renamed note".to_owned())
                .await
                .expect("the note is renamed");

            assert_eq!(target, renamed(&path, "Renamed note"));
            session
                .wait_until("the editor on the renamed note", |model| {
                    model.editor_target() == EditorTarget::Note(target.clone())
                        && model.open_note_path().as_ref() == Some(&target)
                        && model
                            .note_update()
                            .is_some_and(|update| update.path == target)
                })
                .await;
        });
    }

    #[test]
    fn moving_a_note_that_is_still_opening_keeps_the_editor_on_it() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let model = &session.model;
            let welcome = path(&["Welcome"]);

            model.open_note(Some(welcome.clone()));
            let target = model
                .move_node(welcome.clone(), path(&["Journal"]))
                .await
                .expect("the note is moved");

            assert_eq!(target, path(&["Journal", "Welcome"]));
            session
                .wait_until("the editor on the moved note", |model| {
                    model.editor_target() == EditorTarget::Note(target.clone())
                        && model.open_note_path().as_ref() == Some(&target)
                        && model
                            .note_update()
                            .is_some_and(|update| update.path == target)
                })
                .await;
        });
    }

    #[test]
    fn placing_a_note_in_another_folder_while_it_is_opening_keeps_the_editor_on_it() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let model = &session.model;
            let welcome = path(&["Welcome"]);

            model.open_note(Some(welcome.clone()));
            let target = model
                .place_node(welcome.clone(), path(&["Journal"]), Some("2026".to_owned()))
                .await
                .expect("the note is placed");

            assert_eq!(target, path(&["Journal", "Welcome"]));
            session
                .wait_until("the editor on the placed note", |model| {
                    model.editor_target() == EditorTarget::Note(target.clone())
                        && model.open_note_path().as_ref() == Some(&target)
                })
                .await;
        });
    }

    #[test]
    fn renaming_the_open_note_saves_a_pending_edit_first() {
        run(|| async {
            let session = Session::start(fake_bundle());
            session.log_in().await;
            let model = &session.model;
            let path = open_first_note(&session).await;
            session
                .wait_until("the open to settle", |model| !model.opens_pending())
                .await;
            let content = model
                .note_update()
                .map(|update| update.content)
                .expect("the note was delivered");
            let typed = format!("{content}typed before the rename\n");

            model.edit(typed.clone());
            assert!(model.edit_sender().has_pending());
            let target = model
                .rename_node(path.clone(), "Renamed note".to_owned())
                .await
                .expect("the open note is renamed");

            assert_eq!(target, renamed(&path, "Renamed note"));
            session
                .wait_until("the editor on the renamed note", |model| {
                    model.editor_target() == EditorTarget::Note(target.clone())
                })
                .await;
            let other = all_notes(&model.tree().unwrap_or_default())
                .into_iter()
                .find(|note| *note != target)
                .expect("the sample tree has another note");
            open_and_read(&session, &other).await;
            assert_eq!(open_and_read(&session, &target).await, typed);
        });
    }
}
