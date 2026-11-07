use commitnote_interaction::{KeyModifiers, TypeToStartContext, TypeToStartInput, should_start};
use gtk4::{self as gtk, gdk, glib, prelude::*};
use libadwaita::prelude::*;

use crate::model::{AppModel, Route};
use crate::window::CommitnoteWindow;

/// Starts a note from a character typed while no note is open, and holds what follows until
/// the draft's editor can take it.
pub fn handle_type_to_start_key(
    model: &AppModel,
    window: &CommitnoteWindow,
    keyval: gdk::Key,
    state: gdk::ModifierType,
    is_repeat: bool,
) -> glib::Propagation {
    let modifiers = key_modifiers(state);
    if model.type_to_start_pending() {
        let held =
            pending_input(keyval, modifiers).is_some_and(|input| model.buffer_type_to_start(input));
        return if held {
            glib::Propagation::Stop
        } else {
            glib::Propagation::Proceed
        };
    }
    let Some(character) = keyval.to_unicode() else {
        return glib::Propagation::Proceed;
    };
    let characters = character.to_string();
    if should_start(&characters, modifiers, is_repeat, &context(model, window)) {
        model.start_type_to_start(&characters);
        glib::Propagation::Stop
    } else {
        glib::Propagation::Proceed
    }
}

fn key_modifiers(state: gdk::ModifierType) -> KeyModifiers {
    KeyModifiers {
        command: state.intersects(gdk::ModifierType::SUPER_MASK | gdk::ModifierType::META_MASK),
        control: state.contains(gdk::ModifierType::CONTROL_MASK),
        option: state.contains(gdk::ModifierType::ALT_MASK),
        shift: state.contains(gdk::ModifierType::SHIFT_MASK),
    }
}

fn pending_input(keyval: gdk::Key, modifiers: KeyModifiers) -> Option<TypeToStartInput> {
    if modifiers.command || modifiers.control || modifiers.option {
        return None;
    }
    match keyval {
        gdk::Key::Return | gdk::Key::KP_Enter | gdk::Key::ISO_Enter => {
            Some(TypeToStartInput::Enter)
        }
        gdk::Key::BackSpace => Some(TypeToStartInput::Backspace),
        _ => keyval
            .to_unicode()
            .filter(|character| !character.is_control())
            .map(|character| TypeToStartInput::Text(character.to_string())),
    }
}

fn context(model: &AppModel, window: &CommitnoteWindow) -> TypeToStartContext {
    TypeToStartContext {
        enabled: model.type_to_start(),
        tree_loaded: model.route() == Route::Notes && model.tree().is_some(),
        editor_open: model.editor_target() != crate::model::EditorTarget::None,
        placeholder_visible: window.notes_placeholder_visible(),
        modal_presented: window.visible_dialog().is_some(),
        search_active: false,
        text_input_focused: text_input_focused(window),
    }
}

fn text_input_focused(window: &CommitnoteWindow) -> bool {
    let mut widget = gtk::prelude::GtkWindowExt::focus(window);
    while let Some(current) = widget {
        if current.is::<gtk::Editable>() || current.is::<gtk::TextView>() {
            return true;
        }
        widget = current.parent();
    }
    false
}
