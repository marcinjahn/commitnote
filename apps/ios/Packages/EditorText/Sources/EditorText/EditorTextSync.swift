public enum EditorTextSync: Equatable, Sendable {
    case set, update, accept, skip

    public static func decide(
        noteSwitch: Int, appliedSwitch: Int, text: String, doc: String, base: String
    ) -> EditorTextSync {
        if noteSwitch != appliedSwitch { return .set }
        if text == doc { return .accept }
        if doc == base { return .update }
        return .skip
    }
}
