use std::cell::Cell;
use std::rc::Rc;

use commitnote_markdown::VerticalDirection;
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
    /// `gj` or `gk`, `count` lines down or up, which GtkSourceView 5.18 does not move for.
    TableMotion {
        direction: VerticalDirection,
        count: usize,
    },
    /// `<C-f>` and `<C-b>`, or with `half` `<C-d>` and `<C-u>`, `count` pages down or up.
    TablePage {
        direction: VerticalDirection,
        half: bool,
        count: usize,
    },
    PassThrough,
}

/// Decides whether a key goes to the app's history instead of to Vim.
///
/// The mode comes from the context's `command-bar-text` and `command-text` as GtkSourceView 5.18
/// reports them: normal mode has an empty `command-bar-text`, while insert, replace and visual
/// modes show `-- INSERT --`, `-- REPLACE --`, `-- VISUAL --`, `-- VISUAL LINE --` and
/// `-- VISUAL BLOCK --`, and the command and search lines start with `:` and `/` or `?`.
/// A non-empty `command-text` is a pending command, such as the `r` of `ru`, a count such as `3`,
/// or a count and a prefix such as `3g`.
pub fn route_key(
    keyval: gdk::Key,
    state: gdk::ModifierType,
    command_bar_text: &str,
    command_text: &str,
) -> KeyRoute {
    if !command_bar_text.is_empty() {
        return KeyRoute::PassThrough;
    }
    let modifiers = state & MODIFIERS;
    if let Some(route) = table_route(keyval, modifiers, command_text) {
        return route;
    }
    if !command_text.is_empty() {
        return KeyRoute::PassThrough;
    }
    if keyval == gdk::Key::u && modifiers.is_empty() {
        KeyRoute::Undo
    } else if keyval == gdk::Key::r && modifiers == gdk::ModifierType::CONTROL_MASK {
        KeyRoute::Redo
    } else {
        KeyRoute::PassThrough
    }
}

fn table_route(keyval: gdk::Key, modifiers: gdk::ModifierType, pending: &str) -> Option<KeyRoute> {
    if modifiers.is_empty() {
        let direction = match keyval {
            gdk::Key::j => VerticalDirection::Down,
            gdk::Key::k => VerticalDirection::Up,
            _ => return None,
        };
        let count = pending_count(pending.strip_suffix('g')?)?;
        Some(KeyRoute::TableMotion { direction, count })
    } else if modifiers == gdk::ModifierType::CONTROL_MASK {
        let (direction, half) = match keyval {
            gdk::Key::f => (VerticalDirection::Down, false),
            gdk::Key::b => (VerticalDirection::Up, false),
            gdk::Key::d => (VerticalDirection::Down, true),
            gdk::Key::u => (VerticalDirection::Up, true),
            _ => return None,
        };
        let count = pending_count(pending)?;
        Some(KeyRoute::TablePage {
            direction,
            half,
            count,
        })
    } else {
        None
    }
}

