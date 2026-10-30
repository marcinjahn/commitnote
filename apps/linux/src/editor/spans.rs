use std::ops::Range;

use commitnote_editor_text::Utf16Index;
use commitnote_markdown::StyleRun;

use super::tags::{STYLE_ORDER, slot};

/// For each tag slot, the character ranges it covers, sorted and merged.
pub type Spans = Vec<Vec<Range<usize>>>;

pub fn empty() -> Spans {
    vec![Vec::new(); STYLE_ORDER.len()]
}

pub fn from_runs(runs: &[StyleRun], index: &Utf16Index) -> Spans {
    let mut spans = empty();
    for run in runs {
        let start = index.utf16_to_char(run.range.start);
        let end = index.utf16_to_char(run.range.end);
        if start < end {
            spans[slot(run.style)].push(start..end);
        }
    }
    for ranges in &mut spans {
        merge(ranges);
    }
    spans
}

fn merge(ranges: &mut Vec<Range<usize>>) {
    ranges.sort_unstable_by_key(|range| range.start);
    let mut merged: Vec<Range<usize>> = Vec::with_capacity(ranges.len());
    for range in ranges.drain(..) {
        match merged.last_mut() {
            Some(last) if range.start <= last.end => last.end = last.end.max(range.end),
            _ => merged.push(range),
        }
    }
    *ranges = merged;
}

/// The parts of `ranges` that `minus` does not cover; both sorted and merged.
pub fn subtract(ranges: &[Range<usize>], minus: &[Range<usize>]) -> Vec<Range<usize>> {
    let mut result = Vec::new();
    let mut cut = 0;
    for range in ranges {
        let mut start = range.start;
        while cut < minus.len() && minus[cut].end <= start {
            cut += 1;
        }
        let mut next = cut;
        while start < range.end {
            match minus.get(next) {
                Some(hole) if hole.start < range.end => {
                    if hole.start > start {
                        result.push(start..hole.start);
                    }
                    start = start.max(hole.end);
                    next += 1;
                }
                _ => {
                    result.push(start..range.end);
                    break;
                }
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use commitnote_markdown::PreviewStyle;

    use super::*;

    #[test]
    fn runs_merge_per_style_and_skip_empty_ranges() {
        let runs = [
            StyleRun::new(4..6, PreviewStyle::Hidden),
            StyleRun::new(0..2, PreviewStyle::Hidden),
            StyleRun::new(2..3, PreviewStyle::Hidden),
            StyleRun::new(3..3, PreviewStyle::Strong),
            StyleRun::new(0..6, PreviewStyle::Strong),
        ];
        let spans = from_runs(&runs, &Utf16Index::new("abcdefgh"));
        assert_eq!(spans[slot(PreviewStyle::Hidden)], vec![0..3, 4..6]);
        assert_eq!(spans[slot(PreviewStyle::Strong)], vec![0..6]);
        assert!(spans[slot(PreviewStyle::Emphasis)].is_empty());
    }

    #[test]
    fn runs_after_an_astral_character_map_to_characters() {
        let text = "😀 **b**";
        let runs = [
            StyleRun::new(3..5, PreviewStyle::Hidden),
            StyleRun::new(5..6, PreviewStyle::Strong),
        ];
        let spans = from_runs(&runs, &Utf16Index::new(text));
        assert_eq!(spans[slot(PreviewStyle::Hidden)], vec![2..4]);
        assert_eq!(spans[slot(PreviewStyle::Strong)], vec![4..5]);
    }

    fn ranges(bounds: &[(usize, usize)]) -> Vec<Range<usize>> {
        bounds.iter().map(|&(start, end)| start..end).collect()
    }

    fn subtracted(from: &[(usize, usize)], minus: &[(usize, usize)]) -> Vec<Range<usize>> {
        subtract(&ranges(from), &ranges(minus))
    }

    #[test]
    fn subtract_keeps_only_uncovered_parts() {
        assert_eq!(
            subtracted(&[(0, 10)], &[(2, 4), (6, 7)]),
            ranges(&[(0, 2), (4, 6), (7, 10)])
        );
        assert_eq!(
            subtracted(&[(0, 3), (5, 8)], &[(2, 6)]),
            ranges(&[(0, 2), (6, 8)])
        );
        assert_eq!(subtracted(&[(0, 3)], &[(0, 3)]), ranges(&[]));
        assert_eq!(subtracted(&[(0, 3)], &[]), ranges(&[(0, 3)]));
        assert_eq!(subtracted(&[], &[(0, 3)]), ranges(&[]));
        assert_eq!(
            subtracted(&[(4, 6)], &[(0, 1), (2, 3), (8, 9)]),
            ranges(&[(4, 6)])
        );
        assert_eq!(
            subtracted(&[(0, 4), (6, 9)], &[(3, 7)]),
            ranges(&[(0, 3), (7, 9)])
        );
    }
}
