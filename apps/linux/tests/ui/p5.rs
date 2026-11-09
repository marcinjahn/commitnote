use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;

use adw::prelude::*;
use commitnote::accent;
use commitnote::editor::{MarkdownView, NoteEditor};
use commitnote::file_dialogs;
use commitnote::fonts::NoteFont;
use commitnote::model::{AppModel, EditorTarget, PassphraseStage, Route};
use commitnote::pages::notes::NotesPage;
use commitnote_core_api::commands::AtomicBlockedView;
use commitnote_core_api::events::ImportStatusChanged;
use commitnote_core_api::settings::{
    SettingOptionView, SettingScope, SettingsCopy, SettingsSaveState, SettingsView,
};
use commitnote_core_api::shapes::TreeNode;
use gtk4::{self as gtk, gdk, gio, glib};
use libadwaita as adw;

use crate::flows::{PASSPHRASE, ensure, launch_and_log_in, log_in, wait_tree};
use crate::p2::{
    EDITOR, answer, fail_commits, focus_within, submit_title, tree_notes, type_at_end, wait_draft,
    wait_for_font,
};
use crate::p3::{action_enabled, focus_editor, open_note_at, string_attribute};
use crate::support::{ALL_VARIANTS, Case, Harness, Theme, WIDE_LIGHT, Width, descendants};

pub const CASES: &[Case] = &[
    ("p5-preferences-shortcut", preferences_shortcut),
    ("p5-preferences-menu", preferences_menu),
    ("p5-color-mode", color_mode),
    ("p5-accent", accent),
    ("p5-scope", scope),
    ("p5-note-font", note_font),
    ("p5-vim-mode", vim_mode),
    ("p5-type-to-start", type_to_start),
    ("p5-device-name", device_name),
    ("p5-placement", placement),
    ("p5-remote-change", remote_change),
    ("p5-save-failure", save_failure),
    ("p5-search", search),
    ("p5-log-out-closes", log_out_closes),
    ("p5-preferences-screenshots", preferences_screenshots),
    ("p5-note-font-screenshot", note_font_screenshot),
    ("p5-export-preferences", export_preferences),
    ("p5-export-cancel", export_cancel),
    ("p5-export-failure", export_failure),
    ("p5-export-key-changed", export_key_changed),
    ("p5-export-key-changed-clean", export_key_changed_clean),
    ("p5-import-zip", import_zip),
    ("p5-import-existing", import_existing),
    ("p5-import-conflicts", import_conflicts),
    ("p5-import-cancel", import_cancel),
    ("p5-import-markdown", import_markdown),
    ("p5-import-drop", import_drop),
    ("p5-import-action-disabled", import_action_disabled),
    ("p5-import-atomic-blocked", import_atomic_blocked),
    ("p5-import-atomic-enable", import_atomic_enable),
    ("p5-import-screenshots", import_screenshots),
    ("p5-passphrase-change", passphrase_change),
    ("p5-passphrase-mismatch", passphrase_mismatch),
    ("p5-passphrase-wrong-current", passphrase_wrong_current),
    ("p5-passphrase-cancel-review", passphrase_cancel_review),
    (
        "p5-passphrase-no-close-while-working",
        passphrase_no_close_while_working,
    ),
    (
        "p5-change-passphrase-screenshots",
        change_passphrase_screenshots,
    ),
    ("p5-print-loads", print_loads),
    ("p5-print-dialog", print_dialog),
    ("p5-print-system-font", print_system_font),
    ("p5-print-menu", print_menu),
];

const DIALOG: &str = "preferences-dialog";
const MAIN_MENU: &str = "notes-main-menu-button";
const COLOR_MODE: &str = "settings-color-mode";
const NOTE_FONT: &str = "settings-note-font";
const NEW_NOTE_PLACEMENT: &str = "settings-new-note-placement";
const DEVICE_NAME: &str = "settings-device-name";
const SAVE_STATUS: &str = "settings-save-status";
const RETRY: &str = "settings-retry";
const WELCOME: &[&str] = &["Welcome"];
const LORA: &str = "lora";

fn preferences_enabled(h: &Harness) -> bool {
    h.window()
        .ok()
        .and_then(|window| window.lookup_action("preferences"))
        .is_some_and(|action| action.is_enabled())
}

fn launch_notes(h: &Harness) -> Result<Rc<SettingsCopy>, String> {
    launch_and_log_in(h, false)?;
    let model = h.model()?;
    h.wait("the settings and the Preferences action", || {
        model.settings_view().is_some() && preferences_enabled(h)
    })?;
    model
        .settings_copy()
        .ok_or_else(|| "the settings copy did not load".to_owned())
}

fn view(h: &Harness) -> Result<SettingsView, String> {
    h.model()?
        .settings_view()
        .ok_or_else(|| "the settings view is not loaded".to_owned())
}

fn open_preferences(h: &Harness) -> Result<(), String> {
    h.window_action("preferences")?;
    h.wait_shown(DIALOG)?;
    h.wait_shown(COLOR_MODE)?;
    wait_dialog_focus(h)
}

fn wait_dialog_focus(h: &Harness) -> Result<(), String> {
    let dialog = h.widget_as::<adw::PreferencesDialog>(DIALOG)?;
    h.wait("the focus to be in the dialog", || focus_within(h, &dialog))
}

fn close_preferences(h: &Harness) -> Result<(), String> {
    h.widget_as::<adw::PreferencesDialog>(DIALOG)?.close();
    h.wait("the dialog to close", || !h.shown(DIALOG))
}

fn option_id(
    h: &Harness,
    row: &str,
    options: &[SettingOptionView],
) -> Result<Option<String>, String> {
    let selected = h.widget_as::<adw::ComboRow>(row)?.selected();
    Ok(usize::try_from(selected)
        .ok()
        .and_then(|position| options.get(position))
        .map(|option| option.id.clone()))
}

fn choose(h: &Harness, row: &str, options: &[SettingOptionView], id: &str) -> Result<(), String> {
    let position = options
        .iter()
        .position(|option| option.id == id)
        .and_then(|position| u32::try_from(position).ok())
        .ok_or_else(|| format!("{row} offers no {id} option"))?;
    h.widget_as::<adw::ComboRow>(row)?.set_selected(position);
    Ok(())
}

fn wait_choice(
    h: &Harness,
    row: &str,
    options: &[SettingOptionView],
    id: &str,
    stored: impl Fn(&SettingsView) -> &str,
) -> Result<(), String> {
    h.wait(&format!("{row} to show {id}"), || {
        view(h).is_ok_and(|view| stored(&view) == id)
            && option_id(h, row, options).is_ok_and(|shown| shown.as_deref() == Some(id))
    })
}

fn preferences_shortcut(h: &mut Harness) -> Result<(), String> {
    h.launch()?;
    ensure(!preferences_enabled(h), || {
        "Preferences is enabled before login".to_owned()
    })?;
    h.press_keys("<Control>comma")?;
    ensure(!h.shown(DIALOG), || {
        "Ctrl+comma opened Preferences on the login page".to_owned()
    })?;

    log_in(h, false)?;
    wait_tree(h)?;
    h.wait("the Preferences action", || preferences_enabled(h))?;
    h.press_keys("<Control>comma")?;
    h.wait_shown(DIALOG)?;
    wait_dialog_focus(h)?;
    h.press_keys("Escape")?;
    h.wait("Escape to close the dialog", || !h.shown(DIALOG))
}

fn menu_actions(h: &Harness) -> Result<Vec<Vec<String>>, String> {
    let menu = h
        .widget_as::<gtk::MenuButton>(MAIN_MENU)?
        .menu_model()
        .ok_or("the main menu has no model")?;
    Ok((0..menu.n_items())
        .map(|index| {
            menu.item_link(index, "section")
                .map(|section| {
                    (0..section.n_items())
                        .filter_map(|item| string_attribute(&section, item, "action"))
                        .collect()
                })
                .unwrap_or_default()
        })
        .collect())
}

