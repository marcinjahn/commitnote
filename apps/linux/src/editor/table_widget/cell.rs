use std::cell::RefCell;
use std::ops::Range;

use commitnote_markdown::{
    ImageReference, TableAlignment, TableCellContent, TableCellPiece, TableLayoutItem,
    TableTextStyle,
};
use gtk4::subclass::prelude::*;
use gtk4::{self as gtk, gdk, glib, graphene, pango, prelude::*};

use crate::editor::image_source::{EditorImage, ImageSource};
use crate::editor::overlay::{OverlayStyle, dim};
use crate::editor::tags::{CODE_BACKGROUND_ALPHA, CODE_SCALE, DIM_ALPHA};

const IMAGE_FALLBACK: &str = "Image";
const CODE_FAMILY: &str = "monospace";

mod imp {
    use super::*;

    #[derive(Default)]
    pub struct TablePart {
        pub(super) frames: RefCell<Vec<gtk::Allocation>>,
    }

    #[glib::object_subclass]
    impl ObjectSubclass for TablePart {
        const NAME: &'static str = "CommitnoteTablePart";
        type Type = super::TablePart;
        type ParentType = gtk::Widget;
    }

    impl ObjectImpl for TablePart {
        fn dispose(&self) {
            while let Some(child) = self.obj().first_child() {
                child.unparent();
            }
        }
    }

    impl WidgetImpl for TablePart {
        fn size_allocate(&self, _width: i32, _height: i32, _baseline: i32) {
            let frames = self.frames.borrow();
            let mut child = self.obj().first_child();
            for frame in frames.iter() {
                let Some(current) = child else { break };
                place(&current, frame);
                child = current.next_sibling();
            }
        }
    }
}

glib::wrapper! {
    /// A table row or cell: it places its children, in order, at the frames set on it.
    pub struct TablePart(ObjectSubclass<imp::TablePart>)
        @extends gtk::Widget,
        @implements gtk::Accessible, gtk::Buildable, gtk::ConstraintTarget;
}

impl TablePart {
    pub(super) fn new(role: gtk::AccessibleRole) -> Self {
        let part: Self = glib::Object::builder()
            .property("accessible-role", role)
            .build();
        inert(part.upcast_ref());
        part
    }

    /// Frames are relative to this part, one per child in child order.
    pub(super) fn set_frames(&self, frames: Vec<gtk::Allocation>) {
        let mut current = self.imp().frames.borrow_mut();
        if *current != frames {
            *current = frames;
            self.queue_allocate();
        }
    }
}

/// One cell of the table with the widgets that show its pieces.
pub(super) struct TableCell {
    pub(super) part: TablePart,
    items: Vec<CellItem>,
    header: bool,
    alignment: TableAlignment,
}

struct CellItem {
    widget: gtk::Widget,
    kind: ItemKind,
}

enum ItemKind {
    Text(StyledText),
    Image {
        reference: ImageReference,
        shown: ImageShown,
    },
}

#[derive(Debug, Clone, PartialEq)]
enum ImageShown {
    Pending,
    Ready {
        texture: gdk::Texture,
        width: u32,
        height: u32,
    },
}

impl TableCell {
    pub(super) fn new(
        content: &TableCellContent,
        (row, column): (usize, usize),
        alignment: TableAlignment,
        style: &OverlayStyle,
        source: Option<&dyn ImageSource>,
    ) -> Self {
        let header = row == 0;
        let part = TablePart::new(if header {
            gtk::AccessibleRole::ColumnHeader
        } else {
            gtk::AccessibleRole::Cell
        });
        part.set_overflow(gtk::Overflow::Hidden);
        part.update_property(&[gtk::accessible::Property::Label(&content.accessible_label)]);
        part.update_relation(&[
            gtk::accessible::Relation::RowIndex(accessible_index(row)),
            gtk::accessible::Relation::ColIndex(accessible_index(column)),
        ]);
        let mut cell = Self {
            part,
            items: Vec::new(),
            header,
            alignment,
        };
        for spec in item_specs(&content.pieces) {
            let item = match spec {
                ItemSpec::Text(pieces) => {
                    let text = StyledText::new(&content.pieces[pieces]);
                    let widget = cell.text_label(&text, style);
                    CellItem {
                        widget: widget.upcast(),
                        kind: ItemKind::Text(text),
                    }
                }
                ItemSpec::Image(reference) => {
                    let shown = ImageShown::read(source, &reference.image_id);
                    CellItem {
                        widget: cell.image_widget(reference, &shown, style),
                        kind: ItemKind::Image {
                            reference: reference.clone(),
                            shown,
                        },
                    }
                }
            };
            item.widget.set_parent(&cell.part);
            cell.items.push(item);
        }
        cell
    }

