import AppInteraction
import Foundation
import NativeCoreAPI

extension AppModel {
    var shortcutContext: ShortcutContext {
        ShortcutContext(
            notesShown: screen == .notes && tree != nil,
            editorFocused: isEditorFocused,
            modalPresented: isModalPresented)
    }

    func editorDidBeginEditing(_ owner: AnyObject, formatter: @escaping (FormatCommand) -> Void) {
        editorFormatterOwner = owner
        editorFormatter = formatter
        isEditorFocused = true
        recordDraftFocus(.editor)
    }

    func editorDidEndEditing(_ owner: AnyObject) {
        guard editorFormatterOwner === owner else { return }
        editorFormatterOwner = nil
        editorFormatter = nil
        isEditorFocused = false
    }

    func perform(_ command: ShortcutCommand) {
        guard KeyboardShortcuts.isEnabled(command, in: shortcutContext) else { return }
        switch command {
        case .newNote:
            Task { await startDraft(parent: []) }
        case .search:
            Task { await presentSearch() }
        case .save:
            Task { await saveNow() }
        case .bold:
            editorFormatter?(.bold)
        case .italic:
            editorFormatter?(.italic)
        case .strikethrough:
            editorFormatter?(.strikethrough)
        case .link:
            editorFormatter?(.link)
        case .task:
            editorFormatter?(.task)
        }
    }

    func performCommandK() {
        perform(KeyboardShortcuts.commandK(editorFocused: isEditorFocused))
    }

    func saveNow() async {
        await flushEdits()
        Task { await flushSettings() }
        _ = try? await send(SyncFlush())
    }
}
