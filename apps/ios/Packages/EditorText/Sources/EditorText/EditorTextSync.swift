public enum EditorTextSync: Equatable, Sendable {
    case set, update, accept, skip

    public static func decide(
        noteSwitch: Int, appliedSwitch: Int, text: String, doc: String, base: String, echo: Bool
    ) -> EditorTextSync {
        if noteSwitch != appliedSwitch { return .set }
        if text == doc || echo { return .accept }
        if doc == base { return .update }
        return .skip
    }
}

/// The texts sent to the core that it has not reported back yet, so a late report of one is told
/// apart from a change made elsewhere.
public struct SentTexts: Equatable, Sendable {
    public static let limit = 64

    private var texts: [String] = []

    public init() {}

    public mutating func record(_ text: String) {
        if texts.count == Self.limit {
            texts.removeFirst()
        }
        texts.append(text)
    }

    /// The core reports sends in order, and may skip texts that were replaced before being sent,
    /// so this also forgets every earlier one.
    public mutating func takeEcho(_ text: String) -> Bool {
        guard let index = texts.firstIndex(of: text) else { return false }
        texts.removeSubrange(...index)
        return true
    }

    public mutating func clear() {
        texts.removeAll()
    }
}
