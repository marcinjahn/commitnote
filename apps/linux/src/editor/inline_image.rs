use std::cell::Cell;
use std::collections::HashMap;
use std::ops::Range;
use std::rc::Rc;

use commitnote_editor_text::Utf16Index;
use commitnote_markdown::{ImageReference, Placement};
use gtk4::{self as gtk, gdk, graphene, gsk, pango, prelude::*};

use super::image_source::{EditorImage, ImageSource};
use super::overlay::{
    HitBehaviour, Overlay, OverlayKind, OverlayStyle, Painter, Reserve, Slot, dim,
};

pub const DESKTOP_MAX_HEIGHT: f32 = 360.0;
pub const NARROW_MAX_HEIGHT: f32 = 260.0;
pub const NARROW_WIDTH: f32 = 768.0;
pub const UNSIZED_HEIGHT: f32 = 160.0;
pub const GAP: f32 = 8.0;
pub const PADDING: f32 = 8.0;
pub const UNAVAILABLE_TEXT: &str = "Image unavailable";
pub const UNAVAILABLE_ICON: &str = "image-missing-symbolic";
pub const ICON_SIZE: i32 = 16;
const ICON_GAP: f32 = 6.0;
const PLACEHOLDER_ALPHA: f32 = 0.08;
const STATUS_ALPHA: f32 = 0.55;
const BORDER_ALPHA: f32 = 0.15;
const BORDER_WIDTH: f32 = 1.0;

/// What image sizes depend on: the text width, whether the view counts as narrow and the
/// display's pixel ratio.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ImageLayout {
    pub available: f32,
    pub narrow: bool,
    pub pixel_ratio: f32,
}

/// The text and icon of the unavailable state, made from the view's font and display.
#[derive(Debug)]
pub struct UnavailableArt {
    pub text: pango::Layout,
    pub icon: Option<gtk::IconPaintable>,
}

/// One painted image reference and the overlay that shows it.
#[derive(Debug, Clone)]
pub struct InlineImage {
    pub image_id: String,
    pub state: EditorImage,
    pub overlay: usize,
}

impl InlineImage {
    pub fn animated(&self) -> bool {
        matches!(&self.state, EditorImage::Ready { frames, .. } if frames.len() > 1)
    }

    pub fn frame(&self, elapsed_ms: u64) -> usize {
        match &self.state {
            EditorImage::Ready { frames, .. } => frame_at(frames, elapsed_ms),
            _ => 0,
        }
    }

    #[cfg(any(test, feature = "testing"))]
    pub fn state_name(&self) -> &'static str {
        match self.state {
            EditorImage::Loading => "loading",
            EditorImage::Unavailable => "unavailable",
            EditorImage::Ready { .. } => "ready",
        }
    }
}

/// The painted size of an image whose pixel dimensions are `dims`, if known: as wide as fits
/// the text, the image's own width in device pixels and the height cap, keeping its ratio.
pub fn image_size(dims: Option<(u32, u32)>, layout: &ImageLayout) -> (f32, f32) {
    let available = layout.available.max(1.0).round();
    let Some((width, height)) = dims.filter(|&(width, height)| width > 0 && height > 0) else {
        return (available, UNSIZED_HEIGHT);
    };
    let max_height = if layout.narrow {
        NARROW_MAX_HEIGHT
    } else {
        DESKTOP_MAX_HEIGHT
    };
    let ratio = width as f32 / height as f32;
    let painted = available
        .min(width as f32 / layout.pixel_ratio.max(1.0))
        .min(max_height * ratio)
        .round()
        .max(1.0);
    (painted, (painted / ratio).round().clamp(1.0, max_height))
}

/// The block that stacks images of these heights, and each one's top within it.
pub fn stack(heights: &[f32]) -> (f32, Vec<f32>) {
    let mut tops = Vec::with_capacity(heights.len());
    let mut top = PADDING / 2.0;
    for height in heights {
        tops.push(top);
        top += height + GAP;
    }
    let gaps = GAP * heights.len().saturating_sub(1) as f32;
    (heights.iter().sum::<f32>() + gaps + PADDING, tops)
}

