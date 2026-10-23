public struct ImageReference: Sendable, Equatable {
    public var imageId: String
    public var width: Int?
    public var height: Int?
    public var alt: String
    public var range: Range<Int>

    public init(imageId: String, width: Int?, height: Int?, alt: String, range: Range<Int>) {
        self.imageId = imageId
        self.width = width
        self.height = height
        self.alt = alt
        self.range = range
    }

    public struct Target: Sendable, Equatable {
        public var imageId: String
        public var width: Int?
        public var height: Int?

        public init(imageId: String, width: Int?, height: Int?) {
            self.imageId = imageId
            self.width = width
            self.height = height
        }
    }

    /// Parses `image:<26 base32 chars>` with an optional `#WxH` suffix.
    public static func parse(url: String) -> Target? {
        let units = Array(url.utf16)
        let prefix = Array("image:".utf16)
        let idEnd = prefix.count + 26
        guard units.count >= idEnd, Array(units[0..<prefix.count]) == prefix else { return nil }
        for unit in units[prefix.count..<idEnd] {
            let isLower = unit >= 97 && unit <= 122
            let isBase32Digit = unit >= 50 && unit <= 55
            if !isLower && !isBase32Digit { return nil }
        }
        let imageId = String(decoding: units[prefix.count..<idEnd], as: UTF16.self)
        if units.count == idEnd { return Target(imageId: imageId, width: nil, height: nil) }
        guard units[idEnd] == 35 else { return nil }
        guard let separator = units[(idEnd + 1)...].firstIndex(of: 120) else { return nil }
        guard let width = dimension(units[(idEnd + 1)..<separator]),
            let height = dimension(units[(separator + 1)...])
        else { return nil }
        return Target(imageId: imageId, width: width, height: height)
    }

    private static func dimension(_ digits: ArraySlice<UInt16>) -> Int? {
        guard (1...5).contains(digits.count), digits.first != 48 else { return nil }
        var value = 0
        for unit in digits {
            guard unit >= 48 && unit <= 57 else { return nil }
            value = value * 10 + Int(unit - 48)
        }
        return value
    }

    /// Removes the backslash from escaped ASCII punctuation.
    public static func unescapedAlt(_ alt: String) -> String {
        let units = Array(alt.utf16)
        var result: [UInt16] = []
        result.reserveCapacity(units.count)
        var index = 0
        while index < units.count {
            if units[index] == 92, index + 1 < units.count, isEscapable(units[index + 1]) {
                result.append(units[index + 1])
                index += 2
            } else {
                result.append(units[index])
                index += 1
            }
        }
        return String(decoding: result, as: UTF16.self)
    }

    private static func isEscapable(_ unit: UInt16) -> Bool {
        (33...47).contains(unit) || (58...64).contains(unit) || (91...96).contains(unit)
            || (123...126).contains(unit)
    }

    public static func containsReference(in text: String) -> Bool {
        guard text.contains("image:") else { return false }
        let document = MarkdownParser.parse(text)
        return document.nodes.contains { reference(for: $0, in: document) != nil }
    }

    /// The reference described by an `image` node, or nil when its destination is not an image reference.
    public static func reference(for node: SyntaxNode, in document: MarkdownDocument) -> ImageReference? {
        guard node.kind == .image else { return nil }
        let inside = document.nodes(overlapping: node.range).filter {
            node.range.contains($0.range.lowerBound) && $0.range.upperBound <= node.range.upperBound
        }
        let openings = inside.filter { $0.kind == .linkMark && document.slice($0.range) == "(" }
        guard
            let url = inside.first(where: { url in
                url.kind == .url && openings.contains { $0.range.upperBound == url.range.lowerBound }
            }),
            let target = parse(url: document.slice(url.range)),
            let closing = inside.last(where: { $0.kind == .linkMark && $0.range.upperBound <= url.range.lowerBound - 1 }),
            let opening = inside.first(where: { $0.kind == .linkMark })
        else { return nil }
        let alt = document.slice(opening.range.upperBound..<closing.range.lowerBound)
        return ImageReference(
            imageId: target.imageId, width: target.width, height: target.height,
            alt: unescapedAlt(alt), range: node.range)
    }
}

extension MarkdownDocument {
    func slice(_ range: Range<Int>) -> String {
        let lower = max(0, min(range.lowerBound, units.count))
        let upper = max(lower, min(range.upperBound, units.count))
        return String(decoding: units[lower..<upper], as: UTF16.self)
    }
}
