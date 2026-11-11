use crate::scanners::{is_space_unit, skip_spaces};

const OPEN_BRACKET: u16 = b'[' as u16;
const CLOSE_BRACKET: u16 = b']' as u16;
const OPEN_PAREN: u16 = b'(' as u16;
const CLOSE_PAREN: u16 = b')' as u16;
const LESS_THAN: u16 = b'<' as u16;
const GREATER_THAN: u16 = b'>' as u16;
const COLON: u16 = b':' as u16;
const BACKSLASH: u16 = b'\\' as u16;
const DOUBLE_QUOTE: u16 = b'"' as u16;
const SINGLE_QUOTE: u16 = b'\'' as u16;
const NEWLINE: u16 = b'\n' as u16;
const SPACE: u16 = b' ' as u16;

const MAX_LABEL_LENGTH: usize = 999;

/// lezer's `LinkReferenceParser`: reads a paragraph's text line by line as a link reference
/// definition.
pub(super) struct LinkReference {
    content: Vec<u16>,
    stage: Stage,
    /// Where the part read last ends.
    pos: usize,
    title: Option<TitleScan>,
}

/// lezer's `RefStage`: the part of the definition read last.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    Start(LabelScan),
    Label,
    Link,
    Title,
    Failed,
}

pub(super) enum ReferenceProgress {
    /// The definition ended before the line just read, which starts another block.
    Complete,
    Failed,
    Pending,
}

enum Scan {
    Found(usize),
    Invalid,
    Incomplete,
}

impl LinkReference {
    /// A reader for a paragraph whose first line is `first_line`, unless that line cannot start
    /// a definition.
    pub(super) fn start(first_line: &[u16]) -> Option<Self> {
        if first_line.first() != Some(&OPEN_BRACKET) {
            return None;
        }
        let mut reference = Self {
            content: first_line.to_vec(),
            stage: Stage::Start(LabelScan::default()),
            pos: 0,
            title: None,
        };
        reference.advance();
        (reference.stage != Stage::Failed).then_some(reference)
    }

    /// lezer's `nextLine`, given the line as its `scrub` leaves it.
    pub(super) fn next_line(&mut self, indent: usize, text: &[u16]) -> ReferenceProgress {
        self.content.push(NEWLINE);
        self.content.extend(std::iter::repeat_n(SPACE, indent));
        self.content.extend_from_slice(text);
        let end = self.advance();
        if self.stage == Stage::Failed {
            ReferenceProgress::Failed
        } else if end.is_some_and(|end| end < self.content.len()) {
            ReferenceProgress::Complete
        } else {
            ReferenceProgress::Pending
        }
    }

    /// lezer's `finish`: whether the paragraph's whole text is a definition.
    pub(super) fn is_complete(&self) -> bool {
        matches!(self.stage, Stage::Link | Stage::Title)
            && skip_spaces(&self.content, self.pos, self.content.len()) == self.content.len()
    }

    /// lezer's `advance`: reads on as far as the text allows, and where the definition would end.
    fn advance(&mut self) -> Option<usize> {
        let content = &self.content;
        loop {
            match self.stage {
                Stage::Failed => return None,
                Stage::Start(mut label) => {
                    let scan = label.resume(content);
                    self.stage = Stage::Start(label);
                    match scan {
                        Scan::Found(end) if content.get(end) == Some(&COLON) => {
                            self.pos = end + 1;
                            self.stage = Stage::Label;
                        }
                        Scan::Found(_) | Scan::Invalid => self.stage = Stage::Failed,
                        Scan::Incomplete => return None,
                    }
                }
                Stage::Label => {
                    match url_end(content, skip_spaces(content, self.pos, content.len())) {
                        Scan::Found(end) => {
                            self.pos = end;
                            self.stage = Stage::Link;
                        }
                        Scan::Invalid => self.stage = Stage::Failed,
                        Scan::Incomplete => return None,
                    }
                }
                Stage::Link => {
                    let skip = skip_spaces(content, self.pos, content.len());
                    let mut end = None;
                    if skip > self.pos
                        && let Some(title_end) = title_end(&mut self.title, content, skip)
                        && let Some(title_line_end) = line_end_after(content, title_end)
                    {
                        self.pos = title_end;
                        self.stage = Stage::Title;
                        end = Some(title_line_end);
                    }
                    return end
                        .or_else(|| line_end_after(content, self.pos))
                        .filter(|&end| end > 0 && end < content.len());
                }
                Stage::Title => return line_end_after(content, self.pos),
            }
        }
    }
}

