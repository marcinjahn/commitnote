import AppInteraction
import SwiftUI
import UIKit

/// Takes hardware key presses while the note placeholder shows, so typing starts a new note.
struct TypeToStartCatcher: UIViewRepresentable {
    let model: AppModel
    let placeholderVisible: Bool
    let capturing: Bool

    func makeUIView(context: Context) -> TypeToStartCatcherView {
        let view = TypeToStartCatcherView()
        view.model = model
        return view
    }

    func updateUIView(_ view: TypeToStartCatcherView, context: Context) {
        view.model = model
        view.placeholderVisible = placeholderVisible
        view.capturing = capturing
    }

    static func dismantleUIView(_ view: TypeToStartCatcherView, coordinator: ()) {
        view.capturing = false
    }
}

final class TypeToStartCatcherView: UIView {
    weak var model: AppModel?
    var placeholderVisible = false
    var capturing = false {
        didSet {
            guard capturing != oldValue else { return }
            refreshFocus()
        }
    }

    private var consumedPresses: Set<UIPress> = []
    private var focusRetry: Task<Void, Never>?

    override var canBecomeFirstResponder: Bool { true }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        refreshFocus()
    }

    override func becomeFirstResponder() -> Bool {
        let became = super.becomeFirstResponder()
        reportReady()
        return became
    }

    override func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        reportReady()
        return resigned
    }

    private func refreshFocus() {
        focusRetry?.cancel()
        focusRetry = nil
        guard capturing, window != nil else {
            if isFirstResponder {
                _ = resignFirstResponder()
            }
            reportReady()
            return
        }
        claimFocus()
        // A closing sheet or search field can hand the focus back to its presenter after us.
        focusRetry = Task { @MainActor [weak self] in
            for delay in [150, 500] {
                try? await Task.sleep(for: .milliseconds(delay))
                guard let self, !Task.isCancelled else { return }
                self.claimFocus()
            }
        }
    }

    private func claimFocus() {
        guard capturing, window != nil, !isFirstResponder, !Self.textInputFocused() else {
            reportReady()
            return
        }
        _ = becomeFirstResponder()
    }

    private func reportReady() {
        #if FAKE_CORE
        let ready = isFirstResponder && capturing
        if model?.typeToStartCatcherReady != ready {
            model?.typeToStartCatcherReady = ready
        }
        #endif
    }

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var unhandled: Set<UIPress> = []
        for press in presses {
            if handle(press) {
                consumedPresses.insert(press)
            } else {
                unhandled.insert(press)
            }
        }
        if !unhandled.isEmpty {
            super.pressesBegan(unhandled, with: event)
        }
    }

    override func pressesChanged(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        let unhandled = presses.subtracting(consumedPresses)
        if !unhandled.isEmpty {
            super.pressesChanged(unhandled, with: event)
        }
    }

    override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        let unhandled = presses.subtracting(consumedPresses)
        consumedPresses.subtract(presses)
        if !unhandled.isEmpty {
            super.pressesEnded(unhandled, with: event)
        }
    }

    override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        let unhandled = presses.subtracting(consumedPresses)
        consumedPresses.subtract(presses)
        if !unhandled.isEmpty {
            super.pressesCancelled(unhandled, with: event)
        }
    }

    private func handle(_ press: UIPress) -> Bool {
        guard let model, let key = press.key else { return false }
        let modifiers = Self.modifiers(key.modifierFlags)
        if model.typeToStartPending {
            let input = Self.input(for: key, modifiers: modifiers)
            guard input != .other else { return false }
            model.bufferTypeToStart(input)
            return true
        }
        let context = model.typeToStartContext(placeholderVisible: placeholderVisible, textInputFocused: false)
        guard
            TypeToStart.shouldStart(
                characters: key.characters, modifiers: modifiers, isRepeat: false, context: context)
        else { return false }
        model.startTypeToStart(with: key.characters)
        return true
    }

    private static func input(for key: UIKey, modifiers: KeyModifiers) -> TypeToStartInput {
        guard modifiers.isDisjoint(with: [.command, .control, .option]) else { return .other }
        switch key.keyCode {
        case .keyboardReturnOrEnter, .keypadEnter:
            return .enter
        case .keyboardDeleteOrBackspace:
            return .backspace
        default:
            break
        }
        let scalars = key.characters.unicodeScalars
        guard scalars.count == 1, let scalar = scalars.first,
            scalar.properties.generalCategory != .control, !(0xF700...0xF8FF).contains(scalar.value)
        else { return .other }
        return .text(key.characters)
    }

    private static func modifiers(_ flags: UIKeyModifierFlags) -> KeyModifiers {
        var modifiers: KeyModifiers = []
        if flags.contains(.command) { modifiers.insert(.command) }
        if flags.contains(.control) { modifiers.insert(.control) }
        if flags.contains(.alternate) { modifiers.insert(.option) }
        if flags.contains(.shift) { modifiers.insert(.shift) }
        return modifiers
    }

    private static func textInputFocused() -> Bool {
        FirstResponderProbe.current.map { $0 is UIKeyInput } ?? false
    }
}

private enum FirstResponderProbe {
    @MainActor static var found: UIResponder?

    @MainActor static var current: UIResponder? {
        found = nil
        UIApplication.shared.sendAction(#selector(UIResponder.commitnoteReportFirstResponder), to: nil, from: nil, for: nil)
        defer { found = nil }
        return found
    }
}

extension UIResponder {
    @objc fileprivate func commitnoteReportFirstResponder() {
        FirstResponderProbe.found = self
    }
}