fn preferences_menu(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    let sections = menu_actions(h)?;
    let own = |action: &str| vec![action.to_owned()];
    ensure(
        sections.windows(3).any(|run| {
            run == [
                own("win.refresh"),
                own("win.preferences"),
                own("win.log-out"),
            ]
        }),
        || {
            format!(
                "Preferences is not in its own section between Refresh and Log Out: {sections:?}"
            )
        },
    )?;

    open_preferences(h)
}

fn color_mode(h: &mut Harness) -> Result<(), String> {
    let copy = launch_notes(h)?;
    let options = &copy.color_mode.options;
    let style = adw::StyleManager::default();
    let system_dark = style.is_dark();
    open_preferences(h)?;

    choose(h, COLOR_MODE, options, "dark")?;
    h.wait("the app to turn dark", || style.is_dark())?;
    wait_choice(h, COLOR_MODE, options, "dark", |view| {
        &view.values.color_mode
    })?;

    choose(h, COLOR_MODE, options, "light")?;
    h.wait("the app to turn light", || !style.is_dark())?;
    wait_choice(h, COLOR_MODE, options, "light", |view| {
        &view.values.color_mode
    })?;

    choose(h, COLOR_MODE, options, "system")?;
    h.wait("the app to follow the system again", || {
        style.is_dark() == system_dark
    })?;
    wait_choice(h, COLOR_MODE, options, "system", |view| {
        &view.values.color_mode
    })
}

struct AccentProbe(gtk::Label);

impl AccentProbe {
    fn new(h: &Harness) -> Result<Self, String> {
        let probe = accent::probe();
        probe.set_parent(&h.widget("notes-tree")?);
        Ok(Self(probe))
    }

    fn color(&self) -> gdk::RGBA {
        accent::color(&self.0)
    }
}

impl Drop for AccentProbe {
    fn drop(&mut self) {
        self.0.unparent();
    }
}

fn swatch_checked(h: &Harness, id: &str) -> bool {
    h.widget_as::<gtk::ToggleButton>(&format!("settings-accent-{id}"))
        .is_ok_and(|swatch| swatch.is_active())
}

fn accent(h: &mut Harness) -> Result<(), String> {
    let copy = launch_notes(h)?;
    let system = copy
        .accent_color
        .options
        .iter()
        .find(|option| option.light.is_none())
        .ok_or("the core offers no system accent")?
        .id
        .clone();
    let colored = copy
        .accent_color
        .options
        .iter()
        .rfind(|option| option.light.is_some())
        .ok_or("the core offers no accent colour")?
        .id
        .clone();
    let probe = AccentProbe::new(h)?;
    let model = h.model()?;
    open_preferences(h)?;
    h.wait("the system swatch to be checked", || {
        swatch_checked(h, &system)
    })?;
    let before = probe.color();

    h.click(&format!("settings-accent-{colored}"))?;
    h.wait("the window to take the accent", || {
        view(h).is_ok_and(|view| view.values.accent_color == colored)
            && model.appearance().accent.is_some()
            && probe.color() != before
    })?;
    ensure(
        swatch_checked(h, &colored) && !swatch_checked(h, &system),
        || format!("the {colored} swatch is not the only checked one"),
    )?;

    h.click(&format!("settings-accent-{system}"))?;
    h.wait("the system accent to return", || {
        view(h).is_ok_and(|view| view.values.accent_color == system)
            && model.appearance().accent.is_none()
            && probe.color() == before
    })?;
    ensure(
        swatch_checked(h, &system) && !swatch_checked(h, &colored),
        || format!("the {system} swatch is not the only checked one"),
    )
}

fn scope(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    open_preferences(h)?;
    let group = h.widget_as::<adw::ToggleGroup>("scope-accentColor")?;
    let accent_scope = || view(h).map(|view| view.scopes.accent_color);
    ensure(
        accent_scope()? == SettingScope::Synced && group.active_name().as_deref() == Some("synced"),
        || "the accent does not start synced".to_owned(),
    )?;
    let others = view(h)?.scopes;

    group.set_active_name(Some("device"));
    h.wait("the accent to move to this device", || {
        accent_scope().is_ok_and(|scope| scope == SettingScope::Device)
    })?;
    ensure(group.active_name().as_deref() == Some("device"), || {
        "the toggle does not show the device scope".to_owned()
    })?;

    group.set_active_name(Some("synced"));
    h.wait("the accent to sync again", || {
        accent_scope().is_ok_and(|scope| scope == SettingScope::Synced)
    })?;
    ensure(view(h)?.scopes == others, || {
        "another setting's scope changed".to_owned()
    })
}

fn open_list_item_has_class(row: &gtk::Widget, label: &str, class: &str) -> bool {
    descendants(row)
        .into_iter()
        .filter_map(|widget| widget.downcast::<gtk::Label>().ok())
        .any(|item| item.label() == label && item.has_css_class(class))
}

fn note_font(h: &mut Harness) -> Result<(), String> {
    let copy = launch_notes(h)?;
    open_note_at(h, WELCOME)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    open_preferences(h)?;

    choose(h, NOTE_FONT, &copy.note_font.options, LORA)?;
    wait_for_font(h, &editor.view(), LORA)?;
    wait_for_font(
        h,
        &h.widget_as::<MarkdownView>("settings-font-preview")?,
        LORA,
    )?;

    let lora = copy
        .note_font
        .options
        .iter()
        .find(|option| option.id == LORA)
        .ok_or("the core offers no Lora font")?;
    h.activate_row(NOTE_FONT)?;
    let row = h.widget(NOTE_FONT)?;
    let class = format!("note-font-{LORA}");
    h.wait("the Lora item to be set in Lora", || {
        open_list_item_has_class(&row, &lora.label, &class)
    })?;
    for popover in descendants(&row)
        .into_iter()
        .filter_map(|widget| widget.downcast::<gtk::Popover>().ok())
    {
        popover.popdown();
    }
    Ok(())
}

fn vim_mode(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    open_note_at(h, WELCOME)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    ensure(!editor.vim_active() && !h.shown("vim-status-line"), || {
        "the editor starts modal".to_owned()
    })?;
    open_preferences(h)?;

    h.set_switch("settings-vim-mode", true)?;
    h.wait("the editor to turn modal", || {
        editor.vim_active() && h.shown("vim-status-line")
    })?;
    close_preferences(h)?;
    focus_editor(h, &editor)?;
    let before = editor.text().chars().count();
    h.type_keys("ix")?;
    h.wait("Vim to take the i as a command", || {
        editor.text().chars().count() == before + 1
    })?;
    h.press_keys("Escape")?;

    open_preferences(h)?;
    h.set_switch("settings-vim-mode", false)?;
    h.wait("the editor to turn normal", || {
        !editor.vim_active() && !h.shown("vim-status-line")
    })?;
    close_preferences(h)?;
    focus_editor(h, &editor)?;
    let before = editor.text().chars().count();
    h.type_keys("iy")?;
    h.wait("both keys to be typed", || {
        editor.text().chars().count() == before + 2
    })
}

fn focus_tree(h: &Harness) -> Result<(), String> {
    let list = h.widget("notes-tree-list")?;
    list.grab_focus();
    h.wait("the tree to take focus", || focus_within(h, &list))
}

fn type_to_start(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    let model = h.model()?;
    ensure(model.editor_target() == EditorTarget::None, || {
        "a note is already open".to_owned()
    })?;
    open_preferences(h)?;
    h.set_switch("settings-type-to-start", false)?;
    h.wait("typing to start to turn off", || !model.type_to_start())?;
    close_preferences(h)?;

    focus_tree(h)?;
    h.type_keys("h")?;
    h.settle()?;
    ensure(
        model.editor_target() == EditorTarget::None && !model.type_to_start_pending(),
        || "typing on the tree started a note with the setting off".to_owned(),
    )?;

    open_preferences(h)?;
    h.set_switch("settings-type-to-start", true)?;
    h.wait("typing to start to turn on", || model.type_to_start())?;
    close_preferences(h)?;
    focus_tree(h)?;
    h.type_keys("h")?;
    wait_draft(h)
}