/// The frame showing `elapsed_ms` into a loop of frames that each last their delay.
pub fn frame_at<T>(frames: &[(T, u32)], elapsed_ms: u64) -> usize {
    let total: u64 = frames.iter().map(|(_, delay)| u64::from(*delay)).sum();
    if frames.len() < 2 || total == 0 {
        return 0;
    }
    let mut left = elapsed_ms % total;
    for (index, (_, delay)) in frames.iter().enumerate() {
        let delay = u64::from(*delay);
        if left < delay {
            return index;
        }
        left -= delay;
    }
    frames.len() - 1
}

/// One overlay per image reference, painted below its line; references on one line stack in
/// that line's block. Overlay indices start at `first`.
pub fn overlays(
    placements: &[Placement],
    index: &Utf16Index,
    source: Option<&dyn ImageSource>,
    layout: &ImageLayout,
    elapsed: &Rc<Cell<u64>>,
    art: Option<&Rc<UnavailableArt>>,
    first: usize,
) -> Vec<(Overlay, InlineImage)> {
    let mut lines: Vec<(Range<usize>, Vec<&ImageReference>)> = Vec::new();
    let mut by_line: HashMap<usize, usize> = HashMap::new();
    for placement in placements {
        if let Placement::Image {
            reference,
            line_range,
            ..
        } = placement
        {
            let line = *by_line.entry(line_range.start).or_insert_with(|| {
                lines.push((line_range.clone(), Vec::new()));
                lines.len() - 1
            });
            lines[line].1.push(reference);
        }
    }
    let mut states: HashMap<&str, EditorImage> = HashMap::new();
    let mut result = Vec::new();
    for (_, references) in lines {
        let shown: Vec<(&ImageReference, EditorImage, (f32, f32))> = references
            .into_iter()
            .map(|reference| {
                let state = states
                    .entry(reference.image_id.as_str())
                    .or_insert_with(|| {
                        source.map_or(EditorImage::Unavailable, |source| {
                            source.image(&reference.image_id)
                        })
                    })
                    .clone();
                let dims = reference.width.zip(reference.height).or(match &state {
                    EditorImage::Ready { width, height, .. } => Some((*width, *height)),
                    _ => None,
                });
                let size = image_size(dims, layout);
                (reference, state, size)
            })
            .collect();
        let heights: Vec<f32> = shown.iter().map(|(_, _, (_, height))| *height).collect();
        let (block, tops) = stack(&heights);
        for ((reference, state, (width, height)), top) in shown.into_iter().zip(tops) {
            let range = &reference.range;
            let overlay = Overlay {
                kind: OverlayKind::Image,
                range: index.utf16_to_char(range.start)..index.utf16_to_char(range.end),
                reserve: Reserve::Block { height: block },
                slot: Some(Slot { top, width, height }),
                painter: painter(&state, elapsed, art),
                hit: HitBehaviour::Activate(reference.image_id.clone()),
            };
            let image = InlineImage {
                image_id: reference.image_id.clone(),
                state,
                overlay: first + result.len(),
            };
            result.push((overlay, image));
        }
    }
    result
}

fn painter(
    state: &EditorImage,
    elapsed: &Rc<Cell<u64>>,
    art: Option<&Rc<UnavailableArt>>,
) -> Painter {
    match state {
        EditorImage::Ready { frames, .. } if !frames.is_empty() => {
            let frames = frames.clone();
            let elapsed = elapsed.clone();
            Rc::new(move |snapshot, rect, style| {
                let (texture, _) = &frames[frame_at(&frames, elapsed.get())];
                paint_texture(snapshot, rect, style, texture);
            })
        }
        EditorImage::Unavailable => {
            let art = art.cloned();
            Rc::new(move |snapshot, rect, style| {
                paint_placeholder(snapshot, rect, style);
                if let Some(art) = &art {
                    paint_unavailable(snapshot, rect, style, art);
                }
            })
        }
        _ => Rc::new(paint_placeholder),
    }
}

