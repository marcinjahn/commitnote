import MarkdownStyling
import UIKit

enum PreviewTableItem: Equatable {
    case text(NSAttributedString)
    case image(imageId: String)
}

/// A rendered table drawn below its first (hidden) source line, laid out when the paragraph was styled.
struct PreviewTableBox: Equatable {
    var table: RenderedTable
    /// `[row][column][item]`, matching `geometry.itemFrames`.
    var items: [[[PreviewTableItem]]]
    var geometry: TableGeometry
    /// The grid's x offset from the line fragment padding.
    var indent: CGFloat

    var size: CGSize { CGSize(width: geometry.width, height: geometry.height) }
}

final class PreviewTableValue: NSObject {
    let box: PreviewTableBox

    init(_ box: PreviewTableBox) {
        self.box = box
    }

    override func isEqual(_ object: Any?) -> Bool {
        (object as? PreviewTableValue)?.box == box
    }

    override var hash: Int {
        box.table.table.range.lowerBound.hashValue
    }
}

extension RenderedTable {
    var imageIds: [String] {
        var result: [String] = []
        for row in rows {
            for cell in row {
                for piece in cell.pieces {
                    if case .image(let reference) = piece {
                        result.append(reference.imageId)
                    }
                }
            }
        }
        return result
    }
}

@MainActor
struct PreviewTableBuilder {
    var bodyFont: UIFont
    var scale: CGFloat
    /// The container width minus its line fragment padding.
    var lineWidth: CGFloat
    var imageState: @MainActor (String) -> EditorImageState
    var attributes: @MainActor ([PreviewStyle], NSParagraphStyle) -> [NSAttributedString.Key: Any]

    private typealias Item = (item: PreviewTableItem, layout: TableLayoutItem)

    func box(for table: RenderedTable) -> PreviewTableBox {
        let hairline = 1 / max(1, scale)
        let metrics = TableLayoutMetrics(border: Double(hairline), emptyLineHeight: Double(bodyFont.lineHeight))
        let prefix = (table.indentText as NSString).size(withAttributes: [.font: bodyFont]).width
        let indent = (table.quoteLevels > 0 ? 12 : 0) + ceil(prefix)
        let available = max(0, lineWidth - indent)
        let alignments = table.table.alignments
        let paragraphs = (0..<table.table.columnCount).map { column in
            Self.paragraph(column < alignments.count ? alignments[column] : .unspecified)
        }

        var cells: [[[Item]]] = []
        for (rowIndex, row) in table.rows.enumerated() {
            var rowItems: [[Item]] = []
            for (column, cell) in row.enumerated() {
                let paragraph = column < paragraphs.count ? paragraphs[column] : Self.paragraph(.unspecified)
                rowItems.append(items(cell, header: rowIndex == 0, paragraph: paragraph))
            }
            cells.append(rowItems)
        }

        let layout: [[[TableLayoutItem]]] = cells.map { row in row.map { cell in cell.map { $0.layout } } }
        let columns = TableLayout.columns(cells: layout, available: Double(available), metrics: metrics)
        let heights: [[[Double]]] = cells.map { row in
            row.enumerated().map { column, cell -> [Double] in
                let width = column < columns.contentWidths.count ? columns.contentWidths[column] : 0
                return cell.map { item -> Double in
                    guard case .text(let string) = item.item else { return 0 }
                    let bounds = string.boundingRect(
                        with: CGSize(width: max(1, CGFloat(width)), height: .greatestFiniteMagnitude),
                        options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
                    return Double(ceil(bounds.height))
                }
            }
        }
        let geometry = TableLayout.geometry(
            cells: layout, columns: columns, textHeights: heights, alignments: alignments, metrics: metrics)
        return PreviewTableBox(
            table: table, items: cells.map { row in row.map { cell in cell.map { $0.item } } }, geometry: geometry,
            indent: indent)
    }

    private func items(_ cell: TableCellContent, header: Bool, paragraph: NSParagraphStyle) -> [Item] {
        var result: [Item] = []
        let extra: [PreviewStyle] = header ? [.strong] : []
        let pending = NSMutableAttributedString()

        func flush() {
            guard pending.length > 0 else { return }
            let string = NSAttributedString(attributedString: pending)
            result.append((item: .text(string), layout: Self.measure(string)))
            pending.setAttributedString(NSAttributedString())
        }

        for piece in cell.pieces {
            switch piece {
            case .text(let text, let source, let styles):
                var styled = attributes(styles + extra, paragraph)
                styled[.previewTableSource] = source.lowerBound
                if styles.contains(.link) || styles.contains(.url) {
                    styled[.previewTableLink] = true
                }
                pending.append(NSAttributedString(string: text, attributes: styled))
            case .image(let reference):
                if case .loaded(let image) = imageState(reference.imageId) {
                    flush()
                    var pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
                    if let width = reference.width, let height = reference.height, width > 0, height > 0 {
                        pixels = CGSize(width: width, height: height)
                    }
                    let divisor = max(1, scale)
                    result.append(
                        (
                            item: .image(imageId: reference.imageId),
                            layout: .image(
                                width: Double(pixels.width / divisor), height: Double(pixels.height / divisor))
                        ))
                } else {
                    pending.append(
                        NSAttributedString(
                            string: reference.alt.isEmpty ? "Image" : reference.alt,
                            attributes: attributes([.mutedMarker] + extra, paragraph)))
                }
            }
        }
        flush()
        return result
    }

    private static func paragraph(_ alignment: TableAlignment) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.lineBreakMode = .byWordWrapping
        switch alignment {
        case .center: style.alignment = .center
        case .right: style.alignment = .right
        case .left, .unspecified: style.alignment = .natural
        }
        return style
    }