fn focus_name(h: &Harness, row: &adw::EntryRow) -> Result<(), String> {
    row.grab_focus();
    h.wait("the device name to take focus", || focus_within(h, row))
}

fn enter_name(h: &Harness, row: &adw::EntryRow, text: &str) -> Result<(), String> {
    focus_name(h, row)?;
    h.press_keys("<Control>a")?;
    if text.is_empty() {
        h.press_keys("BackSpace")?;
    } else {
        h.type_keys(text)?;
    }
    h.press_keys("Return")
}

fn device_name(h: &mut Harness) -> Result<(), String> {
    let copy = launch_notes(h)?;
    open_preferences(h)?;
    let row = h.widget_as::<adw::EntryRow>(DEVICE_NAME)?;
    let max_length = usize::try_from(copy.device_name.max_length).map_err(|e| e.to_string())?;
    let automatic: String = view(h)?
        .automatic_device_name
        .chars()
        .take(max_length)
        .collect();

    enter_name(h, &row, "Desk 12")?;
    h.wait("the name to be stored", || {
        view(h).is_ok_and(|view| view.device_name == "Desk 12")
    })?;
    ensure(h.text(DEVICE_NAME)? == "Desk 12", || {
        "the entry lost the stored name".to_owned()
    })?;

    enter_name(h, &row, "")?;
    h.wait("the automatic name to return", || {
        view(h).is_ok_and(|view| view.device_name.is_empty())
    })?;
    h.wait("the entry to show the automatic name", || {
        h.text(DEVICE_NAME).is_ok_and(|text| text == automatic)
    })?;

    let long: String = "abcdefghij".chars().cycle().take(max_length + 8).collect();
    let cut: String = long.chars().take(max_length).collect();
    enter_name(h, &row, &long)?;
    h.wait("the cut name to be stored", || {
        view(h).is_ok_and(|view| view.device_name == cut)
    })?;
    ensure(h.text(DEVICE_NAME)? == cut, || {
        "the entry shows more than the maximum length".to_owned()
    })
}

fn root_position(model: &commitnote::model::AppModel, name: &str) -> Option<(usize, usize)> {
    let tree = model.tree()?;
    let position = tree.iter().position(|node| match node {
        TreeNode::Note { path, .. } => path.len() == 1 && path[0] == name,
        TreeNode::Folder { .. } => false,
    })?;
    Some((position, tree.len()))
}

fn create_note(h: &Harness, name: &str) -> Result<(), String> {
    let model = h.model()?;
    h.window_action("new-note")?;
    wait_draft(h)?;
    submit_title(h, name)?;
    let created = vec![name.to_owned()];
    h.wait("the note to be created", || {
        tree_notes(&model).contains(&created)
            && model.editor_target() == EditorTarget::Note(created.clone())
    })
}

fn placement(h: &mut Harness) -> Result<(), String> {
    let copy = launch_notes(h)?;
    let options = &copy.new_note_placement.options;
    let model = h.model()?;

    for (id, name) in [
        ("end", "Placed at the end"),
        ("beginning", "Placed at the start"),
    ] {
        open_preferences(h)?;
        choose(h, NEW_NOTE_PLACEMENT, options, id)?;
        h.wait("the placement to be stored", || {
            view(h).is_ok_and(|view| view.values.new_note_placement == id)
        })?;
        close_preferences(h)?;
        create_note(h, name)?;
        let (position, count) =
            root_position(&model, name).ok_or_else(|| format!("{name} is not at the top level"))?;
        let expected = if id == "end" { count - 1 } else { 0 };
        ensure(position == expected, || {
            format!("with {id}, the note is at {position} of {count}")
        })?;
    }
    Ok(())
}

fn remote_change(h: &mut Harness) -> Result<(), String> {
    let copy = launch_notes(h)?;
    let model = h.model()?;
    open_preferences(h)?;
    let events = Rc::new(Cell::new(0_u32));
    let handler = model.connect_settings_changed({
        let events = events.clone();
        move |_| events.set(events.get() + 1)
    });

    let outcome = (|| {
        h.change_setting("colorMode", "dark")?;
        wait_choice(h, COLOR_MODE, &copy.color_mode.options, "dark", |view| {
            &view.values.color_mode
        })?;
        let seen = events.get();
        h.settle()?;
        ensure(events.get() == seen, || {
            "showing the remote change sent it back to the core".to_owned()
        })
    })();
    model.disconnect(handler);
    outcome
}

fn save_failure(h: &mut Harness) -> Result<(), String> {
    let copy = launch_notes(h)?;
    let options = &copy.new_note_placement.options;
    let model = h.model()?;
    open_preferences(h)?;
    ensure(!h.shown(RETRY), || {
        "Retry shows while nothing failed".to_owned()
    })?;

    fail_commits(h, true)?;
    let current = view(h)?.values.new_note_placement;
    let other = options
        .iter()
        .find(|option| option.id != current)
        .ok_or("the placement has a single option")?;
    choose(h, NEW_NOTE_PLACEMENT, options, &other.id)?;
    h.wait("the change to be stored", || {
        view(h).is_ok_and(|view| view.values.new_note_placement == other.id)
    })?;
    close_preferences(h)?;

    open_preferences(h)?;
    h.wait("the failed save to show", || {
        model
            .settings_save()
            .is_some_and(|save| save.state == SettingsSaveState::Failed)
            && h.shown(RETRY)
    })?;
    let failed = model
        .settings_save()
        .ok_or("the save status vanished")?
        .label;
    ensure(h.label(SAVE_STATUS)? == failed, || {
        format!(
            "the status shows {:?} for a failed save",
            h.label(SAVE_STATUS)
        )
    })?;

    fail_commits(h, false)?;
    h.click(RETRY)?;
    h.wait("the status to return to synced", || {
        model.settings_save().is_some_and(|save| {
            save.state == SettingsSaveState::Synced
                && h.label(SAVE_STATUS).is_ok_and(|label| label == save.label)
        }) && !h.shown(RETRY)
    })
}

fn search(h: &mut Harness) -> Result<(), String> {
    let copy = launch_notes(h)?;
    open_preferences(h)?;
    let query = copy
        .device_name
        .label
        .split_whitespace()
        .next()
        .ok_or("the device name has no label")?
        .to_lowercase();
    let unrelated = &copy.new_folder_placement.label;
    ensure(!unrelated.to_lowercase().contains(&query), || {
        format!("{unrelated} would match {query}")
    })?;
    ensure(
        h.row_shown(&copy.device_name.label) && h.row_shown(unrelated),
        || "the rows are hidden before searching".to_owned(),
    )?;

    h.press_keys("<Control>f")?;
    h.type_keys(&query)?;
    h.wait("the search to keep only the device name", || {
        h.row_shown(&copy.device_name.label) && !h.row_shown(unrelated)
    })
}

fn log_out_closes(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    open_preferences(h)?;
    h.window_action("log-out")?;
    h.wait("the dialog to close", || !h.shown(DIALOG))?;
    h.wait_page("token")?;
    ensure(h.model()?.settings_copy().is_none(), || {
        "the settings copy outlived the session".to_owned()
    })
}

fn scroll_to_top(h: &Harness) -> Result<(), String> {
    let dialog = h.widget(DIALOG)?;
    for scrolled in descendants(&dialog)
        .into_iter()
        .filter_map(|widget| widget.downcast::<gtk::ScrolledWindow>().ok())
    {
        scrolled.vadjustment().set_value(0.0);
    }
    Ok(())
}

fn preferences_screenshots(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    open_note_at(h, WELCOME)?;
    open_preferences(h)?;
    for &(width, theme) in ALL_VARIANTS {
        h.show_variant(width, theme)?;
        scroll_to_top(h)?;
        h.capture_variant("preferences", width, theme)?;
    }
    Ok(())
}

