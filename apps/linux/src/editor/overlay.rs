use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt;
use std::ops::Range;
use std::rc::Rc;

use commitnote_editor_text::Utf16Index;
use commitnote_markdown::{CommandResult, Placement, toggle_checkbox};
use gtk4::{self as gtk, gdk, graphene, gsk, pango, prelude::*};

use super::contrast::Contrast;

const CHECKBOX_SCALE: f32 = 0.75;
const CHECKBOX_RADIUS: f32 = 0.2;
const CHECKBOX_BORDER_FRACTION: f32 = 0.125;
const CHECK_MARK_FRACTION: f32 = 0.13;
const UNCHECKED_ALPHA: Contrast = Contrast::new(0.55, 0.85);
pub(super) const RULE_ALPHA: Contrast = Contrast::new(0.2, 0.5);
const MARK_ALPHA: Contrast = Contrast::new(0.8, 1.0);
const RULE_THICKNESS: f32 = 1.0;
const LIGHT_ACCENT_LUMINANCE: f32 = 0.6;
/// GTK draws a zero-alpha foreground as opaque, treating it as unset, so overlaid text gets the
/// smallest alpha it keeps instead.
const HIDDEN_TEXT_ALPHA: f32 = 2.0 / 65535.0;
pub const HIT_SLOP_X: f32 = 8.0;
pub const HIT_SLOP_Y: f32 = 6.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverlayKind {
    Checkbox,
    Rule,
    Image,
    /// Room for a table widget; the widget draws itself, so the painter draws nothing.
    Table,
}

/// The room an overlay takes in the text layout, made with text tags only.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Reserve {
    /// The range is laid out exactly `width` pixels wide; the painter gets that span of its
    /// display line.
    Inline { width: f32 },
    /// `height` extra pixels open below the range's line; the painter gets the line's whole text
    /// width from its text top down to the bottom of that space, or its slot of that space.
    ///
    /// The space is the next displayed line's top margin, or the range's own line's bottom margin
    /// when no displayed line follows. A bottom margin on a line with invisible text, followed by
    /// a displayed line, would break hit testing in GTK 4.20: for a height in it,
    /// `gtk_text_layout_get_iter_at_position` (gtk/gtktextlayout.c) hands the line's whole byte
    /// count, invisible bytes included, to `gtk_text_iter_set_visible_line_index`, which then runs
    /// past the end of the next displayed line and aborts. A height in a top margin is clamped to
    /// the line's first display line instead. GTK paints a top margin as part of its own line,
    /// though, with that line's paragraph background and selection.
    Block { height: f32 },
    /// `height` extra pixels open above the range's line, as that line's own top margin; the
    /// painter gets the line's whole text width from the top of that space down to the line's
    /// bottom, so whatever GTK paints in the space belongs to the covered line.
    Cover { height: f32 },
}

/// A box inside a block reserve, `top` pixels below the reserved space's top edge and
/// left-aligned to the text; it shrinks to fit a narrower line.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Slot {
    pub top: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OverlayStyle {
    pub foreground: gdk::RGBA,
    pub accent: gdk::RGBA,
    pub line_height: f32,
    pub high_contrast: bool,
}

pub type Painter = Rc<dyn Fn(&gtk::Snapshot, &graphene::Rect, &OverlayStyle)>;
pub type Command = Rc<dyn Fn(&str) -> CommandResult>;

#[derive(Clone)]
pub enum HitBehaviour {
    Inert,
    /// A click runs the command over the current buffer text.
    Command(Command),
    /// A click inside the painted area activates the image, in read-only views too.
    Activate(String),
}

/// Something painted over a buffer range instead of its text, which stays in the buffer
/// unchanged.
#[derive(Clone)]
pub struct Overlay {
    pub kind: OverlayKind,
    /// Buffer character offsets.
    pub range: Range<usize>,
    pub reserve: Reserve,
    pub slot: Option<Slot>,
    pub painter: Painter,
    pub hit: HitBehaviour,
}