fn paint_placeholder(snapshot: &gtk::Snapshot, rect: &graphene::Rect, style: &OverlayStyle) {
    snapshot.append_color(&dim(style.foreground, PLACEHOLDER_ALPHA), rect);
}

fn paint_unavailable(
    snapshot: &gtk::Snapshot,
    rect: &graphene::Rect,
    style: &OverlayStyle,
    art: &UnavailableArt,
) {
    let (text_width, text_height) = art.text.pixel_size();
    let (text_width, text_height) = (text_width as f32, text_height as f32);
    if text_height > rect.height() {
        return;
    }
    let icon_size = ICON_SIZE as f32;
    let icon = art
        .icon
        .as_ref()
        .filter(|_| text_height + ICON_GAP + icon_size <= rect.height());
    let total = text_height + icon.map_or(0.0, |_| icon_size + ICON_GAP);
    let mut top = (rect.y() + (rect.height() - total) / 2.0).round();
    let color = dim(style.foreground, STATUS_ALPHA);
    snapshot.push_clip(rect);
    if let Some(icon) = icon {
        snapshot.save();
        snapshot.translate(&graphene::Point::new(
            (rect.x() + (rect.width() - icon_size) / 2.0).round(),
            top,
        ));
        icon.snapshot_symbolic(
            snapshot,
            f64::from(icon_size),
            f64::from(icon_size),
            &[color],
        );
        snapshot.restore();
        top += icon_size + ICON_GAP;
    }
    snapshot.save();
    snapshot.translate(&graphene::Point::new(
        (rect.x() + (rect.width() - text_width) / 2.0).round(),
        top,
    ));
    snapshot.append_layout(&art.text, &color);
    snapshot.restore();
    snapshot.pop();
}

fn paint_texture(
    snapshot: &gtk::Snapshot,
    rect: &graphene::Rect,
    style: &OverlayStyle,
    texture: &gdk::Texture,
) {
    let (width, height) = (texture.width() as f32, texture.height() as f32);
    if width > 0.0 && height > 0.0 {
        let scale = (rect.width() / width).min(rect.height() / height);
        let (fit_width, fit_height) = (width * scale, height * scale);
        let fitted = graphene::Rect::new(
            rect.x() + (rect.width() - fit_width) / 2.0,
            rect.y() + (rect.height() - fit_height) / 2.0,
            fit_width,
            fit_height,
        );
        snapshot.append_scaled_texture(texture, gsk::ScalingFilter::Trilinear, &fitted);
    }
    let border = dim(style.foreground, BORDER_ALPHA);
    snapshot.append_border(
        &gsk::RoundedRect::from_rect(*rect, 0.0),
        &[BORDER_WIDTH; 4],
        &[border; 4],
    );
}

#[cfg(test)]
mod tests {
    use commitnote_editor_text::TextSelection;
    use commitnote_markdown::{parse, render};

    use super::*;

    const ID_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const ID_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn wide() -> ImageLayout {
        ImageLayout {
            available: 600.0,
            narrow: false,
            pixel_ratio: 1.0,
        }
    }

    struct Loading;

    impl ImageSource for Loading {
        fn image(&self, _: &str) -> EditorImage {
            EditorImage::Loading
        }
    }

    fn images_for(text: &str, source: Option<&dyn ImageSource>) -> Vec<(Overlay, InlineImage)> {
        let document = parse(text);
        let output = render(&document, &[TextSelection::new(0, 0)]);
        overlays(
            &output.placements,
            &Utf16Index::new(text),
            source,
            &wide(),
            &Rc::new(Cell::new(0)),
            None,
            3,
        )
    }

    #[test]
    fn a_sized_image_keeps_its_device_independent_size_and_ratio() {
        assert_eq!(image_size(Some((300, 200)), &wide()), (300.0, 200.0));
        let hidpi = ImageLayout {
            pixel_ratio: 2.0,
            ..wide()
        };
        assert_eq!(image_size(Some((300, 200)), &hidpi), (150.0, 100.0));
    }

