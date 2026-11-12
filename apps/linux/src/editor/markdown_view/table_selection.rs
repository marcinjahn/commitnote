use commitnote_markdown::{TableCellPosition, TableCopy, TableSelection, table_copy};
use gtk4::subclass::prelude::*;
use gtk4::{self as gtk, gdk, glib, graphene, prelude::*};

use super::{MarkdownView, TableWidget};

impl MarkdownView {
    /// Selects the cells from the one under `from` to the one nearest `to`, both in widget
    /// coordinates, and says whether `from` lies on a shown table.
    pub fn drag_table_cells(&self, from_x: f64, from_y: f64, to_x: f64, to_y: f64) -> bool {
        let Some((widget, anchor)) = self.table_cell_at(from_x, from_y) else {
            return false;
        };
        let to = graphene::Point::new(to_x as f32, to_y as f32);
        let Some(focus) = self
            .compute_point(&widget, &to)
            .and_then(|to| cell_at(&widget, &to))
        else {
            return false;
        };
        self.set_table_selection(Some((widget, TableSelection::new(anchor, focus))));
        self.grab_focus();
        true
    }

    /// Selects the cell under a touch held at a point in widget coordinates and opens the context
    /// menu there.
    pub fn long_press_table_at(&self, x: f64, y: f64) -> bool {
        let Some((widget, position)) = self.table_cell_at(x, y) else {
            return false;
        };
        self.set_table_selection(Some((widget, TableSelection::cell(position))));
        self.grab_focus();
        self.open_table_menu(x, y);
        true
    }

    /// Opens the context menu for a secondary press at a point in widget coordinates, keeping the
    /// selection when it holds the pressed cell and selecting that cell otherwise.
    pub fn secondary_press_table_at(&self, x: f64, y: f64) -> bool {
        let Some((widget, position)) = self.table_cell_at(x, y) else {
            return false;
        };
        let kept = self
            .table_selection()
            .filter(|(selected, selection)| *selected == widget && selection.contains(position));
        if kept.is_none() {
            self.set_table_selection(Some((widget, TableSelection::cell(position))));
        }
        self.grab_focus();
        self.open_table_menu(x, y);
        true
    }

    /// Clears the table selection for a press of `button` at a point in widget coordinates, except
    /// while the context menu is shown and for a secondary press on the selected table.
    pub fn table_press_at(&self, x: f64, y: f64, button: u32) {
        if self.context_menu_shown() {
            return;
        }
        let on_selected = || {
            let selected = self.imp().table_selection.borrow().as_ref()?.0.clone();
            let (pressed, _) = self.table_overlays().widget_at(self.upcast_ref(), x, y)?;
            Some(pressed == selected)
        };
        if button == gtk::gdk::BUTTON_SECONDARY && on_selected() == Some(true) {
            return;
        }
        self.clear_table_selection();
    }

    pub fn table_selection(&self) -> Option<(TableWidget, TableSelection)> {
        self.imp().table_selection.borrow().clone()
    }

    /// Handles a key press while cells are selected, returning whether it consumed the key: a copy
    /// key copies the cells, a bare modifier and any key while the context menu is shown leave the
    /// selection alone, and any other key clears it and is left to act as usual.
    pub fn table_selection_key(&self, keyval: gdk::Key, state: gdk::ModifierType) -> bool {
        if self.imp().table_selection.borrow().is_none() || self.context_menu_shown() {
            return false;
        }
        if is_copy_key(keyval, state) {
            self.emit_copy_clipboard();
            return true;
        }
        if !is_modifier_key(keyval) {
            self.clear_table_selection();
        }
        false
    }

    pub fn clear_table_selection(&self) {
        if self.imp().table_selection.borrow().is_some() {
            self.set_table_selection(None);
        }
    }

    /// Drops the selection once its table is no longer shown.
    pub(super) fn retain_table_selection(&self) {
        let Some((widget, _)) = self.table_selection() else {
            return;
        };
        if self.table_overlays().table_of(&widget).is_none() || !widget.is_visible() {
            self.set_table_selection(None);
        }
    }

    /// Puts the selected cells on the clipboard as tab-separated text and as an HTML table,
    /// returning whether there were cells to copy.
    pub(super) fn copy_table_selection(&self) -> bool {
        let Some((widget, selection)) = self.table_selection() else {
            return false;
        };
        let Some(table) = self.table_overlays().table_of(&widget) else {
            return false;
        };
        let TableCopy { text, html } = table_copy(&table, &selection);
        let content = gdk::ContentProvider::new_union(&[
            gdk::ContentProvider::for_value(&text.to_value()),
            gdk::ContentProvider::for_bytes(
                "text/html",
                &glib::Bytes::from_owned(format!("<meta charset=\"utf-8\">{html}")),
            ),
        ]);
        if let Err(error) = self.clipboard().set_content(Some(&content)) {
            glib::g_warning!("commitnote", "could not copy the table cells: {error}");
        }
        true
    }

    fn set_table_selection(&self, next: Option<(TableWidget, TableSelection)>) {
        let previous = self.imp().table_selection.replace(next.clone());
        let cleared = previous.is_some() && next.is_none();
        if let Some((previous, _)) = previous
            && next.as_ref().is_none_or(|(widget, _)| *widget != previous)
        {
            previous.set_selection(None);
        }
        if let Some((widget, selection)) = next {
            widget.set_selection(Some(selection));
        }
        if cleared {
            self.action_set_enabled("clipboard.copy", self.buffer().has_selection());
        }
    }

