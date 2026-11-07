use commitnote_markdown::{ImageReference, ImageTarget, SyntaxKind, parse};

const ID: &str = "abcdefghijklmnopqrstuvwxyz";

fn target(width: Option<u32>, height: Option<u32>) -> ImageTarget {
    ImageTarget {
        image_id: ID.to_owned(),
        width,
        height,
    }
}

#[test]
fn parses_id_with_and_without_dimensions() {
    assert_eq!(
        ImageReference::parse(&format!("image:{ID}#640x480")),
        Some(target(Some(640), Some(480)))
    );
    assert_eq!(
        ImageReference::parse(&format!("image:{ID}")),
        Some(target(None, None))
    );
    assert_eq!(
        ImageReference::parse("image:234567abcdefghijklmnopqrst#99999x1").and_then(|t| t.width),
        Some(99999)
    );
}

#[test]
fn rejects_malformed_urls() {
    let rejected = [
        "image:abc".to_owned(),
        format!("image:{ID}a"),
        "image:ABCDEFGHIJKLMNOPQRSTUVWXYZ".to_owned(),
        "image:abcdefghijklmnopqrstuvwxy1".to_owned(),
        format!("image:{ID}#0x5"),
        format!("image:{ID}#5x0"),
        format!("image:{ID}#100000x5"),
        format!("image:{ID}#5"),
        format!("image:{ID}#5x"),
        format!("image:{ID}#05x5"),
        format!("image:{ID}#5x5x"),
        "https://example.com/a.png".to_owned(),
        format!("IMAGE:{ID}"),
    ];
    for url in rejected {
        assert_eq!(ImageReference::parse(&url), None, "{url}");
    }
}

#[test]
fn unescapes_alt() {
    assert_eq!(
        ImageReference::unescaped_alt("a\\]b \\\\ c\\d"),
        "a]b \\ c\\d"
    );
}

#[test]
fn reference_for_image_node() {
    let text = format!("x ![my \\[alt\\]](image:{ID}#640x480) y");
    let document = parse(&text);
    let node = document
        .nodes
        .iter()
        .find(|node| node.kind == SyntaxKind::Image)
        .unwrap();
    assert_eq!(
        ImageReference::reference_for(node, &document),
        Some(ImageReference {
            image_id: ID.to_owned(),
            width: Some(640),
            height: Some(480),
            alt: "my [alt]".to_owned(),
            range: 2..text.encode_utf16().count() - 2,
        })
    );
}

#[test]
fn non_reference_images_are_not_references() {
    let document = parse("![a](https://x.y/a.png) ![b](image:short)");
    for node in document
        .nodes
        .iter()
        .filter(|node| node.kind == SyntaxKind::Image)
    {
        assert_eq!(ImageReference::reference_for(node, &document), None);
    }
}

#[test]
fn reference_without_dimensions_and_empty_alt() {
    let document = parse(&format!("![](image:{ID})"));
    let node = document
        .nodes
        .iter()
        .find(|node| node.kind == SyntaxKind::Image)
        .unwrap();
    let reference = ImageReference::reference_for(node, &document).unwrap();
    assert_eq!(reference.alt, "");
    assert_eq!(reference.width, None);
}

#[test]
fn contains_reference() {
    assert!(ImageReference::contains_reference(&format!(
        "a\n![x](image:{ID}#2x3)\nb"
    )));
    assert!(ImageReference::contains_reference(&format!(
        "![](image:{ID})"
    )));
    assert!(!ImageReference::contains_reference(
        "![x](image:short) ![y](https://a.b/c.png)"
    ));
    assert!(!ImageReference::contains_reference(&format!(
        "plain image:{ID} text"
    )));
    assert!(!ImageReference::contains_reference(""));
}
