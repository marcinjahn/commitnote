use std::cmp::Reverse;
use std::ops::Range;

use pulldown_cmark::{CodeBlockKind, Event, LinkType, Options, Parser, Tag, TagEnd};

use crate::scanners;
use crate::syntax::{MarkdownDocument, SyntaxKind, SyntaxNode};

pub fn parse(text: &str) -> MarkdownDocument {
    let units: Vec<u16> = text.encode_utf16().collect();
    let nodes = Builder::new(text, &units).build();
    MarkdownDocument::new(text.to_owned(), nodes, units)
}

fn options() -> Options {
    Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS
}

fn is_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r')
}

fn add_segment(segments: &mut Vec<Range<usize>>, segment: Range<usize>) {
    match segments.last_mut() {
        Some(last) if last.end == segment.start => last.end = segment.end,
        _ => segments.push(segment),
    }
}

/// A node in byte offsets; `depth` orders nodes that share a range.
struct Raw {
    kind: SyntaxKind,
    start: usize,
    end: usize,
    depth: u32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FrameKind {
    Document,
    Paragraph,
    SyntheticParagraph,
    Heading,
    Quote,
    Item,
    Code,
    Html,
    InlineLink { image: bool },
    Other,
}

struct Frame {
    kind: FrameKind,
    node: Option<usize>,
    start: usize,
    child_depth: u32,
    content_end: usize,
    open_link: bool,
    scan: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ContainerKind {
    Quote,
    Item,
}

/// A blockquote or list item, whose markers are found by walking its lines.
struct Container {
    kind: ContainerKind,
    raw: Range<usize>,
    node: usize,
    list: Option<usize>,
    value: usize,
}

struct CodeBlock {
    node: usize,
    raw: Range<usize>,
    fenced: bool,
    in_quote: bool,
    containers: Vec<usize>,
}

struct TextRun {
    start: usize,
    end: usize,
    depth: u32,
    open_link: bool,
}

struct Builder<'a> {
    text: &'a str,
    bytes: &'a [u8],
    units: &'a [u16],
    utf16_at: Vec<usize>,
    line_starts: Vec<usize>,
    nodes: Vec<Raw>,
    urls: Vec<Raw>,
    frames: Vec<Frame>,
    containers: Vec<Container>,
    code_blocks: Vec<CodeBlock>,
    run: Option<TextRun>,
    pending_list: Option<usize>,
    quotes: usize,
    brackets: usize,
    inline_end: usize,
}

impl<'a> Builder<'a> {
    fn new(text: &'a str, units: &'a [u16]) -> Self {
        let mut utf16_at = vec![0; text.len() + 1];
        let mut offset = 0;
        for (index, ch) in text.char_indices() {
            utf16_at[index..index + ch.len_utf8()].fill(offset);
            offset += ch.len_utf16();
        }
        utf16_at[text.len()] = offset;
        let mut line_starts = vec![0];
        line_starts.extend(
            text.bytes()
                .enumerate()
                .filter(|(_, byte)| *byte == b'\n')
                .map(|(index, _)| index + 1),
        );
        Self {
            text,
            bytes: text.as_bytes(),
            units,
            utf16_at,
            line_starts,
            nodes: Vec::with_capacity(text.len() / 4),
            urls: Vec::new(),
            frames: vec![Frame {
                kind: FrameKind::Document,
                node: None,
                start: 0,
                child_depth: 0,
                content_end: 0,
                open_link: false,
                scan: true,
            }],
            containers: Vec::new(),
            code_blocks: Vec::new(),
            run: None,
            pending_list: None,
            quotes: 0,
            brackets: 0,
            inline_end: 0,
        }
    }

    fn build(mut self) -> Vec<SyntaxNode> {
        for (event, range) in Parser::new_ext(self.text, options()).into_offset_iter() {
            let extends_run = matches!(event, Event::Text(_))
                && self.run.as_ref().is_some_and(|run| run.end == range.start);
            if !extends_run {
                self.flush_run();
            }
            self.event(event, range);
        }
        self.flush_run();
        let bases = self.walk_containers();
        self.finish_code_blocks(&bases);
        self.finish()
    }