fn note_font_screenshot(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    open_note_at(h, WELCOME)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    h.change_setting("noteFont", LORA)?;
    wait_for_font(h, &editor.view(), LORA)?;
    h.session_screenshots("note-font", WIDE_LIGHT)
}

const EXPORT_ROW: &str = "settings-export";
const IMPORT_ROW: &str = "settings-import";
const KEY_CHANGED_EXPORT: &str = "key-changed-export";
const IMPORT_DIALOG: &str = "import-dialog";
const IMPORT_TARGET: &str = "import-target";
const IMPORT_FOLDER_NAME: &str = "import-folder-name";
const IMPORT_PREVIEW: &str = "import-preview";
const IMPORT_CONFIRM: &str = "import-confirm";
const IMPORT_RENAME: &str = "import-rename";
const ATOMIC_BLOCKED_DIALOG: &str = "import-atomic-blocked-dialog";
const NEW_FOLDER: &str = "new-folder";
const EXISTING_FOLDER: &str = "existing-folder";
const ZIP_SIGNATURE: &[u8] = b"PK\x03\x04";

fn path(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_owned()).collect()
}

fn files_dir(h: &Harness) -> Result<PathBuf, String> {
    let directory = h.case_dir().join("files");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("cannot create the files directory: {error}"))?;
    Ok(directory)
}

fn write_file(h: &Harness, name: &str, text: &str) -> Result<gio::File, String> {
    let file = files_dir(h)?.join(name);
    std::fs::write(&file, text).map_err(|error| format!("cannot write {name}: {error}"))?;
    Ok(gio::File::for_path(file))
}

/// What the app showed while an export ran, from the signals of one model.
struct ExportWatch {
    model: AppModel,
    handlers: Vec<glib::SignalHandlerId>,
    started: Rc<Cell<u32>>,
    finished: Rc<Cell<u32>>,
    toasts: Rc<RefCell<Vec<String>>>,
    row_titles: Rc<RefCell<Vec<String>>>,
}

impl ExportWatch {
    fn new(model: &AppModel, row: Option<adw::ButtonRow>) -> Self {
        let started = Rc::new(Cell::new(0_u32));
        let finished = Rc::new(Cell::new(0_u32));
        let toasts = Rc::new(RefCell::new(Vec::new()));
        let row_titles = Rc::new(RefCell::new(Vec::new()));
        let changed = model.connect_export_changed({
            let (started, finished, row_titles) =
                (started.clone(), finished.clone(), row_titles.clone());
            move |model| {
                if model.exporting() {
                    started.set(started.get() + 1);
                    if let Some(row) = &row {
                        row_titles.borrow_mut().push(row.title().to_string());
                    }
                } else {
                    finished.set(finished.get() + 1);
                }
            }
        });
        let toast = model.connect_toast({
            let toasts = toasts.clone();
            move |_, message| toasts.borrow_mut().push(message.to_owned())
        });
        Self {
            model: model.clone(),
            handlers: vec![changed, toast],
            started,
            finished,
            toasts,
            row_titles,
        }
    }

    fn wait_finished(&self, h: &Harness) -> Result<(), String> {
        h.wait("the export to finish", || {
            self.started.get() > 0 && self.finished.get() > 0 && !self.model.exporting()
        })
    }
}

impl Drop for ExportWatch {
    fn drop(&mut self) {
        for handler in self.handlers.drain(..) {
            self.model.disconnect(handler);
        }
    }
}

fn row_title(h: &Harness, name: &str) -> Result<String, String> {
    Ok(h.widget_as::<adw::ButtonRow>(name)?.title().to_string())
}

fn button_label(h: &Harness, name: &str) -> Result<String, String> {
    h.widget_as::<gtk::Button>(name)?
        .label()
        .map(|label| label.to_string())
        .ok_or_else(|| format!("{name} has no label"))
}

fn zip_target(h: &Harness) -> Result<(PathBuf, gio::File), String> {
    let path = files_dir(h)?.join("export.zip");
    let file = gio::File::for_path(&path);
    Ok((path, file))
}

fn ensure_zip(path: &std::path::Path) -> Result<(), String> {
    let bytes =
        std::fs::read(path).map_err(|error| format!("the export was not written: {error}"))?;
    ensure(bytes.starts_with(ZIP_SIGNATURE), || {
        "the export is not a zip archive".to_owned()
    })
}

fn export_to_zip(h: &Harness) -> Result<gio::File, String> {
    let (path, file) = zip_target(h)?;
    let model = h.model()?;
    let watch = ExportWatch::new(&model, None);
    file_dialogs::testing_queue_save(file.clone());
    h.window_action("export-notes")?;
    watch.wait_finished(h)?;
    ensure_zip(&path)?;
    Ok(file)
}

fn export_preferences(h: &mut Harness) -> Result<(), String> {
    let copy = launch_notes(h)?;
    let model = h.model()?;
    open_preferences(h)?;
    ensure(row_title(h, EXPORT_ROW)? == copy.data.export_label, || {
        "the export row does not show the export label".to_owned()
    })?;
    let watch = ExportWatch::new(&model, Some(h.widget_as::<adw::ButtonRow>(EXPORT_ROW)?));
    let (path, file) = zip_target(h)?;
    file_dialogs::testing_queue_save(file);

    h.activate_row(EXPORT_ROW)?;
    watch.wait_finished(h)?;
    ensure(
        watch
            .row_titles
            .borrow()
            .iter()
            .any(|title| *title == copy.data.exporting_label),
        || "the row never showed the exporting label".to_owned(),
    )?;
    ensure(row_title(h, EXPORT_ROW)? == copy.data.export_label, || {
        "the row kept the exporting label".to_owned()
    })?;
    ensure(watch.toasts.borrow().is_empty(), || {
        "a successful export showed a toast".to_owned()
    })?;
    ensure_zip(&path)
}

fn export_cancel(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    let model = h.model()?;
    open_preferences(h)?;
    let watch = ExportWatch::new(&model, None);
    let (path, _) = zip_target(h)?;
    file_dialogs::testing_queue_cancel();

    h.activate_row(EXPORT_ROW)?;
    watch.wait_finished(h)?;
    h.settle()?;
    ensure(!path.exists(), || {
        "a cancelled export wrote a file".to_owned()
    })?;
    ensure(watch.toasts.borrow().is_empty(), || {
        "a cancelled export showed a toast".to_owned()
    })?;
    ensure(row_title(h, EXPORT_ROW)? == view_export_label(h)?, || {
        "the row did not return to the export label".to_owned()
    })
}

fn view_export_label(h: &Harness) -> Result<String, String> {
    h.model()?
        .settings_copy()
        .map(|copy| copy.data.export_label.clone())
        .ok_or_else(|| "the settings copy is not loaded".to_owned())
}

fn export_failure(h: &mut Harness) -> Result<(), String> {
    let copy = launch_notes(h)?;
    let model = h.model()?;
    open_preferences(h)?;
    let watch = ExportWatch::new(&model, None);
    let unwritable = files_dir(h)?.join("missing").join("export.zip");
    file_dialogs::testing_queue_save(gio::File::for_path(&unwritable));

    h.activate_row(EXPORT_ROW)?;
    watch.wait_finished(h)?;
    h.wait("the failure toast", || {
        watch.toasts.borrow().contains(&copy.data.export_failed)
    })?;
    ensure(!unwritable.exists(), || {
        "the failed export left a file".to_owned()
    })?;
    ensure(row_title(h, EXPORT_ROW)? == copy.data.export_label, || {
        "the row did not return to the export label".to_owned()
    })
}

fn reach_key_changed(
    h: &Harness,
    unsynced_edit: bool,
) -> Result<commitnote::model::KeyChangedView, String> {
    launch_and_log_in(h, false)?;
    let model = h.model()?;
    if unsynced_edit {
        open_note_at(h, WELCOME)?;
        let editor = h.widget_as::<NoteEditor>(EDITOR)?;
        model.set_online(false);
        type_at_end(h, &editor)?;
    }
    h.window_action("testing-change-passphrase")?;
    model.set_online(true);
    h.refresh_until("the key change to be noticed", || {
        matches!(h.route(), Ok(Route::KeyChanged { .. }))
    })?;
    h.wait_page("key-changed")?;
    model
        .key_changed()
        .ok_or_else(|| "the key-changed view is missing".to_owned())
}