    /// Measured with the default paragraph style: an unbounded centred or right-aligned line reports an unusable rect.
    private static func measure(_ string: NSAttributedString) -> TableLayoutItem {
        let plain = NSMutableAttributedString(attributedString: string)
        plain.addAttribute(
            .paragraphStyle, value: NSParagraphStyle.default, range: NSRange(location: 0, length: plain.length))
        let text = plain.string as NSString
        var widest: CGFloat = 0
        var start = 0
        for index in 0...text.length {
            let breaks =
                index == text.length
                || Unicode.Scalar(text.character(at: index)).map { CharacterSet.whitespacesAndNewlines.contains($0) }
                    == true
            guard breaks else { continue }
            if index > start {
                let word = plain.attributedSubstring(from: NSRange(location: start, length: index - start))
                widest = max(widest, width(word))
            }
            start = index + 1
        }
        return .text(minWidth: Double(ceil(widest)), maxWidth: Double(ceil(width(plain))))
    }

    private static func width(_ string: NSAttributedString) -> CGFloat {
        string.boundingRect(
            with: CGSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil
        ).width
    }
}

extension PreviewTableBox {
    /// Draws the grid and the cell items with the table's top-left outer border corner at `origin`.
    /// Border rects never overlap: the separator colour is translucent.
    func draw(at origin: CGPoint, tint: UIColor, image: (String) -> UIImage?) {
        guard let firstRow = geometry.cellFrames.first, let firstCell = firstRow.first, firstCell.x > 0 else {
            return
        }
        let border = CGFloat(firstCell.x)
        func aligned(_ value: Double) -> CGFloat { (CGFloat(value) / border).rounded() * border }
        let ys = ([0] + geometry.cellFrames.compactMap { $0.first?.maxY }).map(aligned)
        let xs = ([0] + firstRow.map(\.maxX)).map(aligned)
        let width = (xs.last ?? 0) + border

        for (index, y) in ys.enumerated() {
            (index == 1 ? tint : UIColor.separator).setFill()
            UIRectFill(CGRect(x: origin.x, y: origin.y + y, width: width, height: border))
        }
        UIColor.separator.setFill()
        for (top, bottom) in zip(ys, ys.dropFirst()) {
            let height = bottom - top - border
            guard height > 0 else { continue }
            for x in xs {
                UIRectFill(CGRect(x: origin.x + x, y: origin.y + top + border, width: border, height: height))
            }
        }

        for (row, rowFrames) in geometry.itemFrames.enumerated() where row < items.count {
            for (column, frames) in rowFrames.enumerated() where column < items[row].count {
                for (frame, item) in zip(frames, items[row][column]) {
                    let rect = CGRect(
                        x: origin.x + CGFloat(frame.x), y: origin.y + CGFloat(frame.y), width: CGFloat(frame.width),
                        height: CGFloat(frame.height))
                    switch item {
                    case .text(let string):
                        string.draw(with: rect, options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
                    case .image(let imageId):
                        image(imageId)?.drawAspectFit(in: rect)
                    }
                }
            }
        }
    }
}

extension PreviewTableBox {
    /// The note offset of the link character under `point` (table coordinates) in a cell's text, if any.
    @MainActor
    func linkSource(row: Int, column: Int, at point: CGPoint) -> Int? {
        guard row < items.count, column < items[row].count, row < geometry.itemFrames.count,
            column < geometry.itemFrames[row].count
        else { return nil }
        for (frame, item) in zip(geometry.itemFrames[row][column], items[row][column]) {
            guard case .text(let string) = item else { continue }
            let rect = CGRect(
                x: CGFloat(frame.x), y: CGFloat(frame.y), width: CGFloat(frame.width), height: CGFloat(frame.height))
            guard rect.contains(point),
                let index = Self.characterIndex(
                    in: string, width: rect.width, at: CGPoint(x: point.x - rect.minX, y: point.y - rect.minY))
            else { continue }
            guard string.attribute(.previewTableLink, at: index, effectiveRange: nil) as? Bool == true else {
                return nil
            }
            var run = NSRange(location: 0, length: 0)
            guard
                let value = string.attribute(
                    .previewTableSource, at: index, longestEffectiveRange: &run,
                    in: NSRange(location: 0, length: string.length)) as? Int
            else { return nil }
            return value + index - run.location
        }
        return nil
    }