    pub(super) fn layout_items(&self, scale: f64) -> Vec<TableLayoutItem> {
        self.items
            .iter()
            .map(|item| item.layout_item(scale))
            .collect()
    }

    /// The natural height of a text item laid out `width` pixels wide.
    pub(super) fn text_height(&self, item: usize, width: i32) -> f64 {
        self.items.get(item).map_or(0.0, |item| {
            f64::from(item.widget.measure(gtk::Orientation::Vertical, width).1)
        })
    }

    /// Frames are relative to the cell, one per item.
    pub(super) fn set_item_frames(&self, frames: Vec<gtk::Allocation>) {
        self.part.set_frames(frames);
    }

    pub(super) fn shows_image(&self, image_id: &str) -> bool {
        self.items.iter().any(|item| {
            matches!(&item.kind, ItemKind::Image { reference, .. } if reference.image_id == image_id)
        })
    }

    pub(super) fn apply_style(&self, style: &OverlayStyle) {
        for item in &self.items {
            let Some(label) = item.widget.downcast_ref::<gtk::Label>() else {
                continue;
            };
            let attributes = match &item.kind {
                ItemKind::Text(text) => text.attributes(self.header, style),
                ItemKind::Image { .. } => muted_attributes(self.header, style),
            };
            label.set_attributes(Some(&attributes));
        }
    }

    /// Swaps the widget of every image whose state changed; true when any did.
    pub(super) fn refresh_images(
        &mut self,
        source: Option<&dyn ImageSource>,
        style: &OverlayStyle,
    ) -> bool {
        let mut changed = false;
        for index in 0..self.items.len() {
            let ItemKind::Image { reference, shown } = &self.items[index].kind else {
                continue;
            };
            let next = ImageShown::read(source, &reference.image_id);
            if *shown == next {
                continue;
            }
            let widget = self.image_widget(reference, &next, style);
            let item = &mut self.items[index];
            widget.insert_after(&self.part, Some(&item.widget));
            item.widget.unparent();
            item.widget = widget;
            if let ItemKind::Image { shown, .. } = &mut item.kind {
                *shown = next;
            }
            changed = true;
        }
        changed
    }

    /// The link of the glyph under a point given in `table`'s coordinates.
    pub(super) fn link_at(&self, table: &gtk::Widget, x: f64, y: f64) -> Option<String> {
        self.items.iter().find_map(|item| {
            let ItemKind::Text(text) = &item.kind else {
                return None;
            };
            let label = item.widget.downcast_ref::<gtk::Label>()?;
            let point = table.compute_point(label, &graphene::Point::new(x as f32, y as f32))?;
            if !label.contains(f64::from(point.x()), f64::from(point.y())) {
                return None;
            }
            let (left, top) = label.layout_offsets();
            let (inside, index, _) = label.layout().xy_to_index(
                pango_units(point.x() - left as f32),
                pango_units(point.y() - top as f32),
            );
            if !inside {
                return None;
            }
            text.link_at(usize::try_from(index).ok()?)
                .map(str::to_owned)
        })
    }

    fn text_label(&self, text: &StyledText, style: &OverlayStyle) -> gtk::Label {
        self.label(&text.text, &text.attributes(self.header, style))
    }