fn export_from_key_changed(h: &Harness, label: &str) -> Result<(), String> {
    h.wait_shown(KEY_CHANGED_EXPORT)?;
    ensure(button_label(h, KEY_CHANGED_EXPORT)? == label, || {
        "the export button does not show the core's label".to_owned()
    })?;
    let (path, file) = zip_target(h)?;
    let model = h.model()?;
    let watch = ExportWatch::new(&model, None);
    file_dialogs::testing_queue_save(file);

    h.click(KEY_CHANGED_EXPORT)?;
    watch.wait_finished(h)?;
    ensure(watch.toasts.borrow().is_empty(), || {
        "the export showed a toast".to_owned()
    })?;
    ensure_zip(&path)
}

fn export_key_changed(h: &mut Harness) -> Result<(), String> {
    let key_changed = reach_key_changed(h, true)?;
    ensure(key_changed.unsaved_count == 1, || {
        format!(
            "{} unsaved notes are reported, not 1",
            key_changed.unsaved_count
        )
    })?;
    ensure(!key_changed.export_label.is_empty(), || {
        "the core offers no export label with unsaved edits".to_owned()
    })?;
    export_from_key_changed(h, &key_changed.export_label)
}

fn export_key_changed_clean(h: &mut Harness) -> Result<(), String> {
    let key_changed = reach_key_changed(h, false)?;
    ensure(key_changed.unsaved_count == 0, || {
        format!("{} unsaved notes are reported", key_changed.unsaved_count)
    })?;
    export_from_key_changed(h, &key_changed.export_label)
}

fn wait_import_form(h: &Harness) -> Result<(), String> {
    let model = h.model()?;
    h.wait_shown(IMPORT_DIALOG)?;
    h.wait("the import preview", || {
        model.import_form().is_some() && model.import_preview().is_some() && h.shown(IMPORT_PREVIEW)
    })?;
    let dialog = h.widget_as::<adw::Dialog>(IMPORT_DIALOG)?;
    h.wait("the focus to be in the import dialog", || {
        focus_within(h, &dialog)
    })
}

fn open_import(h: &Harness, files: Vec<gio::File>) -> Result<(), String> {
    file_dialogs::testing_queue_open(files);
    h.window_action("import-notes")?;
    wait_import_form(h)
}

fn import_zip_dialog(h: &Harness) -> Result<(), String> {
    let zip = export_to_zip(h)?;
    open_import(h, vec![zip])
}

fn wait_dialog_closed(h: &Harness) -> Result<(), String> {
    h.wait("the import dialog to close", || !h.shown(IMPORT_DIALOG))
}

fn choose_existing(h: &Harness) -> Result<(), String> {
    h.widget_as::<adw::ToggleGroup>(IMPORT_TARGET)?
        .set_active_name(Some(EXISTING_FOLDER));
    h.wait("the folder list", || h.shown("import-targets"))
}

fn select_target(h: &Harness, target: &[&str]) -> Result<(), String> {
    let wanted = path(target);
    let form = h.model()?.import_form().ok_or("no import form")?;
    let index = form
        .targets
        .iter()
        .position(|candidate| candidate.path == wanted)
        .ok_or("the form offers no such folder")?;
    let row = h.widget_as::<gtk::ListBoxRow>(&format!("import-target-{index}"))?;
    h.widget_as::<gtk::ListBox>("import-targets")?
        .select_row(Some(&row));
    Ok(())
}

fn import_zip(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    let model = h.model()?;
    open_preferences(h)?;
    let zip = export_to_zip(h)?;
    file_dialogs::testing_queue_open(vec![zip]);
    h.activate_row(IMPORT_ROW)?;
    wait_import_form(h)?;

    let form = model.import_form().ok_or("no import form")?;
    ensure(
        h.widget_as::<adw::ActionRow>("import-file-name")?.title() == form.file_name,
        || "the form does not name the archive".to_owned(),
    )?;
    ensure(!form.empty, || "the archive is reported empty".to_owned())?;
    ensure(
        h.widget_as::<adw::Dialog>(IMPORT_DIALOG)?.title() == form.copy.title,
        || "the form stage has the wrong title".to_owned(),
    )?;
    ensure(
        h.widget_as::<adw::ToggleGroup>(IMPORT_TARGET)?
            .active_name()
            .as_deref()
            == Some(NEW_FOLDER),
        || "the form does not start on a new folder".to_owned(),
    )?;

    let row = h.widget_as::<adw::EntryRow>(IMPORT_FOLDER_NAME)?;
    focus_name(h, &row)?;
    h.press_keys("<Control>a")?;
    h.type_keys("Imported")?;
    h.wait("the folder name", || {
        h.text(IMPORT_FOLDER_NAME)
            .is_ok_and(|text| text == "Imported")
    })?;
    ensure(!h.label(IMPORT_PREVIEW)?.is_empty(), || {
        "the form shows no preview".to_owned()
    })?;

    let expanded = Rc::new(RefCell::new(Vec::<Vec<String>>::new()));
    let handler = model.connect_import_expand({
        let expanded = expanded.clone();
        move |_, path| expanded.borrow_mut().push(path)
    });
    let outcome = (|| {
        h.click(IMPORT_CONFIRM)?;
        wait_dialog_closed(h)?;
        close_preferences(h)?;
        let imported = path(&["Imported", "Welcome"]);
        h.wait("the imported notes", || {
            tree_notes(&model).contains(&imported)
        })?;
        ensure(*expanded.borrow() == [path(&["Imported"])], || {
            "the new folder was not the one to reveal".to_owned()
        })?;
        h.wait("the new folder in the tree", || {
            h.label_shown_with("Imported")
        })
    })();
    model.disconnect(handler);
    outcome
}

fn import_existing(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    let model = h.model()?;
    import_zip_dialog(h)?;

    let before = model.testing_previews_sent();
    choose_existing(h)?;
    select_target(h, &["Projects"])?;
    h.wait("a preview for the chosen folder", || {
        model.testing_previews_sent() > before && h.shown(IMPORT_PREVIEW)
    })?;
    ensure(!h.label(IMPORT_PREVIEW)?.is_empty(), || {
        "the preview is empty after choosing a folder".to_owned()
    })?;

    h.click(IMPORT_CONFIRM)?;
    wait_dialog_closed(h)?;
    let imported = path(&["Projects", "Welcome"]);
    h.wait("the imported notes", || {
        tree_notes(&model).contains(&imported)
    })
}

fn import_conflicts(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    let model = h.model()?;
    import_zip_dialog(h)?;
    let form = model.import_form().ok_or("no import form")?;
    let notes_before = tree_notes(&model).len();

    choose_existing(h)?;
    h.click(IMPORT_CONFIRM)?;
    h.wait("the conflicts stage", || {
        model.import_offers_rename() && h.shown(IMPORT_RENAME)
    })?;
    ensure(
        h.widget_as::<adw::Dialog>(IMPORT_DIALOG)?.title() == form.copy.conflicts_title,
        || "the conflicts stage has the wrong title".to_owned(),
    )?;
    ensure(!h.shown(IMPORT_CONFIRM), || {
        "the conflicts stage still offers the plain import".to_owned()
    })?;
    ensure(tree_notes(&model).len() == notes_before, || {
        "a conflicting import changed the tree".to_owned()
    })?;

    h.click(IMPORT_RENAME)?;
    wait_dialog_closed(h)?;
    h.wait("the renamed notes", || {
        tree_notes(&model).len() > notes_before
    })
}