impl fmt::Debug for Overlay {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Overlay")
            .field("kind", &self.kind)
            .field("range", &self.range)
            .field("reserve", &self.reserve)
            .field("slot", &self.slot)
            .field("hits", &!matches!(self.hit, HitBehaviour::Inert))
            .finish()
    }
}

/// Maps each checkbox and rule placement to its overlay; images and tables have their own
/// passes, which need the view's size.
pub fn overlays(
    placements: &[Placement],
    index: &Utf16Index,
    style: &OverlayStyle,
) -> Vec<Overlay> {
    let unchecked: Painter = Rc::new(|snapshot, rect, style| {
        paint_checkbox(snapshot, rect, style, false);
    });
    let checked: Painter = Rc::new(|snapshot, rect, style| {
        paint_checkbox(snapshot, rect, style, true);
    });
    let rule: Painter = Rc::new(paint_rule);
    let chars =
        |range: &Range<usize>| index.utf16_to_char(range.start)..index.utf16_to_char(range.end);
    placements
        .iter()
        .filter_map(|placement| match placement {
            Placement::Checkbox {
                range,
                checked: is_checked,
            } => {
                let marker = range.clone();
                Some(Overlay {
                    kind: OverlayKind::Checkbox,
                    range: chars(range),
                    reserve: Reserve::Inline {
                        width: style.line_height.round(),
                    },
                    slot: None,
                    painter: if *is_checked {
                        checked.clone()
                    } else {
                        unchecked.clone()
                    },
                    hit: HitBehaviour::Command(Rc::new(move |text| {
                        toggle_checkbox(text, marker.clone())
                    })),
                })
            }
            Placement::Rule { line_range } => Some(Overlay {
                kind: OverlayKind::Rule,
                range: chars(line_range),
                reserve: Reserve::Block { height: 0.0 },
                slot: None,
                painter: rule.clone(),
                hit: HitBehaviour::Inert,
            }),
            Placement::Image { .. } | Placement::Table { .. } => None,
        })
        .collect()
}

/// The overlay's area in buffer coordinates, as handed to its painter.
pub fn overlay_rect(view: &gtk::TextView, overlay: &Overlay) -> graphene::Rect {
    let buffer = view.buffer();
    let start = buffer.iter_at_offset(overlay.range.start as i32);
    match overlay.reserve {
        Reserve::Inline { width } => {
            let end = buffer.iter_at_offset(overlay.range.end as i32);
            let from = view.iter_location(&start);
            let to = view.iter_location(&end);
            let span = if to.y() == from.y() && to.x() > from.x() {
                (to.x() - from.x()) as f32
            } else {
                width
            };
            graphene::Rect::new(from.x() as f32, from.y() as f32, span, from.height() as f32)
        }
        Reserve::Block { height } | Reserve::Cover { height } => {
            let mut line = start;
            line.set_line_offset(0);
            let text = view.iter_location(&line);
            let (line_top, line_height) = view.line_yrange(&line);
            let room = height.round() as i32;
            let span = match overlay.reserve {
                Reserve::Cover { .. } => text.y() - room..line_top + line_height,
                _ => {
                    let below = if next_displayed_line(&line).is_some() {
                        0
                    } else {
                        room
                    };
                    text.y()..line_top + line_height - below + room
                }
            };
            let visible = view.visible_rect();
            let width = visible.x() + visible.width() - view.right_margin() - text.x();
            block_rect(
                text.x() as f32,
                span.start as f32..span.end as f32,
                width.max(0) as f32,
                height,
                overlay.slot,
            )
        }
    }
}

