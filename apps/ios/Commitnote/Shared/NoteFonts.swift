import CoreText
import UIKit

enum NoteFontCatalog {
    private enum Weights {
        case variable
        case fixed(semibold: String, semiboldItalic: String)
    }

    private struct Entry {
        let regular: String
        let italic: String
        let regularFile: String
        let italicFile: String
        let weights: Weights
        let extraFiles: [String]
    }

    private static let weightAxisTag = 0x7767_6874

    private static let entries: [String: Entry] = [
        "inter": variable("Inter-Regular", "Inter-Italic", "Inter"),
        "ibm-plex-sans": variable("IBMPlexSans-Regular", "IBMPlexSans-Italic", "IBMPlexSans"),
        "atkinson-hyperlegible": variable(
            "AtkinsonHyperlegibleNext-Regular", "AtkinsonHyperlegibleNext-Italic",
            "AtkinsonHyperlegibleNext"),
        "nunito": variable("Nunito-ExtraLight", "Nunito-ExtraLightItalic", "Nunito"),
        "ia-writer-quattro": Entry(
            regular: "iAWriterQuattroS-Regular",
            italic: "iAWriterQuattroS-Italic",
            regularFile: "iAWriterQuattroS-Regular.ttf",
            italicFile: "iAWriterQuattroS-Italic.ttf",
            weights: .fixed(
                semibold: "iAWriterQuattroS-Bold", semiboldItalic: "iAWriterQuattroS-BoldItalic"),
            extraFiles: ["iAWriterQuattroS-Bold.ttf", "iAWriterQuattroS-BoldItalic.ttf"]),
        "literata": variable("Literata-Regular", "Literata-Italic", "Literata"),
        "source-serif": variable(
            "SourceSerif4Roman-Regular", "SourceSerif4Italic-Italic", "SourceSerif4"),
        "lora": variable("Lora-Regular", "Lora-Italic", "Lora"),
        "jetbrains-mono": variable("JetBrainsMono-Regular", "JetBrainsMono-Italic", "JetBrainsMono"),
        "ibm-plex-mono": Entry(
            regular: "IBMPlexMono-Regular",
            italic: "IBMPlexMono-Italic",
            regularFile: "IBMPlexMono-Regular.ttf",
            italicFile: "IBMPlexMono-Italic.ttf",
            weights: .fixed(
                semibold: "IBMPlexMono-SemiBold", semiboldItalic: "IBMPlexMono-SemiBoldItalic"),
            extraFiles: ["IBMPlexMono-SemiBold.ttf", "IBMPlexMono-SemiBoldItalic.ttf"]),
    ]

    private static func variable(_ regular: String, _ italic: String, _ file: String) -> Entry {
        Entry(
            regular: regular,
            italic: italic,
            regularFile: "\(file)-Variable.ttf",
            italicFile: "\(file)-VariableItalic.ttf",
            weights: .variable,
            extraFiles: [])
    }

    static let fileNames: [String] = entries.values
        .flatMap { [$0.regularFile, $0.italicFile] + $0.extraFiles }
        .sorted()

    static func fileURL(id: String, italic: Bool) -> URL? {
        guard let entry = entries[id] else { return nil }
        let file = italic ? entry.italicFile : entry.regularFile
        let name = (file as NSString).deletingPathExtension
        return Bundle.main.url(forResource: name, withExtension: "ttf")
    }

    static func font(id: String, size: CGFloat, semibold: Bool, italic: Bool) -> UIFont {
        let weight: UIFont.Weight = semibold ? .semibold : .regular
        guard let entry = entries[id] else {
            return systemFont(size: size, weight: weight, italic: italic)
        }
        let descriptor: UIFontDescriptor
        switch entry.weights {
        case .variable:
            descriptor = UIFontDescriptor(fontAttributes: [
                .name: italic ? entry.italic : entry.regular,
                UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [
                    weightAxisTag: semibold ? 600 : 400
                ],
            ])
        case .fixed(let semiboldName, let semiboldItalicName):
            let name =
                switch (semibold, italic) {
                case (false, false): entry.regular
                case (false, true): entry.italic
                case (true, false): semiboldName
                case (true, true): semiboldItalicName
                }
            descriptor = UIFontDescriptor(fontAttributes: [.name: name])
        }
        let font = UIFont(descriptor: descriptor, size: size)
        let expectedFamily = UIFont(name: entry.regular, size: size)?.familyName
        guard let expectedFamily, font.familyName == expectedFamily else {
            return systemFont(size: size, weight: weight, italic: italic)
        }
        return font
    }

    static func bodyFont(
        id: String, semibold: Bool = false, italic: Bool = false, scale: CGFloat = 1
    ) -> UIFont {
        UIFontMetrics(forTextStyle: .body)
            .scaledFont(for: font(id: id, size: 17 * scale, semibold: semibold, italic: italic))
    }

    private static func systemFont(size: CGFloat, weight: UIFont.Weight, italic: Bool) -> UIFont {
        let base = UIFont.systemFont(ofSize: size, weight: weight)
        guard italic, let descriptor = base.fontDescriptor.withSymbolicTraits(.traitItalic) else {
            return base
        }
        return UIFont(descriptor: descriptor, size: size)
    }
}