fn import_cancel(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    let model = h.model()?;
    import_zip_dialog(h)?;
    let notes = tree_notes(&model);

    h.press_keys("Escape")?;
    wait_dialog_closed(h)?;
    h.wait("the import to be dropped", || {
        model.import_form().is_none() && !model.is_importing()
    })?;
    ensure(tree_notes(&model) == notes, || {
        "cancelling the import changed the tree".to_owned()
    })?;
    ensure(
        h.window()?
            .lookup_action("import-notes")
            .is_some_and(|action| action.is_enabled()),
        || "Import is disabled after cancelling".to_owned(),
    )
}

fn import_markdown(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    let model = h.model()?;
    let files = vec![
        write_file(h, "Alpha import.md", "# Alpha import\n\nfirst\n")?,
        write_file(h, "Beta import.md", "# Beta import\n\nsecond\n")?,
    ];
    file_dialogs::testing_queue_open(files);
    h.window_action("import-notes")?;

    let expected = [path(&["Alpha import"]), path(&["Beta import"])];
    h.wait("both notes to be imported", || {
        let notes = tree_notes(&model);
        expected.iter().all(|note| notes.contains(note))
    })?;
    ensure(
        !h.shown(IMPORT_DIALOG) && model.import_form().is_none(),
        || "importing Markdown files opened the form".to_owned(),
    )
}

fn import_drop(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    let model = h.model()?;
    let file = write_file(h, "Dropped note.md", "# Dropped note\n\ntext\n")?;
    let notes = h
        .page("notes")?
        .downcast::<NotesPage>()
        .map_err(|_| "the notes page has an unexpected type")?;

    ensure(
        notes.testing_drop_files(&[file], Some(&["Projects".to_owned()])),
        || "the tree refused the drop on a folder".to_owned(),
    )?;
    let dropped = path(&["Projects", "Dropped note"]);
    h.wait("the dropped note", || tree_notes(&model).contains(&dropped))?;
    ensure(!h.shown(IMPORT_DIALOG), || {
        "a dropped Markdown file opened the form".to_owned()
    })
}

fn import_enabled(h: &Harness) -> bool {
    h.window()
        .ok()
        .and_then(|window| window.lookup_action("import-notes"))
        .is_some_and(|action| action.is_enabled())
}

fn import_action_disabled(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    let model = h.model()?;
    h.wait("Import to be enabled", || import_enabled(h))?;

    model.testing_import_status(ImportStatusChanged {
        importing: true,
        atomic_blocked: None,
    });
    h.wait("Import to be disabled while importing", || {
        model.is_importing() && !import_enabled(h)
    })?;
    model.testing_import_status(ImportStatusChanged {
        importing: false,
        atomic_blocked: None,
    });
    h.wait("Import to be enabled again", || import_enabled(h))
}

fn atomic_blocked_view() -> AtomicBlockedView {
    AtomicBlockedView {
        title: "Blocked".to_owned(),
        message: "The branch needs atomic commits.".to_owned(),
        enable_label: "Enable".to_owned(),
        save_without_label: "Save Without".to_owned(),
        can_configure: true,
    }
}

fn answer_atomic_blocked(
    h: &Harness,
    label: impl Fn(&AtomicBlockedView) -> &str,
) -> Result<(), String> {
    let model = h.model()?;
    let blocked = atomic_blocked_view();
    model.testing_import_status(ImportStatusChanged {
        importing: true,
        atomic_blocked: Some(blocked.clone()),
    });
    h.wait_shown(ATOMIC_BLOCKED_DIALOG)?;
    let dialog = h.widget_as::<adw::AlertDialog>(ATOMIC_BLOCKED_DIALOG)?;
    ensure(
        dialog.heading().as_deref() == Some(blocked.title.as_str()),
        || "the alert does not show the title".to_owned(),
    )?;

    dialog.close();
    h.settle()?;
    ensure(
        h.shown(ATOMIC_BLOCKED_DIALOG) && model.import_atomic_blocked().is_some(),
        || "the alert was dismissed without an answer".to_owned(),
    )?;

    answer(h, ATOMIC_BLOCKED_DIALOG, label(&blocked))?;
    h.wait("the alert to close", || !h.shown(ATOMIC_BLOCKED_DIALOG))?;
    h.wait("the blocked state to clear", || {
        model.import_atomic_blocked().is_none()
    })
}

fn import_atomic_blocked(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    answer_atomic_blocked(h, |blocked| &blocked.save_without_label)
}

fn import_atomic_enable(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    answer_atomic_blocked(h, |blocked| &blocked.enable_label)
}

fn import_screenshots(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    open_note_at(h, WELCOME)?;
    import_zip_dialog(h)?;
    for &(width, theme) in ALL_VARIANTS {
        h.show_variant(width, theme)?;
        h.capture_variant("import", width, theme)?;
    }

    choose_existing(h)?;
    h.click(IMPORT_CONFIRM)?;
    h.wait("the conflicts stage", || {
        h.model().is_ok_and(|model| model.import_offers_rename()) && h.shown(IMPORT_RENAME)
    })?;
    h.show_variant(Width::Wide, Theme::Light)?;
    h.capture_variant("import-conflicts", Width::Wide, Theme::Light)
}

const CHANGE_PASSPHRASE_ROW: &str = "settings-change-passphrase";
const PASSPHRASE_DIALOG: &str = "change-passphrase-dialog";
const PASSPHRASE_CURRENT: &str = "passphrase-current";
const PASSPHRASE_NEW: &str = "passphrase-new";
const PASSPHRASE_REPEAT: &str = "passphrase-repeat";
const PASSPHRASE_STRENGTH: &str = "passphrase-strength";
const PASSPHRASE_ERROR: &str = "passphrase-error";
const PASSPHRASE_CONTINUE: &str = "passphrase-continue";
const PASSPHRASE_CONFIRM: &str = "passphrase-confirm";
const PASSPHRASE_CANCEL: &str = "passphrase-cancel";
const NEW_PASSPHRASE: &str = "violet harbour lantern seventeen";
const OTHER_PASSPHRASE: &str = "copper meadow whistle ninety";

fn change_passphrase_enabled(h: &Harness) -> bool {
    h.window()
        .ok()
        .and_then(|window| window.lookup_action("change-passphrase"))
        .is_some_and(|action| action.is_enabled())
}

fn start_passphrase_change(h: &Harness) -> Result<adw::Dialog, String> {
    h.wait("the Change Passphrase action", || {
        change_passphrase_enabled(h)
    })?;
    h.activate_row(CHANGE_PASSPHRASE_ROW)?;
    h.wait_shown(PASSPHRASE_CURRENT)?;
    let current = h.widget(PASSPHRASE_CURRENT)?;
    h.wait("the focus in the current passphrase", || {
        focus_within(h, &current)
    })?;
    h.widget_as::<adw::Dialog>(PASSPHRASE_DIALOG)
}

fn open_passphrase_change(h: &Harness) -> Result<adw::Dialog, String> {
    launch_notes(h)?;
    open_preferences(h)?;
    start_passphrase_change(h)
}

fn type_passphrase(h: &Harness, name: &str, text: &str) -> Result<(), String> {
    h.wait_shown(name)?;
    let entry = h.widget(name)?;
    entry.grab_focus();
    h.wait(&format!("the focus in {name}"), || focus_within(h, &entry))?;
    h.type_keys(text)?;
    h.wait(&format!("{name} to hold the typed passphrase"), || {
        h.text(name).is_ok_and(|typed| typed == text)
    })
}

fn strength_label(h: &Harness) -> Result<String, String> {
    let meter = h.widget(PASSPHRASE_STRENGTH)?;
    Ok(h.widget_in(&meter, "strength-label")?
        .downcast::<gtk::Label>()
        .map_err(|_| "the strength label is not a label".to_owned())?
        .label()
        .to_string())
}

fn wait_strength(h: &Harness) -> Result<String, String> {
    h.wait("the strength meter", || {
        h.shown(PASSPHRASE_STRENGTH) && strength_label(h).is_ok_and(|label| !label.is_empty())
    })?;
    strength_label(h)
}

