import UIKit

extension NSAttributedString.Key {
    static let previewCheckbox = NSAttributedString.Key("commitnote.preview.checkbox")
    static let previewRule = NSAttributedString.Key("commitnote.preview.rule")
    static let previewQuote = NSAttributedString.Key("commitnote.preview.quote")
    /// Line-relative start of the link or URL the characters belong to.
    static let previewLink = NSAttributedString.Key("commitnote.preview.link")
    /// A `PreviewImageList` drawn below the paragraph.
    static let previewImages = NSAttributedString.Key("commitnote.preview.images")
}

/// What a paragraph draws besides its text; ranges are relative to the paragraph.
enum PreviewDecoration: Equatable {
    case checkbox(range: NSRange, checked: Bool)
    case rule
    case quote
    case images([PreviewImageBox])

    static func decorations(in string: NSAttributedString) -> [PreviewDecoration] {
        var result: [PreviewDecoration] = []
        let whole = NSRange(location: 0, length: string.length)
        string.enumerateAttribute(.previewCheckbox, in: whole) { value, range, _ in
            if let checked = value as? Bool {
                result.append(.checkbox(range: range, checked: checked))
            }
        }
        var images: [PreviewImageBox]?
        string.enumerateAttribute(.previewImages, in: whole) { value, _, stop in
            if let list = value as? PreviewImageList {
                images = list.boxes
                stop.pointee = true
            }
        }
        var rule = false
        var quote = false
        string.enumerateAttributes(in: whole) { attributes, _, stop in
            if attributes[.previewRule] != nil { rule = true }
            if attributes[.previewQuote] != nil { quote = true }
            if rule && quote { stop.pointee = true }
        }
        if rule { result.append(.rule) }
        if quote { result.append(.quote) }
        if let images { result.append(.images(images)) }
        return result
    }
}

final class PreviewLayoutDelegate: NSObject, NSTextLayoutManagerDelegate {
    var tint: UIColor = .tintColor
    var hairline: CGFloat = 1
    var bodyFont = UIFont.preferredFont(forTextStyle: .body)
    weak var images: EditorImageStore?

    func textLayoutManager(
        _ textLayoutManager: NSTextLayoutManager, textLayoutFragmentFor location: any NSTextLocation,
        in textElement: NSTextElement
    ) -> NSTextLayoutFragment {
        guard let paragraph = textElement as? NSTextParagraph else {
            return NSTextLayoutFragment(textElement: textElement, range: textElement.elementRange)
        }
        let decorations = PreviewDecoration.decorations(in: paragraph.attributedString)
        if decorations.isEmpty {
            return NSTextLayoutFragment(textElement: textElement, range: textElement.elementRange)
        }
        return PreviewLayoutFragment(
            textElement: textElement, range: textElement.elementRange, decorations: decorations,
            tint: tint, hairline: hairline, bodyFont: bodyFont, images: images)
    }
}

final class PreviewLayoutFragment: NSTextLayoutFragment {
    let decorations: [PreviewDecoration]
    private let tint: UIColor
    private let hairline: CGFloat
    private weak var images: EditorImageStore?
    private let font: UIFont

