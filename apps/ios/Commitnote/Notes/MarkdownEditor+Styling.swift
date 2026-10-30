import EditorText
import MarkdownStyling
import UIKit

@MainActor
final class MarkdownStyler {
    private struct Segment: Equatable {
        var range: Range<Int>
        var style: PreviewStyle
    }

    private struct Checkbox: Equatable {
        var range: Range<Int>
        var checked: Bool
    }

    private struct LineStyle: Equatable {
        var text: String
        var segments: [Segment] = []
        var checkboxes: [Checkbox] = []
        var rule = false
        var images: [PreviewImageBox] = []
        var table: PreviewTableBox?
        var tableLine = false

        var quote: Bool { segments.contains { $0.style == .quoteLine } }
        var decorated: Bool { rule || quote || !checkboxes.isEmpty || !images.isEmpty || table != nil }
    }

    private struct FontKey: Hashable {
        var level = 0
        var semibold = false
        var italic = false
        var monospaced = false
    }

    private var document: MarkdownDocument?
    private var lines: [LineStyle] = []
    private var needsFullRestyle = true
    private var fonts: [FontKey: UIFont] = [:]
    var noteFont = AppAppearance.standard.noteFont {
        didSet {
            guard noteFont != oldValue else { return }
            fonts = [:]
            needsFullRestyle = true
        }
    }
    private(set) var placements: [Placement] = []
    weak var images: EditorImageStore?
    var revealsSelectedLines = true

    nonisolated init() {}

    var baseAttributes: [NSAttributedString.Key: Any] {
        [
            .font: font(FontKey()),
            .foregroundColor: UIColor.label,
            .paragraphStyle: NSParagraphStyle.default,
        ]
    }

    func invalidateAll() {
        needsFullRestyle = true
    }

    func contentSizeCategoryDidChange() {
        fonts = [:]
        needsFullRestyle = true
    }

    func restyle(_ textView: UITextView) {
        guard textView.markedTextRange == nil else { return }
        let text = textView.text ?? ""
        let document = parsed(text)
        let selected = textView.selectedRange
        let rendered = LivePreview.render(
            document,
            selection: revealsSelectedLines
                ? [EditorText.TextSelection(location: selected.location, length: selected.length)] : [])
        placements = rendered.placements
        let imageBox = imageBoxMaker(textView)
        let tableBox = tableBoxMaker(textView)
        let newLines = Self.lineStyles(
            document, runs: rendered.runs, placements: rendered.placements, imageBox: imageBox, tableBox: tableBox)
        let changed = needsFullRestyle ? Array(newLines.indices) : Self.changedLines(old: lines, new: newLines)
        let redraw = changed.filter { index in
            newLines[index].decorated || (index < lines.count && lines[index].decorated)
        }
        lines = newLines
        needsFullRestyle = false
        guard !changed.isEmpty else { return }

        let storage = textView.textStorage
        let tint: UIColor = textView.tintColor
        let transaction = {
            storage.beginEditing()
            for index in changed {
                self.apply(newLines[index], at: document.lines[index], tint: tint, to: storage)
            }
            storage.endEditing()
        }
        if let contentStorage = textView.textLayoutManager?.textContentManager as? NSTextContentStorage {
            contentStorage.performEditingTransaction(transaction)
        } else {
            transaction()
        }
        invalidateLayout(redraw, of: document, in: textView)
        if textView.typingAttributes[.previewCheckbox] != nil || textView.typingAttributes[.previewImages] != nil
            || textView.typingAttributes[.previewTable] != nil
            || (textView.typingAttributes[.font] as? UIFont).map({ $0.pointSize < 1 }) == true
        {
            textView.typingAttributes = baseAttributes
        }
    }

