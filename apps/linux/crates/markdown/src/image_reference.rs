use std::ops::Range;

use crate::parse;
use crate::syntax::{MarkdownDocument, SyntaxKind, SyntaxNode};

const SCHEME: &str = "image:";
const ID_LENGTH: usize = 26;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageReference {
    pub image_id: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub alt: String,
    pub range: Range<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageTarget {
    pub image_id: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

impl ImageReference {
    /// Parses `image:<26 base32 chars>` with an optional `#WxH` suffix.
    pub fn parse(url: &str) -> Option<ImageTarget> {
        let units: Vec<u16> = url.encode_utf16().collect();
        let prefix: Vec<u16> = SCHEME.encode_utf16().collect();
        let id_end = prefix.len() + ID_LENGTH;
        if units.len() < id_end || units[..prefix.len()] != prefix[..] {
            return None;
        }
        let is_id_unit = |unit: &u16| (97..=122).contains(unit) || (50..=55).contains(unit);
        if !units[prefix.len()..id_end].iter().all(is_id_unit) {
            return None;
        }
        let image_id = String::from_utf16_lossy(&units[prefix.len()..id_end]);
        if units.len() == id_end {
            return Some(ImageTarget {
                image_id,
                width: None,
                height: None,
            });
        }
        if units[id_end] != 35 {
            return None;
        }
        let separator = id_end + 1 + units[id_end + 1..].iter().position(|&unit| unit == 120)?;
        let width = dimension(&units[id_end + 1..separator])?;
        let height = dimension(&units[separator + 1..])?;
        Some(ImageTarget {
            image_id,
            width: Some(width),
            height: Some(height),
        })
    }

    /// Removes the backslash from escaped ASCII punctuation.
    pub fn unescaped_alt(alt: &str) -> String {
        let units: Vec<u16> = alt.encode_utf16().collect();
        let mut result = Vec::with_capacity(units.len());
        let mut index = 0;
        while index < units.len() {
            if units[index] == 92 && index + 1 < units.len() && is_escapable(units[index + 1]) {
                result.push(units[index + 1]);
                index += 2;
            } else {
                result.push(units[index]);
                index += 1;
            }
        }
        String::from_utf16_lossy(&result)
    }

    pub fn contains_reference(text: &str) -> bool {
        if !text.contains(SCHEME) {
            return false;
        }
        let document = parse(text);
        document
            .nodes
            .iter()
            .any(|node| Self::reference_for(node, &document).is_some())
    }

    /// The reference described by an `image` node, or `None` when its destination is not an image reference.
    pub fn reference_for(node: &SyntaxNode, document: &MarkdownDocument) -> Option<ImageReference> {
        if node.kind != SyntaxKind::Image {
            return None;
        }
        let inside: Vec<&SyntaxNode> = document
            .nodes_overlapping(node.range.clone())
            .into_iter()
            .filter(|inner| {
                node.range.contains(&inner.range.start) && inner.range.end <= node.range.end
            })
            .collect();
        let openings: Vec<&&SyntaxNode> = inside
            .iter()
            .filter(|inner| {
                inner.kind == SyntaxKind::LinkMark && document.slice(inner.range.clone()) == "("
            })
            .collect();
        let url = inside.iter().find(|url| {
            url.kind == SyntaxKind::Url
                && openings
                    .iter()
                    .any(|opening| opening.range.end == url.range.start)
        })?;
        let target = Self::parse(&document.slice(url.range.clone()))?;
        let closing = inside.iter().rev().find(|inner| {
            inner.kind == SyntaxKind::LinkMark && inner.range.end < url.range.start
        })?;
        let opening = inside
            .iter()
            .find(|inner| inner.kind == SyntaxKind::LinkMark)?;
        let alt = document.slice(opening.range.end..closing.range.start);
        Some(ImageReference {
            image_id: target.image_id,
            width: target.width,
            height: target.height,
            alt: Self::unescaped_alt(&alt),
            range: node.range.clone(),
        })
    }
}

fn dimension(digits: &[u16]) -> Option<u32> {
    if !(1..=5).contains(&digits.len()) || digits[0] == 48 {
        return None;
    }
    digits.iter().try_fold(0u32, |value, &unit| {
        (48..=57)
            .contains(&unit)
            .then(|| value * 10 + u32::from(unit - 48))
    })
}

fn is_escapable(unit: u16) -> bool {
    (33..=47).contains(&unit)
        || (58..=64).contains(&unit)
        || (91..=96).contains(&unit)
        || (123..=126).contains(&unit)
}
