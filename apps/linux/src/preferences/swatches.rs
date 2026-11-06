use std::cell::Cell;
use std::f64::consts::TAU;
use std::rc::Rc;

use adw::prelude::*;
use commitnote_core_api::settings::{AccentOptionView, SettingKeyView};
use gtk4::{self as gtk, gdk};
use libadwaita as adw;

use super::binding::Binding;

const SWATCH_SIZE: i32 = 24;

/// One round toggle per accent colour the core offers, in the core's order.
pub(super) struct Swatches {
    pub(super) wrap: adw::WrapBox,
    swatches: Vec<Swatch>,
}

struct Swatch {
    option: AccentOptionView,
    button: gtk::ToggleButton,
    area: gtk::DrawingArea,
    color: Rc<Cell<gdk::RGBA>>,
}

impl Swatches {
    pub(super) fn new(binding: &Rc<Binding>, options: &[AccentOptionView]) -> Self {
        let wrap = adw::WrapBox::builder()
            .child_spacing(8)
            .line_spacing(8)
            .build();
        let mut swatches: Vec<Swatch> = Vec::with_capacity(options.len());
        for option in options {
            let swatch = Swatch::new(binding, option);
            if let Some(first) = swatches.first() {
                swatch.button.set_group(Some(&first.button));
            }
            wrap.append(&swatch.button);
            swatches.push(swatch);
        }
        let swatches = Self { wrap, swatches };
        swatches.paint();
        swatches
    }

    pub(super) fn show(&self, id: &str) {
        if let Some(swatch) = self.swatches.iter().find(|swatch| swatch.option.id == id) {
            swatch.button.set_active(true);
        }
    }

    /// Fills each swatch with the colour it gives the app in the current style.
    pub(super) fn paint(&self) {
        let style = adw::StyleManager::default();
        let system = style.accent_color_rgba();
        for swatch in &self.swatches {
            let color = swatch_color(&swatch.option, style.is_dark())
                .and_then(|color| gdk::RGBA::parse(color).ok())
                .unwrap_or(system);
            swatch.color.set(color);
            swatch.area.queue_draw();
        }
    }
}

impl Swatch {
    fn new(binding: &Rc<Binding>, option: &AccentOptionView) -> Self {
        let color = Rc::new(Cell::new(gdk::RGBA::TRANSPARENT));
        let area = gtk::DrawingArea::builder()
            .content_width(SWATCH_SIZE)
            .content_height(SWATCH_SIZE)
            .can_target(false)
            .build();
        area.set_draw_func({
            let color = color.clone();
            move |_, cairo, width, height| {
                let fill = color.get();
                let (width, height) = (f64::from(width), f64::from(height));
                cairo.set_source_rgba(
                    f64::from(fill.red()),
                    f64::from(fill.green()),
                    f64::from(fill.blue()),
                    f64::from(fill.alpha()),
                );
                cairo.arc(width / 2.0, height / 2.0, width.min(height) / 2.0, 0.0, TAU);
                let _ = cairo.fill();
            }
        });
        let button = gtk::ToggleButton::builder()
            .name(format!("settings-accent-{}", option.id))
            .tooltip_text(&option.label)
            .css_classes(["accent-swatch"])
            .child(&area)
            .build();
        button.update_property(&[gtk::accessible::Property::Label(&option.label)]);
        button.connect_toggled({
            let binding = Rc::downgrade(binding);
            let id = option.id.clone();
            move |button| {
                if !button.is_active() {
                    return;
                }
                if let Some(binding) = binding.upgrade() {
                    binding.change(SettingKeyView::AccentColor, id.as_str());
                }
            }
        });
        Self {
            option: option.clone(),
            button,
            area,
            color,
        }
    }
}

/// The colour an accent option gives the app in a style, as the core states it; `None` when the
/// app then follows the desktop's accent colour.
fn swatch_color(option: &AccentOptionView, dark: bool) -> Option<&str> {
    if dark {
        option.dark.as_deref()
    } else {
        option.light.as_deref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn option(light: Option<&str>, dark: Option<&str>) -> AccentOptionView {
        AccentOptionView {
            id: "blue".to_owned(),
            label: "Blue".to_owned(),
            light: light.map(str::to_owned),
            dark: dark.map(str::to_owned),
        }
    }

    #[test]
    fn swatch_colour_follows_the_style() {
        let blue = option(Some("#3358d4"), Some("#86a4ff"));
        assert_eq!(swatch_color(&blue, false), Some("#3358d4"));
        assert_eq!(swatch_color(&blue, true), Some("#86a4ff"));
    }

    #[test]
    fn swatch_without_a_colour_for_the_style_shows_the_desktop_accent() {
        assert_eq!(swatch_color(&option(None, None), false), None);
        assert_eq!(swatch_color(&option(Some("#3358d4"), None), true), None);
    }
}