    fn table_cell_at(&self, x: f64, y: f64) -> Option<(TableWidget, TableCellPosition)> {
        let (widget, point) = self.table_overlays().widget_at(self.upcast_ref(), x, y)?;
        let position = cell_at(&widget, &point)?;
        Some((widget, position))
    }

    fn context_menu(&self) -> Option<gtk::PopoverMenu> {
        let mut child = self.first_child();
        while let Some(widget) = child {
            if let Some(menu) = widget.downcast_ref::<gtk::PopoverMenu>() {
                return Some(menu.clone());
            }
            child = widget.next_sibling();
        }
        None
    }

    fn context_menu_shown(&self) -> bool {
        self.context_menu().is_some_and(|menu| menu.is_visible())
    }

    /// Opens the view's own context menu pointing at a point in widget coordinates, without the
    /// hit test of the text that a press on the text runs.
    fn open_table_menu(&self, x: f64, y: f64) {
        let _ = self.activate_action("menu.popup", None);
        if let Some(menu) = self.context_menu() {
            menu.set_pointing_to(Some(&gtk::gdk::Rectangle::new(
                x.round() as i32,
                y.round() as i32,
                1,
                1,
            )));
        }
        self.action_set_enabled("clipboard.copy", true);
    }
}

fn cell_at(widget: &TableWidget, point: &graphene::Point) -> Option<TableCellPosition> {
    let (row, column) = widget.cell_at_point(f64::from(point.x()), f64::from(point.y()))?;
    Some(TableCellPosition { row, column })
}

const MODIFIERS: gdk::ModifierType = gdk::ModifierType::SHIFT_MASK
    .union(gdk::ModifierType::CONTROL_MASK)
    .union(gdk::ModifierType::ALT_MASK)
    .union(gdk::ModifierType::SUPER_MASK)
    .union(gdk::ModifierType::HYPER_MASK)
    .union(gdk::ModifierType::META_MASK);

fn is_copy_key(keyval: gdk::Key, state: gdk::ModifierType) -> bool {
    let modifiers = state & MODIFIERS;
    if modifiers == gdk::ModifierType::CONTROL_MASK {
        keyval.to_lower() == gdk::Key::c || matches!(keyval, gdk::Key::Insert | gdk::Key::KP_Insert)
    } else {
        modifiers.is_empty() && keyval == gdk::Key::Copy
    }
}

fn is_modifier_key(keyval: gdk::Key) -> bool {
    matches!(
        keyval,
        gdk::Key::Shift_L
            | gdk::Key::Shift_R
            | gdk::Key::Control_L
            | gdk::Key::Control_R
            | gdk::Key::Alt_L
            | gdk::Key::Alt_R
            | gdk::Key::Meta_L
            | gdk::Key::Meta_R
            | gdk::Key::Super_L
            | gdk::Key::Super_R
            | gdk::Key::Hyper_L
            | gdk::Key::Hyper_R
            | gdk::Key::ISO_Level3_Shift
            | gdk::Key::ISO_Level5_Shift
            | gdk::Key::Caps_Lock
            | gdk::Key::Shift_Lock
            | gdk::Key::Num_Lock
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use gdk::{Key, ModifierType};

    #[test]
    fn copy_keys_are_control_c_control_insert_and_the_bare_copy_key() {
        let keys = [
            Key::c,
            Key::C,
            Key::Insert,
            Key::KP_Insert,
            Key::Copy,
            Key::x,
            Key::Down,
        ];
        let modifier_sets = [
            ("none", ModifierType::empty()),
            ("Control", ModifierType::CONTROL_MASK),
            (
                "Control+Shift",
                ModifierType::CONTROL_MASK | ModifierType::SHIFT_MASK,
            ),
            (
                "Control+Alt",
                ModifierType::CONTROL_MASK | ModifierType::ALT_MASK,
            ),
            ("Shift", ModifierType::SHIFT_MASK),
            (
                "Control+Lock",
                ModifierType::CONTROL_MASK | ModifierType::LOCK_MASK,
            ),
            (
                "Control+Button1",
                ModifierType::CONTROL_MASK | ModifierType::BUTTON1_MASK,
            ),
        ];
        let copies = |key: Key, modifiers: &str| {
            let control_only = matches!(modifiers, "Control" | "Control+Lock" | "Control+Button1");
            match key {
                Key::c | Key::C | Key::Insert | Key::KP_Insert => control_only,
                Key::Copy => modifiers == "none",
                _ => false,
            }
        };
        for key in keys {
            for (name, state) in modifier_sets {
                assert_eq!(
                    is_copy_key(key, state),
                    copies(key, name),
                    "{key:?} with {name}"
                );
            }
        }
    }

    #[test]
    fn modifier_keys_are_the_bare_modifiers_and_locks() {
        let modifiers = [
            Key::Shift_L,
            Key::Shift_R,
            Key::Control_L,
            Key::Control_R,
            Key::Alt_L,
            Key::Alt_R,
            Key::Meta_L,
            Key::Meta_R,
            Key::Super_L,
            Key::Super_R,
            Key::Hyper_L,
            Key::Hyper_R,
            Key::ISO_Level3_Shift,
            Key::ISO_Level5_Shift,
            Key::Caps_Lock,
            Key::Shift_Lock,
            Key::Num_Lock,
        ];
        for key in modifiers {
            assert!(is_modifier_key(key), "{key:?}");
        }
        for key in [
            Key::a,
            Key::Escape,
            Key::Down,
            Key::Tab,
            Key::Menu,
            Key::F10,
        ] {
            assert!(!is_modifier_key(key), "{key:?}");
        }
    }
}