    fn finish(self) -> Vec<SyntaxNode> {
        let utf16_at = &self.utf16_at;
        let mut nodes: Vec<(Raw, Range<usize>)> = self
            .nodes
            .into_iter()
            .filter(|raw| raw.start <= raw.end)
            .map(|raw| {
                let range = utf16_at[raw.start]..utf16_at[raw.end];
                (raw, range)
            })
            .chain(self.urls.into_iter().map(|raw| {
                let range = raw.start..raw.end;
                (raw, range)
            }))
            .collect();
        nodes.sort_by_key(|(raw, range)| (range.start, Reverse(range.end), raw.depth));
        nodes
            .into_iter()
            .map(|(raw, range)| SyntaxNode::new(raw.kind, range))
            .collect()
    }

    fn push(&mut self, kind: SyntaxKind, range: Range<usize>, depth: u32) -> usize {
        self.nodes.push(Raw {
            kind,
            start: range.start,
            end: range.end,
            depth,
        });
        self.nodes.len() - 1
    }

    fn top(&self) -> &Frame {
        self.frames
            .last()
            .expect("the document frame is never popped")
    }

    fn top_mut(&mut self) -> &mut Frame {
        self.frames
            .last_mut()
            .expect("the document frame is never popped")
    }

    fn push_frame(
        &mut self,
        kind: FrameKind,
        node: Option<usize>,
        start: usize,
        child_depth: u32,
        open_link: bool,
        scan: bool,
    ) {
        let parent = self.top();
        let frame = Frame {
            kind,
            node,
            start,
            child_depth,
            content_end: start,
            open_link: parent.open_link || open_link,
            scan: parent.scan && scan,
        };
        self.frames.push(frame);
    }

    fn push_plain_frame(&mut self, start: usize) {
        let depth = self.top().child_depth;
        self.push_frame(FrameKind::Other, None, start, depth, false, true);
    }

    fn open_containers(&self) -> Vec<usize> {
        self.frames
            .iter()
            .filter_map(|frame| frame.node)
            .filter(|&node| {
                matches!(
                    self.nodes[node].kind,
                    SyntaxKind::Blockquote
                        | SyntaxKind::BulletList
                        | SyntaxKind::OrderedList
                        | SyntaxKind::ListItem
                )
            })
            .collect()
    }

    fn in_raw_block(&self) -> bool {
        matches!(self.top().kind, FrameKind::Code | FrameKind::Html)
    }

    fn event(&mut self, event: Event<'_>, range: Range<usize>) {
        match event {
            Event::Start(tag) => self.start(tag, range),
            Event::End(tag) => self.end(tag, range),
            Event::Text(_) => self.text(range),
            Event::Code(_) => self.inline_code(range),
            Event::HardBreak => {
                let depth = self.inline(&range);
                if self.bytes[range.start] == b'\\' {
                    self.push(SyntaxKind::HardBreak, range, depth);
                } else {
                    let newline = self.trim_newline(range.start, range.end);
                    let spaces = self.bytes[range.start..newline]
                        .iter()
                        .rev()
                        .take_while(|&&byte| byte == b' ')
                        .count();
                    if spaces >= 2 {
                        self.push(SyntaxKind::HardBreak, newline - spaces..range.end, depth);
                    }
                }
            }
            Event::Rule => {
                self.close_synthetic_paragraph();
                let depth = self.top().child_depth;
                let start = self.skip_spaces(range.start, range.end);
                let end = self.trim_newline(start, range.end);
                self.push(SyntaxKind::HorizontalRule, start..end, depth);
            }
            Event::Html(_)
            | Event::InlineHtml(_)
            | Event::InlineMath(_)
            | Event::DisplayMath(_)
            | Event::FootnoteReference(_)
            | Event::SoftBreak
            | Event::TaskListMarker(_) => {
                if !self.in_raw_block() {
                    self.inline(&range);
                }
            }
        }
    }