    init(
        textElement: NSTextElement, range: NSTextRange?, decorations: [PreviewDecoration], tint: UIColor,
        hairline: CGFloat, bodyFont: UIFont, images: EditorImageStore?
    ) {
        self.font = bodyFont
        self.decorations = decorations
        self.tint = tint
        self.hairline = hairline
        self.images = images
        super.init(textElement: textElement, range: range)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    /// Checkbox marker ranges (paragraph-relative) and the rects their symbols are drawn in.
    var checkboxes: [(range: NSRange, checked: Bool, rect: CGRect)] {
        decorations.compactMap { decoration in
            guard case .checkbox(let range, let checked) = decoration,
                let rect = checkboxRect(range, checked: checked)
            else { return nil }
            return (range, checked, rect)
        }
    }

    /// Image boxes and their rects, stacked below the paragraph's last line.
    var imageBoxes: [(box: PreviewImageBox, rect: CGRect)] {
        var boxes: [PreviewImageBox] = []
        for case .images(let list) in decorations {
            boxes.append(contentsOf: list)
        }
        guard !boxes.isEmpty else { return [] }
        // The document's last paragraph also carries the empty line after its newline, which sits
        // below the paragraph spacing the boxes are drawn in.
        let lines = textLineFragments
        let lastLine = lines.last { $0.characterRange.length > 0 } ?? lines.last
        var y = (lastLine?.typographicBounds.maxY ?? 0) + PreviewImageBox.gap
        return boxes.map { box in
            let rect = CGRect(origin: CGPoint(x: padding, y: y), size: box.size)
            y = rect.maxY + PreviewImageBox.gap
            return (box, rect)
        }
    }

    override var renderingSurfaceBounds: CGRect {
        var bounds = super.renderingSurfaceBounds
        for decoration in decorations {
            if let rect = rect(for: decoration) {
                bounds = bounds.union(rect)
            }
        }
        return bounds
    }

    override func draw(at point: CGPoint, in context: CGContext) {
        UIGraphicsPushContext(context)
        for decoration in decorations where decoration == .quote {
            if let rect = rect(for: decoration) {
                tint.withAlphaComponent(0.4).setFill()
                UIRectFill(rect.offsetBy(dx: point.x, dy: point.y))
            }
        }
        UIGraphicsPopContext()

        super.draw(at: point, in: context)

        UIGraphicsPushContext(context)
        for decoration in decorations {
            switch decoration {
            case .checkbox(_, let checked):
                if let rect = rect(for: decoration) {
                    symbol(checked: checked)?.draw(in: rect.offsetBy(dx: point.x, dy: point.y))
                }
            case .rule:
                if let rect = rect(for: decoration) {
                    UIColor.separator.setFill()
                    UIRectFill(rect.offsetBy(dx: point.x, dy: point.y))
                }
            case .quote:
                break
            case .images:
                for image in imageBoxes {
                    drawImage(image.box, in: image.rect.offsetBy(dx: point.x, dy: point.y))
                }
            }
        }
        UIGraphicsPopContext()
    }

    private func imageState(_ imageId: String) -> EditorImageState {
        guard Thread.isMainThread else { return .loading }
        return MainActor.assumeIsolated { images?.state(for: imageId) ?? .loading }
    }

    private func drawImage(_ box: PreviewImageBox, in rect: CGRect) {
        switch imageState(box.imageId) {
        case .loading:
            UIColor.secondarySystemFill.setFill()
            UIRectFill(rect)
        case .loaded(let image):
            let size = image.size
            guard size.width > 0, size.height > 0 else { return }
            let scale = min(rect.width / size.width, rect.height / size.height)
            let fitted = CGSize(width: size.width * scale, height: size.height * scale)
            image.draw(
                in: CGRect(
                    x: rect.midX - fitted.width / 2, y: rect.midY - fitted.height / 2, width: fitted.width,
                    height: fitted.height))
        case .unavailable:
            UIColor.separator.setStroke()
            let border = UIBezierPath(rect: rect.insetBy(dx: hairline / 2, dy: hairline / 2))
            border.lineWidth = hairline
            border.stroke()
            let paragraph = NSMutableParagraphStyle()
            paragraph.alignment = .center
            let text = NSAttributedString(
                string: PreviewImageBox.unavailableText,
                attributes: [
                    .font: UIFont.preferredFont(forTextStyle: .footnote),
                    .foregroundColor: UIColor.secondaryLabel,
                    .paragraphStyle: paragraph,
                ])
            let inner = rect.insetBy(dx: 8, dy: 8)
            let height = min(
                inner.height,
                text.boundingRect(
                    with: CGSize(width: inner.width, height: .greatestFiniteMagnitude),
                    options: [.usesLineFragmentOrigin], context: nil
                ).height.rounded(.up))
            text.draw(
                with: CGRect(x: inner.minX, y: inner.midY - height / 2, width: inner.width, height: height),
                options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], context: nil)
        }
    }

    private var padding: CGFloat { textLayoutManager?.textContainer?.lineFragmentPadding ?? 5 }

    private var containerWidth: CGFloat {
        let width = textLayoutManager?.textContainer?.size.width ?? 0
        return width > 0 && width < 1e6 ? width : layoutFragmentFrame.width
    }

    private func rect(for decoration: PreviewDecoration) -> CGRect? {
        switch decoration {
        case .checkbox(let range, let checked):
            return checkboxRect(range, checked: checked)
        case .rule:
            guard let line = textLineFragments.first else { return nil }
            let bounds = line.typographicBounds
            let y = ((bounds.midY - hairline / 2) / hairline).rounded() * hairline
            return CGRect(x: padding, y: y, width: max(0, containerWidth - 2 * padding), height: hairline)
        case .quote:
            return CGRect(x: padding, y: 0, width: 2, height: layoutFragmentFrame.height)
        case .images:
            let rects = imageBoxes.map(\.rect)
            return rects.dropFirst().reduce(rects.first) { $0?.union($1) }
        }
    }

