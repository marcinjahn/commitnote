use std::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;
use std::sync::OnceLock;

use adw::prelude::*;
use adw::subclass::prelude::*;
use commitnote_editor_text::{
    EditorHistory, EditorTextSync, HistoryStep, TextEdit, TextSelection, Utf16Index, apply, diff,
    map_selection,
};
use commitnote_markdown::{
    CommandResult, insert_link, paste_link, toggle_bold, toggle_italic, toggle_strikethrough,
    toggle_task,
};
use glib::subclass::Signal;
use gtk4::{self as gtk, gdk, gio, glib};
use libadwaita as adw;

use super::MarkdownView;
use super::markdown_view::buffer_selection;
use super::vim::{self, KeyRoute, Vim};
use crate::links;
use crate::model::NoteContentUpdate;

const GROUPING_INTERVAL: f64 = 1.0;
const CARET_SCROLL_MARGIN: f64 = 24.0;

type Command = fn(&str, TextSelection) -> Option<CommandResult>;

const FORMAT_ACTIONS: [(&str, Command); 4] = [
    ("bold", toggle_bold),
    ("italic", toggle_italic),
    ("strikethrough", toggle_strikethrough),
    ("insert-link", insert_link),
];

const SHORTCUTS: [(&str, &str); 8] = [
    ("<Control>z", "editor.undo"),
    ("<Control><Shift>z", "editor.redo"),
    ("<Control>b", "editor.bold"),
    ("<Control>i", "editor.italic"),
    ("<Control><Shift>x", "editor.strikethrough"),
    ("<Control>k", "editor.insert-link"),
    ("<Control>Return", "editor.toggle-task"),
    ("<Control>KP_Enter", "editor.toggle-task"),
];

#[derive(Debug)]
struct EditState {
    history: EditorHistory,
    last_text: String,
    last_index: Utf16Index,
    last_selection: TextSelection,
    applied_switch: Option<u64>,
    base: String,
    synced: Option<(u64, u64)>,
}

impl Default for EditState {
    fn default() -> Self {
        Self {
            history: EditorHistory::new(GROUPING_INTERVAL),
            last_text: String::new(),
            last_index: Utf16Index::default(),
            last_selection: TextSelection::new(0, 0),
            applied_switch: None,
            base: String::new(),
            synced: None,
        }
    }
}

mod imp {
    use super::*;

    #[derive(Debug, Default)]
    pub struct NoteEditor {
        pub(super) view: OnceCell<MarkdownView>,
        pub(super) actions: gio::SimpleActionGroup,
        pub(super) state: RefCell<EditState>,
        pub(super) applying: Cell<bool>,
        pub(super) user_action_depth: Cell<u32>,
        pub(super) changed_in_action: Cell<bool>,
        pub(super) scroll_pending: Cell<bool>,
        pub(super) vim: RefCell<Option<Vim>>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for NoteEditor {
        const NAME: &'static str = "CommitnoteNoteEditor";
        type Type = super::NoteEditor;
        type ParentType = adw::Bin;
    }

    impl ObjectImpl for NoteEditor {
        fn signals() -> &'static [Signal] {
            static SIGNALS: OnceLock<Vec<Signal>> = OnceLock::new();
            SIGNALS.get_or_init(|| {
                vec![
                    Signal::builder("local-edit")
                        .param_types([String::static_type()])
                        .build(),
                    Signal::builder("vim-changed").build(),
                    Signal::builder("save-requested").build(),
                ]
            })
        }

        fn constructed(&self) {
            self.parent_constructed();
            let editor = self.obj();
            editor.set_widget_name("note-editor");
            let view = MarkdownView::new();
            view.connect_command({
                let editor = editor.downgrade();
                move |result| {
                    if let Some(editor) = editor.upgrade() {
                        editor.apply_command(result);
                    }
                }
            });
            editor.set_child(Some(&view));
            let _ = self.view.set(view.clone());
            editor.connect_buffer(&view.buffer());
            editor.setup_actions();
            editor.setup_paste();
        }
    }