/// The area of a block reserve of `height` pixels whose line's text starts at `left`, spanning
/// `span` down to the reserved space's bottom, `width` pixels at most: all of it, or the slot,
/// placed from the reserved space's top and shrunk to fit.
fn block_rect(
    left: f32,
    span: Range<f32>,
    width: f32,
    height: f32,
    slot: Option<Slot>,
) -> graphene::Rect {
    let Some(slot) = slot else {
        return graphene::Rect::new(left, span.start, width, span.end - span.start);
    };
    let scale = if slot.width > width && slot.width > 0.0 {
        width / slot.width
    } else {
        1.0
    };
    graphene::Rect::new(
        left,
        span.end - height.round() + slot.top,
        (slot.width * scale).round(),
        (slot.height * scale).round(),
    )
}

/// The first displayed character of the first line after `line` that has one; `None` when only
/// invisible text, or an empty last line, follows.
fn next_displayed_line(line: &gtk::TextIter) -> Option<gtk::TextIter> {
    let mut next = *line;
    next.forward_visible_line().then_some(next)
}

/// The buffer characters an overlay must touch to show in the buffer heights `top..=bottom`: the
/// lines displayed there, and the displayed line before them, whose block reserve may be the
/// first line's top margin.
pub fn lines_between(view: &gtk::TextView, top: i32, bottom: i32) -> Range<usize> {
    let (mut first, _) = view.line_at_y(top);
    first.backward_visible_line();
    first.set_line_offset(0);
    let (mut last, _) = view.line_at_y(bottom);
    if !last.ends_line() {
        last.forward_to_line_end();
    }
    first.offset().max(0) as usize..last.offset().max(0) as usize + 1
}

pub fn hit_area(rect: &graphene::Rect) -> graphene::Rect {
    rect.inset_r(-HIT_SLOP_X, -HIT_SLOP_Y)
}

pub type Reserved = Vec<(Range<usize>, gtk::TextTag)>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Margin {
    Above,
    Below,
}

/// The tags that hide overlaid text and reserve room for overlays, kept apart from the preview
/// tags and above them in priority.
#[derive(Debug)]
pub struct OverlayTags {
    table: gtk::TextTagTable,
    source: gtk::TextTag,
    spacing: RefCell<HashMap<i32, gtk::TextTag>>,
    above: RefCell<HashMap<i32, gtk::TextTag>>,
    below: RefCell<HashMap<i32, gtk::TextTag>>,
    natural_widths: RefCell<HashMap<String, i32>>,
}

impl OverlayTags {
    pub fn new(buffer: &gtk::TextBuffer) -> Self {
        let table = buffer.tag_table();
        let source = gtk::TextTag::builder()
            .name("overlay-source")
            .foreground_rgba(&gdk::RGBA::new(0.0, 0.0, 0.0, HIDDEN_TEXT_ALPHA))
            .strikethrough(false)
            .underline(pango::Underline::None)
            .build();
        table.add(&source);
        Self {
            table,
            source,
            spacing: RefCell::default(),
            above: RefCell::default(),
            below: RefCell::default(),
            natural_widths: RefCell::default(),
        }
    }

    /// Forgets measured text widths, for when the font changes.
    pub fn forget_widths(&self) {
        self.natural_widths.borrow_mut().clear();
    }