/// The count a pending command made of nothing but a count holds, or 1 when nothing is pending.
fn pending_count(pending: &str) -> Option<usize> {
    if pending.is_empty() {
        return Some(1);
    }
    if pending.starts_with('0') || !pending.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    pending.parse().ok()
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
    /// Whether the pending command was cleared since Vim last handled a key: GtkSourceView 5.18
    /// rebuilds `command-text` only when it handles one, so until then it still shows the cleared
    /// command.
    cleared: Rc<Cell<bool>>,
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
        let cleared = Rc::new(Cell::new(false));
        context.connect_notify_local(Some("command-text"), {
            let cleared = cleared.clone();
            move |_, _| cleared.set(false)
        });
        Self {
            context,
            controller,
            view: view.clone(),
            cleared,
        }
    }

    pub fn context(&self) -> &VimIMContext {
        &self.context
    }

    pub fn command_bar_text(&self) -> String {
        text_property(&self.context, "command-bar-text")
    }

    pub fn command_text(&self) -> String {
        if self.cleared.get() {
            return String::new();
        }
        text_property(&self.context, "command-text")
    }

    /// Drops the pending command, such as a count, and goes back to normal mode.
    pub fn clear_command(&self) {
        self.context.reset();
        self.cleared.set(true);
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
        assert_eq!(route_key(gdk::Key::u, alt, "", ""), KeyRoute::PassThrough);
        assert_eq!(
            route_key(gdk::Key::u, CTRL | alt, "", ""),
            KeyRoute::PassThrough
        );
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

    const DOWN: VerticalDirection = VerticalDirection::Down;
    const UP: VerticalDirection = VerticalDirection::Up;

    fn motion(direction: VerticalDirection, count: usize) -> KeyRoute {
        KeyRoute::TableMotion { direction, count }
    }

    fn page(direction: VerticalDirection, half: bool, count: usize) -> KeyRoute {
        KeyRoute::TablePage {
            direction,
            half,
            count,
        }
    }

    #[test]
    fn gj_and_gk_are_table_motions_with_their_count() {
        assert_eq!(route_key(gdk::Key::j, NONE, "", "g"), motion(DOWN, 1));
        assert_eq!(route_key(gdk::Key::k, NONE, "", "g"), motion(UP, 1));
        assert_eq!(route_key(gdk::Key::j, NONE, "", "3g"), motion(DOWN, 3));
        assert_eq!(route_key(gdk::Key::k, NONE, "", "12g"), motion(UP, 12));
    }

    #[test]
    fn j_k_and_the_arrows_stay_with_vim() {
        for pending in ["", "3", "g", "3g"] {
            for key in [gdk::Key::Down, gdk::Key::Up] {
                assert_eq!(route_key(key, NONE, "", pending), KeyRoute::PassThrough);
            }
        }
        for pending in ["", "3", "12"] {
            for key in [gdk::Key::j, gdk::Key::k] {
                assert_eq!(route_key(key, NONE, "", pending), KeyRoute::PassThrough);
            }
        }
    }

    #[test]
    fn page_keys_are_table_pages_with_their_count() {
        assert_eq!(route_key(gdk::Key::f, CTRL, "", ""), page(DOWN, false, 1));
        assert_eq!(route_key(gdk::Key::b, CTRL, "", ""), page(UP, false, 1));
        assert_eq!(route_key(gdk::Key::d, CTRL, "", ""), page(DOWN, true, 1));
        assert_eq!(route_key(gdk::Key::u, CTRL, "", ""), page(UP, true, 1));
        assert_eq!(route_key(gdk::Key::f, CTRL, "", "2"), page(DOWN, false, 2));
        assert_eq!(route_key(gdk::Key::u, CTRL, "", "10"), page(UP, true, 10));
    }

    #[test]
    fn table_keys_with_another_pending_command_go_to_vim() {
        for pending in ["d", "\"a", "2d", "dg", "d2g", "0g", "0", "g3", "gg", "\"ag"] {
            for key in [gdk::Key::j, gdk::Key::k] {
                assert_eq!(route_key(key, NONE, "", pending), KeyRoute::PassThrough);
            }
        }
        for pending in ["d", "\"a", "2d", "g", "3g", "0"] {
            for key in [gdk::Key::f, gdk::Key::b, gdk::Key::d, gdk::Key::u] {
                assert_eq!(route_key(key, CTRL, "", pending), KeyRoute::PassThrough);
            }
        }
    }

    #[test]
    fn a_count_too_large_to_hold_goes_to_vim() {
        let huge = format!("{}g", "9".repeat(40));
        assert_eq!(
            route_key(gdk::Key::j, NONE, "", &huge),
            KeyRoute::PassThrough
        );
    }

    #[test]
    fn table_keys_in_other_modes_go_to_vim() {
        for bar in [
            "-- INSERT --",
            "-- REPLACE --",
            "-- VISUAL --",
            "-- VISUAL LINE --",
            "-- VISUAL BLOCK --",
            ":",
            "/j",
        ] {
            for pending in ["", "g", "3g"] {
                assert_eq!(
                    route_key(gdk::Key::j, NONE, bar, pending),
                    KeyRoute::PassThrough
                );
                assert_eq!(
                    route_key(gdk::Key::k, NONE, bar, pending),
                    KeyRoute::PassThrough
                );
            }
            for key in [gdk::Key::f, gdk::Key::b, gdk::Key::d, gdk::Key::u] {
                assert_eq!(route_key(key, CTRL, bar, ""), KeyRoute::PassThrough);
            }
        }
    }

    #[test]
    fn table_keys_with_other_modifiers_go_to_vim() {
        let shift = gdk::ModifierType::SHIFT_MASK;
        let alt = gdk::ModifierType::ALT_MASK;
        for modifiers in [CTRL, alt, shift] {
            assert_eq!(
                route_key(gdk::Key::j, modifiers, "", "g"),
                KeyRoute::PassThrough
            );
            assert_eq!(
                route_key(gdk::Key::k, modifiers, "", "3g"),
                KeyRoute::PassThrough
            );
        }
        for modifiers in [alt, CTRL | alt, CTRL | shift] {
            for key in [gdk::Key::f, gdk::Key::b, gdk::Key::d, gdk::Key::u] {
                assert_eq!(route_key(key, modifiers, "", ""), KeyRoute::PassThrough);
            }
        }
        let locks = gdk::ModifierType::LOCK_MASK | gdk::ModifierType::BUTTON1_MASK;
        assert_eq!(route_key(gdk::Key::j, locks, "", "g"), motion(DOWN, 1));
        assert_eq!(
            route_key(gdk::Key::f, CTRL | locks, "", ""),
            page(DOWN, false, 1)
        );
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