    func invalidateImage(_ imageId: String, in textView: UITextView) {
        guard let document, document.lines.count == lines.count else { return }
        let indices = lines.indices.filter { index in
            lines[index].images.contains { $0.imageId == imageId }
                || lines[index].table?.table.imageIds.contains(imageId) == true
        }
        invalidateLayout(indices, of: document, in: textView)
        if !indices.isEmpty {
            textView.textLayoutManager?.textViewportLayoutController.layoutViewport()
        }
    }

    private func imageBoxMaker(_ textView: UITextView) -> @MainActor (ImageReference) -> PreviewImageBox {
        let container = textView.textLayoutManager?.textContainer
        let width = container.map { $0.size.width - 2 * $0.lineFragmentPadding } ?? 0
        let available = width > 0 && width < 1e6 ? width : 0
        let compact = textView.traitCollection.horizontalSizeClass == .compact
        let scale = textView.traitCollection.displayScale
        let images = self.images
        return { reference in
            PreviewImageBox(
                imageId: reference.imageId, alt: reference.alt,
                size: PreviewImageBox.size(
                    for: reference, state: images?.state(for: reference.imageId) ?? .loading,
                    available: available, compact: compact, scale: scale))
        }
    }

    private func tableBoxMaker(_ textView: UITextView) -> @MainActor (RenderedTable) -> PreviewTableBox {
        let container = textView.textLayoutManager?.textContainer
        let width = container.map { $0.size.width - 2 * $0.lineFragmentPadding } ?? 0
        let lineWidth = width > 0 && width < 1e6 ? width : 0
        let scale = textView.traitCollection.displayScale
        let tint: UIColor = textView.tintColor
        let bodyFont = font(FontKey())
        let images = self.images
        return { table in
            PreviewTableBuilder(
                bodyFont: bodyFont, scale: scale, lineWidth: lineWidth,
                imageState: { images?.state(for: $0) ?? .loading },
                attributes: { self.attributes($0, paragraph: $1, tint: tint) }
            ).box(for: table)
        }
    }

    private func invalidateLayout(_ indices: [Int], of document: MarkdownDocument, in textView: UITextView) {
        guard !indices.isEmpty, let layout = textView.textLayoutManager,
            let content = layout.textContentManager as? NSTextContentStorage
        else { return }
        let origin = content.documentRange.location
        for index in indices {
            let line = document.line(containing: document.lines[index])
            guard let start = content.location(origin, offsetBy: line.lowerBound),
                let end = content.location(origin, offsetBy: line.upperBound),
                let range = NSTextRange(location: start, end: end)
            else { continue }
            layout.invalidateLayout(for: range)
        }
    }

    func parsed(_ text: String) -> MarkdownDocument {
        if let document, document.text == text { return document }
        let parsed = MarkdownParser.parse(text)
        document = parsed
        return parsed
    }

    private static func lineStyles(
        _ document: MarkdownDocument, runs: [StyleRun], placements: [Placement],
        imageBox: @MainActor (ImageReference) -> PreviewImageBox,
        tableBox: @MainActor (RenderedTable) -> PreviewTableBox
    ) -> [LineStyle] {
        let text = document.text as NSString
        let starts = document.lines
        let length = text.length
        func end(_ index: Int) -> Int { index + 1 < starts.count ? starts[index + 1] - 1 : length }

        var result = starts.indices.map { index in
            LineStyle(text: text.substring(with: NSRange(location: starts[index], length: end(index) - starts[index])))
        }
        for run in runs where !run.range.isEmpty {
            var index = lineIndex(starts, run.range.lowerBound)
            while index < starts.count, starts[index] < run.range.upperBound {
                let lower = max(run.range.lowerBound, starts[index])
                let upper = min(run.range.upperBound, end(index))
                if lower < upper {
                    result[index].segments.append(
                        Segment(range: (lower - starts[index])..<(upper - starts[index]), style: run.style))
                }
                index += 1
            }
        }
        for placement in placements {
            switch placement {
            case .rule(let lineRange):
                result[lineIndex(starts, lineRange.lowerBound)].rule = true
            case .checkbox(let range, let checked):
                let index = lineIndex(starts, range.lowerBound)
                let start = starts[index]
                result[index].checkboxes.append(
                    Checkbox(range: (range.lowerBound - start)..<(range.upperBound - start), checked: checked))
            case .image(let reference, let lineRange, _):
                result[lineIndex(starts, lineRange.lowerBound)].images.append(imageBox(reference))
            case .table(let rendered):
                let range = rendered.table.range
                var index = lineIndex(starts, range.lowerBound)
                result[index].table = tableBox(rendered)
                while index < starts.count, range.contains(starts[index]) {
                    result[index].tableLine = true
                    index += 1
                }
            }
        }
        return result
    }

