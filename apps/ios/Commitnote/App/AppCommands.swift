import AppInteraction
import SwiftUI
import UIKit

struct ShortcutState: Equatable {
    var context: ShortcutContext
    var commandKTitle: String
}

struct ShortcutStateKey: FocusedValueKey {
    typealias Value = ShortcutState
}

extension FocusedValues {
    var shortcutState: ShortcutState? {
        get { self[ShortcutStateKey.self] }
        set { self[ShortcutStateKey.self] = newValue }
    }
}

struct ShortcutStatePublisher: ViewModifier {
    let model: AppModel

    func body(content: Content) -> some View {
        let state = ShortcutState(
            context: model.shortcutContext,
            commandKTitle: KeyboardShortcuts.title(
                for: KeyboardShortcuts.commandK(editorFocused: model.isEditorFocused)))
        content
            .focusedSceneValue(\.shortcutState, state)
            .onChange(of: state) {
                // Key commands keep the enablement of the last menu validation until it is redone.
                UIMenuSystem.main.setNeedsRevalidate()
            }
    }
}

struct AppCommands: Commands {
    let model: AppModel
    @FocusedValue(\.shortcutState) private var state

    var body: some Commands {
        // On iPad only commands that replace the new-item group reach the app; the ones placed after
        // it or in the text formatting group never fire, so the editor's other commands live in
        // MarkdownTextView.
        CommandGroup(replacing: .newItem) {
            Button(KeyboardShortcuts.title(for: .newNote)) { model.perform(.newNote) }
                .keyboardShortcut(Self.shortcut(for: .newNote))
                .disabled(!isEnabled(.newNote))
            Button(KeyboardShortcuts.title(for: .search)) { model.perform(.search) }
                .keyboardShortcut(Self.shortcut(for: .search))
                .disabled(!isEnabled(.search))
            Button(state?.commandKTitle ?? KeyboardShortcuts.title(for: .search)) { model.performCommandK() }
                .keyboardShortcut(Self.shortcut(for: .link))
                .disabled(!isEnabled(.link) && !isEnabled(.search))
            Button(KeyboardShortcuts.title(for: .save)) { model.perform(.save) }
                .keyboardShortcut(Self.shortcut(for: .save))
                .disabled(!isEnabled(.save))
            Button(KeyboardShortcuts.title(for: .task)) { model.perform(.task) }
                .keyboardShortcut(Self.shortcut(for: .task))
                .disabled(!isEnabled(.task))
        }
        CommandGroup(replacing: .textEditing) {}
    }

    private func isEnabled(_ command: ShortcutCommand) -> Bool {
        state.map { KeyboardShortcuts.isEnabled(command, in: $0.context) } ?? false
    }

    private static func shortcut(for command: ShortcutCommand) -> KeyboardShortcut {
        let key = KeyboardShortcuts.key(for: command)
        let equivalent: KeyEquivalent = key.input == "\r" ? .return : KeyEquivalent(Character(key.input))
        return KeyboardShortcut(equivalent, modifiers: key.shift ? [.command, .shift] : .command)
    }
}
