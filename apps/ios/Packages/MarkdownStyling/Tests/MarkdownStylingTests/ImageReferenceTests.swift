import MarkdownStyling
import XCTest

final class ImageReferenceTests: XCTestCase {
    private let id = "abcdefghijklmnopqrstuvwxyz"

    func testParsesIdWithAndWithoutDimensions() {
        XCTAssertEqual(
            ImageReference.parse(url: "image:\(id)#640x480"),
            ImageReference.Target(imageId: id, width: 640, height: 480))
        XCTAssertEqual(
            ImageReference.parse(url: "image:\(id)"), ImageReference.Target(imageId: id, width: nil, height: nil))
        XCTAssertEqual(
            ImageReference.parse(url: "image:234567abcdefghijklmnopqrst#99999x1")?.width, 99999)
    }

    func testRejectsMalformedURLs() {
        let rejected = [
            "image:abc", "image:\(id)a", "image:ABCDEFGHIJKLMNOPQRSTUVWXYZ", "image:abcdefghijklmnopqrstuvwxy1",
            "image:\(id)#0x5", "image:\(id)#5x0", "image:\(id)#100000x5", "image:\(id)#5", "image:\(id)#5x",
            "image:\(id)#05x5", "image:\(id)#5x5x", "https://example.com/a.png", "IMAGE:\(id)",
        ]
        for url in rejected { XCTAssertNil(ImageReference.parse(url: url), url) }
    }

    func testUnescapesAlt() {
        XCTAssertEqual(ImageReference.unescapedAlt("a\\]b \\\\ c\\d"), "a]b \\ c\\d")
    }

    func testReferenceForImageNode() {
        let text = "x ![my \\[alt\\]](image:\(id)#640x480) y"
        let document = MarkdownParser.parse(text)
        let node = document.nodes.first { $0.kind == .image }!
        let reference = ImageReference.reference(for: node, in: document)
        XCTAssertEqual(
            reference,
            ImageReference(
                imageId: id, width: 640, height: 480, alt: "my [alt]", range: 2..<(text.utf16.count - 2)))
    }

    func testNonReferenceImagesAreNotReferences() {
        let document = MarkdownParser.parse("![a](https://x.y/a.png) ![b](image:short)")
        for node in document.nodes where node.kind == .image {
            XCTAssertNil(ImageReference.reference(for: node, in: document))
        }
    }

    func testReferenceWithoutDimensionsAndEmptyAlt() {
        let document = MarkdownParser.parse("![](image:\(id))")
        let node = document.nodes.first { $0.kind == .image }!
        let reference = ImageReference.reference(for: node, in: document)
        XCTAssertEqual(reference?.alt, "")
        XCTAssertNil(reference?.width)
    }
}