    private static func lineIndex(_ starts: [Int], _ offset: Int) -> Int {
        var low = 0
        var high = starts.count - 1
        while low < high {
            let mid = (low + high + 1) / 2
            if starts[mid] <= offset { low = mid } else { high = mid - 1 }
        }
        return low
    }

    private static func changedLines(old: [LineStyle], new: [LineStyle]) -> [Int] {
        let common = min(old.count, new.count)
        var prefix = 0
        while prefix < common, old[prefix].text == new[prefix].text { prefix += 1 }
        var suffix = 0
        while suffix < common - prefix, old[old.count - 1 - suffix].text == new[new.count - 1 - suffix].text {
            suffix += 1
        }
        let middle = prefix..<(new.count - suffix)
        let textChanged = !middle.isEmpty || old.count != new.count
        var changed: [Int] = []
        for index in 0..<prefix where old[index] != new[index] || (textChanged && index == prefix - 1) {
            changed.append(index)
        }
        changed.append(contentsOf: middle)
        for offset in 0..<suffix where old[old.count - 1 - offset] != new[new.count - 1 - offset] {
            changed.append(new.count - 1 - offset)
        }
        return changed
    }

    private func apply(
        _ line: LineStyle, at start: Int, tint: UIColor, to storage: NSTextStorage
    ) {
        let length = line.text.utf16.count
        let paragraph = paragraphStyle(line)
        var boundaries: Set<Int> = [0, length]
        for segment in line.segments {
            boundaries.insert(segment.range.lowerBound)
            boundaries.insert(segment.range.upperBound)
        }
        for checkbox in line.checkboxes {
            boundaries.insert(checkbox.range.lowerBound)
            boundaries.insert(checkbox.range.upperBound)
        }
        let quote = line.quote
        let images = line.images.isEmpty ? nil : PreviewImageList(line.images)
        let table = line.table.map(PreviewTableValue.init)
        let points = boundaries.sorted()
        for (lower, upper) in zip(points, points.dropFirst()) where lower < upper {
            let covering = line.segments.filter { $0.range.lowerBound <= lower && upper <= $0.range.upperBound }
            let styles = covering.map(\.style)
            var styled = attributes(styles, paragraph: paragraph, tint: tint)
            if quote { styled[.previewQuote] = true }
            if line.rule { styled[.previewRule] = true }
            if let images { styled[.previewImages] = images }
            if let table { styled[.previewTable] = table }
            if let checkbox = line.checkboxes.first(where: {
                $0.range.lowerBound <= lower && upper <= $0.range.upperBound
            }) {
                styled[.previewCheckbox] = checkbox.checked
                styled[.foregroundColor] = UIColor.clear
                styled[.strikethroughStyle] = nil
                styled[.underlineStyle] = nil
                styled[.backgroundColor] = nil
            }
            if !styles.contains(.hidden),
                let link = covering.first(where: { $0.style == .link || $0.style == .url })
            {
                styled[.previewLink] = link.range.lowerBound
            }
            storage.setAttributes(styled, range: NSRange(location: start + lower, length: upper - lower))
        }
        if start + length < storage.length {
            var lineBreak = line.tableLine ? attributes([.hidden], paragraph: paragraph, tint: tint) : baseAttributes
            lineBreak[.paragraphStyle] = paragraph
            if let images { lineBreak[.previewImages] = images }
            if line.tableLine && quote { lineBreak[.previewQuote] = true }
            if let table { lineBreak[.previewTable] = table }
            storage.setAttributes(lineBreak, range: NSRange(location: start + length, length: 1))
        }
    }