fn fill_passphrases(h: &Harness, current: &str, next: &str, repeated: &str) -> Result<(), String> {
    type_passphrase(h, PASSPHRASE_CURRENT, current)?;
    ensure(!h.shown(PASSPHRASE_STRENGTH), || {
        "the strength meter shows before a new passphrase is typed".to_owned()
    })?;
    type_passphrase(h, PASSPHRASE_NEW, next)?;
    wait_strength(h)?;
    type_passphrase(h, PASSPHRASE_REPEAT, repeated)
}

fn passphrase_stage(h: &Harness) -> Result<Option<PassphraseStage>, String> {
    Ok(h.model()?.passphrase_change().map(|change| change.stage))
}

fn wait_review(h: &Harness) -> Result<(), String> {
    h.wait("the review stage", || {
        h.shown(PASSPHRASE_CONFIRM)
            && matches!(
                passphrase_stage(h),
                Ok(Some(PassphraseStage::Review { .. }))
            )
    })?;
    ensure(!h.label("passphrase-review-summary")?.is_empty(), || {
        "the review shows no summary".to_owned()
    })
}

fn reach_review(h: &Harness, current: &str) -> Result<(), String> {
    fill_passphrases(h, current, OTHER_PASSPHRASE, OTHER_PASSPHRASE)?;
    h.click(PASSPHRASE_CONTINUE)?;
    wait_review(h)
}

fn wait_passphrase_closed(h: &Harness) -> Result<(), String> {
    let model = h.model()?;
    h.wait("the Change Passphrase dialog to close", || {
        !h.shown(PASSPHRASE_DIALOG) && model.passphrase_change().is_none()
    })
}

fn wait_form_error(h: &Harness) -> Result<String, String> {
    h.wait("the form error", || {
        h.shown(PASSPHRASE_ERROR)
            && h.label(PASSPHRASE_ERROR)
                .is_ok_and(|error| !error.is_empty())
    })?;
    ensure(
        matches!(passphrase_stage(h)?, Some(PassphraseStage::Form))
            && h.shown(PASSPHRASE_CONTINUE)
            && !h.shown(PASSPHRASE_CONFIRM),
        || "the dialog left the form".to_owned(),
    )?;
    h.label(PASSPHRASE_ERROR)
}

fn wait_current_cleared(h: &Harness) -> Result<(), String> {
    let current = h.widget(PASSPHRASE_CURRENT)?;
    h.wait("the current passphrase to be emptied and focused", || {
        h.text(PASSPHRASE_CURRENT).is_ok_and(|text| text.is_empty()) && focus_within(h, &current)
    })?;
    wait_form_error(h).map(|_| ())
}

fn passphrase_change(h: &mut Harness) -> Result<(), String> {
    open_passphrase_change(h)?;
    type_passphrase(h, PASSPHRASE_CURRENT, PASSPHRASE)?;
    let (start, rest) = NEW_PASSPHRASE.split_at(3);
    type_passphrase(h, PASSPHRASE_NEW, start)?;
    let short = wait_strength(h)?;
    h.type_keys(rest)?;
    h.wait("the strength meter to rate the whole passphrase", || {
        h.text(PASSPHRASE_NEW)
            .is_ok_and(|text| text == NEW_PASSPHRASE)
            && strength_label(h).is_ok_and(|label| !label.is_empty() && label != short)
    })?;
    type_passphrase(h, PASSPHRASE_REPEAT, NEW_PASSPHRASE)?;
    h.click(PASSPHRASE_CONTINUE)?;
    wait_review(h)?;
    h.click(PASSPHRASE_CONFIRM)?;
    wait_passphrase_closed(h)?;
    ensure(h.shown(DIALOG), || {
        "Preferences closed with the passphrase dialog".to_owned()
    })?;

    start_passphrase_change(h)?;
    fill_passphrases(h, PASSPHRASE, OTHER_PASSPHRASE, OTHER_PASSPHRASE)?;
    h.type_keys("\n")?;
    wait_current_cleared(h)?;
    type_passphrase(h, PASSPHRASE_CURRENT, NEW_PASSPHRASE)?;
    h.click(PASSPHRASE_CONTINUE)?;
    wait_review(h)?;
    h.click(PASSPHRASE_CANCEL)?;
    h.wait("the form", || h.shown(PASSPHRASE_CONTINUE))?;
    h.widget_as::<adw::Dialog>(PASSPHRASE_DIALOG)?.close();
    wait_passphrase_closed(h)
}

fn passphrase_mismatch(h: &mut Harness) -> Result<(), String> {
    open_passphrase_change(h)?;
    fill_passphrases(h, PASSPHRASE, NEW_PASSPHRASE, OTHER_PASSPHRASE)?;
    h.type_keys("\n")?;
    wait_form_error(h)?;
    ensure(
        h.text(PASSPHRASE_CURRENT)? == PASSPHRASE && h.text(PASSPHRASE_NEW)? == NEW_PASSPHRASE,
        || "a mismatched repeat emptied the other entries".to_owned(),
    )
}

fn passphrase_wrong_current(h: &mut Harness) -> Result<(), String> {
    open_passphrase_change(h)?;
    fill_passphrases(
        h,
        "not the repository passphrase",
        NEW_PASSPHRASE,
        NEW_PASSPHRASE,
    )?;
    h.click(PASSPHRASE_CONTINUE)?;
    wait_current_cleared(h)?;
    ensure(h.text(PASSPHRASE_NEW)? == NEW_PASSPHRASE, || {
        "a wrong current passphrase emptied the new one".to_owned()
    })
}

fn passphrase_cancel_review(h: &mut Harness) -> Result<(), String> {
    let dialog = open_passphrase_change(h)?;
    reach_review(h, PASSPHRASE)?;
    h.click(PASSPHRASE_CANCEL)?;
    h.wait("the form after cancelling the review", || {
        h.shown(PASSPHRASE_CONTINUE)
            && !h.shown(PASSPHRASE_CONFIRM)
            && matches!(passphrase_stage(h), Ok(Some(PassphraseStage::Form)))
    })?;
    h.wait("the focus to stay in the dialog", || {
        focus_within(h, &dialog)
    })?;
    h.press_keys("Escape")?;
    wait_passphrase_closed(h)
}

/// Activates the shortcut for `accelerator` on the focused widget or the nearest ancestor that
/// handles it, as a key press bubbling up from the focus would, without leaving the main loop.
fn press_at_focus(h: &Harness, accelerator: &str) -> Result<(), String> {
    let mut widget = GtkWindowExt::focus(&h.window()?);
    while let Some(current) = widget {
        if h.press_shortcut(&current, accelerator).is_ok() {
            return Ok(());
        }
        widget = current.parent();
    }
    Err(format!("nothing around the focus handles {accelerator}"))
}

fn passphrase_no_close_while_working(h: &mut Harness) -> Result<(), String> {
    let dialog = open_passphrase_change(h)?;
    let model = h.model()?;
    fill_passphrases(h, PASSPHRASE, NEW_PASSPHRASE, NEW_PASSPHRASE)?;
    let attempts = Rc::new(Cell::new(0_u32));
    let closed = Rc::new(Cell::new(false));
    dialog.connect_close_attempt({
        let attempts = attempts.clone();
        move |_| attempts.set(attempts.get() + 1)
    });
    dialog.connect_closed({
        let closed = closed.clone();
        move |_| closed.set(true)
    });

    h.click(PASSPHRASE_CONTINUE)?;
    h.wait("the working stage", || {
        model
            .passphrase_change()
            .is_some_and(|change| change.is_working())
    })?;
    let change = model
        .passphrase_change()
        .ok_or("the change ended while working")?;
    ensure(!change.can_close() && !dialog.can_close(), || {
        "the dialog can close while working".to_owned()
    })?;
    press_at_focus(h, "Escape")?;
    ensure(attempts.get() == 1, || {
        "Escape did not try to close the dialog".to_owned()
    })?;

    wait_review(h)?;
    ensure(!closed.get() && h.shown(PASSPHRASE_DIALOG), || {
        "Escape closed the dialog while working".to_owned()
    })?;
    ensure(dialog.can_close(), || {
        "the review cannot be closed".to_owned()
    })
}