    pub fn reserved(&self, view: &gtk::TextView, overlays: &[Overlay]) -> Reserved {
        let buffer = view.buffer();
        let mut spans = Vec::with_capacity(overlays.len() * 2);
        let mut reserving = HashSet::new();
        let mut margins: BTreeMap<(usize, Margin), (Range<usize>, i32)> = BTreeMap::new();
        for overlay in overlays {
            let range = overlay.range.clone();
            let from = buffer.iter_at_offset(range.start as i32);
            let to = buffer.iter_at_offset(range.end as i32);
            if !matches!(overlay.kind, OverlayKind::Image | OverlayKind::Table) {
                spans.push((range.clone(), self.source.clone()));
            }
            match overlay.reserve {
                Reserve::Inline { width } => {
                    let text = buffer.text(&from, &to, true);
                    let count = text.chars().count() as i32;
                    if count == 0 {
                        continue;
                    }
                    let target = (width * pango::SCALE as f32).round() as i32;
                    let spacing = (target - self.natural_width(view, &text)) / count;
                    if spacing > 0 {
                        spans.push((range, self.spacing_tag(spacing)));
                    }
                }
                Reserve::Block { height } | Reserve::Cover { height } => {
                    let pixels = height.round() as i32;
                    let mut line = from;
                    line.set_line_offset(0);
                    if pixels <= 0 || !reserving.insert(line.offset()) {
                        continue;
                    }
                    let (line, margin) = match (overlay.reserve, next_displayed_line(&line)) {
                        (Reserve::Cover { .. }, _) => (line, Margin::Above),
                        (_, Some(next)) => (next, Margin::Above),
                        (_, None) => (line, Margin::Below),
                    };
                    let chars = line_chars(&line);
                    margins.entry((chars.start, margin)).or_insert((chars, 0)).1 += pixels;
                }
            }
        }
        for ((_, margin), (chars, pixels)) in margins {
            let tag = match margin {
                Margin::Above => self.above_tag(pixels),
                Margin::Below => self.below_tag(pixels),
            };
            spans.push((chars, tag));
        }
        spans
    }

    /// Moves the tags from `previous` to `wanted`; `full` first clears them from the whole
    /// buffer, for when the text changed under them.
    pub fn apply(
        &self,
        buffer: &gtk::TextBuffer,
        previous: &Reserved,
        wanted: &Reserved,
        full: bool,
    ) {
        let tag_range = |range: &Range<usize>| {
            (
                buffer.iter_at_offset(range.start as i32),
                buffer.iter_at_offset(range.end as i32),
            )
        };
        if full {
            let (start, end) = buffer.bounds();
            for tag in self.all() {
                buffer.remove_tag(&tag, &start, &end);
            }
            for (range, tag) in wanted {
                let (from, to) = tag_range(range);
                buffer.apply_tag(tag, &from, &to);
            }
            return;
        }
        if previous == wanted {
            return;
        }
        let kept: HashSet<&(Range<usize>, gtk::TextTag)> = wanted.iter().collect();
        let had: HashSet<&(Range<usize>, gtk::TextTag)> = previous.iter().collect();
        for span in previous.iter().filter(|span| !kept.contains(span)) {
            let (from, to) = tag_range(&span.0);
            buffer.remove_tag(&span.1, &from, &to);
        }
        for span in wanted.iter().filter(|span| !had.contains(span)) {
            let (from, to) = tag_range(&span.0);
            buffer.apply_tag(&span.1, &from, &to);
        }
    }

    fn all(&self) -> Vec<gtk::TextTag> {
        let mut tags = vec![self.source.clone()];
        tags.extend(self.spacing.borrow().values().cloned());
        tags.extend(self.above.borrow().values().cloned());
        tags.extend(self.below.borrow().values().cloned());
        tags
    }

    fn natural_width(&self, view: &gtk::TextView, text: &str) -> i32 {
        if let Some(&width) = self.natural_widths.borrow().get(text) {
            return width;
        }
        let width = view.create_pango_layout(Some(text)).size().0;
        self.natural_widths
            .borrow_mut()
            .insert(text.to_owned(), width);
        width
    }

    fn spacing_tag(&self, spacing: i32) -> gtk::TextTag {
        self.cached(&self.spacing, spacing, || {
            gtk::TextTag::builder()
                .name(format!("overlay-spacing-{spacing}"))
                .letter_spacing(spacing)
                .build()
        })
    }

    fn above_tag(&self, pixels: i32) -> gtk::TextTag {
        self.cached(&self.above, pixels, || {
            gtk::TextTag::builder()
                .name(format!("overlay-above-{pixels}"))
                .pixels_above_lines(pixels)
                .build()
        })
    }