    fn start(&mut self, tag: Tag<'_>, range: Range<usize>) {
        match tag {
            Tag::Paragraph => {
                self.close_synthetic_paragraph();
                self.open_paragraph(range.start, FrameKind::Paragraph);
            }
            Tag::Heading { level, .. } => {
                self.close_synthetic_paragraph();
                let depth = self.top().child_depth;
                let start = self.skip_spaces(range.start, range.end);
                let level = level as u8;
                let setext =
                    self.bytes[start..self.trim_newline(start, range.end)].contains(&b'\n');
                let kind = if !setext {
                    SyntaxKind::AtxHeading { level }
                } else {
                    SyntaxKind::SetextHeading { level }
                };
                let node = self.push(kind, start..start, depth);
                self.brackets = 0;
                self.push_frame(
                    FrameKind::Heading,
                    Some(node),
                    start,
                    depth + 1,
                    false,
                    true,
                );
            }
            Tag::BlockQuote(_) => {
                self.close_synthetic_paragraph();
                let depth = self.top().child_depth;
                let end = self.composite_end(range.clone(), false);
                let node = self.push(SyntaxKind::Blockquote, range.start..end, depth);
                self.containers.push(Container {
                    kind: ContainerKind::Quote,
                    raw: range.clone(),
                    node,
                    list: None,
                    value: 0,
                });
                self.quotes += 1;
                self.push_frame(
                    FrameKind::Quote,
                    Some(node),
                    range.start,
                    depth + 1,
                    false,
                    true,
                );
            }
            Tag::List(first) => {
                self.close_synthetic_paragraph();
                let depth = self.top().child_depth;
                let kind = if first.is_some() {
                    SyntaxKind::OrderedList
                } else {
                    SyntaxKind::BulletList
                };
                let end = self.composite_end(range.clone(), self.quotes > 0);
                let node = self.push(kind, range.start..end, depth);
                self.pending_list = Some(node);
                self.push_frame(
                    FrameKind::Other,
                    Some(node),
                    range.start,
                    depth + 1,
                    false,
                    true,
                );
            }
            Tag::Item => {
                self.close_synthetic_paragraph();
                let depth = self.top().child_depth;
                let end = self.composite_end(range.clone(), self.quotes > 0);
                let node = self.push(SyntaxKind::ListItem, range.start..end, depth);
                self.containers.push(Container {
                    kind: ContainerKind::Item,
                    raw: range.clone(),
                    node,
                    list: self.pending_list.take(),
                    value: 0,
                });
                self.push_frame(
                    FrameKind::Item,
                    Some(node),
                    range.start,
                    depth + 1,
                    false,
                    true,
                );
            }
            Tag::CodeBlock(kind) => {
                self.close_synthetic_paragraph();
                let depth = self.top().child_depth;
                let fenced = matches!(kind, CodeBlockKind::Fenced(_));
                let kind = if fenced {
                    SyntaxKind::FencedCode
                } else {
                    SyntaxKind::IndentedCode
                };
                let node = self.push(kind, range.clone(), depth);
                self.code_blocks.push(CodeBlock {
                    node,
                    raw: range.clone(),
                    fenced,
                    in_quote: self.quotes > 0,
                    containers: self.open_containers(),
                });
                self.push_frame(
                    FrameKind::Code,
                    Some(node),
                    range.start,
                    depth + 1,
                    false,
                    false,
                );
            }
            Tag::HtmlBlock => {
                self.close_synthetic_paragraph();
                let depth = self.top().child_depth;
                self.push_frame(FrameKind::Html, None, range.start, depth, false, false);
            }
            Tag::Table(_) => {
                self.close_synthetic_paragraph();
                let depth = self.top().child_depth;
                let end = self.trim_newline(range.start, range.end);
                let node = self.push(SyntaxKind::Table, range.start..end, depth);
                self.push_frame(
                    FrameKind::Other,
                    Some(node),
                    range.start,
                    depth + 1,
                    false,
                    true,
                );
            }
            Tag::TableHead | Tag::TableRow => self.push_plain_frame(range.start),
            Tag::TableCell => {
                self.brackets = 0;
                self.push_plain_frame(range.start);
            }
            Tag::Emphasis => self.start_emphasis(SyntaxKind::Emphasis, 1, range),
            Tag::Strong => self.start_emphasis(SyntaxKind::StrongEmphasis, 2, range),
            Tag::Strikethrough => self.start_strikethrough(range),
            Tag::Link { link_type, .. } => self.start_link(link_type, false, range),
            Tag::Image { link_type, .. } => self.start_link(link_type, true, range),
            Tag::Superscript | Tag::Subscript => {
                self.inline(&range);
                self.push_plain_frame(range.start);
            }
            Tag::FootnoteDefinition(_)
            | Tag::DefinitionList
            | Tag::DefinitionListTitle
            | Tag::DefinitionListDefinition
            | Tag::MetadataBlock(_) => {
                self.close_synthetic_paragraph();
                self.push_plain_frame(range.start);
            }
        }
    }

