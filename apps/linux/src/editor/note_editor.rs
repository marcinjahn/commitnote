use std::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;
use std::sync::OnceLock;

use adw::prelude::*;
use adw::subclass::prelude::*;
use commitnote_editor_text::{
    EditorHistory, EditorTextSync, HistoryStep, SentTexts, TextEdit, TextSelection, Utf16Index,
    apply, diff, map_selection,
};
use commitnote_markdown::{
    CommandResult, insert_link, paste_link, toggle_bold, toggle_italic, toggle_strikethrough,
    toggle_task,
};
use glib::subclass::Signal;
use gtk4::{self as gtk, gdk, gio, glib};
use libadwaita as adw;

use super::MarkdownView;
use super::image_insertion::{ImageInserter, InsertAt, place_images, target_selection};
use super::image_source::ImageSource;
use super::markdown_view::buffer_selection;
use super::vim::{self, KeyRoute, Vim};
use crate::fonts::NoteFont;
use crate::links;
use crate::model::{ImageInput, NoteContentUpdate};

const GROUPING_INTERVAL: f64 = 1.0;
const CARET_SCROLL_MARGIN: f64 = 24.0;
const CARET_SCROLL_RETRIES: u8 = 10;

type Command = fn(&str, TextSelection) -> Option<CommandResult>;

const IMAGE_REFERENCE_MARKER: &str = "image:";

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

#[derive(Clone)]
pub(super) struct InserterHandle(Rc<dyn ImageInserter>);

impl std::fmt::Debug for InserterHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ImageInserter")
    }
}

/// Where a late result may still go: the note shown when it started, and where in it.
#[derive(Debug, Clone)]
struct Pending {
    switch: Option<u64>,
    at: InsertAt,
}

#[derive(Debug, Clone, Copy)]
enum Paste {
    Files,
    Texture,
    Text,
}

fn file_inputs(list: &gdk::FileList) -> Vec<ImageInput> {
    list.files().into_iter().map(ImageInput::File).collect()
}

fn texture_input(texture: &gdk::Texture) -> ImageInput {
    ImageInput::Bytes {
        bytes: texture.save_to_png_bytes(),
        mime_type: "image/png".to_owned(),
    }
}

#[derive(Debug)]
struct EditState {
    history: EditorHistory,
    last_text: String,
    last_index: Utf16Index,
    last_selection: TextSelection,
    applied_switch: Option<u64>,
    base: String,
    synced: Option<(u64, u64)>,
    sent: SentTexts,
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
            sent: SentTexts::default(),
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
        pub(super) scroll_retries: Cell<u8>,
        pub(super) vim: RefCell<Option<Vim>>,
        pub(super) inserter: RefCell<Option<InserterHandle>>,
        pub(super) drop_target: OnceCell<gtk::DropTarget>,
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
                    Signal::builder("insert-image-requested").build(),
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
            editor.setup_drop();
            editor.setup_actions();
            editor.setup_context_menu();
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

    pub fn set_note_font(&self, font: NoteFont) {
        self.view().set_note_font(font);
    }

    pub fn set_image_source(&self, source: Option<Rc<dyn ImageSource>>) {
        self.view().set_image_source(source);
    }

    pub fn image_changed(&self, image_id: &str) {
        self.view().image_changed(image_id);
    }

