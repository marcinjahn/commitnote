use gtk4::prelude::*;
use gtk4::{self as gtk, gdk, glib};
use sourceview5::VimIMContext;

const MODIFIERS: gdk::ModifierType = gdk::ModifierType::CONTROL_MASK
    .union(gdk::ModifierType::SHIFT_MASK)
    .union(gdk::ModifierType::ALT_MASK)
    .union(gdk::ModifierType::SUPER_MASK)
    .union(gdk::ModifierType::META_MASK);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyRoute {
    Undo,
    Redo,
    PassThrough,
}

/// Decides whether a key goes to the app's history instead of to Vim.
///
/// The mode comes from the context's `command-bar-text` and `command-text` as GtkSourceView 5.18
/// reports them: normal mode has an empty `command-bar-text`, while insert, replace and visual
/// modes show `-- INSERT --`, `-- REPLACE --`, `-- VISUAL --`, `-- VISUAL LINE --` and
/// `-- VISUAL BLOCK --`, and the command and search lines start with `:` and `/` or `?`.
/// A non-empty `command-text` is a pending command, such as the `r` of `ru`.
pub fn route_key(
    keyval: gdk::Key,
    state: gdk::ModifierType,
    command_bar_text: &str,
    command_text: &str,
) -> KeyRoute {
    if !command_bar_text.is_empty() || !command_text.is_empty() {
        return KeyRoute::PassThrough;
    }
    let modifiers = state & MODIFIERS;
    if keyval == gdk::Key::u && modifiers.is_empty() {
        KeyRoute::Undo
    } else if keyval == gdk::Key::r && modifiers == gdk::ModifierType::CONTROL_MASK {
        KeyRoute::Redo
    } else {
        KeyRoute::PassThrough
    }
}

fn bare(command: &str) -> &str {
    command.trim().trim_start_matches(':').trim()
}

pub fn is_undo_command(command: &str) -> bool {
    matches!(bare(command), "u" | "undo")
}

pub fn is_redo_command(command: &str) -> bool {
    matches!(bare(command), "red" | "redo")
}

/// Vim emulation attached to a text view, for as long as the value lives.
#[derive(Debug)]
pub struct Vim {
    context: VimIMContext,
    controller: gtk::EventControllerKey,
    view: gtk::TextView,
}

impl Vim {
    pub fn attach(view: &gtk::TextView) -> Self {
        let context = VimIMContext::new();
        let controller = gtk::EventControllerKey::new();
        controller.set_propagation_phase(gtk::PropagationPhase::Capture);
        controller.set_im_context(Some(&context));
        view.add_controller(controller.clone());
        context.set_client_widget(Some(view));
        if view.has_focus() {
            context.focus_in();
        }
        Self {
            context,
            controller,
            view: view.clone(),
        }
    }

    pub fn context(&self) -> &VimIMContext {
        &self.context
    }

    pub fn command_bar_text(&self) -> String {
        text_property(&self.context, "command-bar-text")
    }

    pub fn command_text(&self) -> String {
        text_property(&self.context, "command-text")
    }
}

impl Drop for Vim {
    fn drop(&mut self) {
        self.controller.set_im_context(None::<&VimIMContext>);
        self.view.remove_controller(&self.controller);
        self.context.focus_out();
        self.context.set_client_widget(None::<&gtk::Widget>);
        self.view.set_overwrite(false);
    }
}

fn text_property(context: &VimIMContext, name: &str) -> String {
    context
        .property::<Option<glib::GString>>(name)
        .map(Into::into)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONE: gdk::ModifierType = gdk::ModifierType::empty();
    const CTRL: gdk::ModifierType = gdk::ModifierType::CONTROL_MASK;

    #[test]
    fn u_and_ctrl_r_go_to_the_history_in_normal_mode() {
        assert_eq!(route_key(gdk::Key::u, NONE, "", ""), KeyRoute::Undo);
        assert_eq!(route_key(gdk::Key::r, CTRL, "", ""), KeyRoute::Redo);
    }

    #[test]
    fn lock_modifiers_do_not_matter() {
        let locks = gdk::ModifierType::LOCK_MASK | gdk::ModifierType::BUTTON1_MASK;
        assert_eq!(route_key(gdk::Key::u, locks, "", ""), KeyRoute::Undo);
        assert_eq!(route_key(gdk::Key::r, CTRL | locks, "", ""), KeyRoute::Redo);
    }

    #[test]
    fn other_keys_and_modifiers_go_to_vim() {
        let shift = gdk::ModifierType::SHIFT_MASK;
        let alt = gdk::ModifierType::ALT_MASK;
        assert_eq!(route_key(gdk::Key::U, shift, "", ""), KeyRoute::PassThrough);
        assert_eq!(route_key(gdk::Key::u, CTRL, "", ""), KeyRoute::PassThrough);
        assert_eq!(route_key(gdk::Key::u, alt, "", ""), KeyRoute::PassThrough);
        assert_eq!(route_key(gdk::Key::r, NONE, "", ""), KeyRoute::PassThrough);
        assert_eq!(
            route_key(gdk::Key::r, CTRL | shift, "", ""),
            KeyRoute::PassThrough
        );
        assert_eq!(route_key(gdk::Key::z, CTRL, "", ""), KeyRoute::PassThrough);
    }

    #[test]
    fn insert_visual_and_command_lines_keep_their_keys() {
        for bar in [
            "-- INSERT --",
            "-- REPLACE --",
            "-- VISUAL --",
            "-- VISUAL LINE --",
            "-- VISUAL BLOCK --",
            ":und",
            "/u",
        ] {
            assert_eq!(route_key(gdk::Key::u, NONE, bar, ""), KeyRoute::PassThrough);
            assert_eq!(route_key(gdk::Key::r, CTRL, bar, ""), KeyRoute::PassThrough);
        }
    }

    #[test]
    fn pending_commands_keep_their_keys() {
        for pending in ["r", "d", "2", "\"", "g"] {
            assert_eq!(
                route_key(gdk::Key::u, NONE, "", pending),
                KeyRoute::PassThrough
            );
            assert_eq!(
                route_key(gdk::Key::r, CTRL, "", pending),
                KeyRoute::PassThrough
            );
        }
    }

    #[test]
    fn undo_and_redo_commands_are_recognised() {
        assert!(is_undo_command("u"));
        assert!(is_undo_command("undo"));
        assert!(is_undo_command(" undo "));
        assert!(is_undo_command(":undo"));
        assert!(is_redo_command("red"));
        assert!(is_redo_command("redo"));
        assert!(!is_undo_command("undoo"));
        assert!(!is_redo_command("re"));
        assert!(!is_undo_command("w"));
    }
}
