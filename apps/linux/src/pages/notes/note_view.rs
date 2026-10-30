use std::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use adw::prelude::*;
use adw::subclass::prelude::*;
use gtk4::{self as gtk, glib};
use libadwaita as adw;

use commitnote_core_api::commands::{ConflictResolution, NoteDraftOutcome};
use commitnote_core_api::shapes::OpenNoteConflict;
use commitnote_editor_text::EditorTextSync;

use super::note_state::{NoteDisplay, display_state, loaded_update, note_title};
use super::sync_feedback::{
    BannerAction, conflict_locks_note, is_conflict_marker, note_banner, open_conflict,
};
use crate::editor::NoteEditor;
use crate::model::{AppModel, DraftFocus, EditorTarget, NoteContentUpdate, RenameResult};

const SPINNER_DELAY: Duration = Duration::from_millis(300);
const MARKER_ALPHA: f32 = 0.55;

mod imp {
    use super::*;

    #[derive(Debug, Default, gtk::CompositeTemplate)]
    #[template(resource = "/io/github/marcinjahn/commitnote/ui/note-view.ui")]
    pub struct NoteView {
        #[template_child]
        pub(super) banner: TemplateChild<adw::Banner>,
        #[template_child]
        pub(super) stack: TemplateChild<gtk::Stack>,
        #[template_child]
        pub(super) scrolled: TemplateChild<gtk::ScrolledWindow>,
        #[template_child]
        pub(super) title_entry: TemplateChild<gtk::Entry>,
        #[template_child]
        pub(super) name_error: TemplateChild<gtk::Label>,
        #[template_child]
        pub(super) editor: TemplateChild<NoteEditor>,
        #[template_child]
        pub(super) vim_status_box: TemplateChild<gtk::Box>,
        #[template_child]
        pub(super) vim_status_line: TemplateChild<gtk::Label>,
        #[template_child]
        pub(super) vim_command_text: TemplateChild<gtk::Label>,
        #[template_child]
        pub(super) status_page: TemplateChild<adw::StatusPage>,
        pub(super) model: OnceCell<AppModel>,
        pub(super) handler: RefCell<Option<glib::SignalHandlerId>>,
        pub(super) settings_handler: RefCell<Option<glib::SignalHandlerId>>,
        pub(super) sync_handler: RefCell<Option<glib::SignalHandlerId>>,
        pub(super) banner_action: Cell<Option<super::BannerAction>>,
        pub(super) spinner_timer: RefCell<Option<glib::SourceId>>,
        pub(super) loading_path: RefCell<Option<Vec<String>>>,
        pub(super) spinner_pending: Cell<bool>,
        pub(super) shown_lineage: Cell<Option<u64>>,
        pub(super) focused_switch: Cell<Option<u64>>,
        pub(super) title_key: RefCell<Option<(EditorTarget, u64)>>,
        pub(super) title_syncing: Cell<bool>,
        pub(super) title_submitted: Cell<bool>,
        pub(super) focus_body_pending: Cell<bool>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for NoteView {
        const NAME: &'static str = "CommitnoteNoteView";
        type Type = super::NoteView;
        type ParentType = adw::Bin;

        fn class_init(klass: &mut Self::Class) {
            NoteEditor::ensure_type();
            klass.bind_template();
        }

        fn instance_init(obj: &glib::subclass::InitializingObject<Self>) {
            obj.init_template();
        }
    }

    impl ObjectImpl for NoteView {
        fn constructed(&self) {
            self.parent_constructed();
            // The text view rewraps for a new width while it is being allocated, and the resize
            // it queues then is lost, leaving the text cut off at its old height.
            let text_view = self.editor.view().downgrade();
            self.scrolled
                .hadjustment()
                .connect_page_size_notify(move |_| {
                    let text_view = text_view.clone();
                    glib::idle_add_local_once(move || {
                        if let Some(text_view) = text_view.upgrade() {
                            text_view.queue_resize();
                        }
                    });
                });
        }

        fn dispose(&self) {
            if let Some(model) = self.model.get() {
                for id in [
                    self.handler.take(),
                    self.settings_handler.take(),
                    self.sync_handler.take(),
                ]
                .into_iter()
                .flatten()
                {
                    model.disconnect(id);
                }
            }
            if let Some(id) = self.spinner_timer.take() {
                id.remove();
            }
        }
    }