    private func checkboxRect(_ range: NSRange, checked: Bool) -> CGRect? {
        guard let marker = segmentRects(range).first, let size = symbol(checked: checked)?.size else {
            return nil
        }
        let side = min(max(size.width, size.height), font.lineHeight)
        let scale = side / max(size.width, size.height)
        let width = size.width * scale
        let height = size.height * scale
        return CGRect(x: marker.midX - width / 2, y: marker.midY - height / 2, width: width, height: height)
    }

    private func symbol(checked: Bool) -> UIImage? {
        UIImage(
            systemName: checked ? "checkmark.square.fill" : "square",
            withConfiguration: UIImage.SymbolConfiguration(font: font))?
            .withTintColor(tint, renderingMode: .alwaysOriginal)
    }
}

extension NSTextLayoutFragment {
    /// Rects, in fragment coordinates, covering `range` of the paragraph, one per line it spans.
    func segmentRects(_ range: NSRange) -> [CGRect] {
        var rects: [CGRect] = []
        for line in textLineFragments {
            let lineRange = line.characterRange
            let lower = max(range.location, lineRange.location)
            let upper = min(NSMaxRange(range), NSMaxRange(lineRange))
            guard lower < upper else { continue }
            let start = line.locationForCharacter(at: lower).x
            let end = line.locationForCharacter(at: upper).x
            let bounds = line.typographicBounds
            rects.append(
                CGRect(x: bounds.minX + min(start, end), y: bounds.minY, width: abs(end - start), height: bounds.height))
        }
        return rects
    }

    /// The paragraph-relative index of the character whose glyph box contains `point` (fragment coordinates).
    func characterIndex(at point: CGPoint) -> Int? {
        for line in textLineFragments {
            let bounds = line.typographicBounds
            guard bounds.minY <= point.y, point.y < bounds.maxY else { continue }
            let local = CGPoint(x: point.x - bounds.minX, y: point.y - bounds.minY)
            let index = line.characterIndex(for: local)
            let lineRange = line.characterRange
            for candidate in [index - 1, index] where lineRange.location <= candidate && candidate < NSMaxRange(lineRange) {
                let start = line.locationForCharacter(at: candidate).x
                let end = line.locationForCharacter(at: candidate + 1).x
                if min(start, end) <= local.x && local.x <= max(start, end) {
                    return candidate
                }
            }
            return nil
        }
        return nil
    }

    /// Visible links of the paragraph: their line-relative start (the `previewLink` value), range and text.
    var previewLinks: [(start: Int, range: NSRange, text: String)] {
        guard let string = (textElement as? NSTextParagraph)?.attributedString else { return [] }
        var links: [(start: Int, range: NSRange, text: String)] = []
        string.enumerateAttribute(.previewLink, in: NSRange(location: 0, length: string.length)) { value, range, _ in
            guard let start = value as? Int else { return }
            let text = string.attributedSubstring(from: range).string
            if let last = links.last, last.start == start {
                links[links.count - 1] = (
                    start, NSUnionRange(last.range, range), last.text + text
                )
            } else {
                links.append((start, range, text))
            }
        }
        return links.map { link in
            var text = link.text.trimmingCharacters(in: .whitespacesAndNewlines)
            if text.hasPrefix("<") && text.hasSuffix(">") && text.count >= 2 {
                text = String(text.dropFirst().dropLast())
            }
            return (link.start, link.range, text)
        }
    }

    var paragraphText: String {
        (textElement as? NSTextParagraph)?.attributedString.string ?? ""
    }
}

enum PreviewHit {
    case checkbox(Range<Int>)
    case link(URL)
    case image(String)
}

struct PreviewAccessibilityItem {
    enum Kind {
        case checkbox(range: Range<Int>, checked: Bool, label: String)
        case link(offset: Int, label: String)
        case image(key: String, imageId: String, label: String, state: String)
    }

    var kind: Kind
    /// In text view coordinates.
    var frame: CGRect
}

extension MarkdownTextView {
    private var contentStorage: NSTextContentStorage? {
        textLayoutManager?.textContentManager as? NSTextContentStorage
    }

    private func offset(of fragment: NSTextLayoutFragment) -> Int? {
        guard let storage = contentStorage else { return nil }
        return storage.offset(from: storage.documentRange.location, to: fragment.rangeInElement.location)
    }

    private func origin(of fragment: NSTextLayoutFragment) -> CGPoint {
        CGPoint(
            x: fragment.layoutFragmentFrame.minX + textContainerInset.left,
            y: fragment.layoutFragmentFrame.minY + textContainerInset.top)
    }