    fn end(&mut self, _tag: TagEnd, range: Range<usize>) {
        self.close_synthetic_paragraph();
        let frame = self.frames.pop().expect("every end has a start");
        match frame.kind {
            FrameKind::Paragraph => self.finish_paragraph(&frame),
            FrameKind::Heading => self.finish_heading(&frame, range.end),
            FrameKind::Quote => self.quotes -= 1,
            FrameKind::InlineLink { image } => self.finish_link(&frame, image, range.end),
            _ => {}
        }
        self.inline_end = self.inline_end.max(range.end);
        let top = self.top_mut();
        top.content_end = top.content_end.max(range.end);
    }

    /// Records inline content, opening the implicit paragraph of a tight list item; returns the depth for its nodes.
    fn inline(&mut self, range: &Range<usize>) -> u32 {
        if self.top().kind == FrameKind::Item {
            let mut start = range.start;
            if start > 0 && self.bytes[start - 1] == b'\\' {
                start -= 1;
            }
            self.open_paragraph(start, FrameKind::SyntheticParagraph);
        }
        self.inline_end = self.inline_end.max(range.end);
        let top = self.top_mut();
        top.content_end = top.content_end.max(range.end);
        top.child_depth
    }

    fn open_paragraph(&mut self, start: usize, kind: FrameKind) {
        let depth = self.top().child_depth;
        let node = self.push(SyntaxKind::Paragraph, start..start, depth);
        self.brackets = 0;
        self.inline_end = start;
        self.push_frame(kind, Some(node), start, depth + 1, false, true);
    }

    fn close_synthetic_paragraph(&mut self) {
        if self.top().kind == FrameKind::SyntheticParagraph {
            let frame = self.frames.pop().expect("checked above");
            self.finish_paragraph(&frame);
        }
    }

    fn finish_paragraph(&mut self, frame: &Frame) {
        let Some(node) = frame.node else { return };
        let start = frame.start;
        let end = if self.inline_end > start {
            self.line_end_at(self.inline_end - 1)
        } else {
            start
        };
        self.nodes[node].end = end;
        let marker = self.bytes.get(start..start + 4);
        let is_task = self.top().kind == FrameKind::Item
            && marker.is_some_and(|marker| {
                marker[0] == b'['
                    && matches!(marker[1], b' ' | b'x' | b'X')
                    && marker[2] == b']'
                    && matches!(marker[3], b' ' | b'\t')
            });
        if is_task {
            let depth = self.nodes[node].depth + 1;
            self.nodes[node].kind = SyntaxKind::Task;
            let checked = self.bytes[start + 1] | 0x20 == b'x';
            self.push(SyntaxKind::TaskMarker { checked }, start..start + 3, depth);
        }
    }

    fn finish_heading(&mut self, frame: &Frame, raw_end: usize) {
        let Some(node) = frame.node else { return };
        let start = frame.start;
        let depth = self.nodes[node].depth + 1;
        if matches!(self.nodes[node].kind, SyntaxKind::AtxHeading { .. }) {
            let line_end = self.line_end_at(start);
            self.nodes[node].end = line_end;
            let open = self.run_length(start, line_end, b'#');
            self.push(SyntaxKind::HeaderMark, start..start + open, depth);
            let end_of_space = self.skip_spaces_back(line_end, start);
            let mut after = end_of_space;
            while after > start && self.bytes[after - 1] == b'#' {
                after -= 1;
            }
            if after != end_of_space && after != start && is_space(self.bytes[after - 1]) {
                self.push(SyntaxKind::HeaderMark, after..end_of_space, depth);
            }
        } else {
            let last = self.trim_newline(start, raw_end);
            let end = self.line_end_at(last.saturating_sub(1).max(start));
            self.nodes[node].end = end;
            let mark_end = self.skip_spaces_back(end, start);
            if mark_end > start {
                let ch = self.bytes[mark_end - 1];
                let mut mark_start = mark_end;
                while mark_start > start && self.bytes[mark_start - 1] == ch {
                    mark_start -= 1;
                }
                self.push(SyntaxKind::HeaderMark, mark_start..mark_end, depth);
            }
        }
    }

