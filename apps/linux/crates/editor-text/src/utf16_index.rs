/// Maps between UTF-16 code unit offsets and Unicode scalar value (`char`) offsets.
///
/// Only characters outside the Basic Multilingual Plane occupy two UTF-16 units, so the
/// index records the `char` position of each of those and answers both directions with
/// a binary search over that list.
#[derive(Debug, Clone, Default)]
pub struct Utf16Index {
    astral_chars: Vec<usize>,
    char_count: usize,
}

impl Utf16Index {
    pub fn new(text: &str) -> Self {
        let mut astral_chars = Vec::new();
        let mut char_count = 0;
        for c in text.chars() {
            if c.len_utf16() == 2 {
                astral_chars.push(char_count);
            }
            char_count += 1;
        }
        Self {
            astral_chars,
            char_count,
        }
    }

    pub fn len_utf16(&self) -> usize {
        self.char_count + self.astral_chars.len()
    }

    pub fn len_chars(&self) -> usize {
        self.char_count
    }

    pub fn char_to_utf16(&self, char_offset: usize) -> usize {
        let char_offset = char_offset.min(self.char_count);
        let before = self
            .astral_chars
            .partition_point(|&position| position < char_offset);
        char_offset + before
    }

    pub fn utf16_to_char(&self, offset: usize) -> usize {
        let offset = offset.min(self.len_utf16());
        let (mut low, mut high) = (0, self.astral_chars.len());
        while low < high {
            let mid = low + (high - low) / 2;
            if self.astral_chars[mid] + mid < offset {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        match low.checked_sub(1) {
            Some(last) if self.astral_chars[last] + last + 1 == offset => self.astral_chars[last],
            _ => offset - low,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_text_has_no_offsets() {
        let index = Utf16Index::new("");
        assert_eq!(index.len_utf16(), 0);
        assert_eq!(index.len_chars(), 0);
        assert_eq!(index.utf16_to_char(0), 0);
        assert_eq!(index.char_to_utf16(0), 0);
        assert_eq!(index.utf16_to_char(5), 0);
        assert_eq!(index.char_to_utf16(5), 0);
    }

    #[test]
    fn ascii_offsets_are_identical() {
        let index = Utf16Index::new("hello");
        assert_eq!(index.len_utf16(), 5);
        for offset in 0..=5 {
            assert_eq!(index.utf16_to_char(offset), offset);
            assert_eq!(index.char_to_utf16(offset), offset);
        }
    }

    #[test]
    fn two_byte_and_three_byte_characters_count_as_one_unit() {
        let text = "é世a界ñ";
        let index = Utf16Index::new(text);
        assert_eq!(index.len_utf16(), 5);
        assert_eq!(index.len_chars(), 5);
        for offset in 0..=5 {
            assert_eq!(index.utf16_to_char(offset), offset);
            assert_eq!(index.char_to_utf16(offset), offset);
        }
    }

    #[test]
    fn astral_characters_count_as_two_units() {
        let index = Utf16Index::new("a😀b🙂");
        assert_eq!(index.len_utf16(), 6);
        assert_eq!(index.len_chars(), 4);

        assert_eq!(index.char_to_utf16(0), 0);
        assert_eq!(index.char_to_utf16(1), 1);
        assert_eq!(index.char_to_utf16(2), 3);
        assert_eq!(index.char_to_utf16(3), 4);
        assert_eq!(index.char_to_utf16(4), 6);

        assert_eq!(index.utf16_to_char(0), 0);
        assert_eq!(index.utf16_to_char(1), 1);
        assert_eq!(index.utf16_to_char(3), 2);
        assert_eq!(index.utf16_to_char(4), 3);
        assert_eq!(index.utf16_to_char(6), 4);
    }

    #[test]
    fn an_offset_inside_a_surrogate_pair_maps_to_the_start_of_the_character() {
        let index = Utf16Index::new("a😀b🙂");
        assert_eq!(index.utf16_to_char(2), 1);
        assert_eq!(index.utf16_to_char(5), 3);
    }

    #[test]
    fn text_made_only_of_astral_characters() {
        let index = Utf16Index::new("😀😀😀");
        assert_eq!(index.len_utf16(), 6);
        assert_eq!(index.utf16_to_char(0), 0);
        assert_eq!(index.utf16_to_char(1), 0);
        assert_eq!(index.utf16_to_char(2), 1);
        assert_eq!(index.utf16_to_char(3), 1);
        assert_eq!(index.utf16_to_char(4), 2);
        assert_eq!(index.utf16_to_char(6), 3);
    }

    #[test]
    fn combining_marks_are_separate_characters() {
        let text = "e\u{301}x";
        let index = Utf16Index::new(text);
        assert_eq!(index.len_utf16(), 3);
        assert_eq!(index.len_chars(), 3);
        assert_eq!(index.utf16_to_char(2), 2);
        assert_eq!(index.char_to_utf16(2), 2);

        let emoji = "👍\u{1F3FD}";
        let index = Utf16Index::new(emoji);
        assert_eq!(index.len_chars(), 2);
        assert_eq!(index.len_utf16(), 4);
        assert_eq!(index.char_to_utf16(1), 2);
        assert_eq!(index.utf16_to_char(2), 1);
    }

    #[test]
    fn out_of_range_offsets_clamp_to_the_end() {
        let index = Utf16Index::new("a😀é");
        assert_eq!(index.len_utf16(), 4);
        assert_eq!(index.utf16_to_char(4), 3);
        assert_eq!(index.utf16_to_char(5), 3);
        assert_eq!(index.utf16_to_char(usize::MAX), 3);
        assert_eq!(index.char_to_utf16(3), 4);
        assert_eq!(index.char_to_utf16(4), 4);
        assert_eq!(index.char_to_utf16(usize::MAX), 4);
    }

    #[test]
    fn round_trips_every_boundary_of_a_mixed_string() {
        let text = "ab é 世界 😀🙂 e\u{301} \u{10600}x\n👍\u{1F3FD}z";
        let index = Utf16Index::new(text);
        let mut utf16 = 0;
        for (char_offset, c) in text.chars().enumerate() {
            assert_eq!(index.char_to_utf16(char_offset), utf16);
            assert_eq!(index.utf16_to_char(utf16), char_offset);
            if c.len_utf16() == 2 {
                assert_eq!(index.utf16_to_char(utf16 + 1), char_offset);
            }
            utf16 += c.len_utf16();
        }
        assert_eq!(index.char_to_utf16(text.chars().count()), utf16);
        assert_eq!(index.utf16_to_char(utf16), text.chars().count());
        assert_eq!(index.len_utf16(), text.encode_utf16().count());
        assert_eq!(index.len_utf16(), utf16);
    }

    #[test]
    fn a_large_note_is_indexed_and_queried_consistently() {
        let text = "line é 😀 世界\n".repeat(7_000);
        let index = Utf16Index::new(&text);
        let total_chars = text.chars().count();
        assert_eq!(index.len_utf16(), text.encode_utf16().count());
        assert_eq!(index.utf16_to_char(index.len_utf16()), total_chars);
        for char_offset in (0..=total_chars).step_by(997) {
            let utf16 = index.char_to_utf16(char_offset);
            assert_eq!(index.utf16_to_char(utf16), char_offset);
        }
    }
}