    #[test]
    fn an_oversized_image_fits_the_text_width_and_the_height_cap() {
        assert_eq!(image_size(Some((1200, 600)), &wide()), (600.0, 300.0));
        assert_eq!(image_size(Some((400, 1600)), &wide()), (90.0, 360.0));
        let narrow = ImageLayout {
            available: 320.0,
            narrow: true,
            pixel_ratio: 1.0,
        };
        assert_eq!(image_size(Some((400, 1600)), &narrow), (65.0, 260.0));
        assert_eq!(image_size(Some((1000, 500)), &narrow), (320.0, 160.0));
    }

    #[test]
    fn an_unsized_image_takes_the_text_width_and_a_fixed_height() {
        assert_eq!(image_size(None, &wide()), (600.0, UNSIZED_HEIGHT));
        assert_eq!(image_size(Some((0, 10)), &wide()), (600.0, UNSIZED_HEIGHT));
    }

    #[test]
    fn stacked_images_are_spaced_and_padded() {
        assert_eq!(stack(&[100.0]), (108.0, vec![4.0]));
        assert_eq!(stack(&[100.0, 50.0]), (166.0, vec![4.0, 112.0]));
    }

    #[test]
    fn frames_follow_their_delays_in_a_loop() {
        let frames = [((), 100), ((), 50), ((), 200)];
        assert_eq!(frame_at(&frames, 0), 0);
        assert_eq!(frame_at(&frames, 99), 0);
        assert_eq!(frame_at(&frames, 100), 1);
        assert_eq!(frame_at(&frames, 149), 1);
        assert_eq!(frame_at(&frames, 150), 2);
        assert_eq!(frame_at(&frames, 350), 0);
        assert_eq!(frame_at(&frames, 3_500 + 120), 1);
        assert_eq!(frame_at(&[((), 0), ((), 0)], 500), 0);
        assert_eq!(frame_at(&[((), 40)], 500), 0);
    }

    #[test]
    fn references_on_one_line_share_its_block() {
        let text = format!(
            "intro\n![](image:{ID_A}#300x100) ![](image:{ID_B})\n\n![](image:{ID_A}#300x200)\n"
        );
        let found = images_for(&text, Some(&Loading));
        assert_eq!(found.len(), 3);
        let slots: Vec<Slot> = found
            .iter()
            .map(|(overlay, _)| overlay.slot.unwrap())
            .collect();
        let first_block = 100.0 + GAP + UNSIZED_HEIGHT + PADDING;
        for (overlay, _) in &found[..2] {
            assert_eq!(
                overlay.reserve,
                Reserve::Block {
                    height: first_block
                }
            );
            assert_eq!(overlay.kind, OverlayKind::Image);
        }
        assert_eq!(
            slots[0],
            Slot {
                top: 4.0,
                width: 300.0,
                height: 100.0
            }
        );
        assert_eq!(
            slots[1],
            Slot {
                top: 4.0 + 100.0 + GAP,
                width: 600.0,
                height: UNSIZED_HEIGHT
            }
        );
        assert_eq!(found[2].0.reserve, Reserve::Block { height: 208.0 });
        assert_eq!(found[0].0.range.start, 6);
        let ids: Vec<(&str, &str, usize)> = found
            .iter()
            .map(|(_, image)| (image.image_id.as_str(), image.state_name(), image.overlay))
            .collect();
        assert_eq!(
            ids,
            [
                (ID_A, "loading", 3),
                (ID_B, "loading", 4),
                (ID_A, "loading", 5)
            ]
        );
        let HitBehaviour::Activate(activated) = &found[1].0.hit else {
            panic!("an image does not activate");
        };
        assert_eq!(activated, ID_B);
    }

    #[test]
    fn without_a_source_every_image_is_unavailable() {
        let found = images_for(&format!("![](image:{ID_A})"), None);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].1.state_name(), "unavailable");
    }
}