    fn below_tag(&self, pixels: i32) -> gtk::TextTag {
        self.cached(&self.below, pixels, || {
            gtk::TextTag::builder()
                .name(format!("overlay-below-{pixels}"))
                .pixels_below_lines(pixels)
                .build()
        })
    }

    fn cached(
        &self,
        tags: &RefCell<HashMap<i32, gtk::TextTag>>,
        key: i32,
        create: impl FnOnce() -> gtk::TextTag,
    ) -> gtk::TextTag {
        tags.borrow_mut()
            .entry(key)
            .or_insert_with(|| {
                let tag = create();
                self.table.add(&tag);
                tag
            })
            .clone()
    }
}

/// The characters of the whole line `iter` is on, its line break included.
fn line_chars(iter: &gtk::TextIter) -> Range<usize> {
    let mut start = *iter;
    start.set_line_offset(0);
    let mut end = start;
    end.forward_line();
    start.offset() as usize..end.offset() as usize
}

pub(super) fn dim(color: gdk::RGBA, alpha: f32) -> gdk::RGBA {
    color.with_alpha(color.alpha() * alpha)
}

fn mark_color(accent: gdk::RGBA, high_contrast: bool) -> gdk::RGBA {
    let luminance = 0.2126 * accent.red() + 0.7152 * accent.green() + 0.0722 * accent.blue();
    if luminance > LIGHT_ACCENT_LUMINANCE {
        gdk::RGBA::new(0.0, 0.0, 0.0, MARK_ALPHA.pick(high_contrast))
    } else {
        gdk::RGBA::WHITE
    }
}

fn paint_checkbox(
    snapshot: &gtk::Snapshot,
    rect: &graphene::Rect,
    style: &OverlayStyle,
    checked: bool,
) {
    let side = (style.line_height * CHECKBOX_SCALE)
        .round()
        .min(rect.width())
        .min(rect.height())
        .max(1.0);
    let x = (rect.x() + (rect.width() - side) / 2.0).round();
    let y = (rect.y() + (rect.height() - side) / 2.0).round();
    let bounds = graphene::Rect::new(x, y, side, side);
    let outline = gsk::RoundedRect::from_rect(bounds, side * CHECKBOX_RADIUS);
    if !checked {
        let width = (side * CHECKBOX_BORDER_FRACTION).round().max(1.0);
        let color = dim(style.foreground, UNCHECKED_ALPHA.pick(style.high_contrast));
        snapshot.append_border(&outline, &[width; 4], &[color; 4]);
        return;
    }
    snapshot.push_rounded_clip(&outline);
    snapshot.append_color(&style.accent, &bounds);
    snapshot.pop();
    let mark = gsk::PathBuilder::new();
    mark.move_to(x + side * 0.27, y + side * 0.52);
    mark.line_to(x + side * 0.43, y + side * 0.68);
    mark.line_to(x + side * 0.74, y + side * 0.34);
    let stroke = gsk::Stroke::new((side * CHECK_MARK_FRACTION).max(1.5));
    stroke.set_line_cap(gsk::LineCap::Round);
    stroke.set_line_join(gsk::LineJoin::Round);
    snapshot.append_stroke(
        &mark.to_path(),
        &stroke,
        &mark_color(style.accent, style.high_contrast),
    );
}

fn paint_rule(snapshot: &gtk::Snapshot, rect: &graphene::Rect, style: &OverlayStyle) {
    let y = (rect.y() + (rect.height() - RULE_THICKNESS) / 2.0).round();
    snapshot.append_color(
        &dim(style.foreground, RULE_ALPHA.pick(style.high_contrast)),
        &graphene::Rect::new(rect.x(), y, rect.width(), RULE_THICKNESS),
    );
}

#[cfg(test)]
mod tests {
    use commitnote_editor_text::TextSelection;
    use commitnote_markdown::{RenderMode, parse, render};

    use super::*;

    fn style() -> OverlayStyle {
        OverlayStyle {
            foreground: gdk::RGBA::BLACK,
            accent: gdk::RGBA::BLUE,
            line_height: 19.6,
            high_contrast: false,
        }
    }

