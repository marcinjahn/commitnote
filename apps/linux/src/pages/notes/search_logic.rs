use commitnote_core_api::commands::SnippetPart;
use gtk4::{gdk, pango};

const MATCH_BACKGROUND_ALPHA: u16 = 0x4000;

pub fn utf16_range_to_bytes(text: &str, (start, end): (u32, u32)) -> Option<(usize, usize)> {
    if start > end {
        return None;
    }
    let mut units = 0_u32;
    let mut start_byte = None;
    let mut end_byte = None;
    for (byte, ch) in text.char_indices() {
        if units == start {
            start_byte = Some(byte);
        }
        if units == end {
            end_byte = Some(byte);
            break;
        }
        units += ch.len_utf16() as u32;
    }
    if units == start && start_byte.is_none() {
        start_byte = Some(text.len());
    }
    if units == end && end_byte.is_none() {
        end_byte = Some(text.len());
    }
    Some((start_byte?, end_byte?))
}

fn bold(start: usize, end: usize) -> pango::AttrInt {
    let mut weight = pango::AttrInt::new_weight(pango::Weight::Bold);
    weight.set_start_index(start as u32);
    weight.set_end_index(end as u32);
    weight
}

fn channel(value: f32) -> u16 {
    (value.clamp(0.0, 1.0) * f32::from(u16::MAX)).round() as u16
}

fn highlight(attrs: &pango::AttrList, start: usize, end: usize, accent: &gdk::RGBA) {
    attrs.insert(bold(start, end));
    let (red, green, blue) = (
        channel(accent.red()),
        channel(accent.green()),
        channel(accent.blue()),
    );
    let mut background = pango::AttrColor::new_background(red, green, blue);
    background.set_start_index(start as u32);
    background.set_end_index(end as u32);
    attrs.insert(background);
    let mut alpha = pango::AttrInt::new_background_alpha(MATCH_BACKGROUND_ALPHA);
    alpha.set_start_index(start as u32);
    alpha.set_end_index(end as u32);
    attrs.insert(alpha);
}

pub fn name_attributes(name: &str, ranges: &[(u32, u32)]) -> pango::AttrList {
    let attrs = pango::AttrList::new();
    for range in ranges {
        if let Some((start, end)) = utf16_range_to_bytes(name, *range)
            && start < end
        {
            attrs.insert(bold(start, end));
        }
    }
    attrs
}