fn change_passphrase_screenshots(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    open_note_at(h, WELCOME)?;
    open_preferences(h)?;
    start_passphrase_change(h)?;
    fill_passphrases(h, PASSPHRASE, NEW_PASSPHRASE, NEW_PASSPHRASE)?;
    let repeat = h
        .widget(PASSPHRASE_REPEAT)?
        .dynamic_cast::<gtk::Editable>()
        .map_err(|_| "the repeat entry is not editable".to_owned())?;
    for &(width, theme) in ALL_VARIANTS {
        h.show_variant(width, theme)?;
        repeat.set_position(-1);
        h.capture_variant("change-passphrase", width, theme)?;
    }
    Ok(())
}

const WHITEBOARD: &[&str] = &["Journal", "2026", "Whiteboard"];
const PRINT_NOTE: &str = "notes.print-note";

/// Collects the toasts shown while it lives.
struct ToastWatch {
    model: AppModel,
    handler: Option<glib::SignalHandlerId>,
    toasts: Rc<RefCell<Vec<String>>>,
}

impl ToastWatch {
    fn new(model: &AppModel) -> Self {
        let toasts = Rc::new(RefCell::new(Vec::new()));
        let handler = model.connect_toast({
            let toasts = toasts.clone();
            move |_, message| toasts.borrow_mut().push(message.to_owned())
        });
        Self {
            model: model.clone(),
            handler: Some(handler),
            toasts,
        }
    }

    fn toasts(&self) -> Vec<String> {
        self.toasts.borrow().clone()
    }
}

impl Drop for ToastWatch {
    fn drop(&mut self) {
        if let Some(handler) = self.handler.take() {
            self.model.disconnect(handler);
        }
    }
}

fn print_note(h: &Harness) -> Result<(), String> {
    WidgetExt::activate_action(&h.widget("notes-tree")?, PRINT_NOTE, None)
        .map_err(|error| format!("cannot activate {PRINT_NOTE}: {error}"))
}

fn open_print_dialog(h: &Harness) -> Option<gtk::Window> {
    let main = h.window().ok()?;
    gtk::Window::list_toplevels()
        .into_iter()
        .filter_map(|widget| widget.downcast::<gtk::Window>().ok())
        .find(|window| window != main.upcast_ref::<gtk::Window>() && window.is_visible())
}

fn wait_print_dialog(h: &Harness) -> Result<gtk::Window, String> {
    let mut dialog = None;
    h.wait("the print dialog to open", || {
        dialog = open_print_dialog(h);
        dialog.is_some()
    })?;
    dialog.ok_or_else(|| "no print dialog opened".to_owned())
}

/// The document the open print dialog prints; the dialog opens only once it has loaded.
fn printed_document(name: &str) -> Result<String, String> {
    let title = format!("<title>{name}</title>");
    commitnote::print::testing_last_document()
        .filter(|document| commitnote::print::testing_load_finished() && document.contains(&title))
        .ok_or_else(|| format!("the print dialog opened without a loaded {name} document"))
}

fn close_print_dialog(h: &Harness, dialog: &gtk::Window) -> Result<(), String> {
    dialog.close();
    h.wait("the print dialog to close and printing to end", || {
        open_print_dialog(h).is_none() && action_enabled(h, PRINT_NOTE).unwrap_or(false)
    })
}

fn print_loads(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    let model = h.model()?;
    h.change_setting("noteFont", LORA)?;
    h.wait("the Lora note font", || model.note_font() == NoteFont::Lora)?;
    open_note_at(h, WHITEBOARD)?;
    h.wait("printing to be enabled", || {
        action_enabled(h, PRINT_NOTE).unwrap_or(false)
    })?;
    let toasts = ToastWatch::new(&model);

    print_note(h)?;
    let dialog = wait_print_dialog(h)?;
    let document = printed_document("Whiteboard")?;

    ensure(
        document.contains(
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; \
             img-src data:; font-src data:; style-src 'unsafe-inline'\">",
        ),
        || "the print document has no content security policy".to_owned(),
    )?;
    ensure(
        document.contains("@font-face{font-family:\"commitnote-note\""),
        || "the print document embeds no note font face".to_owned(),
    )?;
    ensure(document.contains("data:image/"), || {
        "the print document holds no inline image".to_owned()
    })?;
    close_print_dialog(h, &dialog)?;
    ensure(toasts.toasts().is_empty(), || {
        format!("closing the print dialog showed {:?}", toasts.toasts())
    })
}

fn print_dialog(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    let model = h.model()?;
    open_note_at(h, WELCOME)?;
    let editor = h.widget_as::<NoteEditor>(EDITOR)?;
    focus_editor(h, &editor)?;
    h.wait("printing to be enabled", || {
        action_enabled(h, PRINT_NOTE).unwrap_or(false)
    })?;
    let toasts = ToastWatch::new(&model);

    h.press_keys("<Control>p")?;
    let dialog = wait_print_dialog(h)?;
    ensure(!action_enabled(h, PRINT_NOTE)?, || {
        "printing stays enabled while the print dialog is open".to_owned()
    })?;
    h.press_keys_in(&dialog, "Escape")?;

    h.wait("the print dialog to close and printing to end", || {
        open_print_dialog(h).is_none() && action_enabled(h, PRINT_NOTE).unwrap_or(false)
    })?;
    h.settle()?;
    ensure(toasts.toasts().is_empty(), || {
        format!("cancelling the print dialog showed {:?}", toasts.toasts())
    })
}

fn print_system_font(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    let model = h.model()?;
    h.change_setting("noteFont", "system")?;
    h.wait("the system note font", || {
        model.note_font() == NoteFont::System
    })?;
    open_note_at(h, WELCOME)?;
    h.wait("printing to be enabled", || {
        action_enabled(h, PRINT_NOTE).unwrap_or(false)
    })?;

    print_note(h)?;
    let dialog = wait_print_dialog(h)?;
    let document = printed_document("Welcome")?;

    ensure(!document.contains("@font-face"), || {
        "the system font print document embeds a font face".to_owned()
    })?;
    close_print_dialog(h, &dialog)
}

fn print_menu(h: &mut Harness) -> Result<(), String> {
    launch_notes(h)?;
    ensure(!action_enabled(h, PRINT_NOTE)?, || {
        "printing is enabled with no note open".to_owned()
    })?;
    open_note_at(h, WELCOME)?;
    h.wait_shown("note-menu-button")?;
    h.wait("printing to be enabled", || {
        action_enabled(h, PRINT_NOTE).unwrap_or(false)
    })?;

    let menu = h
        .widget_as::<gtk::MenuButton>("note-menu-button")?
        .menu_model()
        .ok_or("the note menu has no model")?;
    let sections: Vec<Vec<(String, String)>> = (0..menu.n_items())
        .filter_map(|index| menu.item_link(index, "section"))
        .map(|section| {
            (0..section.n_items())
                .map(|item| {
                    (
                        string_attribute(&section, item, "label").unwrap_or_default(),
                        string_attribute(&section, item, "action").unwrap_or_default(),
                    )
                })
                .collect()
        })
        .collect();
    let actions = |section: &[(String, String)]| -> Vec<String> {
        section.iter().map(|(_, action)| action.clone()).collect()
    };
    let share = sections
        .iter()
        .find(|section| actions(section).contains(&"notes.share-note".to_owned()))
        .ok_or_else(|| format!("the note menu has no Share section: {sections:?}"))?;
    ensure(
        actions(share) == ["notes.share-note", "notes.show-history", PRINT_NOTE],
        || format!("the Share section holds {share:?}"),
    )?;
    ensure(share[2].0 == "Print…", || {
        format!("the print item is labelled {:?}", share[2].0)
    })
}