    fn start_emphasis(&mut self, kind: SyntaxKind, size: usize, range: Range<usize>) {
        let depth = self.inline(&range);
        let node = self.push(kind, range.clone(), depth);
        self.push(
            SyntaxKind::EmphasisMark,
            range.start..range.start + size,
            depth + 1,
        );
        self.push(
            SyntaxKind::EmphasisMark,
            range.end - size..range.end,
            depth + 1,
        );
        self.push_frame(
            FrameKind::Other,
            Some(node),
            range.start,
            depth + 1,
            false,
            true,
        );
    }

    fn start_strikethrough(&mut self, range: Range<usize>) {
        let depth = self.inline(&range);
        let source = &self.bytes[range.clone()];
        let valid = source.len() >= 4
            && source.starts_with(b"~~")
            && source[2] != b'~'
            && source.ends_with(b"~~")
            && source[source.len() - 3] != b'~';
        if valid {
            let node = self.push(SyntaxKind::Strikethrough, range.clone(), depth);
            self.push(
                SyntaxKind::StrikethroughMark,
                range.start..range.start + 2,
                depth + 1,
            );
            self.push(
                SyntaxKind::StrikethroughMark,
                range.end - 2..range.end,
                depth + 1,
            );
            self.push_frame(
                FrameKind::Other,
                Some(node),
                range.start,
                depth + 1,
                false,
                true,
            );
        } else {
            self.push_frame(FrameKind::Other, None, range.start, depth, false, true);
        }
    }

    fn inline_code(&mut self, range: Range<usize>) {
        if self.in_raw_block() {
            return;
        }
        let depth = self.inline(&range);
        let size = self.run_length(range.start, range.end, b'`');
        self.push(SyntaxKind::InlineCode, range.clone(), depth);
        self.push(
            SyntaxKind::CodeMark,
            range.start..range.start + size,
            depth + 1,
        );
        self.push(SyntaxKind::CodeMark, range.end - size..range.end, depth + 1);
    }

    fn start_link(&mut self, link_type: LinkType, image: bool, range: Range<usize>) {
        let depth = self.inline(&range);
        match link_type {
            LinkType::Inline => {
                let kind = if image {
                    SyntaxKind::Image
                } else {
                    SyntaxKind::Link
                };
                let node = self.push(kind, range.clone(), depth);
                self.push_frame(
                    FrameKind::InlineLink { image },
                    Some(node),
                    range.start,
                    depth + 2,
                    true,
                    true,
                );
            }
            LinkType::Autolink | LinkType::Email => {
                let start = self.utf16_at[range.start];
                let end = self.utf16_at[range.end];
                let valid = end > start + 1
                    && scanners::autolink_length(self.units, start + 1) == Some(end - start - 1);
                if valid {
                    self.push(SyntaxKind::Autolink, range.clone(), depth);
                    self.push(
                        SyntaxKind::LinkMark,
                        range.start..range.start + 1,
                        depth + 1,
                    );
                    self.push(SyntaxKind::Url, range.start + 1..range.end - 1, depth + 1);
                    self.push(SyntaxKind::LinkMark, range.end - 1..range.end, depth + 1);
                }
                self.push_frame(FrameKind::Other, None, range.start, depth + 1, false, false);
            }
            _ => self.push_frame(FrameKind::Other, None, range.start, depth, true, true),
        }
    }

    fn finish_link(&mut self, frame: &Frame, image: bool, end: usize) {
        let Some(node) = frame.node else { return };
        let start = frame.start;
        let depth = self.nodes[node].depth + 1;
        let open_end = start + if image { 2 } else { 1 };
        let Some(close) = (open_end.max(frame.content_end)..end).find(|&i| self.bytes[i] == b']')
        else {
            return;
        };
        self.push(SyntaxKind::LinkMark, start..open_end, depth);
        if open_end < close {
            self.push(SyntaxKind::LinkLabel, open_end..close, depth);
        }
        self.push(SyntaxKind::LinkMark, close..close + 1, depth);
        self.push(SyntaxKind::LinkMark, close + 1..close + 2, depth);
        let destination = self.skip_spaces(close + 2, end - 1);
        if let Some(url) = self.link_destination(destination, end - 1) {
            self.push(SyntaxKind::Url, url, depth);
        }
        self.push(SyntaxKind::LinkMark, end - 1..end, depth);
    }