pub fn snippet_markup(parts: &[SnippetPart], accent: &gdk::RGBA) -> (String, pango::AttrList) {
    let attrs = pango::AttrList::new();
    let mut text = String::new();
    for part in parts {
        let start = text.len();
        text.push_str(&part.text);
        if part.is_match && text.len() > start {
            highlight(&attrs, start, text.len(), accent);
        }
    }
    (text, attrs)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn weight_ranges(attrs: &pango::AttrList) -> Vec<(u32, u32)> {
        attrs
            .attributes()
            .iter()
            .filter(|attr| attr.type_() == pango::AttrType::Weight)
            .map(|attr| (attr.start_index(), attr.end_index()))
            .collect()
    }

    fn background_ranges(attrs: &pango::AttrList) -> Vec<(u32, u32)> {
        attrs
            .attributes()
            .iter()
            .filter(|attr| attr.type_() == pango::AttrType::Background)
            .map(|attr| (attr.start_index(), attr.end_index()))
            .collect()
    }

    fn accent() -> gdk::RGBA {
        gdk::RGBA::new(0.5, 0.25, 1.0, 1.0)
    }

    fn part(text: &str, is_match: bool) -> SnippetPart {
        SnippetPart {
            text: text.to_owned(),
            is_match,
        }
    }

    #[test]
    fn converts_ascii_ranges() {
        assert_eq!(utf16_range_to_bytes("hello world", (6, 11)), Some((6, 11)));
        assert_eq!(utf16_range_to_bytes("hello", (0, 0)), Some((0, 0)));
        assert_eq!(utf16_range_to_bytes("hello", (5, 5)), Some((5, 5)));
    }

    #[test]
    fn converts_polish_diacritics_to_byte_offsets() {
        let text = "Zażółć gęślą jaźń";
        assert_eq!(utf16_range_to_bytes(text, (0, 6)), Some((0, 10)));
        let (start, end) = utf16_range_to_bytes(text, (7, 12)).unwrap();
        assert_eq!(&text[start..end], "gęślą");
        let (start, end) = utf16_range_to_bytes(text, (13, 17)).unwrap();
        assert_eq!(&text[start..end], "jaźń");
    }

    #[test]
    fn counts_an_emoji_as_two_utf16_units() {
        let text = "🙂 note";
        assert_eq!(utf16_range_to_bytes(text, (3, 7)), Some((5, 9)));
        assert_eq!(utf16_range_to_bytes(text, (0, 2)), Some((0, 4)));
    }

    #[test]
    fn rejects_ranges_inside_a_surrogate_pair() {
        let text = "🙂 note";
        assert_eq!(utf16_range_to_bytes(text, (1, 3)), None);
        assert_eq!(utf16_range_to_bytes(text, (0, 1)), None);
    }

    #[test]
    fn rejects_out_of_range_and_reversed_ranges() {
        assert_eq!(utf16_range_to_bytes("abc", (1, 4)), None);
        assert_eq!(utf16_range_to_bytes("abc", (4, 5)), None);
        assert_eq!(utf16_range_to_bytes("abc", (2, 1)), None);
        assert_eq!(utf16_range_to_bytes("", (0, 1)), None);
    }

    #[test]
    fn name_attributes_bolds_each_valid_range() {
        let attrs = name_attributes("Zażółć gęślą", &[(0, 3), (7, 12)]);
        assert_eq!(weight_ranges(&attrs), vec![(0, 4), (11, 19)]);
    }

    #[test]
    fn name_attributes_marks_text_after_an_emoji() {
        let attrs = name_attributes("🙂 note", &[(3, 7)]);
        assert_eq!(weight_ranges(&attrs), vec![(5, 9)]);
    }

    #[test]
    fn name_attributes_keeps_adjacent_ranges_separate() {
        let attrs = name_attributes("abcdef", &[(0, 3), (3, 6)]);
        assert_eq!(weight_ranges(&attrs), vec![(0, 3), (3, 6)]);
    }

    #[test]
    fn name_attributes_skips_invalid_and_empty_ranges() {
        let attrs = name_attributes("🙂abc", &[(1, 2), (2, 9), (3, 3), (2, 4)]);
        assert_eq!(weight_ranges(&attrs), vec![(4, 6)]);
    }

    #[test]
    fn snippet_markup_concatenates_parts_and_marks_matches() {
        let parts = [part("a ", false), part("żółw", true), part(" run", false)];
        let (text, attrs) = snippet_markup(&parts, &accent());
        assert_eq!(text, "a żółw run");
        assert_eq!(weight_ranges(&attrs), vec![(2, 9)]);
        assert_eq!(background_ranges(&attrs), vec![(2, 9)]);
    }

    #[test]
    fn snippet_markup_uses_the_given_accent_with_a_translucent_background() {
        let parts = [part("a ", false), part("żółw", true)];
        let (_, attrs) = snippet_markup(&parts, &accent());
        let attributes = attrs.attributes();
        let background = attributes
            .iter()
            .find(|attr| attr.type_() == pango::AttrType::Background)
            .and_then(|attr| attr.downcast_ref::<pango::AttrColor>())
            .expect("background attribute")
            .color();
        assert_eq!(
            (background.red(), background.green(), background.blue()),
            (0x8000, 0x4000, 0xffff)
        );
        let alpha = attributes
            .iter()
            .find(|attr| attr.type_() == pango::AttrType::BackgroundAlpha)
            .and_then(|attr| attr.downcast_ref::<pango::AttrInt>())
            .expect("alpha attribute")
            .value();
        assert_eq!(alpha, i32::from(MATCH_BACKGROUND_ALPHA));

        let other = gdk::RGBA::new(1.0, 0.0, 0.0, 1.0);
        let (_, attrs) = snippet_markup(&parts, &other);
        let attributes = attrs.attributes();
        let background = attributes
            .iter()
            .find(|attr| attr.type_() == pango::AttrType::Background)
            .and_then(|attr| attr.downcast_ref::<pango::AttrColor>())
            .unwrap()
            .color();
        assert_eq!(
            (background.red(), background.green(), background.blue()),
            (0xffff, 0, 0)
        );
    }

    #[test]
    fn snippet_markup_handles_adjacent_matches_and_emoji() {
        let parts = [part("🙂", false), part("ab", true), part("cd", true)];
        let (text, attrs) = snippet_markup(&parts, &accent());
        assert_eq!(text, "🙂abcd");
        assert_eq!(weight_ranges(&attrs), vec![(4, 6), (6, 8)]);
    }

    #[test]
    fn snippet_markup_ignores_empty_matches_and_empty_input() {
        let (text, attrs) = snippet_markup(&[part("x", false), part("", true)], &accent());
        assert_eq!(text, "x");
        assert!(weight_ranges(&attrs).is_empty());
        let (text, attrs) = snippet_markup(&[], &accent());
        assert!(text.is_empty());
        assert!(attrs.attributes().is_empty());
    }
}
