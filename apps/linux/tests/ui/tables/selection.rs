use std::cell::RefCell;

use commitnote::editor::{MarkdownView, NoteEditor, OverlayStyle, TableWidget};
use commitnote_markdown::{TableCellPosition, TableSelection};
use gtk4::{self as gtk, gdk, graphene};
use libadwaita as adw;
use libadwaita::prelude::*;

use super::{
    BAND, Host, Placed, SHARED_VERSION_TEXT, ViewPoint, WINDOW_HEIGHT, WINDOW_WIDTH, allocated_at,
    caret_in, cell, cell_bounds, char_count, children, edit, focus_view, offset_in, open_note,
    place_caret, placements, rendered, to_view, view_text,
};
use crate::flows::{ensure, split_view};
use crate::p2::{focus_within, set_vim_mode};
use crate::p4::view_shared_version;
use crate::support::{
    Harness, Theme, WIDE_VARIANTS, Width, WindowPixels, assert_selected, render_window, restoring,
};

const TABLE: &str = "| Name | Qty | Note |\n| :- | :-: | -: |\n| **Tea** | 2 | [shop](https://e.x/s) |\n| code | | plain |\n| a | b |";
const TINT_ALPHA: f32 = 0.22;
const HIGH_CONTRAST_TINT_ALPHA: f32 = 0.4;
const CORNER_INSET: f32 = 2.0;
const WINDOW_MARGIN: f32 = 10.0;
const TINT_TOLERANCE: u32 = 6;
const TEXT_DISTANCE: u32 = 60;

#[derive(Debug, Clone, Copy)]
struct Look {
    name: &'static str,
    dark: bool,
    accent: gdk::RGBA,
    high_contrast: bool,
}

fn looks() -> [Look; 4] {
    [
        Look {
            name: "light",
            dark: false,
            accent: gdk::RGBA::new(0.2, 0.4, 0.9, 1.0),
            high_contrast: false,
        },
        Look {
            name: "dark",
            dark: true,
            accent: gdk::RGBA::new(0.5, 0.7, 1.0, 1.0),
            high_contrast: false,
        },
        Look {
            name: "high contrast",
            dark: false,
            accent: gdk::RGBA::new(0.2, 0.4, 0.9, 1.0),
            high_contrast: true,
        },
        Look {
            name: "second accent",
            dark: false,
            accent: gdk::RGBA::new(0.85, 0.3, 0.1, 1.0),
            high_contrast: false,
        },
    ]
}

impl Look {
    fn style(&self) -> OverlayStyle {
        let shade = if self.dark { 0.92 } else { 0.1 };
        OverlayStyle {
            foreground: gdk::RGBA::new(shade, shade, shade, 1.0),
            accent: self.accent,
            line_height: 17.0,
            high_contrast: self.high_contrast,
        }
    }

    fn tint_alpha(&self) -> f32 {
        if self.high_contrast {
            HIGH_CONTRAST_TINT_ALPHA
        } else {
            TINT_ALPHA
        }
    }

    fn scheme(&self) -> adw::ColorScheme {
        if self.dark {
            adw::ColorScheme::ForceDark
        } else {
            adw::ColorScheme::ForceLight
        }
    }
}

const fn position(row: usize, column: usize) -> TableCellPosition {
    TableCellPosition { row, column }
}

fn selections() -> [(&'static str, TableSelection); 2] {
    [
        ("a body cell", TableSelection::cell(position(1, 1))),
        (
            "a range from the header to the last row",
            TableSelection::new(position(0, 1), position(3, 1)),
        ),
    ]
}

pub(super) fn selection_tint(h: &mut Harness) -> Result<(), String> {
    let table = TableWidget::new(rendered(TABLE)?, &looks()[0].style(), None);
    table.set_band_width(BAND);
    table.set_halign(gtk::Align::Start);
    table.set_valign(gtk::Align::Start);
    let host = Host(
        gtk::Window::builder()
            .default_width(WINDOW_WIDTH)
            .default_height(WINDOW_HEIGHT)
            .child(&table)
            .build(),
    );
    host.0.present();
    h.wait("the table to be allocated at the band width", || {
        allocated_at(&table, BAND)
    })?;
    let scene = Scene {
        host: &host.0,
        table: &table,
    };
    let schemes = adw::StyleManager::default();
    let original = schemes.color_scheme();
    restoring(
        || schemes.set_color_scheme(original),
        || {
            for look in &looks() {
                check_look(h, &scene, look)?;
            }
            check_accessible_state(h, &table)?;
            check_style_change(h, &scene)
        },
    )
}

struct Scene<'a> {
    host: &'a gtk::Window,
    table: &'a TableWidget,
}