    fn link_destination(&self, start: usize, limit: usize) -> Option<Range<usize>> {
        if start >= limit {
            return None;
        }
        if self.bytes[start] == b'<' {
            for pos in start + 1..limit {
                match self.bytes[pos] {
                    b'>' => return Some(start..pos + 1),
                    b'<' | b'\n' => return None,
                    _ => {}
                }
            }
            return None;
        }
        let mut depth = 0usize;
        let mut escaped = false;
        let mut pos = start;
        while pos < limit {
            let byte = self.bytes[pos];
            if is_space(byte) {
                break;
            } else if escaped {
                escaped = false;
            } else if byte == b'(' {
                depth += 1;
            } else if byte == b')' {
                if depth == 0 {
                    break;
                }
                depth -= 1;
            } else if byte == b'\\' {
                escaped = true;
            }
            pos += 1;
        }
        (pos > start).then_some(start..pos)
    }

    fn text(&mut self, range: Range<usize>) {
        if self.in_raw_block() {
            return;
        }
        let depth = self.inline(&range);
        if !self.top().scan {
            return;
        }
        if let Some(run) = self.run.as_mut() {
            run.end = range.end;
        } else {
            self.run = Some(TextRun {
                start: range.start,
                end: range.end,
                depth,
                open_link: self.top().open_link,
            });
        }
    }

    /// Scans a run of adjacent text for GFM autolink literals.
    fn flush_run(&mut self) {
        let Some(run) = self.run.take() else { return };
        let start = self.utf16_at[run.start];
        let end = self.utf16_at[run.end];
        let text = &self.units[..end];
        let mut pos = start;
        while pos < end {
            let unit = text[pos];
            if unit == u16::from(b'[') {
                if !(pos > 0 && text[pos - 1] == u16::from(b'\\')) {
                    self.brackets += 1;
                }
            } else if unit == u16::from(b']') {
                self.brackets = self.brackets.saturating_sub(1);
            } else if let Some(link_end) = self.autolink_literal(text, pos, run.open_link) {
                self.urls.push(Raw {
                    kind: SyntaxKind::Url,
                    start: pos,
                    end: link_end,
                    depth: run.depth,
                });
                pos = link_end;
                continue;
            }
            pos += 1;
        }
    }

    /// Matches inside the text run only, but rejects a link the whole text would not accept.
    fn autolink_literal(&self, run_text: &[u16], pos: usize, open_link: bool) -> Option<usize> {
        let unit = run_text[pos];
        let escaped = pos > 0
            && run_text[pos - 1] == u16::from(b'\\')
            && u8::try_from(unit).is_ok_and(|byte| byte.is_ascii_punctuation());
        if unit == u16::from(b'_') || escaped {
            return None;
        }
        let has_open_link = open_link || self.brackets > 0;
        let end = scanners::autolink_literal_end(run_text, pos, has_open_link)?;
        scanners::autolink_literal_end(self.units, pos, has_open_link)?;
        Some(end)
    }

    /// Adds quote and list markers and fixes container starts; returns each line's content start.
    fn walk_containers(&mut self) -> Vec<usize> {
        let mut bases = Vec::with_capacity(self.line_starts.len());
        let mut stack: Vec<usize> = Vec::new();
        let mut next = 0;
        for line in 0..self.line_starts.len() {
            let line_start = self.line_starts[line];
            let line_end = self.line_end(line);
            stack.retain(|&index| self.containers[index].raw.end > line_start);
            while next < self.containers.len() && self.containers[next].raw.start <= line_end {
                stack.push(next);
                next += 1;
            }
            let mut pos = line_start;
            for &index in &stack {
                let first = self.containers[index].raw.start >= line_start;
                let node = self.containers[index].node;
                let depth = self.nodes[node].depth + 1;
                match self.containers[index].kind {
                    ContainerKind::Quote => {
                        let mark = self.skip_spaces(pos, line_end);
                        if mark >= line_end
                            || self.bytes[mark] != b'>'
                            || self.column(line_start, mark) - self.column(line_start, pos) >= 4
                        {
                            break;
                        }
                        if first {
                            self.nodes[node].start = mark;
                        }
                        self.push(SyntaxKind::QuoteMark, mark..mark + 1, depth);
                        pos = mark + 1;
                        if pos < line_end && matches!(self.bytes[pos], b' ' | b'\t') {
                            pos += 1;
                        }
                    }
                    ContainerKind::Item => {
                        let base_column = self.column(line_start, pos);
                        if first {
                            self.nodes[node].start = pos;
                            if let Some(list) = self.containers[index].list {
                                self.nodes[list].start = pos;
                            }
                            let marker = self.skip_spaces(pos, line_end);
                            let marker_end = self.list_marker_end(marker, line_end);
                            self.push(SyntaxKind::ListMark, marker..marker_end, depth);
                            let indent_after = self.column(line_start, marker_end);
                            let content = self.skip_spaces(marker_end, line_end);
                            let content_column = self.column(line_start, content);
                            let column =
                                if content == line_end || content_column >= indent_after + 5 {
                                    indent_after + 1
                                } else {
                                    content_column
                                };
                            self.containers[index].value = column - base_column;
                            pos = self.find_column(line_start, line_end, column);
                        } else {
                            let target = base_column + self.containers[index].value;
                            let content = self.skip_spaces(pos, line_end);
                            if content < line_end && self.column(line_start, content) < target {
                                break;
                            }
                            pos = self.find_column(line_start, line_end, target);
                        }
                    }
                }
            }
            bases.push(pos);
        }
        bases
    }