    fn image_widget(
        &self,
        reference: &ImageReference,
        shown: &ImageShown,
        style: &OverlayStyle,
    ) -> gtk::Widget {
        match shown {
            ImageShown::Ready { texture, .. } => {
                let picture = gtk::Picture::builder()
                    .paintable(texture)
                    .content_fit(gtk::ContentFit::Contain)
                    .can_shrink(true)
                    .build();
                if !reference.alt.is_empty() {
                    picture.set_alternative_text(Some(&reference.alt));
                }
                inert(picture.upcast_ref());
                picture.upcast()
            }
            ImageShown::Pending => {
                let text = if reference.alt.is_empty() {
                    IMAGE_FALLBACK
                } else {
                    &reference.alt
                };
                self.label(text, &muted_attributes(self.header, style))
                    .upcast()
            }
        }
    }

    fn label(&self, text: &str, attributes: &pango::AttrList) -> gtk::Label {
        let (xalign, justify) = match self.alignment {
            TableAlignment::Center => (0.5, gtk::Justification::Center),
            TableAlignment::Right => (1.0, gtk::Justification::Right),
            TableAlignment::Left | TableAlignment::Unspecified => (0.0, gtk::Justification::Left),
        };
        let label = gtk::Label::builder()
            .label(text)
            .wrap(true)
            .wrap_mode(pango::WrapMode::WordChar)
            .selectable(false)
            .xalign(xalign)
            .yalign(0.0)
            .justify(justify)
            .attributes(attributes)
            .build();
        inert(label.upcast_ref());
        label
    }
}

impl CellItem {
    fn layout_item(&self, scale: f64) -> TableLayoutItem {
        match &self.kind {
            ItemKind::Image {
                reference,
                shown: ImageShown::Ready { width, height, .. },
            } => {
                let (width, height) = match (reference.width, reference.height) {
                    (Some(width), Some(height)) => (width, height),
                    _ => (*width, *height),
                };
                TableLayoutItem::Image {
                    width: f64::from(width) / scale,
                    height: f64::from(height) / scale,
                }
            }
            _ => match self.widget.downcast_ref::<gtk::Label>() {
                Some(label) => text_widths(label),
                None => TableLayoutItem::Text {
                    min_width: 0.0,
                    max_width: 0.0,
                },
            },
        }
    }
}

impl ImageShown {
    fn read(source: Option<&dyn ImageSource>, image_id: &str) -> Self {
        match source.map(|source| source.image(image_id)) {
            Some(EditorImage::Ready {
                width,
                height,
                frames,
            }) => frames
                .first()
                .map_or(Self::Pending, |(texture, _)| Self::Ready {
                    texture: texture.clone(),
                    width,
                    height,
                }),
            _ => Self::Pending,
        }
    }
}

/// Measures a child for its frame's width before allocating it there, the order GTK expects.
pub(super) fn place(widget: &gtk::Widget, frame: &gtk::Allocation) {
    widget.measure(gtk::Orientation::Vertical, frame.width());
    widget.size_allocate(frame, -1);
}

/// Not focusable and not a pointer target, so the table widget alone takes events.
pub(super) fn inert(widget: &gtk::Widget) {
    widget.set_focusable(false);
    widget.set_can_target(false);
}

pub(super) fn accessible_index(index: usize) -> i32 {
    i32::try_from(index + 1).unwrap_or(i32::MAX)
}

/// The widest word, which never wraps, and the width of the whole text on one line.
fn text_widths(label: &gtk::Label) -> TableLayoutItem {
    let layout = label.layout().copy();
    layout.set_wrap(pango::WrapMode::Word);
    layout.set_width(1);
    let min_width = f64::from(layout.pixel_size().0);
    layout.set_width(-1);
    let max_width = f64::from(layout.pixel_size().0);
    TableLayoutItem::Text {
        min_width,
        max_width,
    }
}

fn pango_units(pixels: f32) -> i32 {
    (pixels * pango::SCALE as f32).round() as i32
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ItemSpec<'a> {
    /// A maximal run of consecutive text pieces, by piece index.
    Text(Range<usize>),
    Image(&'a ImageReference),
}

/// The items a cell shows; a run of text pieces with no text at all shows nothing.
fn item_specs(pieces: &[TableCellPiece]) -> Vec<ItemSpec<'_>> {
    let mut specs = Vec::new();
    let mut run_start = None;
    for (index, piece) in pieces.iter().enumerate() {
        match piece {
            TableCellPiece::Text { .. } => {
                run_start.get_or_insert(index);
            }
            TableCellPiece::Image { reference } => {
                if let Some(start) = run_start.take() {
                    push_text_run(&mut specs, pieces, start..index);
                }
                specs.push(ItemSpec::Image(reference));
            }
        }
    }
    if let Some(start) = run_start {
        push_text_run(&mut specs, pieces, start..pieces.len());
    }
    specs
}