impl Scene<'_> {
    fn pixels(&self) -> Result<WindowPixels, String> {
        WindowPixels::new(&render_window(self.host, None)?, self.host)
    }

    fn background(&self, pixels: &WindowPixels) -> Result<[u8; 4], String> {
        pixels.at(&graphene::Point::new(
            self.host.width() as f32 - WINDOW_MARGIN,
            self.host.height() as f32 - WINDOW_MARGIN,
        ))
    }

    fn in_window(&self, point: graphene::Point) -> Result<graphene::Point, String> {
        self.table
            .compute_point(self.host, &point)
            .ok_or_else(|| "the table is not inside the window".to_owned())
    }

    fn cells(&self) -> Vec<TableCellPosition> {
        let table = self.table.table();
        (0..table.row_count())
            .flat_map(|row| (0..table.column_count()).map(move |column| position(row, column)))
            .collect()
    }

    /// The pixel just inside a cell's bottom-right corner, clear of its text.
    fn corner(&self, pixels: &WindowPixels, cell: TableCellPosition) -> Result<[u8; 4], String> {
        let bounds = self
            .table
            .cell_bounds(cell.row, cell.column)
            .ok_or_else(|| format!("cell {},{} has no bounds", cell.row, cell.column))?;
        pixels.at(&self.in_window(graphene::Point::new(
            bounds.x() + bounds.width() - CORNER_INSET,
            bounds.y() + bounds.height() - CORNER_INSET,
        ))?)
    }

    /// Whether some pixel of the cell's content area differs from `tint`, as text over it does.
    fn text_shows(
        &self,
        pixels: &WindowPixels,
        cell: TableCellPosition,
        tint: [u8; 4],
    ) -> Result<bool, String> {
        let geometry = self.table.geometry().ok_or("the table has no geometry")?;
        let content = &geometry.content_frames[cell.row][cell.column];
        let origin = self.in_window(graphene::Point::new(content.x as f32, content.y as f32))?;
        let (left, top) = (origin.x().floor() as i32, origin.y().floor() as i32);
        let (right, bottom) = (
            (origin.x() + content.width as f32).ceil() as i32,
            (origin.y() + content.height as f32).ceil() as i32,
        );
        for y in top..bottom {
            for x in left..right {
                let pixel = pixels.at(&graphene::Point::new(x as f32, y as f32))?;
                if distance(pixel, tint) > TEXT_DISTANCE {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    fn has_text(&self, cell: TableCellPosition) -> bool {
        !self.table.table().rows[cell.row][cell.column]
            .plain_text
            .is_empty()
    }
}

fn check_look(h: &Harness, scene: &Scene, look: &Look) -> Result<(), String> {
    adw::StyleManager::default().set_color_scheme(look.scheme());
    scene.table.set_selection(None);
    scene.table.set_style(&look.style());
    let baseline = wait_for_ok(h, &format!("the unselected {} table", look.name), || {
        unselected_samples(scene, look)
    })?;
    for (what, selection) in selections() {
        scene.table.set_selection(Some(selection));
        wait_for_ok(
            h,
            &format!("{what} tinted in the {} look", look.name),
            || check_tint(scene, look, &selection, &baseline),
        )?;
        scene.table.set_selection(None);
        wait_for_ok(
            h,
            &format!("{what} untinted in the {} look", look.name),
            || unselected_samples(scene, look),
        )?;
    }
    Ok(())
}

/// The corner pixel of every cell, each of which must show the window's background.
fn unselected_samples(
    scene: &Scene,
    look: &Look,
) -> Result<Vec<(TableCellPosition, [u8; 4])>, String> {
    let pixels = scene.pixels()?;
    let background = scene.background(&pixels)?;
    if is_dark(background) != look.dark {
        return Err(format!(
            "the window background {background:?} does not suit the look"
        ));
    }
    scene
        .cells()
        .into_iter()
        .map(|cell| {
            let sample = scene.corner(&pixels, cell)?;
            if sample == background {
                Ok((cell, sample))
            } else {
                Err(format!(
                    "cell {},{} shows {sample:?} at its corner, not the background {background:?}",
                    cell.row, cell.column
                ))
            }
        })
        .collect()
}

fn check_tint(
    scene: &Scene,
    look: &Look,
    selection: &TableSelection,
    baseline: &[(TableCellPosition, [u8; 4])],
) -> Result<(), String> {
    let pixels = scene.pixels()?;
    for &(cell, unselected) in baseline {
        let sample = scene.corner(&pixels, cell)?;
        let selected = selection.contains(cell);
        let (expected, tolerance) = if selected {
            (
                tinted(unselected, look.accent, look.tint_alpha()),
                TINT_TOLERANCE,
            )
        } else {
            (unselected, 0)
        };
        if distance(sample, expected) > tolerance {
            return Err(format!(
                "cell {},{} shows {sample:?}, not {expected:?}, while {}selected",
                cell.row,
                cell.column,
                if selected { "" } else { "not " }
            ));
        }
        if selected && scene.has_text(cell) && !scene.text_shows(&pixels, cell, expected)? {
            return Err(format!(
                "the text of cell {},{} is not drawn over the tint",
                cell.row, cell.column
            ));
        }
    }
    Ok(())
}

fn check_accessible_state(h: &Harness, table: &TableWidget) -> Result<(), String> {
    let selection = TableSelection::new(position(0, 1), position(3, 1));
    table.set_selection(Some(selection));
    let states = |selection: Option<TableSelection>| -> Result<(), String> {
        for (row, part) in children(table).iter().enumerate() {
            for column in 0..children(part).len() {
                let selected =
                    selection.is_some_and(|selection| selection.contains(position(row, column)));
                assert_selected(&cell(table, row, column)?, selected)?;
            }
        }
        Ok(())
    };
    wait_for_ok(h, "the range's cells to be selected", || {
        states(Some(selection))
    })?;
    table.set_selection(None);
    wait_for_ok(h, "no cell to be selected", || states(None))
}

fn check_style_change(h: &Harness, scene: &Scene) -> Result<(), String> {
    let looks = looks();
    let [first, .., last] = &looks;
    adw::StyleManager::default().set_color_scheme(first.scheme());
    scene.table.set_style(&first.style());
    let baseline = wait_for_ok(h, "the table in the first look", || {
        unselected_samples(scene, first)
    })?;
    let (_, selection) = selections()[1];
    scene.table.set_selection(Some(selection));
    wait_for_ok(h, "the selection in the first accent", || {
        check_tint(scene, first, &selection, &baseline)
    })?;
    scene.table.set_style(&last.style());
    if scene.table.selection() != Some(selection) {
        return Err(format!(
            "the selection is {:?} after the style changed",
            scene.table.selection()
        ));
    }
    wait_for_ok(h, "the tint to follow the new accent", || {
        check_tint(scene, last, &selection, &baseline)
    })
}

fn wait_for_ok<T>(
    h: &Harness,
    description: &str,
    check: impl Fn() -> Result<T, String>,
) -> Result<T, String> {
    let outcome = RefCell::new(None);
    let last_error = RefCell::new(String::new());
    h.wait(description, || match check() {
        Ok(value) => {
            outcome.replace(Some(value));
            true
        }
        Err(error) => {
            last_error.replace(error);
            false
        }
    })
    .map_err(|error| format!("{error}: {}", last_error.borrow()))?;
    outcome
        .take()
        .ok_or_else(|| "the check passed without a result".to_owned())
}

fn tinted(background: [u8; 4], accent: gdk::RGBA, alpha: f32) -> [u8; 4] {
    let blend = |below: u8, above: f32| {
        (f32::from(below) * (1.0 - alpha) + above * 255.0 * alpha).round() as u8
    };
    [
        blend(background[0], accent.red()),
        blend(background[1], accent.green()),
        blend(background[2], accent.blue()),
        background[3],
    ]
}

fn distance(a: [u8; 4], b: [u8; 4]) -> u32 {
    a.iter()
        .zip(b)
        .take(3)
        .map(|(&a, b)| u32::from(a.abs_diff(b)))
        .sum()
}

fn is_dark([red, green, blue, _]: [u8; 4]) -> bool {
    0.2126 * f32::from(red) + 0.7152 * f32::from(green) + 0.0722 * f32::from(blue) < 128.0
}

const TWO_TABLES: &str = "Intro paragraph above the tables.\n\n| Item | Qty | Note |\n| :-- | :-: | --: |\n| tea | 2 | hot |\n| milk | 1 | cold |\n| jam | 3 | sweet |\n\nMiddle paragraph between the tables.\n\n| Key | Value |\n| --- | --- |\n| a | b |\n\nClosing paragraph below the tables.";
const MIDDLE: &str = "Middle paragraph between the tables.";
const TABLE_A_HEADER: &str = "| Item |";
const TABLE_A_END: &str = "\n\nMiddle";
const TABLE_A_ROWS: usize = 4;
const TABLE_A_COLUMNS: usize = 3;
const TABLE_B_FIRST_CELL: &str = "Key";
const INSIDE_TABLE_A: &str = "milk";
const TYPED: &str = "X";
const BEYOND_GRID: f32 = 24.0;

/// The two shown tables of [`TWO_TABLES`], in text order.
struct Tables {
    a: TableWidget,
    b: TableWidget,
}

/// The caret, the other end of the text selection and the text of a view.
#[derive(Debug, PartialEq)]
struct TextState {
    caret: i32,
    bound: i32,
    text: String,
}

/// A table widget's own gestures, driven by emitting their signals.
struct Gestures {
    drag: gtk::GestureDrag,
    long_press: gtk::GestureLongPress,
    secondary: gtk::GestureClick,
    middle: gtk::GestureClick,
}

impl Gestures {
    fn of(widget: &TableWidget) -> Result<Self, String> {
        let list = widget.observe_controllers();
        let controllers: Vec<gtk::EventController> = (0..list.n_items())
            .filter_map(|index| list.item(index).and_downcast())
            .collect();
        let find = |what: &str, wanted: &dyn Fn(&gtk::EventController) -> bool| {
            controllers
                .iter()
                .find(|controller| wanted(controller))
                .cloned()
                .ok_or_else(|| format!("the table widget has no {what}"))
        };
        let click_on = |button: u32| {
            move |controller: &gtk::EventController| {
                controller
                    .downcast_ref::<gtk::GestureClick>()
                    .is_some_and(|click| click.button() == button)
            }
        };
        Ok(Self {
            drag: find("drag gesture", &|controller| {
                controller.is::<gtk::GestureDrag>()
            })?
            .downcast()
            .map_err(|_| "the drag gesture is no GestureDrag")?,
            long_press: find("long press", &|controller| {
                controller.is::<gtk::GestureLongPress>()
            })?
            .downcast()
            .map_err(|_| "the long press is no GestureLongPress")?,
            secondary: find("secondary click", &click_on(gdk::BUTTON_SECONDARY))?
                .downcast()
                .map_err(|_| "the secondary click is no GestureClick")?,
            middle: find("middle click", &click_on(gdk::BUTTON_MIDDLE))?
                .downcast()
                .map_err(|_| "the middle click is no GestureClick")?,
        })
    }

    fn begin(&self, (x, y): (f64, f64)) {
        self.drag.emit_by_name::<()>("drag-begin", &[&x, &y]);
    }

    fn update(&self, (dx, dy): (f64, f64)) {
        self.drag.emit_by_name::<()>("drag-update", &[&dx, &dy]);
    }

    fn end(&self, (dx, dy): (f64, f64)) {
        self.drag.emit_by_name::<()>("drag-end", &[&dx, &dy]);
    }

    fn cancel(&self) {
        self.drag
            .emit_by_name::<()>("cancel", &[&None::<gdk::EventSequence>]);
    }

    fn drag_between(&self, from: (f64, f64), to: (f64, f64)) {
        let offset = (to.0 - from.0, to.1 - from.1);
        self.begin(from);
        self.update(offset);
        self.end(offset);
    }

    fn long_press(&self, (x, y): (f64, f64)) {
        self.long_press.emit_by_name::<()>("pressed", &[&x, &y]);
    }

    fn secondary_press(&self, (x, y): (f64, f64)) {
        self.secondary
            .emit_by_name::<()>("pressed", &[&1_i32, &x, &y]);
    }

    fn middle_press(&self, (x, y): (f64, f64)) {
        self.middle.emit_by_name::<()>("pressed", &[&1_i32, &x, &y]);
    }
}

/// Drags, presses and clears cell selections on two rendered tables, in the editor, in Vim and in
/// the shared version. The gestures are driven by emitting their signals and by calling the view's
/// methods: that leaves out GTK's event delivery, real pointer motion against the drag threshold,
/// and the claiming and denying between the gestures of the view and of the table.
pub(super) fn selection(h: &mut Harness) -> Result<(), String> {
    let middle_end = offset_in(TWO_TABLES, MIDDLE)? + char_count(MIDDLE);
    let (editor, view) = open_note(h, TWO_TABLES, middle_end)?;
    let tables = wait_tables(h, &view)?;
    let before = text_state(&view);

    drag_matrix(h, &view, &tables, &before)?;
    clamping(&view, &tables, &before)?;
    let tables = widget_signals(h, &view, tables, &before)?;
    press_rule(h, &view, &tables)?;
    let tables = clearing_and_keeping(h, &view, tables, &before)?;
    vim(h, &editor, &view, &tables)?;
    screenshots(h, &view, &tables)?;
    read_only(h)
}

fn drag_matrix(
    h: &Harness,
    view: &MarkdownView,
    tables: &Tables,
    before: &TextState,
) -> Result<(), String> {
    let cells = table_a_cells();
    let centres = cells
        .iter()
        .map(|&cell| cell_point(view, &tables.a, cell))
        .collect::<Result<Vec<_>, _>>()?;
    for (&anchor, &from) in cells.iter().zip(&centres) {
        for (&focus, &to) in cells.iter().zip(&centres) {
            let what = format!("a drag from {anchor:?} to {focus:?}");
            ensure(view.drag_table_cells(from.0, from.1, to.0, to.1), || {
                format!("{what} did not act")
            })?;
            expect_selection(
                view,
                &tables.a,
                Some(TableSelection::new(anchor, focus)),
                &what,
            )?;
            expect_text(view, before, &what)?;
            expect_shown(view, tables, &what)?;
        }
    }
    h.wait("the drags to keep the focus in the view", || {
        focus_within(h, view)
    })?;
    h.settle()?;
    expect_shown(view, tables, "the drag matrix")?;
    expect_text(view, before, "the drag matrix")
}

fn clamping(view: &MarkdownView, tables: &Tables, before: &TextState) -> Result<(), String> {
    let widget = &tables.a;
    let grid = widget.grid_bounds();
    let column = cell_bounds(widget, 0, 1)?.center().x();
    let row = cell_bounds(widget, 2, 0)?.center().y();
    let from = cell_point(view, widget, position(2, 1))?;
    let beyond = [
        (
            "below the grid",
            graphene::Point::new(column, grid.height() + BEYOND_GRID),
            position(TABLE_A_ROWS - 1, 1),
        ),
        (
            "right of the grid",
            graphene::Point::new(grid.width() + BEYOND_GRID, row),
            position(2, TABLE_A_COLUMNS - 1),
        ),
        (
            "above the grid",
            graphene::Point::new(column, -BEYOND_GRID),
            position(0, 1),
        ),
    ];
    for (where_to, point, focus) in beyond {
        let to = to_view(view, widget, &point)?;
        let what = format!("a drag to {where_to}");
        ensure(view.drag_table_cells(from.0, from.1, to.0, to.1), || {
            format!("{what} did not act")
        })?;
        expect_selection(
            view,
            widget,
            Some(TableSelection::new(position(2, 1), focus)),
            &what,
        )?;
    }

    let held = view.table_selection();
    let text = text_point(view, offset_in(&view_text(view), MIDDLE)?);
    let to = cell_point(view, widget, position(1, 1))?;
    ensure(!view.drag_table_cells(text.0, text.1, to.0, to.1), || {
        "a drag from the text acted".to_owned()
    })?;
    ensure(view.table_selection() == held, || {
        "a drag from the text changed the selection".to_owned()
    })?;
    expect_text(view, before, "the clamped drags")
}

fn widget_signals(
    h: &Harness,
    view: &MarkdownView,
    tables: Tables,
    before: &TextState,
) -> Result<Tables, String> {
    view.clear_table_selection();
    let gestures = Gestures::of(&tables.a)?;
    let threshold = f64::from(tables.a.settings().gtk_dnd_drag_threshold());
    let from = widget_point(&tables.a, position(1, 0))?;
    let to = widget_point(&tables.a, position(2, 2))?;
    ensure(
        (to.0 - from.0).abs() > threshold || (to.1 - from.1).abs() > threshold,
        || "the drag between the cells stays within the threshold".to_owned(),
    )?;
    let within = (threshold / 2.0, -threshold / 2.0);

    gestures.drag_between(from, to);
    expect_selection(
        view,
        &tables.a,
        Some(TableSelection::new(position(1, 0), position(2, 2))),
        "the drag gesture",
    )?;
    expect_text(view, before, "the drag gesture")?;
    expect_shown(view, &tables, "the drag gesture")?;

    gestures.begin(from);
    gestures.update((to.0 - from.0, to.1 - from.1));
    gestures.cancel();
    gestures.end((0.0, 0.0));
    expect_text(view, before, "a release after a cancelled drag")?;

    gestures.begin(from);
    gestures.long_press(from);
    expect_selection(
        view,
        &tables.a,
        Some(TableSelection::cell(position(1, 0))),
        "the long press",
    )?;
    let menu = expect_menu_at(
        view,
        to_view_point(view, &tables.a, from)?,
        "the long press",
    )?;
    close_menu(h, &menu)?;
    gestures.end(within);
    expect_text(view, before, "a release after the long press")?;

    secondary_presses(h, view, &tables, &gestures)?;

    let held = view.table_selection();
    gestures.middle_press(widget_point(&tables.a, position(1, 1))?);
    ensure(view.table_selection() == held, || {
        "the middle press changed the selection".to_owned()
    })?;
    expect_text(view, before, "the middle press")?;

    ensure(
        view.drag_table_cells_between(&tables.a, position(0, 0), position(1, 1))?,
        || "the drag on table A did not act".to_owned(),
    )?;
    Gestures::of(&tables.b)?.drag_between(
        widget_point(&tables.b, position(0, 0))?,
        widget_point(&tables.b, position(1, 1))?,
    );
    expect_selection(
        view,
        &tables.b,
        Some(TableSelection::new(position(0, 0), position(1, 1))),
        "the drag on table B",
    )?;
    ensure(tables.a.selection().is_none(), || {
        "table A kept its selection after the drag on table B".to_owned()
    })?;

    view.clear_table_selection();
    gestures.begin(from);
    gestures.end(within);
    let caret = caret_in(view);
    let table_a = offset_in(TWO_TABLES, TABLE_A_HEADER)?..offset_in(TWO_TABLES, TABLE_A_END)?;
    ensure(table_a.contains(&caret), || {
        format!("the click put the caret at {caret}, outside table A's {table_a:?}")
    })?;
    h.wait("the click to reveal table A", || table_a_revealed(view))?;
    ensure(view.table_selection().is_none(), || {
        "a selection outlived its table's reveal".to_owned()
    })?;
    place_caret(view, before.caret);
    let tables = wait_tables(h, view)?;
    expect_text(view, before, "restoring the caret after the click")?;
    Ok(tables)
}

fn secondary_presses(
    h: &Harness,
    view: &MarkdownView,
    tables: &Tables,
    gestures: &Gestures,
) -> Result<(), String> {
    let press = |widget: &TableWidget, gestures: &Gestures, at: TableCellPosition| {
        let point = widget_point(widget, at)?;
        gestures.secondary_press(point);
        let menu = expect_menu_at(
            view,
            to_view_point(view, widget, point)?,
            "the secondary press",
        )?;
        close_menu(h, &menu)
    };

    view.clear_table_selection();
    press(&tables.a, gestures, position(1, 1))?;
    expect_selection(
        view,
        &tables.a,
        Some(TableSelection::cell(position(1, 1))),
        "a secondary press with no selection",
    )?;

    let range = TableSelection::new(position(1, 0), position(2, 2));
    view.drag_table_cells_between(&tables.a, range.anchor, range.focus)?;
    press(&tables.a, gestures, position(2, 0))?;
    expect_selection(
        view,
        &tables.a,
        Some(range),
        "a secondary press inside the range",
    )?;

    press(&tables.a, gestures, position(3, 1))?;
    expect_selection(
        view,
        &tables.a,
        Some(TableSelection::cell(position(3, 1))),
        "a secondary press outside the range",
    )?;

    press(&tables.b, &Gestures::of(&tables.b)?, position(1, 0))?;
    expect_selection(
        view,
        &tables.b,
        Some(TableSelection::cell(position(1, 0))),
        "a secondary press on table B",
    )?;
    ensure(tables.a.selection().is_none(), || {
        "table A kept its selection after the secondary press on table B".to_owned()
    })
}

fn press_rule(h: &Harness, view: &MarkdownView, tables: &Tables) -> Result<(), String> {
    let text = text_point(view, offset_in(&view_text(view), MIDDLE)?);
    let on_a = cell_point(view, &tables.a, position(1, 1))?;
    let on_b = cell_point(view, &tables.b, position(1, 0))?;
    let range = TableSelection::new(position(0, 1), position(2, 1));
    let cases = [
        (
            "a primary press on the text",
            text,
            gdk::BUTTON_PRIMARY,
            false,
        ),
        (
            "a secondary press on table A",
            on_a,
            gdk::BUTTON_SECONDARY,
            true,
        ),
        (
            "a secondary press on table B",
            on_b,
            gdk::BUTTON_SECONDARY,
            false,
        ),
        ("a middle press on table A", on_a, gdk::BUTTON_MIDDLE, false),
    ];
    for (what, (x, y), button, keeps) in cases {
        view.drag_table_cells_between(&tables.a, range.anchor, range.focus)?;
        view.table_press_at(x, y, button);
        expect_selection(view, &tables.a, keeps.then_some(range), what)?;
    }

    view.drag_table_cells_between(&tables.a, range.anchor, range.focus)?;
    ensure(view.secondary_press_table_at(on_a.0, on_a.1), || {
        "the secondary press on table A did not act".to_owned()
    })?;
    let menu = expect_menu_at(view, on_a, "the secondary press on table A")?;
    view.table_press_at(text.0, text.1, gdk::BUTTON_PRIMARY);
    expect_selection(
        view,
        &tables.a,
        Some(range),
        "a primary press while the menu is shown",
    )?;
    close_menu(h, &menu)?;
    view.table_press_at(text.0, text.1, gdk::BUTTON_PRIMARY);
    expect_selection(
        view,
        &tables.a,
        None,
        "a primary press once the menu closed",
    )
}

fn clearing_and_keeping(
    h: &Harness,
    view: &MarkdownView,
    tables: Tables,
    before: &TextState,
) -> Result<Tables, String> {
    let range = TableSelection::new(position(1, 1), position(3, 0));
    view.drag_table_cells_between(&tables.a, range.anchor, range.focus)?;
    edit(view, 0, 0, TYPED);
    expect_selection(view, &tables.a, None, "an edit above the tables")?;
    edit(view, 0, char_count(TYPED), "");
    let tables = wait_tables(h, view)?;
    expect_text(view, before, "undoing the edit")?;

    view.drag_table_cells_between(&tables.a, range.anchor, range.focus)?;
    place_caret(view, offset_in(TWO_TABLES, INSIDE_TABLE_A)?);
    h.wait("the caret to reveal table A", || table_a_revealed(view))?;
    expect_selection(view, &tables.a, None, "revealing table A")?;
    place_caret(view, before.caret);
    let tables = wait_tables(h, view)?;

    view.drag_table_cells_between(&tables.a, range.anchor, range.focus)?;
    h.show_variant(Width::Wide, Theme::Dark)?;
    expect_selection(view, &tables.a, Some(range), "the dark palette")?;
    h.show_variant(Width::Wide, Theme::Light)?;
    expect_selection(view, &tables.a, Some(range), "the light palette")?;

    h.show_variant(Width::Narrow, Theme::Light)?;
    split_view(h)?.set_show_content(true);
    h.wait_shown("formatting-bar")?;
    let narrow = wait_tables(h, view)?;
    expect_selection(view, &narrow.a, Some(range), "the narrow window")?;
    h.show_variant(Width::Wide, Theme::Light)?;
    let wide = wait_tables(h, view)?;
    expect_selection(view, &wide.a, Some(range), "the wide window")?;
    expect_text(view, before, "the palette and width changes")?;
    Ok(wide)
}

fn vim(
    h: &Harness,
    editor: &NoteEditor,
    view: &MarkdownView,
    tables: &Tables,
) -> Result<(), String> {
    set_vim_mode(h, editor, true)?;
    let result = vim_drag(h, editor, view, tables);
    let off = set_vim_mode(h, editor, false);
    view.clear_table_selection();
    result.and(off)
}

fn vim_drag(
    h: &Harness,
    editor: &NoteEditor,
    view: &MarkdownView,
    tables: &Tables,
) -> Result<(), String> {
    focus_view(h, view)?;
    let command_bar = editor.vim_status().0;
    let state = text_state(view);
    let range = TableSelection::new(position(1, 0), position(3, 2));
    ensure(
        view.drag_table_cells_between(&tables.a, range.anchor, range.focus)?,
        || "the drag in Vim's normal mode did not act".to_owned(),
    )?;
    expect_selection(view, &tables.a, Some(range), "the drag in Vim")?;
    h.wait("the view to keep the focus in Vim", || {
        focus_within(h, view)
    })?;
    ensure(editor.vim_status().0 == command_bar, || {
        format!(
            "the drag changed Vim's command bar from {command_bar:?} to {:?}",
            editor.vim_status().0
        )
    })?;
    expect_text(view, &state, "the drag in Vim")
}

fn screenshots(h: &Harness, view: &MarkdownView, tables: &Tables) -> Result<(), String> {
    let range = TableSelection::new(position(0, 1), position(TABLE_A_ROWS - 1, 1));
    view.drag_table_cells_between(&tables.a, range.anchor, range.focus)?;
    h.session_screenshots("selection", WIDE_VARIANTS)?;
    expect_selection(view, &tables.a, Some(range), "the screenshots")
}

fn read_only(h: &Harness) -> Result<(), String> {
    view_shared_version(h)?;
    let view = h.widget_as::<MarkdownView>(SHARED_VERSION_TEXT)?;
    h.wait("the shared version to hold the note", || {
        view_text(&view).contains(TWO_TABLES)
    })?;
    ensure(!view.is_editable(), || {
        "the shared version is editable".to_owned()
    })?;
    let tables = wait_tables(h, &view)?;
    let before = text_state(&view);

    let range = TableSelection::new(position(0, 0), position(1, 1));
    ensure(
        view.drag_table_cells_between(&tables.a, range.anchor, range.focus)?,
        || "a drag in the shared version did not act".to_owned(),
    )?;
    expect_selection(
        &view,
        &tables.a,
        Some(range),
        "a drag in the shared version",
    )?;

    let (x, y) = cell_point(&view, &tables.a, position(2, 2))?;
    ensure(view.secondary_press_table_at(x, y), || {
        "a secondary press in the shared version did not act".to_owned()
    })?;
    expect_selection(
        &view,
        &tables.a,
        Some(TableSelection::cell(position(2, 2))),
        "a secondary press in the shared version",
    )?;
    let menu = expect_menu_at(&view, (x, y), "a secondary press in the shared version")?;
    close_menu(h, &menu)?;

    ensure(!view.click_table_at(x, y, false), || {
        "a plain click in the shared version acted".to_owned()
    })?;
    let text = text_point(&view, offset_in(&view_text(&view), MIDDLE)?);
    view.table_press_at(text.0, text.1, gdk::BUTTON_PRIMARY);
    expect_selection(&view, &tables.a, None, "a primary press on the shared text")?;
    h.settle()?;
    expect_shown(&view, &tables, "selecting in the shared version")?;
    expect_text(&view, &before, "selecting in the shared version")
}

trait DragBetween {
    /// Drags from the centre of one of `widget`'s cells to the centre of another.
    fn drag_table_cells_between(
        &self,
        widget: &TableWidget,
        anchor: TableCellPosition,
        focus: TableCellPosition,
    ) -> Result<bool, String>;
}

impl DragBetween for MarkdownView {
    fn drag_table_cells_between(
        &self,
        widget: &TableWidget,
        anchor: TableCellPosition,
        focus: TableCellPosition,
    ) -> Result<bool, String> {
        let from = cell_point(self, widget, anchor)?;
        let to = cell_point(self, widget, focus)?;
        Ok(self.drag_table_cells(from.0, from.1, to.0, to.1))
    }
}

fn table_a_cells() -> Vec<TableCellPosition> {
    (0..TABLE_A_ROWS)
        .flat_map(|row| (0..TABLE_A_COLUMNS).map(move |column| position(row, column)))
        .collect()
}

fn wait_tables(h: &Harness, view: &MarkdownView) -> Result<Tables, String> {
    let both = || {
        let [a, b]: [Placed; 2] = placements(view)?
            .try_into()
            .map_err(|placed: Vec<Placed>| format!("{} tables are shown", placed.len()))?;
        Ok(Tables {
            a: a.shown.widget,
            b: b.shown.widget,
        })
    };
    wait_for_ok(h, "both tables on their overlays", both)?;
    h.settle()?;
    both()
}

fn table_a_revealed(view: &MarkdownView) -> bool {
    match view.shown_tables().as_slice() {
        [shown] => shown
            .table
            .rows
            .first()
            .and_then(|row| row.first())
            .is_some_and(|cell| cell.plain_text == TABLE_B_FIRST_CELL),
        _ => false,
    }
}

fn text_state(view: &MarkdownView) -> TextState {
    let buffer = view.buffer();
    TextState {
        caret: buffer.iter_at_mark(&buffer.get_insert()).offset(),
        bound: buffer.iter_at_mark(&buffer.selection_bound()).offset(),
        text: view_text(view),
    }
}

fn expect_text(view: &MarkdownView, before: &TextState, what: &str) -> Result<(), String> {
    let now = text_state(view);
    ensure(now == *before, || {
        format!(
            "{what} moved the caret or the text selection, or changed the text: {:?} became {:?}",
            (before.caret, before.bound),
            (now.caret, now.bound)
        )
    })
}

fn expect_selection(
    view: &MarkdownView,
    widget: &TableWidget,
    expected: Option<TableSelection>,
    what: &str,
) -> Result<(), String> {
    let held = view.table_selection();
    let on_widget = held.as_ref().is_none_or(|(selected, _)| selected == widget);
    ensure(
        on_widget
            && held.as_ref().map(|(_, selection)| *selection) == expected
            && widget.selection() == expected,
        || {
            format!(
                "after {what} the view holds {:?}{} and the table {:?}, not {expected:?}",
                held.as_ref().map(|(_, selection)| selection),
                if on_widget { "" } else { " on another table" },
                widget.selection()
            )
        },
    )
}

fn expect_shown(view: &MarkdownView, tables: &Tables, what: &str) -> Result<(), String> {
    let shown = view.shown_tables();
    ensure(
        shown.len() == 2 && shown.iter().any(|table| table.widget == tables.a),
        || format!("{what} revealed a table: {} are shown", shown.len()),
    )
}

fn context_menu(view: &MarkdownView) -> Result<gtk::PopoverMenu, String> {
    children(view)
        .into_iter()
        .find_map(|child| child.downcast::<gtk::PopoverMenu>().ok())
        .ok_or_else(|| "the view has no context menu".to_owned())
}

fn expect_menu_at(
    view: &MarkdownView,
    (x, y): ViewPoint,
    what: &str,
) -> Result<gtk::PopoverMenu, String> {
    let menu = context_menu(view)?;
    ensure(menu.is_visible(), || {
        format!("{what} did not open the context menu")
    })?;
    let (set, rect) = menu.pointing_to();
    let (x, y) = (x.round() as i32, y.round() as i32);
    ensure(
        set && (rect.x()..rect.x() + rect.width()).contains(&x)
            && (rect.y()..rect.y() + rect.height()).contains(&y),
        || {
            format!(
                "after {what} the menu points at {}x{} at {},{}, not at {x},{y}",
                rect.width(),
                rect.height(),
                rect.x(),
                rect.y()
            )
        },
    )?;
    Ok(menu)
}

fn close_menu(h: &Harness, menu: &gtk::PopoverMenu) -> Result<(), String> {
    menu.popdown();
    h.wait("the context menu to close", || !menu.is_visible())
}

fn widget_point(widget: &TableWidget, cell: TableCellPosition) -> Result<(f64, f64), String> {
    let centre = cell_bounds(widget, cell.row, cell.column)?.center();
    Ok((f64::from(centre.x()), f64::from(centre.y())))
}

fn to_view_point(
    view: &MarkdownView,
    widget: &TableWidget,
    (x, y): (f64, f64),
) -> Result<ViewPoint, String> {
    to_view(view, widget, &graphene::Point::new(x as f32, y as f32))
}

fn cell_point(
    view: &MarkdownView,
    widget: &TableWidget,
    cell: TableCellPosition,
) -> Result<ViewPoint, String> {
    to_view_point(view, widget, widget_point(widget, cell)?)
}

fn text_point(view: &MarkdownView, offset: i32) -> ViewPoint {
    let at = view.iter_location(&view.buffer().iter_at_offset(offset));
    let (x, y) = view.buffer_to_window_coords(
        gtk::TextWindowType::Widget,
        at.x() + at.width() / 2,
        at.y() + at.height() / 2,
    );
    (f64::from(x), f64::from(y))
}