    impl WidgetImpl for NoteView {}
    impl BinImpl for NoteView {}
}

glib::wrapper! {
    pub struct NoteView(ObjectSubclass<imp::NoteView>)
        @extends adw::Bin, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl NoteView {
    pub fn new(model: &AppModel) -> Self {
        let widget: Self = glib::Object::new();
        let _ = widget.imp().model.set(model.clone());
        widget.imp().editor.connect_local_edit({
            let model = model.downgrade();
            move |_, text| {
                if let Some(model) = model.upgrade() {
                    model.edit(text.to_owned());
                }
            }
        });
        widget.imp().editor.connect_vim_changed({
            let widget = widget.downgrade();
            move |_| {
                if let Some(widget) = widget.upgrade() {
                    widget.update_vim_status();
                }
            }
        });
        widget.imp().editor.connect_save_requested({
            let model = model.downgrade();
            move |_| {
                if let Some(model) = model.upgrade() {
                    glib::spawn_future_local(async move { model.save_now().await });
                }
            }
        });
        widget.setup_title();
        widget.imp().editor.set_vim_mode(model.vim_mode());
        let settings_handler = model.connect_editor_settings_changed({
            let widget = widget.downgrade();
            move |model| {
                if let Some(widget) = widget.upgrade() {
                    widget.imp().editor.set_vim_mode(model.vim_mode());
                }
            }
        });
        widget
            .imp()
            .settings_handler
            .replace(Some(settings_handler));
        widget.update();
        let handler = model.connect_open_note_changed({
            let widget = widget.downgrade();
            move |_| {
                if let Some(widget) = widget.upgrade() {
                    widget.update();
                }
            }
        });
        widget.imp().handler.replace(Some(handler));
        let sync_handler = model.connect_sync_state_changed({
            let widget = widget.downgrade();
            move |_| {
                if let Some(widget) = widget.upgrade() {
                    widget.update_banner();
                }
            }
        });
        widget.imp().sync_handler.replace(Some(sync_handler));
        widget.imp().banner.connect_button_clicked({
            let widget = widget.downgrade();
            move |_| {
                if let Some(widget) = widget.upgrade() {
                    widget.banner_clicked();
                }
            }
        });
        widget
    }

    pub fn editor(&self) -> NoteEditor {
        self.imp().editor.get()
    }

    pub fn placeholder_visible(&self) -> bool {
        self.imp().stack.visible_child_name().as_deref() == Some("empty")
    }

    pub fn set_title_editable(&self, editable: bool) {
        self.imp().title_entry.set_editable(editable);
    }

    fn setup_title(&self) {
        let entry = &self.imp().title_entry;
        entry.connect_changed({
            let widget = self.downgrade();
            move |entry| {
                let Some(widget) = widget.upgrade() else {
                    return;
                };
                let imp = widget.imp();
                if imp.title_syncing.get() {
                    return;
                }
                imp.title_submitted.set(false);
                if let Some(model) = imp.model.get()
                    && model.editor_target().is_draft()
                {
                    model.set_draft_name(entry.text().to_string());
                }
            }
        });
        entry.connect_activate({
            let widget = self.downgrade();
            move |_| {
                if let Some(widget) = widget.upgrade() {
                    widget.title_activated();
                }
            }
        });
        let focus = gtk::EventControllerFocus::new();
        focus.connect_enter({
            let widget = self.downgrade();
            move |_| {
                if let Some(widget) = widget.upgrade() {
                    widget.imp().title_submitted.set(false);
                }
            }
        });
        focus.connect_leave({
            let widget = self.downgrade();
            move |_| {
                let Some(widget) = widget.upgrade() else {
                    return;
                };
                let imp = widget.imp();
                let on_note = imp
                    .model
                    .get()
                    .is_some_and(|model| model.editor_target().note_path().is_some());
                if on_note && !imp.title_submitted.get() {
                    widget.commit_title();
                }
            }
        });
        entry.add_controller(focus);
    }

    fn title_activated(&self) {
        let imp = self.imp();
        let Some(model) = imp.model.get() else {
            return;
        };
        match model.editor_target() {
            EditorTarget::Note(_) => {
                imp.title_submitted.set(true);
                self.commit_title();
            }
            EditorTarget::Draft(_) => {
                imp.focus_body_pending.set(true);
                let model = model.clone();
                let widget = self.downgrade();
                glib::spawn_future_local(async move {
                    let outcome = model.commit_draft_name().await;
                    let Some(widget) = widget.upgrade() else {
                        return;
                    };
                    if !matches!(outcome, NoteDraftOutcome::Created { .. }) {
                        let imp = widget.imp();
                        imp.focus_body_pending.set(false);
                        if model.editor_target().is_draft() {
                            imp.title_entry.grab_focus();
                        }
                    }
                });
            }
            EditorTarget::None => {}
        }
    }

    fn commit_title(&self) {
        let imp = self.imp();
        let Some(model) = imp.model.get() else {
            return;
        };
        let Some(path) = model.editor_target().note_path().map(<[String]>::to_vec) else {
            return;
        };
        let text = imp.title_entry.text().to_string();
        if text == note_title(&path) && model.note_name_error().is_none() {
            return;
        }
        let model = model.clone();
        let widget = self.downgrade();
        glib::spawn_future_local(async move {
            let result = model.rename_open_note(text).await;
            let Some(widget) = widget.upgrade() else {
                return;
            };
            if matches!(result, RenameResult::None | RenameResult::Restore)
                && model.editor_target().note_path() == Some(path.as_slice())
            {
                widget.set_title_text(note_title(&path));
            }
        });
    }

    fn set_title_text(&self, text: &str) {
        let imp = self.imp();
        if imp.title_entry.text() == text {
            return;
        }
        imp.title_syncing.set(true);
        imp.title_entry.set_text(text);
        imp.title_syncing.set(false);
    }

    fn title_focused(&self) -> bool {
        let entry = self.imp().title_entry.upcast_ref::<gtk::Widget>();
        self.root()
            .and_then(|root| root.focus())
            .is_some_and(|focus| &focus == entry || focus.is_ancestor(entry))
    }

    fn drain_type_to_start(&self) {
        let imp = self.imp();
        let Some(model) = imp.model.get() else {
            return;
        };
        let view = imp.editor.view();
        let focused = self
            .root()
            .and_then(|root| root.focus())
            .is_some_and(|focus| {
                focus.upcast_ref::<gtk::Widget>() == view.upcast_ref::<gtk::Widget>()
            });
        if !focused {
            model.cancel_type_to_start();
            return;
        }
        if let Some(text) = model.take_type_to_start_text()
            && !text.is_empty()
        {
            imp.editor.insert_at_caret(&text);
        }
    }

    fn update_title(&self, model: &AppModel) {
        let imp = self.imp();
        let target = model.editor_target();
        let key = (target.clone(), model.editor_lineage());
        if imp.title_key.borrow().as_ref() != Some(&key) {
            let previous = imp.title_key.replace(Some(key));
            let promoted = previous.is_some_and(|(previous, _)| previous.is_draft())
                && target.note_path().is_some();
            if !(promoted && self.title_focused()) {
                let text = match &target {
                    EditorTarget::Draft(_) => model.draft_name(),
                    EditorTarget::Note(path) => note_title(path).to_owned(),
                    EditorTarget::None => String::new(),
                };
                self.set_title_text(&text);
            }
        }
        let error = match &target {
            EditorTarget::Note(_) => model.note_name_error().or_else(|| model.draft_error()),
            EditorTarget::Draft(_) => model.draft_error(),
            EditorTarget::None => None,
        };
        imp.name_error
            .set_label(error.as_deref().unwrap_or_default());
        imp.name_error.set_visible(error.is_some());
    }

    fn update_vim_status(&self) {
        let imp = self.imp();
        let (mode, command) = imp.editor.vim_status();
        imp.vim_status_line.set_label(&mode);
        imp.vim_command_text.set_label(&command);
        imp.vim_status_box.set_visible(imp.editor.vim_active());
    }

    fn update(&self) {
        let imp = self.imp();
        let Some(model) = imp.model.get() else {
            return;
        };
        self.update_title(model);
        self.update_banner();
        let target = model.editor_target();
        if target.is_draft() {
            self.set_title_editable(true);
            self.leave_loading();
            self.show_draft(model);
            return;
        }
        let path = model.open_note_path();
        let state = model.open_note_state();
        self.set_title_editable(open_conflict(path.as_deref(), state.as_ref()).is_none());
        let locked = conflict_locks_note(path.as_deref(), state.as_ref());
        let display = display_state(path.as_deref(), state.as_ref());
        if let Some(update) = loaded_update(&display, &target, model.note_update()) {
            self.leave_loading();
            self.show_loaded(&update, model.note_switch(), locked);
            return;
        }
        let keeps_editor = target.note_path().is_some()
            && imp.shown_lineage.get() == Some(model.editor_lineage())
            && imp.stack.visible_child_name().as_deref() == Some("loaded")
            && !matches!(display, NoteDisplay::Problem(_));
        if keeps_editor {
            self.leave_loading();
            imp.editor.set_editable(!locked);
            return;
        }
        imp.shown_lineage.set(None);
        match display {
            NoteDisplay::Empty => {
                self.leave_loading();
                imp.editor.set_editable(false);
                imp.stack.set_visible_child_name("empty");
            }
            NoteDisplay::Loading(path) => {
                imp.editor.set_editable(false);
                self.start_loading(path);
            }
            NoteDisplay::Loaded { path, .. } => {
                imp.editor.set_editable(false);
                self.start_loading(path);
            }
            NoteDisplay::Problem(message) => {
                self.leave_loading();
                imp.editor.set_editable(false);
                imp.status_page
                    .set_description(Some(&glib::markup_escape_text(message)));
                imp.stack.set_visible_child_name("problem");
            }
        }
    }

    fn start_loading(&self, path: &[String]) {
        let imp = self.imp();
        if imp.loading_path.borrow().as_deref() == Some(path) {
            return;
        }
        self.leave_loading();
        imp.loading_path.replace(Some(path.to_vec()));
        imp.stack.set_visible_child_name("blank");
        imp.spinner_pending.set(true);
        let timer = glib::timeout_add_local_once(SPINNER_DELAY, {
            let widget = self.downgrade();
            move || {
                if let Some(widget) = widget.upgrade() {
                    let imp = widget.imp();
                    imp.spinner_timer.take();
                    if imp.spinner_pending.get() {
                        imp.stack.set_visible_child_name("loading");
                    }
                }
            }
        });
        imp.spinner_timer.replace(Some(timer));
    }

    fn leave_loading(&self) {
        let imp = self.imp();
        imp.loading_path.replace(None);
        imp.spinner_pending.set(false);
        if let Some(timer) = imp.spinner_timer.take() {
            timer.remove();
        }
    }

    fn show_loaded(&self, update: &NoteContentUpdate, note_switch: u64, locked: bool) {
        let imp = self.imp();
        if imp.editor.apply_update(update, note_switch) == EditorTextSync::Set {
            imp.scrolled.vadjustment().set_value(0.0);
        }
        imp.editor.set_editable(!locked);
        imp.stack.set_visible_child_name("loaded");
        if let Some(model) = imp.model.get() {
            imp.shown_lineage.set(Some(model.editor_lineage()));
        }
        let at_end = imp.model.get().is_some_and(AppModel::take_focus_end);
        if imp.focus_body_pending.take() {
            imp.editor.focus_at_end();
        } else if at_end {
            self.focus_at_end_when_mapped();
        }
    }

    fn focus_at_end_when_mapped(&self) {
        let editor = self.imp().editor.clone();
        if self.is_mapped() {
            editor.focus_at_end();
            return;
        }
        let handler = Rc::new(RefCell::new(None::<glib::SignalHandlerId>));
        let id = self.connect_map(glib::clone!(
            #[strong]
            handler,
            move |widget| {
                if let Some(id) = handler.take() {
                    widget.disconnect(id);
                }
                let editor = editor.clone();
                glib::idle_add_local_once(move || editor.focus_at_end());
            }
        ));
        handler.replace(Some(id));
    }

    fn show_draft(&self, model: &AppModel) {
        let imp = self.imp();
        let note_switch = model.note_switch();
        if imp.editor.start_blank(note_switch) {
            let body = model.draft_body();
            if !body.is_empty() {
                imp.editor.set_text(&body);
            }
            imp.scrolled.vadjustment().set_value(0.0);
        }
        imp.editor.set_editable(true);
        imp.stack.set_visible_child_name("loaded");
        imp.shown_lineage.set(Some(model.editor_lineage()));
        if imp.focused_switch.replace(Some(note_switch)) == Some(note_switch) {
            return;
        }
        let focus = model.draft_focus();
        let widget = self.downgrade();
        glib::idle_add_local_once(move || {
            let Some(widget) = widget.upgrade() else {
                return;
            };
            let imp = widget.imp();
            let still_drafting = imp.model.get().is_some_and(|model| {
                model.editor_target().is_draft() && model.note_switch() == note_switch
            });
            if !still_drafting {
                return;
            }
            match focus {
                DraftFocus::Name => {
                    imp.title_entry.grab_focus();
                }
                DraftFocus::Editor => {
                    imp.editor.view().grab_focus();
                    widget.drain_type_to_start();
                }
            }
        });
    }

    fn update_banner(&self) {
        let imp = self.imp();
        let Some(model) = imp.model.get() else {
            return;
        };
        let banner = if model.editor_target().is_draft() {
            None
        } else {
            note_banner(
                model.open_note_path().as_deref(),
                model.open_note_state().as_ref(),
                model.sync_state().as_ref(),
            )
        };
        let Some(banner) = banner else {
            imp.banner_action.set(None);
            imp.banner.set_revealed(false);
            return;
        };
        imp.banner.set_title(&banner.title);
        imp.banner
            .set_button_label(banner.button.map(|(label, _)| label));
        imp.banner_action
            .set(banner.button.map(|(_, action)| action));
        imp.banner.set_revealed(true);
    }

    fn banner_clicked(&self) {
        let imp = self.imp();
        let Some(model) = imp.model.get() else {
            return;
        };
        match imp.banner_action.get() {
            Some(BannerAction::Resolve) => {
                let path = model.open_note_path();
                let state = model.open_note_state();
                if let Some(conflict) = open_conflict(path.as_deref(), state.as_ref()) {
                    self.present_conflict(conflict);
                }
            }
            Some(BannerAction::Retry) => {
                let model = model.clone();
                glib::spawn_future_local(async move { model.retry_sync().await });
            }
            None => {}
        }
    }

    fn present_conflict(&self, conflict: &OpenNoteConflict) {
        let dialog = adw::AlertDialog::new(Some(&conflict.heading), Some(&conflict.text));
        dialog.set_widget_name("conflict-dialog");
        dialog.add_responses(&[
            ("cancel", "_Cancel"),
            ("edit-merged", &conflict.edit_merged_label),
            ("keep-other", &conflict.keep_other_label),
            ("keep-this", &conflict.keep_this_label),
        ]);
        dialog.set_response_appearance("keep-this", adw::ResponseAppearance::Suggested);
        dialog.set_default_response(Some("cancel"));
        dialog.set_close_response("cancel");
        dialog.set_prefer_wide_layout(true);
        dialog.set_extra_child(Some(&merged_preview(&conflict.merged)));
        let model = self.imp().model.get().cloned();
        dialog.connect_response(None, move |_, response| {
            let resolution = match response {
                "keep-this" => ConflictResolution::KeepMine,
                "keep-other" => ConflictResolution::KeepTheirs,
                "edit-merged" => ConflictResolution::EditMerged,
                _ => return,
            };
            if let Some(model) = model.clone() {
                glib::spawn_future_local(async move { model.resolve_conflict(resolution).await });
            }
        });
        dialog.present(Some(self));
    }
}

fn merged_preview(merged: &str) -> gtk::ScrolledWindow {
    let view = gtk::TextView::builder()
        .name("conflict-merged-text")
        .editable(false)
        .cursor_visible(false)
        .monospace(true)
        .wrap_mode(gtk::WrapMode::WordChar)
        .top_margin(8)
        .bottom_margin(8)
        .left_margin(8)
        .right_margin(8)
        .build();
    let buffer = view.buffer();
    buffer.set_text(merged);
    let marker = gtk::TextTag::builder().name("conflict-marker").build();
    buffer.tag_table().add(&marker);
    let tint = {
        let marker = marker.clone();
        move |view: &gtk::TextView| {
            let mut color = view.color();
            color.set_alpha(MARKER_ALPHA);
            marker.set_foreground_rgba(Some(&color));
        }
    };
    tint(&view);
    view.connect_map(tint.clone());
    let style_manager = adw::StyleManager::default();
    let scheme = RefCell::new(Some(style_manager.connect_dark_notify({
        let view = view.downgrade();
        move |_| {
            let view = view.clone();
            let tint = tint.clone();
            glib::idle_add_local_once(move || {
                if let Some(view) = view.upgrade() {
                    tint(&view);
                }
            });
        }
    })));
    view.connect_destroy(move |_| {
        if let Some(scheme) = scheme.take() {
            style_manager.disconnect(scheme);
        }
    });
    for (line, text) in merged.split('\n').enumerate() {
        if !is_conflict_marker(text) {
            continue;
        }
        let Ok(line) = i32::try_from(line) else {
            break;
        };
        if let Some(start) = buffer.iter_at_line(line) {
            let mut end = start;
            if !end.ends_line() {
                end.forward_to_line_end();
            }
            buffer.apply_tag(&marker, &start, &end);
        }
    }
    gtk::ScrolledWindow::builder()
        .child(&view)
        .min_content_height(200)
        .max_content_height(360)
        .propagate_natural_height(true)
        .hscrollbar_policy(gtk::PolicyType::Never)
        .build()
}