fn push_text_run(specs: &mut Vec<ItemSpec<'_>>, pieces: &[TableCellPiece], run: Range<usize>) {
    let has_text = pieces[run.clone()]
        .iter()
        .any(|piece| matches!(piece, TableCellPiece::Text { text, .. } if !text.is_empty()));
    if has_text {
        specs.push(ItemSpec::Text(run));
    }
}

/// A run of text pieces joined into one string, with each piece's style over its UTF-8 bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
struct StyledText {
    text: String,
    spans: Vec<TextSpan>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TextSpan {
    range: Range<usize>,
    style: TableTextStyle,
    link: Option<String>,
}

impl StyledText {
    fn new(pieces: &[TableCellPiece]) -> Self {
        let mut text = String::new();
        let mut spans = Vec::new();
        for piece in pieces {
            let TableCellPiece::Text {
                text: piece_text,
                style,
                link,
            } = piece
            else {
                continue;
            };
            if piece_text.is_empty() {
                continue;
            }
            let start = text.len();
            text.push_str(piece_text);
            spans.push(TextSpan {
                range: start..text.len(),
                style: *style,
                link: link.clone(),
            });
        }
        Self { text, spans }
    }

    fn link_at(&self, index: usize) -> Option<&str> {
        self.spans
            .iter()
            .find(|span| span.range.contains(&index))
            .and_then(|span| span.link.as_deref())
    }

