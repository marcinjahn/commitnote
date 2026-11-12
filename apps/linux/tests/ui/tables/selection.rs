use std::cell::RefCell;

use commitnote::editor::{OverlayStyle, TableWidget};
use commitnote_markdown::{TableCellPosition, TableSelection};
use gtk4::{self as gtk, gdk, graphene};
use libadwaita as adw;
use libadwaita::prelude::*;

use super::{BAND, Host, WINDOW_HEIGHT, WINDOW_WIDTH, allocated_at, cell, children, rendered};
use crate::support::{Harness, WindowPixels, assert_selected, render_window, restoring};

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
