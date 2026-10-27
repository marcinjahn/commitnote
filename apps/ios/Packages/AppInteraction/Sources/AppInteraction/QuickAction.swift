import NativeCoreAPI

public enum QuickAction {
    public static let newNoteType = "io.github.marcinjahn.commitnote.new-note"
    public static let searchType = "io.github.marcinjahn.commitnote.search"

    public static func action(forType type: String) -> LaunchAction? {
        switch type {
        case newNoteType: .newNote
        case searchType: .search
        default: nil
        }
    }

    public static func type(for action: LaunchAction) -> String {
        switch action {
        case .newNote: newNoteType
        case .search: searchType
        }
    }
}
