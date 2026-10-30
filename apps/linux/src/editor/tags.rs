use commitnote_markdown::PreviewStyle;
use gtk4::glib::translate::IntoGlib;
use gtk4::{self as gtk, gdk, pango, prelude::*};

const HEADING_SCALES: [f64; 6] = [1.75, 1.25, 1.125, 1.0, 1.0, 1.0];
const CODE_SCALE: f64 = 0.875;
const QUOTE_INDENT: i32 = 12;
const DIM_ALPHA: f32 = 0.55;
const LIST_MARK_ALPHA: f32 = 0.5;
const CODE_BACKGROUND_ALPHA: f32 = 0.08;

/// Tag priority grows along this order, so later styles win where runs overlap: headings
/// keep their scale over inline code, and the foreground goes muted marker, list mark, link,
/// quote, as the iOS editor resolves it.
pub const STYLE_ORDER: [PreviewStyle; 17] = [
    PreviewStyle::CodeBlockLine,
    PreviewStyle::InlineCode,
    PreviewStyle::QuoteLine,
    PreviewStyle::Heading { level: 1 },
    PreviewStyle::Heading { level: 2 },
    PreviewStyle::Heading { level: 3 },
    PreviewStyle::Heading { level: 4 },
    PreviewStyle::Heading { level: 5 },
    PreviewStyle::Heading { level: 6 },
    PreviewStyle::Emphasis,
    PreviewStyle::Strong,
    PreviewStyle::Strikethrough,
    PreviewStyle::Link,
    PreviewStyle::Url,
    PreviewStyle::ListMark,
    PreviewStyle::MutedMarker,
    PreviewStyle::Hidden,
];

pub fn slot(style: PreviewStyle) -> usize {
    match style {
        PreviewStyle::CodeBlockLine => 0,
        PreviewStyle::InlineCode => 1,
        PreviewStyle::QuoteLine => 2,
        PreviewStyle::Heading { level } => 2 + usize::from(level.clamp(1, 6)),
        PreviewStyle::Emphasis => 9,
        PreviewStyle::Strong => 10,
        PreviewStyle::Strikethrough => 11,
        PreviewStyle::Link => 12,
        PreviewStyle::Url => 13,
        PreviewStyle::ListMark => 14,
        PreviewStyle::MutedMarker => 15,
        PreviewStyle::Hidden => 16,
    }
}

pub fn tag_name(style: PreviewStyle) -> String {
    let name = match style {
        PreviewStyle::Heading { level } => return format!("preview-heading-{}", level.clamp(1, 6)),
        PreviewStyle::Emphasis => "emphasis",
        PreviewStyle::Strong => "strong",
        PreviewStyle::Strikethrough => "strikethrough",
        PreviewStyle::InlineCode => "inline-code",
        PreviewStyle::CodeBlockLine => "code-block-line",
        PreviewStyle::QuoteLine => "quote-line",
        PreviewStyle::Link => "link",
        PreviewStyle::Url => "url",
        PreviewStyle::ListMark => "list-mark",
        PreviewStyle::MutedMarker => "muted-marker",
        PreviewStyle::Hidden => "hidden",
    };
    format!("preview-{name}")
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Palette {
    pub foreground: gdk::RGBA,
    pub accent: gdk::RGBA,
    pub left_margin: i32,
}

/// One tag per preview style, owned by a buffer's tag table; only colours change later.
#[derive(Debug)]
pub struct PreviewTags {
    tags: Vec<gtk::TextTag>,
}

impl PreviewTags {
    pub fn new(buffer: &gtk::TextBuffer) -> Self {
        let table = buffer.tag_table();
        let tags = STYLE_ORDER
            .iter()
            .map(|&style| {
                let tag = gtk::TextTag::new(Some(&tag_name(style)));
                configure(&tag, style);
                table.add(&tag);
                tag
            })
            .collect();
        Self { tags }
    }

    pub fn by_slot(&self) -> &[gtk::TextTag] {
        &self.tags
    }

    pub fn set_palette(&self, palette: &Palette) {
        let dimmed = dim(palette.foreground, DIM_ALPHA);
        for (&style, tag) in STYLE_ORDER.iter().zip(&self.tags) {
            match style {
                PreviewStyle::InlineCode => {
                    tag.set_background_rgba(Some(&dim(palette.foreground, CODE_BACKGROUND_ALPHA)));
                }
                PreviewStyle::CodeBlockLine => {
                    tag.set_paragraph_background_rgba(Some(&dim(
                        palette.foreground,
                        CODE_BACKGROUND_ALPHA,
                    )));
                }
                PreviewStyle::QuoteLine => {
                    tag.set_foreground_rgba(Some(&dimmed));
                    tag.set_left_margin(palette.left_margin + QUOTE_INDENT);
                }
                PreviewStyle::Link | PreviewStyle::Url => {
                    tag.set_foreground_rgba(Some(&palette.accent));
                }
                PreviewStyle::ListMark => {
                    tag.set_foreground_rgba(Some(&dim(palette.accent, LIST_MARK_ALPHA)));
                }
                PreviewStyle::MutedMarker => tag.set_foreground_rgba(Some(&dimmed)),
                _ => {}
            }
        }
    }
}

fn dim(color: gdk::RGBA, alpha: f32) -> gdk::RGBA {
    color.with_alpha(color.alpha() * alpha)
}

fn configure(tag: &gtk::TextTag, style: PreviewStyle) {
    match style {
        PreviewStyle::Heading { level } => {
            tag.set_scale(HEADING_SCALES[usize::from(level.clamp(1, 6)) - 1]);
            tag.set_weight(pango::Weight::Semibold.into_glib());
        }
        PreviewStyle::Emphasis => tag.set_style(pango::Style::Italic),
        PreviewStyle::Strong => tag.set_weight(pango::Weight::Semibold.into_glib()),
        PreviewStyle::Strikethrough => tag.set_strikethrough(true),
        PreviewStyle::InlineCode | PreviewStyle::CodeBlockLine => {
            tag.set_family(Some("monospace"));
            tag.set_scale(CODE_SCALE);
        }
        PreviewStyle::Link | PreviewStyle::Url => tag.set_underline(pango::Underline::Single),
        PreviewStyle::Hidden => tag.set_invisible(true),
        PreviewStyle::QuoteLine | PreviewStyle::ListMark | PreviewStyle::MutedMarker => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_style_has_its_own_slot_in_priority_order() {
        for (index, &style) in STYLE_ORDER.iter().enumerate() {
            assert_eq!(slot(style), index);
        }
    }

    #[test]
    fn out_of_range_heading_levels_use_the_nearest_heading_tag() {
        assert_eq!(
            slot(PreviewStyle::Heading { level: 0 }),
            slot(PreviewStyle::Heading { level: 1 })
        );
        assert_eq!(
            slot(PreviewStyle::Heading { level: 9 }),
            slot(PreviewStyle::Heading { level: 6 })
        );
        assert_eq!(
            tag_name(PreviewStyle::Heading { level: 9 }),
            "preview-heading-6"
        );
    }

    #[test]
    fn tag_names_are_unique() {
        let mut names: Vec<String> = STYLE_ORDER.iter().map(|&style| tag_name(style)).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), STYLE_ORDER.len());
    }
}
