import AppIntents
import NativeCoreAPI

struct NewNoteIntent: AppIntent {
    static let title: LocalizedStringResource = "New note"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        LaunchInbox.shared.deliver(.newNote)
        return .result()
    }
}

struct SearchNotesIntent: AppIntent {
    static let title: LocalizedStringResource = "Search notes"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        LaunchInbox.shared.deliver(.search)
        return .result()
    }
}

struct CommitnoteShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: NewNoteIntent(),
            phrases: [
                "New note in \(.applicationName)",
                "Start a note in \(.applicationName)",
            ],
            shortTitle: "New note",
            systemImageName: "square.and.pencil"
        )
        AppShortcut(
            intent: SearchNotesIntent(),
            phrases: [
                "Search notes in \(.applicationName)",
                "Search \(.applicationName)",
            ],
            shortTitle: "Search notes",
            systemImageName: "magnifyingglass"
        )
    }
}