    private func paragraphStyle(_ line: LineStyle) -> NSParagraphStyle {
        let quote = line.segments.contains { $0.style == .quoteLine }
        guard quote || line.rule || !line.images.isEmpty || line.table != nil else { return NSParagraphStyle.default }
        let style = NSMutableParagraphStyle()
        if quote {
            style.firstLineHeadIndent = 12
            style.headIndent = 12
        }
        if line.rule {
            style.minimumLineHeight = font(FontKey()).lineHeight
        }
        if !line.images.isEmpty {
            style.paragraphSpacing = PreviewImageBox.spacing(for: line.images)
        }
        if let table = line.table {
            style.paragraphSpacing = PreviewImageBox.gap + table.size.height + PreviewImageBox.gap
        }
        return style
    }

    private func attributes(
        _ styles: [PreviewStyle], paragraph: NSParagraphStyle, tint: UIColor
    ) -> [NSAttributedString.Key: Any] {
        if styles.contains(.hidden) {
            return [
                .font: UIFont.systemFont(ofSize: 0.01),
                .foregroundColor: UIColor.clear,
                .paragraphStyle: paragraph,
            ]
        }
        var key = FontKey()
        var link = false
        var quote = false
        var muted = false
        var listMark = false
        var strikethrough = false
        for style in styles {
            switch style {
            case .heading(let level):
                key.level = level
                key.semibold = true
            case .emphasis: key.italic = true
            case .strong: key.semibold = true
            case .strikethrough: strikethrough = true
            case .inlineCode, .codeBlockLine: key.monospaced = true
            case .quoteLine: quote = true
            case .link, .url: link = true
            case .listMark: listMark = true
            case .mutedMarker: muted = true
            case .hidden: break
            }
        }
        var result: [NSAttributedString.Key: Any] = [.font: font(key), .paragraphStyle: paragraph]
        if muted {
            result[.foregroundColor] = UIColor.secondaryLabel
        } else if listMark {
            result[.foregroundColor] = tint.softened(alpha: 0.5)
        } else if link {
            result[.foregroundColor] = tint
            result[.underlineStyle] = NSUnderlineStyle.single.rawValue
        } else if quote {
            result[.foregroundColor] = UIColor.secondaryLabel
        } else {
            result[.foregroundColor] = UIColor.label
        }
        if key.monospaced {
            result[.backgroundColor] = UIColor.secondarySystemFill
        }
        if strikethrough {
            result[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
        }
        return result
    }

    private func font(_ key: FontKey) -> UIFont {
        if let cached = fonts[key] { return cached }
        var font = NoteFontCatalog.bodyFont(id: noteFont)
        if key != FontKey() {
            let scale: CGFloat =
                switch key.level {
                case 1: 1.75
                case 2: 1.25
                case 3: 1.125
                default: 1
                }
            if key.monospaced {
                let size = font.pointSize * scale * 0.875
                font = .monospacedSystemFont(ofSize: size, weight: key.semibold ? .semibold : .regular)
                if key.italic,
                    let descriptor = font.fontDescriptor.withSymbolicTraits(
                        font.fontDescriptor.symbolicTraits.union(.traitItalic))
                {
                    font = UIFont(descriptor: descriptor, size: size)
                }
            } else {
                font = NoteFontCatalog.bodyFont(
                    id: noteFont, semibold: key.semibold, italic: key.italic, scale: scale)
            }
        }
        fonts[key] = font
        return font
    }
}
