import EditorText

public enum InsertionAnchorRule {
    /// The edits made since an insertion anchor was taken, or nil when the editor moved to another note or draft.
    public static func edits(
        anchorLineage: Int, currentLineage: Int, anchorText: String, currentText: String
    ) -> [TextEdit]? {
        guard anchorLineage == currentLineage else { return nil }
        return TextEdits.diff(old: anchorText, new: currentText)
    }
}