    /// Lays the text out as `draw(at:)` does and returns the character whose glyph box contains `point`.
    @MainActor
    private static func characterIndex(in string: NSAttributedString, width: CGFloat, at point: CGPoint) -> Int? {
        let storage = NSTextStorage(attributedString: string)
        let layoutManager = NSLayoutManager()
        let container = NSTextContainer(size: CGSize(width: width, height: .greatestFiniteMagnitude))
        container.lineFragmentPadding = 0
        layoutManager.addTextContainer(container)
        storage.addLayoutManager(layoutManager)
        guard layoutManager.numberOfGlyphs > 0 else { return nil }
        var fraction: CGFloat = 0
        let glyph = layoutManager.glyphIndex(for: point, in: container, fractionOfDistanceThroughGlyph: &fraction)
        let bounds = layoutManager.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: container)
        guard bounds.contains(point) else { return nil }
        let index = layoutManager.characterIndexForGlyph(at: glyph)
        return index < string.length ? index : nil
    }

    /// Each maximal run of link or URL text in a cell, once per distinct note offset it starts at.
    func links(row: Int, column: Int) -> [(text: String, source: Int)] {
        guard row < table.rows.count, column < table.rows[row].count else { return [] }
        var links: [(text: String, source: Int)] = []
        var current: (text: String, source: Int)?
        for piece in table.rows[row][column].pieces {
            if case .text(let text, let source, let styles) = piece, styles.contains(.link) || styles.contains(.url) {
                if let run = current {
                    current = (run.text + text, run.source)
                } else {
                    current = (text, source.lowerBound)
                }
            } else if let run = current {
                links.append(run)
                current = nil
            }
        }
        if let run = current { links.append(run) }
        return links
    }
}

struct PreviewTableAccessibilityItem {
    var box: PreviewTableBox
    /// In text view coordinates.
    var frame: CGRect
    var firstLineOffset: Int

    var key: String { "table:\(firstLineOffset)" }
}

/// Frames are kept in the editor's coordinates, so they stay right whatever element contains them.
final class EditorTableElement: UIAccessibilityElement, UIAccessibilityContainerDataTable {
    weak var editor: MarkdownEditorContainer?
    var frameInEditor: CGRect = .zero
    private(set) var box: PreviewTableBox?
    private var cells: [[EditorTableCellElement]] = []