    fn list_marker_end(&self, marker: usize, line_end: usize) -> usize {
        if marker >= line_end {
            return marker;
        }
        if matches!(self.bytes[marker], b'-' | b'+' | b'*') {
            return marker + 1;
        }
        let digits = marker
            + self.bytes[marker..line_end]
                .iter()
                .take_while(|byte| byte.is_ascii_digit())
                .count();
        if digits > marker && digits < line_end && matches!(self.bytes[digits], b'.' | b')') {
            digits + 1
        } else {
            marker + 1
        }
    }

    fn finish_code_blocks(&mut self, bases: &[usize]) {
        for block in std::mem::take(&mut self.code_blocks) {
            if block.fenced {
                self.finish_fenced_code(&block, bases);
            } else {
                self.finish_indented_code(&block, bases);
            }
            let end = self.nodes[block.node].end;
            for &container in &block.containers {
                let node = &mut self.nodes[container];
                node.end = node.end.max(end);
            }
        }
    }

    fn finish_fenced_code(&mut self, block: &CodeBlock, bases: &[usize]) {
        let depth = self.nodes[block.node].depth + 1;
        let start = self.skip_spaces(block.raw.start, block.raw.end);
        let Some(&fence) = self.bytes.get(start) else {
            return;
        };
        let open_line = self.line_index(start);
        let open_line_end = self.line_end(open_line);
        let fence_length = self.run_length(start, open_line_end, fence);
        self.push(SyntaxKind::CodeMark, start..start + fence_length, depth);
        let info_from = self.skip_spaces(start + fence_length, open_line_end);
        let info_to = self.skip_spaces_back(open_line_end, info_from);
        if info_from < info_to {
            self.push(SyntaxKind::CodeInfo, info_from..info_to, depth);
        }
        let raw_last = self.line_index(self.trim_newline(start, block.raw.end));
        let closing = (raw_last > open_line)
            .then(|| self.closing_fence(raw_last, bases[raw_last], fence, fence_length))
            .flatten();
        let last_content = match closing {
            Some(_) => raw_last - 1,
            None if block.raw.end >= self.bytes.len() && !block.in_quote => {
                self.line_starts.len() - 1
            }
            None => raw_last,
        };
        let mut segments = Vec::new();
        let mut empty = true;
        let mut has_line = false;
        for (index, line) in (open_line + 1..=last_content).enumerate() {
            has_line = true;
            let line_start = self.line_starts[line];
            let line_end = self.line_end(line);
            if index > 0 {
                add_segment(&mut segments, line_start - 1..line_start);
                empty = false;
            }
            let base = bases[line].min(line_end);
            if base < line_end {
                add_segment(&mut segments, base..line_end);
                empty = false;
            }
        }
        let end = if let Some(mark) = closing {
            let closing_start = self.line_starts[raw_last];
            if empty && has_line {
                add_segment(&mut segments, closing_start - 1..closing_start);
            }
            self.push(SyntaxKind::CodeMark, mark, depth);
            self.line_end(raw_last)
        } else if has_line {
            self.line_end(last_content)
        } else {
            open_line_end
        };
        self.nodes[block.node].start = start;
        self.nodes[block.node].end = end;
        for segment in segments {
            self.push(SyntaxKind::CodeText, segment, depth);
        }
    }