    func previewHit(at point: CGPoint) -> PreviewHit? {
        guard markedTextRange == nil, let layout = textLayoutManager else { return nil }
        let containerPoint = CGPoint(x: point.x - textContainerInset.left, y: point.y - textContainerInset.top)
        if let imageId = imageHit(at: containerPoint) {
            return .image(imageId)
        }
        guard let fragment = layout.textLayoutFragment(for: containerPoint), let start = offset(of: fragment) else {
            return nil
        }
        let local = CGPoint(
            x: containerPoint.x - fragment.layoutFragmentFrame.minX,
            y: containerPoint.y - fragment.layoutFragmentFrame.minY)
        if let preview = fragment as? PreviewLayoutFragment {
            for checkbox in preview.checkboxes where checkbox.rect.insetBy(dx: -8, dy: -6).contains(local) {
                let range = checkbox.range
                return .checkbox((start + range.location)..<(start + NSMaxRange(range)))
            }
        }
        guard !isFirstResponder, let index = fragment.characterIndex(at: local) else { return nil }
        guard fragment.previewLinks.contains(where: { NSLocationInRange(index, $0.range) }),
            let url = linkURLProvider?(start + index)
        else { return nil }
        return .link(url)
    }

    /// Checked across the viewport because the box lies in the paragraph spacing, below the fragment's text.
    private func imageHit(at containerPoint: CGPoint) -> String? {
        guard let layout = textLayoutManager, let viewport = layout.textViewportLayoutController.viewportRange
        else { return nil }
        var hit: String?
        _ = layout.enumerateTextLayoutFragments(from: viewport.location, options: []) { fragment in
            if fragment.rangeInElement.location.compare(viewport.endLocation) != .orderedAscending {
                return false
            }
            guard let preview = fragment as? PreviewLayoutFragment else { return true }
            let local = CGPoint(
                x: containerPoint.x - fragment.layoutFragmentFrame.minX,
                y: containerPoint.y - fragment.layoutFragmentFrame.minY)
            if let image = preview.imageBoxes.first(where: { $0.rect.contains(local) }) {
                hit = image.box.imageId
                return false
            }
            return true
        }
        return hit
    }

    func visiblePreviewItems() -> [PreviewAccessibilityItem] {
        guard markedTextRange == nil, let layout = textLayoutManager,
            let viewport = layout.textViewportLayoutController.viewportRange
        else { return [] }
        var checkboxes: [PreviewAccessibilityItem] = []
        var links: [PreviewAccessibilityItem] = []
        var images: [PreviewAccessibilityItem] = []
        _ = layout.enumerateTextLayoutFragments(from: viewport.location, options: []) { fragment in
            if fragment.rangeInElement.location.compare(viewport.endLocation) != .orderedAscending {
                return false
            }
            guard let start = self.offset(of: fragment) else { return true }
            let corner = self.origin(of: fragment)
            let text = fragment.paragraphText as NSString
            if let preview = fragment as? PreviewLayoutFragment {
                for checkbox in preview.checkboxes {
                    let lineEnd = text.lineRange(for: NSRange(location: checkbox.range.location, length: 0))
                    let restStart = NSMaxRange(checkbox.range)
                    let rest = text.substring(
                        with: NSRange(location: restStart, length: max(0, NSMaxRange(lineEnd) - restStart)))
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    checkboxes.append(
                        PreviewAccessibilityItem(
                            kind: .checkbox(
                                range: (start + checkbox.range.location)..<(start + NSMaxRange(checkbox.range)),
                                checked: checkbox.checked, label: rest.isEmpty ? "Task" : "Task: \(rest)"),
                            frame: checkbox.rect.offsetBy(dx: corner.x, dy: corner.y)))
                }
                for (index, image) in preview.imageBoxes.enumerated() {
                    let state = imageStore?.state(for: image.box.imageId) ?? .loading
                    images.append(
                        PreviewAccessibilityItem(
                            kind: .image(
                                key: "\(start):\(index)", imageId: image.box.imageId,
                                label: image.box.accessibilityLabel, state: state.accessibilityValue),
                            frame: image.rect.offsetBy(dx: corner.x, dy: corner.y)))
                }
            }
            for link in fragment.previewLinks where !link.text.isEmpty {
                let rects = fragment.segmentRects(link.range)
                guard let first = rects.first else { continue }
                let frame = rects.dropFirst().reduce(first) { $0.union($1) }
                links.append(
                    PreviewAccessibilityItem(
                        kind: .link(offset: start + link.range.location, label: link.text),
                        frame: frame.offsetBy(dx: corner.x, dy: corner.y)))
            }
            return true
        }
        return checkboxes + links + images
    }
}

final class EditorActionElement: UIAccessibilityElement {
    var action: (() -> Void)?

    override func accessibilityActivate() -> Bool {
        guard let action else { return false }
        action()
        return true
    }
}