    override var accessibilityFrame: CGRect {
        get {
            guard let editor else { return .zero }
            return UIAccessibility.convertToScreenCoordinates(frameInEditor, in: editor)
        }
        set {}
    }

    func configure(box: PreviewTableBox, editor: MarkdownEditorContainer, textView: MarkdownTextView) {
        self.box = box
        self.editor = editor
        isAccessibilityElement = false
        accessibilityContainerType = .dataTable
        accessibilityIdentifier = "editor-table"
        accessibilityLabel = "Table"
        let editable = textView.isEditable
        cells = box.table.rows.enumerated().map { row, contents in
            contents.enumerated().map { column, content -> EditorTableCellElement in
                let cell = EditorTableCellElement(accessibilityContainer: self)
                cell.editor = editor
                cell.row = row
                cell.column = column
                cell.accessibilityIdentifier = "editor-table-cell"
                cell.accessibilityLabel = content.spokenText
                cell.accessibilityTraits = row == 0 ? [.staticText, .header] : .staticText
                if editable {
                    let caret = content.caret
                    cell.action = { [weak textView] in
                        textView?.revealTableCell(caret: caret)
                    }
                }
                var opened = Set<URL>()
                var actions: [UIAccessibilityCustomAction] = []
                for link in box.links(row: row, column: column) {
                    guard let url = textView.linkURLProvider?(link.source), opened.insert(url).inserted else {
                        continue
                    }
                    actions.append(
                        UIAccessibilityCustomAction(name: "Open \(link.text)") { _ in
                            UIApplication.shared.open(url)
                            return true
                        })
                }
                cell.accessibilityCustomActions = actions.isEmpty ? nil : actions
                return cell
            }
        }
        accessibilityElements = cells.flatMap { $0 }
    }

    /// `frame` is the table's frame in the editor's coordinates.
    func place(at frame: CGRect) {
        frameInEditor = frame
        guard let box else { return }
        for (row, frames) in box.geometry.cellFrames.enumerated() where row < cells.count {
            for (column, cellFrame) in frames.enumerated() where column < cells[row].count {
                cells[row][column].frameInEditor = CGRect(
                    x: frame.minX + CGFloat(cellFrame.x), y: frame.minY + CGFloat(cellFrame.y),
                    width: CGFloat(cellFrame.width), height: CGFloat(cellFrame.height))
            }
        }
    }

    func accessibilityRowCount() -> Int {
        cells.count
    }

    func accessibilityColumnCount() -> Int {
        cells.first?.count ?? 0
    }

    func accessibilityDataTableCellElement(forRow row: Int, column: Int) -> UIAccessibilityContainerDataTableCell? {
        guard row >= 0, row < cells.count, column >= 0, column < cells[row].count else { return nil }
        return cells[row][column]
    }

    func accessibilityHeaderElements(forColumn column: Int) -> [UIAccessibilityContainerDataTableCell]? {
        guard let header = cells.first, column >= 0, column < header.count else { return nil }
        return [header[column]]
    }
}

final class EditorTableCellElement: EditorActionElement, UIAccessibilityContainerDataTableCell {
    weak var editor: MarkdownEditorContainer?
    var frameInEditor: CGRect = .zero
    var row = 0
    var column = 0

    override var accessibilityFrame: CGRect {
        get {
            guard let editor else { return .zero }
            return UIAccessibility.convertToScreenCoordinates(frameInEditor, in: editor)
        }
        set {}
    }

    func accessibilityRowRange() -> NSRange {
        NSRange(location: row, length: 1)
    }

    func accessibilityColumnRange() -> NSRange {
        NSRange(location: column, length: 1)
    }
}

extension UIImage {
    func drawAspectFit(in rect: CGRect) {
        guard size.width > 0, size.height > 0 else { return }
        let factor = min(rect.width / size.width, rect.height / size.height)
        let fitted = CGSize(width: size.width * factor, height: size.height * factor)
        draw(
            in: CGRect(
                x: rect.midX - fitted.width / 2, y: rect.midY - fitted.height / 2, width: fitted.width,
                height: fitted.height))
    }
}