    fn attributes(&self, header: bool, style: &OverlayStyle) -> pango::AttrList {
        let list = pango::AttrList::new();
        let code_background = dim(
            style.foreground,
            CODE_BACKGROUND_ALPHA.pick(style.high_contrast),
        );
        for span in &self.spans {
            let range = &span.range;
            if span.style.emphasis {
                insert(
                    &list,
                    pango::AttrInt::new_style(pango::Style::Italic),
                    range,
                );
            }
            if span.style.strong && !header {
                insert(
                    &list,
                    pango::AttrInt::new_weight(pango::Weight::Semibold),
                    range,
                );
            }
            if span.style.strikethrough {
                insert(&list, pango::AttrInt::new_strikethrough(true), range);
            }
            if span.style.code {
                insert(&list, pango::AttrString::new_family(CODE_FAMILY), range);
                insert(&list, pango::AttrFloat::new_scale(CODE_SCALE), range);
                insert_background(&list, code_background, range);
            }
            if span.link.is_some() {
                insert_foreground(&list, style.accent, range);
                insert(
                    &list,
                    pango::AttrInt::new_underline(pango::Underline::Single),
                    range,
                );
            }
        }
        if header {
            list.insert(pango::AttrInt::new_weight(pango::Weight::Bold));
        }
        list
    }
}

fn muted_attributes(header: bool, style: &OverlayStyle) -> pango::AttrList {
    let list = pango::AttrList::new();
    insert_foreground(
        &list,
        dim(style.foreground, DIM_ALPHA.pick(style.high_contrast)),
        &(0..usize::MAX),
    );
    if header {
        list.insert(pango::AttrInt::new_weight(pango::Weight::Bold));
    }
    list
}

fn insert(list: &pango::AttrList, attribute: impl Into<pango::Attribute>, range: &Range<usize>) {
    let mut attribute = attribute.into();
    attribute.set_start_index(byte_index(range.start));
    attribute.set_end_index(byte_index(range.end));
    list.insert(attribute);
}

fn insert_foreground(list: &pango::AttrList, color: gdk::RGBA, range: &Range<usize>) {
    let [red, green, blue, alpha] = channels(color);
    insert(
        list,
        pango::AttrColor::new_foreground(red, green, blue),
        range,
    );
    insert(list, pango::AttrInt::new_foreground_alpha(alpha), range);
}

fn insert_background(list: &pango::AttrList, color: gdk::RGBA, range: &Range<usize>) {
    let [red, green, blue, alpha] = channels(color);
    insert(
        list,
        pango::AttrColor::new_background(red, green, blue),
        range,
    );
    insert(list, pango::AttrInt::new_background_alpha(alpha), range);
}

fn byte_index(index: usize) -> u32 {
    u32::try_from(index).unwrap_or(u32::MAX)
}

fn channels(color: gdk::RGBA) -> [u16; 4] {
    [color.red(), color.green(), color.blue(), color.alpha()]
        .map(|channel| (channel.clamp(0.0, 1.0) * f32::from(u16::MAX)).round() as u16)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(text: &str, style: TableTextStyle, link: Option<&str>) -> TableCellPiece {
        TableCellPiece::Text {
            text: text.to_owned(),
            style,
            link: link.map(str::to_owned),
        }
    }

    fn plain(value: &str) -> TableCellPiece {
        text(value, TableTextStyle::default(), None)
    }

    fn image(id: &str) -> TableCellPiece {
        TableCellPiece::Image {
            reference: ImageReference {
                image_id: id.to_owned(),
                width: None,
                height: None,
                alt: String::new(),
                range: 0..0,
            },
        }
    }

    const STRONG: TableTextStyle = TableTextStyle {
        emphasis: false,
        strong: true,
        strikethrough: false,
        code: false,
    };

    #[test]
    fn consecutive_text_pieces_share_one_item_and_images_stand_alone() {
        let pieces = [
            plain("a "),
            text("b", STRONG, None),
            image("x"),
            image("y"),
            plain("c"),
        ];

        let specs = item_specs(&pieces);

        assert_eq!(specs.len(), 4);
        assert_eq!(specs[0], ItemSpec::Text(0..2));
        assert!(matches!(specs[1], ItemSpec::Image(reference) if reference.image_id == "x"));
        assert!(matches!(specs[2], ItemSpec::Image(reference) if reference.image_id == "y"));
        assert_eq!(specs[3], ItemSpec::Text(4..5));
    }

    #[test]
    fn a_blank_cell_and_empty_text_runs_have_no_items() {
        assert!(item_specs(&[]).is_empty());
        let pieces = [plain(""), image("x"), plain("")];

        let specs = item_specs(&pieces);

        assert_eq!(specs.len(), 1);
        assert!(matches!(specs[0], ItemSpec::Image(reference) if reference.image_id == "x"));
    }

    #[test]
    fn styles_and_links_cover_their_pieces_bytes() {
        let styled = StyledText::new(&[
            plain("ż "),
            text("bold", STRONG, None),
            plain(""),
            text(" site", TableTextStyle::default(), Some("https://e.x")),
        ]);

        assert_eq!(styled.text, "ż bold site");
        assert_eq!(
            styled.spans,
            [
                TextSpan {
                    range: 0..3,
                    style: TableTextStyle::default(),
                    link: None,
                },
                TextSpan {
                    range: 3..7,
                    style: STRONG,
                    link: None,
                },
                TextSpan {
                    range: 7..12,
                    style: TableTextStyle::default(),
                    link: Some("https://e.x".to_owned()),
                },
            ]
        );
    }

    #[test]
    fn a_link_is_found_only_inside_its_piece() {
        let styled = StyledText::new(&[
            plain("see "),
            text("shop", TableTextStyle::default(), Some("https://e.x/s")),
        ]);

        assert_eq!(styled.link_at(3), None);
        assert_eq!(styled.link_at(4), Some("https://e.x/s"));
        assert_eq!(styled.link_at(7), Some("https://e.x/s"));
        assert_eq!(styled.link_at(8), None);
    }

    #[test]
    fn colour_channels_scale_to_sixteen_bits() {
        assert_eq!(
            channels(gdk::RGBA::new(1.0, 0.0, 0.5, 0.2)),
            [65535, 0, 32768, 13107]
        );
    }
}
