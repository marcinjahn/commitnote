public enum ShortcutCommand: String, CaseIterable, Sendable {
    case newNote, search, save, bold, italic, strikethrough, link, task
}

public struct ShortcutKey: Equatable, Sendable {
    public let input: String
    public let shift: Bool

    public init(input: String, shift: Bool = false) {
        self.input = input
        self.shift = shift
    }
}

public struct ShortcutContext: Equatable, Sendable {
    public var notesShown: Bool
    public var editorFocused: Bool
    public var modalPresented: Bool

    public init(notesShown: Bool, editorFocused: Bool, modalPresented: Bool) {
        self.notesShown = notesShown
        self.editorFocused = editorFocused
        self.modalPresented = modalPresented
    }
}

public enum KeyboardShortcuts {
    public static let menuCommands: [ShortcutCommand] = [.newNote, .search, .save]
    public static let formatCommands: [ShortcutCommand] = [
        .bold, .italic, .strikethrough, .link, .task,
    ]

    public static func key(for command: ShortcutCommand) -> ShortcutKey {
        switch command {
        case .newNote: ShortcutKey(input: "n")
        case .search: ShortcutKey(input: "f")
        case .save: ShortcutKey(input: "s")
        case .bold: ShortcutKey(input: "b")
        case .italic: ShortcutKey(input: "i")
        case .strikethrough: ShortcutKey(input: "x", shift: true)
        case .link: ShortcutKey(input: "k")
        case .task: ShortcutKey(input: "\r")
        }
    }

    public static func title(for command: ShortcutCommand) -> String {
        switch command {
        case .newNote: "New Note"
        case .search: "Search Notes"
        case .save: "Save"
        case .bold: "Bold"
        case .italic: "Italic"
        case .strikethrough: "Strikethrough"
        case .link: "Link"
        case .task: "Task"
        }
    }

    public static func commandK(editorFocused: Bool) -> ShortcutCommand {
        editorFocused ? .link : .search
    }

    public static func isEnabled(_ command: ShortcutCommand, in context: ShortcutContext) -> Bool {
        guard context.notesShown, !context.modalPresented else { return false }
        if formatCommands.contains(command) { return context.editorFocused }
        return true
    }
}
