import CoreText
import UIKit
import XCTest

@testable import commitnote

final class NoteFontTests: XCTestCase {
    private struct Family {
        let id: String
        let familyFragment: String
        let fixedWeights: Bool
    }

    private static let families = [
        Family(id: "inter", familyFragment: "inter", fixedWeights: false),
        Family(id: "ibm-plex-sans", familyFragment: "plex sans", fixedWeights: false),
        Family(id: "atkinson-hyperlegible", familyFragment: "atkinson", fixedWeights: false),
        Family(id: "nunito", familyFragment: "nunito", fixedWeights: false),
        Family(id: "ia-writer-quattro", familyFragment: "quattro", fixedWeights: true),
        Family(id: "literata", familyFragment: "literata", fixedWeights: false),
        Family(id: "source-serif", familyFragment: "source serif", fixedWeights: false),
        Family(id: "lora", familyFragment: "lora", fixedWeights: false),
        Family(id: "jetbrains-mono", familyFragment: "jetbrains", fixedWeights: false),
        Family(id: "ibm-plex-mono", familyFragment: "plex mono", fixedWeights: true),
    ]

    private static let weightAxis = NSNumber(value: 0x7767_6874)

    func testEveryBundledFontFileIsInTheAppBundle() {
        XCTAssertFalse(NoteFontCatalog.fileNames.isEmpty)
        for fileName in NoteFontCatalog.fileNames {
            let name = (fileName as NSString).deletingPathExtension
            XCTAssertNotNil(
                Bundle.main.url(forResource: name, withExtension: "ttf"), "\(fileName) is not bundled")
        }
    }

    func testSystemIdUsesTheSystemFont() {
        let font = NoteFontCatalog.font(id: "system", size: 17, semibold: false, italic: false)
        XCTAssertEqual(font.familyName, UIFont.systemFont(ofSize: 17).familyName)
    }

    func testEveryBundledFamilyResolvesWithBoldAndItalicVariants() {
        for family in Self.families {
            let regular = NoteFontCatalog.font(
                id: family.id, size: 17, semibold: false, italic: false)
            XCTAssertTrue(
                regular.familyName.lowercased().contains(family.familyFragment),
                "\(family.id) resolved to \(regular.familyName)")

            let semibold = NoteFontCatalog.font(
                id: family.id, size: 17, semibold: true, italic: false)
            XCTAssertEqual(semibold.familyName, regular.familyName, "\(family.id) semibold family")
            if family.fixedWeights {
                XCTAssertTrue(
                    ["bold", "semibold"].contains { semibold.fontName.lowercased().contains($0) },
                    "\(family.id) semibold resolved to \(semibold.fontName)")
            } else {
                let variation = CTFontCopyVariation(semibold as CTFont) as? [NSNumber: NSNumber]
                XCTAssertEqual(
                    variation?[Self.weightAxis]?.intValue, 600, "\(family.id) weight variation")
            }

            let italic = NoteFontCatalog.font(
                id: family.id, size: 17, semibold: false, italic: true)
            XCTAssertTrue(
                italic.fontDescriptor.symbolicTraits.contains(.traitItalic),
                "\(family.id) italic resolved to \(italic.fontName)")
            XCTAssertEqual(italic.familyName, regular.familyName, "\(family.id) italic family")
        }
    }
}