    impl WidgetImpl for NoteEditor {}
    impl BinImpl for NoteEditor {}
}

glib::wrapper! {
    pub struct NoteEditor(ObjectSubclass<imp::NoteEditor>)
        @extends adw::Bin, gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl NoteEditor {
    pub fn new() -> Self {
        glib::Object::new()
    }

    pub fn view(&self) -> MarkdownView {
        self.imp()
            .view
            .get()
            .expect("the view is created on construction")
            .clone()
    }

    pub fn text(&self) -> String {
        let buffer = self.view().buffer();
        let (start, end) = buffer.bounds();
        buffer.text(&start, &end, true).into()
    }

    /// Receives the whole text after every change made in the editor itself.
    pub fn connect_local_edit<F: Fn(&Self, &str) + 'static>(&self, f: F) -> glib::SignalHandlerId {
        self.connect_local("local-edit", false, move |args| {
            let editor = args[0].get::<Self>().ok()?;
            let text = args[1].get::<&str>().ok()?;
            f(&editor, text);
            None
        })
    }

    pub fn connect_vim_changed<F: Fn(&Self) + 'static>(&self, f: F) -> glib::SignalHandlerId {
        self.connect_unit_signal("vim-changed", f)
    }

    /// Runs when the user asks Vim to write the note.
    pub fn connect_save_requested<F: Fn(&Self) + 'static>(&self, f: F) -> glib::SignalHandlerId {
        self.connect_unit_signal("save-requested", f)
    }

    fn connect_unit_signal<F: Fn(&Self) + 'static>(
        &self,
        name: &str,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_local(name, false, move |args| {
            f(&args[0].get::<Self>().ok()?);
            None
        })
    }

    pub fn vim_active(&self) -> bool {
        self.imp().vim.borrow().is_some()
    }

    /// The mode or command line and the pending command of the Vim emulation, both empty while
    /// it is off.
    pub fn vim_status(&self) -> (String, String) {
        self.imp().vim.borrow().as_ref().map_or_else(
            || (String::new(), String::new()),
            |vim| (vim.command_bar_text(), vim.command_text()),
        )
    }

    pub fn vim_context(&self) -> Option<sourceview5::VimIMContext> {
        self.imp()
            .vim
            .borrow()
            .as_ref()
            .map(|vim| vim.context().clone())
    }

    /// Turns the Vim emulation on or off, leaving the text, the caret and the history alone.
    pub fn set_vim_mode(&self, enabled: bool) {
        if enabled == self.vim_active() {
            return;
        }
        if enabled {
            let vim = Vim::attach(self.view().upcast_ref());
            let context = vim.context().clone();
            context.connect_command_bar_text_notify({
                let editor = self.downgrade();
                move |_| {
                    if let Some(editor) = editor.upgrade() {
                        editor.emit_by_name::<()>("vim-changed", &[]);
                    }
                }
            });
            context.connect_command_text_notify({
                let editor = self.downgrade();
                move |_| {
                    if let Some(editor) = editor.upgrade() {
                        editor.emit_by_name::<()>("vim-changed", &[]);
                    }
                }
            });
            context.connect_execute_command({
                let editor = self.downgrade();
                move |_, command| {
                    let Some(editor) = editor.upgrade() else {
                        return false;
                    };
                    if vim::is_undo_command(command) {
                        editor.undo();
                    } else if vim::is_redo_command(command) {
                        editor.redo();
                    } else {
                        return false;
                    }
                    true
                }
            });
            context.connect_write({
                let editor = self.downgrade();
                move |_, _, _| {
                    if let Some(editor) = editor.upgrade() {
                        editor.emit_by_name::<()>("save-requested", &[]);
                    }
                }
            });
            self.imp().vim.replace(Some(vim));
        } else {
            self.imp().vim.take();
        }
        self.emit_by_name::<()>("vim-changed", &[]);
    }

    /// Sends a key that Vim must not see to the app's history, returning whether it did.
    pub fn route_vim_key(&self, keyval: gdk::Key, state: gdk::ModifierType) -> bool {
        if !self.vim_active() {
            return false;
        }
        let (bar, command) = self.vim_status();
        match vim::route_key(keyval, state, &bar, &command) {
            KeyRoute::Undo => self.undo(),
            KeyRoute::Redo => self.redo(),
            KeyRoute::PassThrough => return false,
        }
        true
    }

    pub fn set_editable(&self, editable: bool) {
        let view = self.view();
        view.set_editable(editable);
        view.set_cursor_visible(editable);
        self.update_actions();
    }

    /// The text and the selection, as a UTF-16 location and length, that the edit pipeline
    /// last recorded.
    pub fn tracked_state(&self) -> (String, usize, usize) {
        let state = self.imp().state.borrow();
        (
            state.last_text.clone(),
            state.last_selection.location,
            state.last_selection.length,
        )
    }

    pub fn can_undo(&self) -> bool {
        self.is_ready() && self.imp().state.borrow().history.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.is_ready() && self.imp().state.borrow().history.can_redo()
    }

    /// Shows a different text with no history: the caret goes to the start and the preview
    /// starts afresh.
    pub fn set_text(&self, text: &str) {
        self.replace_all(text);
    }

    /// Empties the editor for a note that does not exist yet, once per `note_switch`, and
    /// returns whether it did.
    pub fn start_blank(&self, note_switch: u64) -> bool {
        if self.imp().state.borrow().applied_switch == Some(note_switch) {
            return false;
        }
        self.replace_all("");
        let mut state = self.imp().state.borrow_mut();
        state.applied_switch = Some(note_switch);
        state.base = String::new();
        state.synced = None;
        drop(state);
        self.update_actions();
        true
    }

    pub fn focus_at_end(&self) {
        let view = self.view();
        let buffer = view.buffer();
        buffer.place_cursor(&buffer.end_iter());
        view.grab_focus();
    }

    /// Brings a note update from the core into the editor and returns what it did: a new
    /// note replaces everything, a change made elsewhere merges in place keeping the caret,
    /// the selection and the history, and an echo of what was typed here changes nothing.
    pub fn apply_update(&self, update: &NoteContentUpdate, note_switch: u64) -> EditorTextSync {
        let imp = self.imp();
        let key = (update.serial, note_switch);
        if imp.state.borrow().synced == Some(key) {
            return EditorTextSync::Skip;
        }
        imp.state.borrow_mut().synced = Some(key);

        let doc = self.text();
        let decision = {
            let state = imp.state.borrow();
            match state.applied_switch {
                Some(applied) if applied == note_switch => {
                    EditorTextSync::decide(note_switch, applied, &update.content, &doc, &state.base)
                }
                _ => EditorTextSync::Set,
            }
        };
        match decision {
            EditorTextSync::Set => {
                self.replace_all(&update.content);
                let mut state = imp.state.borrow_mut();
                state.applied_switch = Some(note_switch);
                state.base = update.content.clone();
            }
            EditorTextSync::Update => {
                let mut edits: Vec<TextEdit> = update
                    .edits
                    .iter()
                    .flatten()
                    .map(|edit| TextEdit::new(edit.from as usize, edit.to as usize, &edit.insert))
                    .collect();
                if update.edits.is_none() || apply(&edits, &doc) != update.content {
                    edits = diff(&doc, &update.content);
                }
                self.apply_remote(&doc, &edits);
                let text = self.text();
                let mut state = imp.state.borrow_mut();
                state.history.map_through_remote(&edits);
                state.last_index = Utf16Index::new(&text);
                state.last_text = text;
                state.base = update.content.clone();
            }
            EditorTextSync::Accept => imp.state.borrow_mut().base = update.content.clone(),
            EditorTextSync::Skip => {}
        }
        self.update_actions();
        decision
    }

    /// Applies a command's edits and selection as one undoable step of its own.
    pub fn apply_command(&self, result: CommandResult) {
        if !self.is_ready() {
            return;
        }
        let (last_text, last_selection) = self.current_text_and_selection();
        let text = apply(&result.edits, &last_text);
        let Some(edit) = diff(&last_text, &text).into_iter().next() else {
            self.set_selection(result.selection);
            return;
        };
        {
            let mut state = self.imp().state.borrow_mut();
            state.history.break_group();
            state.history.record_local(
                &edit,
                &last_text,
                last_selection,
                result.selection,
                now(),
                false,
            );
            state.history.break_group();
        }
        self.apply_local(HistoryStep {
            edits: vec![edit],
            selection: result.selection,
        });
    }

    /// Inserts text at the caret as one undoable local edit, leaving the caret after it.
    pub fn insert_at_caret(&self, text: &str) -> bool {
        if !self.is_ready() {
            return false;
        }
        let (_, selection) = self.current_text_and_selection();
        let from = selection.location;
        self.apply_command(CommandResult {
            edits: vec![TextEdit::new(from, from + selection.length, text)],
            selection: TextSelection::new(from + text.encode_utf16().count(), 0),
        });
        true
    }

    pub fn undo(&self) {
        if !self.is_ready() {
            return;
        }
        let step = self.imp().state.borrow_mut().history.undo();
        if let Some(step) = step {
            self.apply_local(step);
        }
    }

    pub fn redo(&self) {
        if !self.is_ready() {
            return;
        }
        let step = self.imp().state.borrow_mut().history.redo();
        if let Some(step) = step {
            self.apply_local(step);
        }
    }

    /// The actions that run commands on the text, resolved as `editor.*`.
    pub fn actions(&self) -> gio::SimpleActionGroup {
        self.imp().actions.clone()
    }

    fn format(&self, command: Command) {
        if !self.is_ready() {
            return;
        }
        let (text, selection) = self.current_text_and_selection();
        if let Some(result) = command(&text, selection) {
            self.apply_command(result);
        }
    }

    fn toggle_task_or_open_link(&self) {
        if !self.is_ready() {
            return;
        }
        let (text, selection) = self.current_text_and_selection();
        if selection.length == 0 && self.open_link_at(selection.location) {
            return;
        }
        if let Some(result) = toggle_task(&text, selection) {
            self.apply_command(result);
        }
    }

    fn open_link_at_caret(&self) {
        if !self.is_ready() {
            return;
        }
        let selection = self.imp().state.borrow().last_selection;
        self.open_link_at(selection.location);
    }

    fn open_link_at(&self, offset: usize) -> bool {
        let view = self.view();
        let Some(url) = view.link_url_at(offset) else {
            return false;
        };
        links::open_uri(&view, &url);
        true
    }

    fn current_text_and_selection(&self) -> (String, TextSelection) {
        let state = self.imp().state.borrow();
        (state.last_text.clone(), state.last_selection)
    }

    fn setup_paste(&self) {
        self.view().connect_paste_clipboard({
            let editor = self.downgrade();
            move |view| {
                let Some(editor) = editor.upgrade() else {
                    return;
                };
                if !editor.is_ready() {
                    return;
                }
                let clipboard = view.clipboard();
                if !clipboard.formats().contains_type(String::static_type()) {
                    return;
                }
                view.stop_signal_emission_by_name("paste-clipboard");
                glib::spawn_future_local(async move {
                    if let Ok(Some(text)) = clipboard.read_text_future().await {
                        editor.finish_paste(text.as_str());
                    }
                });
            }
        });
    }

    fn finish_paste(&self, pasted: &str) {
        if !self.is_ready() {
            return;
        }
        let (text, selection) = self.current_text_and_selection();
        let result = paste_link(&text, selection, pasted).unwrap_or_else(|| CommandResult {
            edits: vec![TextEdit::new(
                selection.location,
                selection.location + selection.length,
                pasted,
            )],
            selection: TextSelection::new(selection.location + pasted.encode_utf16().count(), 0),
        });
        self.apply_command(result);
    }

    fn is_ready(&self) -> bool {
        self.view().is_editable() && self.imp().state.borrow().applied_switch.is_some()
    }

    fn connect_buffer(&self, buffer: &gtk::TextBuffer) {
        buffer.connect_begin_user_action({
            let editor = self.downgrade();
            move |_| {
                if let Some(editor) = editor.upgrade() {
                    let depth = &editor.imp().user_action_depth;
                    depth.set(depth.get() + 1);
                }
            }
        });
        buffer.connect_end_user_action({
            let editor = self.downgrade();
            move |_| {
                if let Some(editor) = editor.upgrade() {
                    editor.user_action_ended();
                }
            }
        });
        buffer.connect_changed({
            let editor = self.downgrade();
            move |_| {
                if let Some(editor) = editor.upgrade() {
                    editor.buffer_changed();
                }
            }
        });
        buffer.connect_mark_set({
            let editor = self.downgrade();
            move |buffer, _, mark| {
                if let Some(editor) = editor.upgrade()
                    && (*mark == buffer.get_insert() || *mark == buffer.selection_bound())
                {
                    editor.selection_moved();
                }
            }
        });
    }

    fn setup_actions(&self) {
        let imp = self.imp();
        let entry = |name: &str, run: Box<dyn Fn(&Self)>| {
            let editor = self.downgrade();
            gio::ActionEntry::builder(name)
                .activate(move |_: &gio::SimpleActionGroup, _, _| {
                    if let Some(editor) = editor.upgrade() {
                        run(&editor);
                    }
                })
                .build()
        };
        let mut entries = vec![
            entry("undo", Box::new(Self::undo)),
            entry("redo", Box::new(Self::redo)),
            entry("toggle-task", Box::new(Self::toggle_task_or_open_link)),
            entry("open-link", Box::new(Self::open_link_at_caret)),
        ];
        for (name, command) in FORMAT_ACTIONS {
            entries.push(entry(name, Box::new(move |editor| editor.format(command))));
        }
        imp.actions.add_action_entries(entries);
        self.insert_action_group("editor", Some(&imp.actions));

        let shortcuts = gtk::ShortcutController::new();
        shortcuts.set_propagation_phase(gtk::PropagationPhase::Capture);
        for (accelerator, action) in SHORTCUTS {
            shortcuts.add_shortcut(gtk::Shortcut::new(
                gtk::ShortcutTrigger::parse_string(accelerator),
                Some(gtk::NamedAction::new(action)),
            ));
        }
        self.add_controller(shortcuts);

        let keys = gtk::EventControllerKey::new();
        keys.set_propagation_phase(gtk::PropagationPhase::Capture);
        keys.connect_key_pressed({
            let editor = self.downgrade();
            move |_, keyval, _, state| match editor.upgrade() {
                Some(editor) if editor.route_vim_key(keyval, state) => glib::Propagation::Stop,
                _ => glib::Propagation::Proceed,
            }
        });
        self.add_controller(keys);
        self.update_actions();
    }

    fn update_actions(&self) {
        let actions = &self.imp().actions;
        let ready = self.is_ready();
        let history = [("undo", self.can_undo()), ("redo", self.can_redo())];
        let others = ["toggle-task", "open-link"]
            .into_iter()
            .chain(FORMAT_ACTIONS.map(|(name, _)| name))
            .map(|name| (name, ready));
        for (name, enabled) in history.into_iter().chain(others) {
            if let Some(action) = actions
                .lookup_action(name)
                .and_downcast::<gio::SimpleAction>()
            {
                action.set_enabled(enabled);
            }
        }
    }

    fn user_action_ended(&self) {
        let imp = self.imp();
        let depth = imp.user_action_depth.get().saturating_sub(1);
        imp.user_action_depth.set(depth);
        if depth > 0 {
            return;
        }
        if imp.changed_in_action.replace(false) {
            self.record_change();
        } else {
            self.selection_moved();
        }
    }

    fn buffer_changed(&self) {
        let imp = self.imp();
        if imp.applying.get() {
            return;
        }
        if imp.user_action_depth.get() > 0 {
            imp.changed_in_action.set(true);
        } else {
            self.record_change();
        }
    }

    fn selection_moved(&self) {
        let imp = self.imp();
        if imp.applying.get() || imp.user_action_depth.get() > 0 || imp.changed_in_action.get() {
            return;
        }
        let buffer = self.view().buffer();
        {
            let mut state = imp.state.borrow_mut();
            state.last_selection = buffer_selection(&buffer, &state.last_index);
        }
        if self.view().is_editable() {
            self.queue_scroll_to_caret();
        }
    }

    /// Records whatever changed since the last known text as one step of local editing and
    /// sends the new text on.
    fn record_change(&self) {
        let text = self.text();
        let index = Utf16Index::new(&text);
        let selection = buffer_selection(&self.view().buffer(), &index);
        let ready = self.is_ready();
        let changed = {
            let mut state = self.imp().state.borrow_mut();
            let edits = if ready {
                diff(&state.last_text, &text)
            } else {
                Vec::new()
            };
            if let Some(edit) = edits.first() {
                let before = state.last_selection;
                let old_text = std::mem::take(&mut state.last_text);
                state
                    .history
                    .record_local(edit, &old_text, before, selection, now(), false);
            }
            state.last_text = text.clone();
            state.last_index = index;
            state.last_selection = selection;
            !edits.is_empty()
        };
        if changed {
            self.update_actions();
            self.queue_scroll_to_caret();
            self.emit_by_name::<()>("local-edit", &[&text]);
        }
    }

    fn replace_all(&self, text: &str) {
        let imp = self.imp();
        let view = self.view();
        let buffer = view.buffer();
        imp.applying.set(true);
        buffer.set_text(text);
        buffer.place_cursor(&buffer.start_iter());
        imp.applying.set(false);
        view.reset();
        let mut state = imp.state.borrow_mut();
        state.history.reset();
        state.last_text = text.to_owned();
        state.last_index = Utf16Index::new(text);
        state.last_selection = TextSelection::new(0, 0);
        drop(state);
        self.update_actions();
    }

    /// Applies simultaneous edits made elsewhere to `doc`, the current text, keeping the
    /// selection on the same text and the scroll position where it is.
    fn apply_remote(&self, doc: &str, edits: &[TextEdit]) {
        if edits.is_empty() {
            return;
        }
        let imp = self.imp();
        let buffer = self.view().buffer();
        let index = Utf16Index::new(doc);
        let selection = map_selection(buffer_selection(&buffer, &index), edits);
        let adjustment = self.scroll_adjustment();
        let offset = adjustment.as_ref().map(gtk::Adjustment::value);
        imp.applying.set(true);
        for edit in edits.iter().rev() {
            replace(&buffer, &index, edit);
        }
        let text = self.text();
        let index = Utf16Index::new(&text);
        select(&buffer, &index, selection);
        imp.applying.set(false);
        if let (Some(adjustment), Some(offset)) = (adjustment, offset) {
            adjustment.set_value(offset);
        }
        imp.state.borrow_mut().last_selection = buffer_selection(&buffer, &index);
    }

    /// Applies a step of local editing, whose edits follow one another, and sends the result.
    fn apply_local(&self, step: HistoryStep) {
        let imp = self.imp();
        let buffer = self.view().buffer();
        imp.applying.set(true);
        let mut text = imp.state.borrow().last_text.clone();
        for edit in &step.edits {
            replace(&buffer, &Utf16Index::new(&text), edit);
            text = apply(std::slice::from_ref(edit), &text);
        }
        let text = self.text();
        let index = Utf16Index::new(&text);
        select(&buffer, &index, step.selection);
        imp.applying.set(false);
        {
            let mut state = imp.state.borrow_mut();
            state.last_selection = buffer_selection(&buffer, &index);
            state.last_text = text.clone();
            state.last_index = index;
        }
        self.update_actions();
        self.queue_scroll_to_caret();
        self.emit_by_name::<()>("local-edit", &[&text]);
    }

    fn set_selection(&self, selection: TextSelection) {
        let imp = self.imp();
        let buffer = self.view().buffer();
        imp.applying.set(true);
        let mut state = imp.state.borrow_mut();
        select(&buffer, &state.last_index, selection);
        state.last_selection = buffer_selection(&buffer, &state.last_index);
        drop(state);
        imp.applying.set(false);
    }

    fn scroll_window(&self) -> Option<gtk::ScrolledWindow> {
        self.ancestor(gtk::ScrolledWindow::static_type())
            .and_downcast::<gtk::ScrolledWindow>()
    }

    fn scroll_adjustment(&self) -> Option<gtk::Adjustment> {
        self.scroll_window().map(|scrolled| scrolled.vadjustment())
    }

    /// Scrolls the caret into view once the next frame is laid out, as the text view has no
    /// scrolling of its own inside the page.
    fn queue_scroll_to_caret(&self) {
        let imp = self.imp();
        if imp.scroll_pending.get() {
            return;
        }
        let Some(clock) = self.frame_clock() else {
            return;
        };
        imp.scroll_pending.set(true);
        let handler = Rc::new(Cell::new(None::<glib::SignalHandlerId>));
        let id = clock.connect_after_paint({
            let editor = self.downgrade();
            let handler = handler.clone();
            move |clock| {
                if let Some(id) = handler.take() {
                    clock.disconnect(id);
                }
                if let Some(editor) = editor.upgrade() {
                    editor.imp().scroll_pending.set(false);
                    editor.scroll_to_caret();
                }
            }
        });
        handler.set(Some(id));
        self.queue_draw();
    }

    fn scroll_to_caret(&self) {
        let Some(scrolled) = self.scroll_window() else {
            return;
        };
        let view = self.view();
        let buffer = view.buffer();
        let caret = view.iter_location(&buffer.iter_at_mark(&buffer.get_insert()));
        let (x, y) =
            view.buffer_to_window_coords(gtk::TextWindowType::Widget, caret.x(), caret.y());
        let Some(top) =
            view.compute_point(&scrolled, &gtk::graphene::Point::new(x as f32, y as f32))
        else {
            return;
        };
        let top = f64::from(top.y());
        let bottom = top + f64::from(caret.height());
        let adjustment = scrolled.vadjustment();
        let page = adjustment.page_size();
        if top < 0.0 {
            adjustment.set_value(adjustment.value() + top - CARET_SCROLL_MARGIN);
        } else if bottom > page {
            adjustment.set_value(adjustment.value() + bottom - page + CARET_SCROLL_MARGIN);
        }
    }
}

impl Default for NoteEditor {
    fn default() -> Self {
        Self::new()
    }
}

fn now() -> f64 {
    glib::monotonic_time() as f64 / 1e6
}

fn replace(buffer: &gtk::TextBuffer, index: &Utf16Index, edit: &TextEdit) {
    let from = index.utf16_to_char(edit.from) as i32;
    let to = (index.utf16_to_char(edit.to) as i32).max(from);
    let mut start = buffer.iter_at_offset(from);
    let mut end = buffer.iter_at_offset(to);
    buffer.delete(&mut start, &mut end);
    let mut at = buffer.iter_at_offset(from);
    buffer.insert(&mut at, &edit.insert);
}

fn select(buffer: &gtk::TextBuffer, index: &Utf16Index, selection: TextSelection) {
    let anchor = index.utf16_to_char(selection.location) as i32;
    let caret = index.utf16_to_char(selection.location + selection.length) as i32;
    buffer.select_range(
        &buffer.iter_at_offset(caret),
        &buffer.iter_at_offset(anchor),
    );
}