    pub fn set_image_inserter(&self, inserter: Option<Rc<dyn ImageInserter>>) {
        self.imp().inserter.replace(inserter.map(InserterHandle));
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

    /// Runs when Insert Image is chosen, to let the user pick the images.
    pub fn connect_insert_image_requested<F: Fn(&Self) + 'static>(
        &self,
        f: F,
    ) -> glib::SignalHandlerId {
        self.connect_unit_signal("insert-image-requested", f)
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

    /// Handles a key that Vim must not see, sending it to the app's history or moving the caret
    /// onto or across rendered tables, returning whether it did.
    pub fn route_vim_key(&self, keyval: gdk::Key, state: gdk::ModifierType) -> bool {
        if !self.vim_active() {
            return false;
        }
        let (bar, command) = self.vim_status();
        match vim::route_key(keyval, state, &bar, &command) {
            KeyRoute::Undo => self.undo(),
            KeyRoute::Redo => self.redo(),
            KeyRoute::TableMotion { direction, count } => {
                if !self.view().enter_table(direction, count) {
                    return false;
                }
                self.clear_vim_command();
            }
            KeyRoute::TablePage {
                direction,
                half,
                count,
            } => {
                if !self.view().vim_page(direction, half, count) {
                    return false;
                }
                self.clear_vim_command();
            }
            KeyRoute::PassThrough => return false,
        }
        true
    }

    fn clear_vim_command(&self) {
        if let Some(vim) = self.imp().vim.borrow().as_ref() {
            vim.clear_command();
        }
        self.emit_by_name::<()>("vim-changed", &[]);
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

    /// The caret's character offset in the buffer.
    pub fn caret_offset(&self) -> i32 {
        self.view().buffer().cursor_position()
    }

    /// Puts the caret at a character offset, clamped to the text, without scrolling to it.
    pub fn place_caret(&self, offset: i32) {
        let imp = self.imp();
        let buffer = self.view().buffer();
        imp.applying.set(true);
        buffer.place_cursor(&buffer.iter_at_offset(offset.clamp(0, buffer.char_count())));
        imp.applying.set(false);
        {
            let mut state = imp.state.borrow_mut();
            state.last_selection = buffer_selection(&buffer, &state.last_index);
        }
        self.update_open_link_action();
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
            let mut state = imp.state.borrow_mut();
            let echo = state.sent.take_echo(&update.content);
            match state.applied_switch {
                Some(applied) if applied == note_switch => EditorTextSync::decide(
                    note_switch,
                    applied,
                    &update.content,
                    &doc,
                    &state.base,
                    echo,
                ),
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

    /// Places image references by the insertion rule as one undoable step, replacing the
    /// selection `at` resolves to.
    pub fn insert_image_references(&self, references: &[String], at: InsertAt) {
        if !self.is_ready() || references.is_empty() {
            return;
        }
        let (text, selection) = self.current_text_and_selection();
        let selection = target_selection(&at, &text, selection);
        self.apply_command(place_images(&text, selection, references));
    }

    /// Adds the inputs as images and inserts their references, unless another note is shown by
    /// the time they are ready.
    pub fn insert_images(&self, inputs: Vec<ImageInput>, at: InsertAt) {
        if inputs.is_empty() {
            return;
        }
        let (Some(inserter), Some(pending)) = (self.inserter(), self.pending(at)) else {
            return;
        };
        let editor = self.downgrade();
        glib::spawn_future_local(async move {
            let references = inserter.0.insert_images(inputs).await;
            if let Some(editor) = editor.upgrade()
                && editor.still_showing(&pending)
            {
                editor.insert_image_references(&references, pending.at);
            }
        });
    }

    /// Where the selection is now, for a result that arrives later.
    pub fn capture_position(&self) -> InsertAt {
        let (text, selection) = self.current_text_and_selection();
        InsertAt::Captured { text, selection }
    }

    fn inserter(&self) -> Option<InserterHandle> {
        self.imp().inserter.borrow().clone()
    }

    fn pending(&self, at: InsertAt) -> Option<Pending> {
        self.is_ready().then(|| Pending {
            switch: self.imp().state.borrow().applied_switch,
            at,
        })
    }

    fn still_showing(&self, pending: &Pending) -> bool {
        self.is_ready() && self.imp().state.borrow().applied_switch == pending.switch
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
                let clipboard = view.clipboard();
                let Some(paste) = editor.paste_kind(&clipboard.formats()) else {
                    return;
                };
                let Some(pending) = editor.pending(editor.capture_position()) else {
                    return;
                };
                view.stop_signal_emission_by_name("paste-clipboard");
                glib::spawn_future_local(async move {
                    editor.paste(&clipboard, paste, pending).await;
                });
            }
        });
    }

    fn paste_kind(&self, formats: &gdk::ContentFormats) -> Option<Paste> {
        if self.inserter().is_some() {
            if formats.contains_type(gdk::FileList::static_type()) {
                return Some(Paste::Files);
            }
            let text = formats.contains_type(String::static_type());
            if !text && formats.contains_type(gdk::Texture::static_type()) {
                return Some(Paste::Texture);
            }
        }
        formats
            .contains_type(String::static_type())
            .then_some(Paste::Text)
    }

    async fn paste(&self, clipboard: &gdk::Clipboard, paste: Paste, pending: Pending) {
        let inputs = match paste {
            Paste::Files => clipboard
                .read_value_future(gdk::FileList::static_type(), glib::Priority::DEFAULT)
                .await
                .ok()
                .and_then(|value| value.get::<gdk::FileList>().ok())
                .map(|list| file_inputs(&list))
                .unwrap_or_default(),
            Paste::Texture => match clipboard.read_texture_future().await {
                Ok(Some(texture)) => vec![texture_input(&texture)],
                _ => Vec::new(),
            },
            Paste::Text => {
                if let Ok(Some(text)) = clipboard.read_text_future().await {
                    self.paste_text(text.into(), pending).await;
                }
                return;
            }
        };
        if self.still_showing(&pending) {
            self.insert_images(inputs, pending.at);
        }
    }

    async fn paste_text(&self, mut pasted: String, pending: Pending) {
        if pasted.contains(IMAGE_REFERENCE_MARKER)
            && let (Some(inserter), InsertAt::Captured { text, .. }) =
                (self.inserter(), &pending.at)
        {
            pasted = inserter.0.clone_pasted_images(text.clone(), pasted).await;
        }
        if self.still_showing(&pending) {
            self.finish_paste(&pasted, &pending.at);
        }
    }

    fn finish_paste(&self, pasted: &str, at: &InsertAt) {
        if !self.is_ready() {
            return;
        }
        let (text, selection) = self.current_text_and_selection();
        let selection = target_selection(at, &text, selection);
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

    fn setup_drop(&self) {
        let target = gtk::DropTarget::new(glib::Type::INVALID, gdk::DragAction::empty());
        target.set_types(&[gdk::FileList::static_type(), gdk::Texture::static_type()]);
        target.set_propagation_phase(gtk::PropagationPhase::Capture);
        target.connect_drop({
            let editor = self.downgrade();
            move |_, value, x, y| {
                editor
                    .upgrade()
                    .is_some_and(|editor| editor.drop_value(value, x, y))
            }
        });
        self.view().add_controller(target.clone());
        let _ = self.imp().drop_target.set(target);
    }

    /// Inserts dropped image files or an image where they were dropped, in view coordinates.
    fn drop_value(&self, value: &glib::Value, x: f64, y: f64) -> bool {
        if !self.is_ready() || self.inserter().is_none() {
            return false;
        }
        let inputs = if let Ok(list) = value.get::<gdk::FileList>() {
            file_inputs(&list)
        } else if let Ok(texture) = value.get::<gdk::Texture>() {
            vec![texture_input(&texture)]
        } else {
            return false;
        };
        let view = self.view();
        let (bx, by) =
            view.window_to_buffer_coords(gtk::TextWindowType::Widget, x as i32, y as i32);
        if let Some(iter) = view.iter_at_location(bx, by) {
            view.buffer().place_cursor(&iter);
        }
        view.grab_focus();
        self.insert_images(inputs, self.capture_position());
        true
    }

    #[cfg(feature = "testing")]
    pub fn testing_drop(&self, value: &glib::Value, x: f64, y: f64) -> bool {
        self.drop_value(value, x, y)
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
            entry(
                "insert-image",
                Box::new(|editor| editor.emit_by_name::<()>("insert-image-requested", &[])),
            ),
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

    fn setup_context_menu(&self) {
        let section = gio::Menu::new();
        section.append(Some("Open Link"), Some("editor.open-link"));
        let menu = gio::Menu::new();
        menu.append_section(None, &section);
        self.view().set_extra_menu(Some(&menu));
    }

    fn set_action_enabled(&self, name: &str, enabled: bool) {
        if let Some(action) = self
            .imp()
            .actions
            .lookup_action(name)
            .and_downcast::<gio::SimpleAction>()
        {
            action.set_enabled(enabled);
        }
    }

    fn update_open_link_action(&self) {
        let selection = self.imp().state.borrow().last_selection;
        let enabled = self.is_ready()
            && selection.length == 0
            && self.view().link_url_at(selection.location).is_some();
        self.set_action_enabled("open-link", enabled);
    }

    fn update_actions(&self) {
        let ready = self.is_ready();
        let history = [("undo", self.can_undo()), ("redo", self.can_redo())];
        let others = ["toggle-task", "insert-image"]
            .into_iter()
            .chain(FORMAT_ACTIONS.map(|(name, _)| name))
            .map(|name| (name, ready));
        for (name, enabled) in history.into_iter().chain(others) {
            self.set_action_enabled(name, enabled);
        }
        self.update_open_link_action();
        if let Some(target) = self.imp().drop_target.get() {
            target.set_actions(if ready {
                gdk::DragAction::COPY
            } else {
                gdk::DragAction::empty()
            });
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
        self.update_open_link_action();
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
            self.send(&text);
        }
    }

    fn send(&self, text: &str) {
        self.imp().state.borrow_mut().sent.record(text);
        self.emit_by_name::<()>("local-edit", &[&text]);
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
        state.sent.clear();
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
        self.update_open_link_action();
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
        self.send(&text);
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
        self.update_open_link_action();
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
                    if !editor.scroll_to_caret() {
                        let imp = editor.imp();
                        let retries = imp.scroll_retries.get();
                        if retries < CARET_SCROLL_RETRIES {
                            imp.scroll_retries.set(retries + 1);
                            editor.queue_scroll_to_caret();
                            return;
                        }
                    }
                    editor.imp().scroll_retries.set(0);
                }
            }
        });
        handler.set(Some(id));
        self.queue_draw();
    }

    /// Returns whether the caret ended up in view; it is not while the page has yet to grow
    /// to the laid-out text, which clamps the scroll position.
    ///
    /// Until its allocation grows to the laid-out text, the text view scrolls itself to keep
    /// the caret inside it. That offset goes away with the next allocation, so the caret is
    /// placed where the unscrolled text view will show it.
    fn scroll_to_caret(&self) -> bool {
        let Some(scrolled) = self.scroll_window() else {
            return true;
        };
        let view = self.view();
        let buffer = view.buffer();
        let caret = view.iter_location(&buffer.iter_at_mark(&buffer.get_insert()));
        let (x, y) =
            view.buffer_to_window_coords(gtk::TextWindowType::Widget, caret.x(), caret.y());
        let own_offset = view.vadjustment().map_or(0.0, |own| own.value());
        let Some(top) =
            view.compute_point(&scrolled, &gtk::graphene::Point::new(x as f32, y as f32))
        else {
            return true;
        };
        let top = f64::from(top.y()) + own_offset;
        let bottom = top + f64::from(caret.height());
        let adjustment = scrolled.vadjustment();
        let page = adjustment.page_size();
        let before = adjustment.value();
        if top < 0.0 {
            adjustment.set_value(before + top - CARET_SCROLL_MARGIN);
        } else if bottom > page {
            adjustment.set_value(before + bottom - page + CARET_SCROLL_MARGIN);
        }
        let moved = adjustment.value() - before;
        top - moved >= 0.0 && bottom - moved <= page
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