/// lezer's `parseLinkLabel` for the label a definition starts with, resumed where the text read
/// before ended, as text is only ever added to the end.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
struct LabelScan {
    scanned: usize,
    escaped: bool,
    has_content: bool,
}

impl LabelScan {
    fn resume(&mut self, content: &[u16]) -> Scan {
        let limit = content.len().min(1 + MAX_LABEL_LENGTH);
        let from = self.scanned.max(1);
        for (pos, &unit) in content.iter().enumerate().take(limit).skip(from) {
            self.scanned = pos + 1;
            if self.escaped {
                self.escaped = false;
            } else if unit == CLOSE_BRACKET {
                return if self.has_content {
                    Scan::Found(pos + 1)
                } else {
                    Scan::Invalid
                };
            } else {
                self.has_content |= !is_space_unit(unit);
                if unit == OPEN_BRACKET {
                    return Scan::Invalid;
                }
                self.escaped = unit == BACKSLASH;
            }
        }
        Scan::Incomplete
    }
}

/// lezer's `parseLinkTitle`, resumed where the text read before ended for a title that starts
/// where the last one did.
#[derive(Debug, Clone, Copy)]
struct TitleScan {
    start: usize,
    close: u16,
    scanned: usize,
    escaped: bool,
    end: Option<usize>,
}

fn title_end(scan: &mut Option<TitleScan>, content: &[u16], start: usize) -> Option<usize> {
    let close = match *content.get(start)? {
        quote @ (DOUBLE_QUOTE | SINGLE_QUOTE) => quote,
        OPEN_PAREN => CLOSE_PAREN,
        _ => return None,
    };
    let scan = match scan {
        Some(scan) if scan.start == start => scan,
        _ => scan.insert(TitleScan {
            start,
            close,
            scanned: start + 1,
            escaped: false,
            end: None,
        }),
    };
    if scan.end.is_none() {
        for (pos, &unit) in content.iter().enumerate().skip(scan.scanned) {
            if scan.escaped {
                scan.escaped = false;
            } else if unit == scan.close {
                scan.end = Some(pos + 1);
                break;
            } else {
                scan.escaped = unit == BACKSLASH;
            }
        }
        scan.scanned = content.len();
    }
    scan.end
}

/// lezer's `parseURL`.
fn url_end(content: &[u16], start: usize) -> Scan {
    if content.get(start) == Some(&LESS_THAN) {
        for (pos, &unit) in content.iter().enumerate().skip(start + 1) {
            match unit {
                GREATER_THAN => return Scan::Found(pos + 1),
                LESS_THAN | NEWLINE => return Scan::Invalid,
                _ => {}
            }
        }
        return Scan::Incomplete;
    }
    let mut depth = 0;
    let mut escaped = false;
    let mut pos = start;
    while let Some(&unit) = content.get(pos) {
        if is_space_unit(unit) {
            break;
        } else if escaped {
            escaped = false;
        } else if unit == OPEN_PAREN {
            depth += 1;
        } else if unit == CLOSE_PAREN {
            if depth == 0 {
                break;
            }
            depth -= 1;
        } else if unit == BACKSLASH {
            escaped = true;
        }
        pos += 1;
    }
    if pos > start {
        Scan::Found(pos)
    } else if pos >= content.len() {
        Scan::Incomplete
    } else {
        Scan::Invalid
    }
}

/// lezer's `lineEnd`: where the line at `pos` ends, if only spaces come before.
fn line_end_after(content: &[u16], pos: usize) -> Option<usize> {
    for (index, &unit) in content.iter().enumerate().skip(pos) {
        if unit == NEWLINE {
            return Some(index);
        }
        if !is_space_unit(unit) {
            return None;
        }
    }
    Some(content.len().max(pos))
}