    fn overlays_for(text: &str, caret: usize) -> Vec<Overlay> {
        let document = parse(text);
        let output = render(
            &document,
            &[TextSelection::new(caret, 0)],
            RenderMode::Editable,
        );
        overlays(&output.placements, &Utf16Index::new(text), &style())
    }

    #[test]
    fn checkboxes_reserve_a_line_height_and_toggle_their_marker() {
        let text = "- [ ] one\n- [x] two";
        let found = overlays_for(text, text.len());
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].kind, OverlayKind::Checkbox);
        assert_eq!(found[0].range, 2..5);
        assert_eq!(found[0].reserve, Reserve::Inline { width: 20.0 });
        let HitBehaviour::Command(command) = &found[0].hit else {
            panic!("a checkbox does not toggle");
        };
        let result = command(text);
        assert_eq!(
            commitnote_editor_text::apply(&result.edits, text),
            "- [x] one\n- [x] two"
        );
        assert_eq!(found[1].range, 12..15);
    }

    #[test]
    fn a_rule_covers_its_line_only_while_the_caret_is_elsewhere() {
        let text = "a\n\n---\n\nb";
        let found = overlays_for(text, 0);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, OverlayKind::Rule);
        assert_eq!(found[0].range, 3..6);
        assert_eq!(found[0].reserve, Reserve::Block { height: 0.0 });
        assert!(matches!(found[0].hit, HitBehaviour::Inert));
        assert!(overlays_for(text, 4).is_empty());
    }

    #[test]
    fn ranges_are_buffer_characters_after_astral_text() {
        let text = "😀\n- [ ] task";
        let found = overlays_for(text, 0);
        assert_eq!(found[0].range, 4..7);
    }

    #[test]
    fn a_block_without_a_slot_takes_its_whole_span() {
        let rect = block_rect(12.0, 40.0..140.0, 600.0, 80.4, None);
        assert_eq!(
            (rect.x(), rect.y(), rect.width(), rect.height()),
            (12.0, 40.0, 600.0, 100.0)
        );
    }

    #[test]
    fn a_slot_starts_at_the_top_of_the_reserved_space() {
        let slot = Slot {
            top: 4.0,
            width: 300.0,
            height: 72.0,
        };
        let rect = block_rect(12.0, 40.0..140.0, 600.0, 80.4, Some(slot));
        assert_eq!(
            (rect.x(), rect.y(), rect.width(), rect.height()),
            (12.0, 64.0, 300.0, 72.0)
        );
    }

    #[test]
    fn a_wide_slot_shrinks_to_the_line() {
        let slot = Slot {
            top: 0.0,
            width: 400.0,
            height: 100.0,
        };
        let rect = block_rect(0.0, 0.0..120.0, 200.0, 100.0, Some(slot));
        assert_eq!((rect.width(), rect.height()), (200.0, 50.0));
    }

    #[test]
    fn the_check_mark_contrasts_with_the_accent() {
        assert_eq!(mark_color(gdk::RGBA::BLUE, false), gdk::RGBA::WHITE);
        assert_eq!(mark_color(gdk::RGBA::BLUE, true), gdk::RGBA::WHITE);
        assert_eq!(mark_color(gdk::RGBA::WHITE, false).alpha(), 0.8);
        assert_eq!(mark_color(gdk::RGBA::WHITE, true).alpha(), 1.0);
    }

    #[test]
    fn faint_alphas_strengthen_in_high_contrast() {
        let pairs = [
            (UNCHECKED_ALPHA, 0.55, 0.85),
            (RULE_ALPHA, 0.2, 0.5),
            (MARK_ALPHA, 0.8, 1.0),
        ];
        for (alpha, normal, high) in pairs {
            assert_eq!(alpha.pick(false), normal);
            assert_eq!(alpha.pick(true), high);
        }
    }
}
