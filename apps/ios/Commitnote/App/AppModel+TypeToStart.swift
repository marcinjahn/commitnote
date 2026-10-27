import AppInteraction
import Foundation

enum DraftFocus {
    case name
    case editor
}

extension AppModel {
    func typeToStartContext(placeholderVisible: Bool, textInputFocused: Bool) -> TypeToStartContext {
        TypeToStartContext(
            enabled: typeToStartEnabled,
            treeLoaded: screen == .notes && tree != nil && initialEntrySettled,
            editorOpen: editorTarget != .none,
            placeholderVisible: placeholderVisible,
            modalPresented: isModalPresented,
            searchActive: isSearchActive,
            textInputFocused: textInputFocused)
    }

    /// Whether a key press could start a note now, before looking at the key itself.
    func typeToStartArmed(placeholderVisible: Bool) -> Bool {
        let context = typeToStartContext(placeholderVisible: placeholderVisible, textInputFocused: false)
        return context.enabled && context.treeLoaded && !context.editorOpen && context.placeholderVisible
            && !context.modalPresented && !context.searchActive
    }

    func startTypeToStart(with characters: String) {
        guard !typeToStartPending else { return }
        typeToStartBuffer.append(.text(characters))
        typeToStartPending = true
        Task {
            let started = await startDraft(parent: [], focus: .editor)
            if !started {
                cancelTypeToStart()
            }
        }
    }

    func bufferTypeToStart(_ input: TypeToStartInput) {
        guard typeToStartPending else { return }
        typeToStartBuffer.append(input)
    }

    /// The keys typed since the note was started, once its editor can take them.
    func editorBecameReady() -> String? {
        guard typeToStartPending else { return nil }
        typeToStartPending = false
        return typeToStartBuffer.drain()
    }

    func cancelTypeToStart() {
        typeToStartPending = false
        _ = typeToStartBuffer.drain()
    }
}
