use commitnote_markdown::{TableCellPosition, TableSelection};
use gtk4::subclass::prelude::*;
use gtk4::{self as gtk, graphene, prelude::*};

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

    fn set_table_selection(&self, next: Option<(TableWidget, TableSelection)>) {
        let previous = self.imp().table_selection.replace(next.clone());
        if let Some((previous, _)) = previous
            && next.as_ref().is_none_or(|(widget, _)| *widget != previous)
        {
            previous.set_selection(None);
        }
        if let Some((widget, selection)) = next {
            widget.set_selection(Some(selection));
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
    }
}

fn cell_at(widget: &TableWidget, point: &graphene::Point) -> Option<TableCellPosition> {
    let (row, column) = widget.cell_at_point(f64::from(point.x()), f64::from(point.y()))?;
    Some(TableCellPosition { row, column })
}