    fn closing_fence(
        &self,
        line: usize,
        base: usize,
        fence: u8,
        length: usize,
    ) -> Option<Range<usize>> {
        let line_start = self.line_starts[line];
        let line_end = self.line_end(line);
        let base = base.min(line_end);
        let mark = self.skip_spaces(base, line_end);
        if self.column(line_start, mark) - self.column(line_start, base) >= 4 {
            return None;
        }
        let mark_end = mark + self.run_length(mark, line_end, fence);
        (mark_end - mark >= length && self.skip_spaces(mark_end, line_end) == line_end)
            .then_some(mark..mark_end)
    }

    fn finish_indented_code(&mut self, block: &CodeBlock, bases: &[usize]) {
        let depth = self.nodes[block.node].depth + 1;
        let start = block.raw.start;
        let first = self.line_index(start);
        let last = self.line_index(self.trim_newline(start, block.raw.end));
        let mut end = self.line_end(first);
        let mut segments = Vec::new();
        add_segment(&mut segments, start..end);
        let mut pending = Vec::new();
        for (line, &base) in bases.iter().enumerate().take(last + 1).skip(first + 1) {
            let line_start = self.line_starts[line];
            let line_end = self.line_end(line);
            let base = base.min(line_end);
            if self.skip_spaces(base, line_end) == line_end {
                pending.push(line_start - 1..line_start);
                continue;
            }
            for segment in pending.drain(..) {
                add_segment(&mut segments, segment);
            }
            add_segment(&mut segments, line_start - 1..line_start);
            end = line_end;
            let code_start =
                self.find_column(line_start, line_end, self.column(line_start, base) + 4);
            if code_start < line_end {
                add_segment(&mut segments, code_start..line_end);
            }
        }
        self.nodes[block.node].end = end;
        for segment in segments {
            self.push(SyntaxKind::CodeText, segment, depth);
        }
    }

    /// The end of a container, without its trailing line break and blank lines.
    /// `quoted` also treats lines holding only quote markers as blank.
    fn composite_end(&self, range: Range<usize>, quoted: bool) -> usize {
        let mut end = range.end;
        loop {
            end = self.trim_newline(range.start, end);
            let line_start = self.line_starts[self.line_index(end)];
            let blank = self.bytes[line_start..end]
                .iter()
                .all(|&byte| is_space(byte) || (quoted && byte == b'>'));
            if line_start > range.start && blank {
                end = line_start;
            } else {
                return end;
            }
        }
    }

    fn trim_newline(&self, start: usize, end: usize) -> usize {
        if end > start && self.bytes[end - 1] == b'\n' {
            end - 1
        } else {
            end
        }
    }

    fn skip_spaces(&self, from: usize, to: usize) -> usize {
        let mut pos = from;
        while pos < to && is_space(self.bytes[pos]) {
            pos += 1;
        }
        pos
    }

    fn skip_spaces_back(&self, from: usize, to: usize) -> usize {
        let mut pos = from;
        while pos > to && is_space(self.bytes[pos - 1]) {
            pos -= 1;
        }
        pos
    }

    fn run_length(&self, from: usize, to: usize, byte: u8) -> usize {
        self.bytes[from..to]
            .iter()
            .take_while(|&&b| b == byte)
            .count()
    }

    fn line_index(&self, pos: usize) -> usize {
        self.line_starts.partition_point(|&start| start <= pos) - 1
    }

    fn line_end(&self, line: usize) -> usize {
        self.line_starts
            .get(line + 1)
            .map_or(self.bytes.len(), |next| next - 1)
    }

    fn line_end_at(&self, pos: usize) -> usize {
        self.line_end(self.line_index(pos))
    }

    fn column(&self, line_start: usize, pos: usize) -> usize {
        self.bytes[line_start..pos].iter().fold(0, |column, &byte| {
            if byte == b'\t' {
                column + 4 - column % 4
            } else {
                column + 1
            }
        })
    }

    fn find_column(&self, line_start: usize, line_end: usize, goal: usize) -> usize {
        let mut pos = line_start;
        let mut column = 0;
        while pos < line_end && column < goal {
            column = if self.bytes[pos] == b'\t' {
                column + 4 - column % 4
            } else {
                column + 1
            };
            pos += 1;
        }
        pos
    }
}
