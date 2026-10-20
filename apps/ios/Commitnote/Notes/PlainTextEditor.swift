import EditorText
import NativeCoreAPI
import SwiftUI
import UIKit

struct PlainTextEditor: UIViewRepresentable {
    let model: AppModel
    let target: EditorTarget
    let editorSwitch: Int
    let update: NoteContentUpdate?
    @Binding var focusRequested: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> EditorTextView {
        let textView = EditorTextView()
        let coordinator = context.coordinator
        coordinator.textView = textView
        textView.editorUndoManager = coordinator.undoManager
        textView.delegate = coordinator

        textView.font = UIFont.preferredFont(forTextStyle: .body)
        textView.adjustsFontForContentSizeCategory = true
        textView.textColor = .label
        textView.backgroundColor = .systemBackground
        textView.tintColor = UIColor(named: "AccentColor")
        textView.smartQuotesType = .no
        textView.smartDashesType = .no
        textView.smartInsertDeleteType = .no
        textView.autocorrectionType = .default
        textView.dataDetectorTypes = []
        textView.allowsEditingTextAttributes = false
        textView.alwaysBounceVertical = true
        textView.keyboardDismissMode = .interactive
        textView.accessibilityIdentifier = "note-editor"
        return textView
    }

    func updateUIView(_ textView: EditorTextView, context: Context) {
        let coordinator = context.coordinator
        coordinator.model = model
        coordinator.sync(target: target, editorSwitch: editorSwitch, update: update)
        if focusRequested {
            Task { @MainActor in
                textView.becomeFirstResponder()
                focusRequested = false
            }
        }
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate {
        private struct SyncKey: Equatable {
            let serial: Int?
            let editorSwitch: Int
            let target: EditorTarget
        }

        weak var model: AppModel?
        weak var textView: EditorTextView?
        let undoManager = EditorUndoManager()

        private var history = EditorHistory()
        private var lastText = ""
        private var lastSelection = EditorText.TextSelection(location: 0, length: 0)
        private var base = ""
        private var appliedSwitch: Int?
        private var currentSwitch = 0
        private var syncedKey: SyncKey?
        private var applying = false
        private var composing = false

        override init() {
            super.init()
            undoManager.coordinator = self
        }

        private var isReady: Bool { appliedSwitch == currentSwitch }

        var canUndo: Bool { isReady && history.canUndo }
        var canRedo: Bool { isReady && history.canRedo }

        func sync(target: EditorTarget, editorSwitch: Int, update: NoteContentUpdate?) {
            currentSwitch = editorSwitch
            let key = SyncKey(serial: update?.serial, editorSwitch: editorSwitch, target: target)
            guard key != syncedKey, let textView else { return }
            syncedKey = key

            switch target {
            case .none:
                return
            case .draft:
                if appliedSwitch != editorSwitch {
                    replaceAll(with: "", in: textView)
                    appliedSwitch = editorSwitch
                    base = ""
                }
            case .note(let path):
                guard let update, update.path == path else { return }
                apply(update, editorSwitch: editorSwitch, in: textView)
            }
        }

        private func apply(_ update: NoteContentUpdate, editorSwitch: Int, in textView: EditorTextView) {
            let doc = textView.text ?? ""
            let decision = EditorTextSync.decide(
                noteSwitch: editorSwitch, appliedSwitch: appliedSwitch ?? Int.min,
                text: update.content, doc: doc, base: base)
            switch decision {
            case .set:
                replaceAll(with: update.content, in: textView)
                appliedSwitch = editorSwitch
                base = update.content
            case .update:
                guard textView.markedTextRange == nil else { return }
                var edits = (update.edits ?? []).map {
                    TextEdit(from: $0.from, to: $0.to, insert: $0.insert)
                }
                if update.edits == nil || TextEdits.apply(edits, to: doc) != update.content {
                    edits = TextEdits.diff(old: doc, new: update.content)
                }
                applyRemote(edits, in: textView)
                history.mapThroughRemote(edits)
                lastText = update.content
                base = update.content
            case .accept:
                base = update.content
            case .skip:
                break
            }
        }

        private func replaceAll(with text: String, in textView: EditorTextView) {
            applying = true
            textView.text = text
            textView.selectedRange = NSRange(location: 0, length: 0)
            textView.setContentOffset(
                CGPoint(x: 0, y: -textView.adjustedContentInset.top), animated: false)
            applying = false
            history.reset()
            lastText = text
            lastSelection = EditorText.TextSelection(location: 0, length: 0)
            composing = false
        }

        private func applyRemote(_ edits: [TextEdit], in textView: EditorTextView) {
            guard !edits.isEmpty else { return }
            let offset = textView.contentOffset
            let selection = TextEdits.mapSelection(Self.selection(of: textView), through: edits)
            applying = true
            textView.inputDelegate?.textWillChange(textView)
            let storage = textView.textStorage
            storage.beginEditing()
            for edit in edits.reversed() {
                replace(edit, in: textView)
            }
            storage.endEditing()
            textView.inputDelegate?.textDidChange(textView)
            textView.selectedRange = Self.range(selection, length: storage.length)
            textView.contentOffset = offset
            applying = false
            lastSelection = Self.selection(of: textView)
        }

        private func applyLocal(_ step: HistoryStep, in textView: EditorTextView) {
            applying = true
            textView.inputDelegate?.textWillChange(textView)
            let storage = textView.textStorage
            storage.beginEditing()
            for edit in step.edits {
                replace(edit, in: textView)
            }
            storage.endEditing()
            textView.inputDelegate?.textDidChange(textView)
            textView.selectedRange = Self.range(step.selection, length: storage.length)
            applying = false
            lastText = textView.text ?? ""
            lastSelection = Self.selection(of: textView)
            composing = false
            textView.scrollRangeToVisible(textView.selectedRange)
            model?.edit(text: lastText)
        }

        private func replace(_ edit: TextEdit, in textView: EditorTextView) {
            let storage = textView.textStorage
            let from = min(max(0, edit.from), storage.length)
            let to = min(max(from, edit.to), storage.length)
            let attributes: [NSAttributedString.Key: Any] = [
                .font: textView.font ?? UIFont.preferredFont(forTextStyle: .body),
                .foregroundColor: textView.textColor ?? UIColor.label,
            ]
            storage.replaceCharacters(
                in: NSRange(location: from, length: to - from),
                with: NSAttributedString(string: edit.insert, attributes: attributes))
        }

        func undo() {
            guard isReady, let textView, textView.markedTextRange == nil,
                let step = history.undo()
            else { return }
            applyLocal(step, in: textView)
        }

        func redo() {
            guard isReady, let textView, textView.markedTextRange == nil,
                let step = history.redo()
            else { return }
            applyLocal(step, in: textView)
        }

        func textView(
            _ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String
        ) -> Bool {
            isReady
        }

        func textViewDidChange(_ textView: UITextView) {
            guard !applying else { return }
            let text = textView.text ?? ""
            let selection = Self.selection(of: textView)
            guard isReady else {
                lastText = text
                lastSelection = selection
                return
            }
            let marked = textView.markedTextRange != nil
            let edits = TextEdits.diff(old: lastText, new: text)
            if let edit = edits.first {
                history.recordLocal(
                    edit, in: lastText, selectionBefore: lastSelection, selectionAfter: selection,
                    at: ProcessInfo.processInfo.systemUptime, joinCurrentGroup: marked || composing)
            }
            composing = marked
            lastText = text
            lastSelection = selection
            if !edits.isEmpty {
                model?.edit(text: text)
            }
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            guard !applying, (textView.text ?? "") == lastText else { return }
            lastSelection = Self.selection(of: textView)
        }

        private static func selection(of textView: UITextView) -> EditorText.TextSelection {
            let range = textView.selectedRange
            return EditorText.TextSelection(location: range.location, length: range.length)
        }

        private static func range(_ selection: EditorText.TextSelection, length: Int) -> NSRange {
            let location = min(max(0, selection.location), length)
            return NSRange(
                location: location, length: min(max(0, selection.length), length - location))
        }
    }
}

final class EditorTextView: UITextView {
    var editorUndoManager: UndoManager?

    override var undoManager: UndoManager? {
        editorUndoManager ?? super.undoManager
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let side = max(16, (bounds.width - 720) / 2)
        if textContainerInset.left != side {
            textContainerInset = UIEdgeInsets(top: 12, left: side, bottom: 24, right: side)
        }
    }
}

/// Owns undo for the editor: UIKit's own registrations are discarded so that undo and redo only
/// ever revert local edits recorded in `EditorHistory`, never remote ones.
final class EditorUndoManager: UndoManager {
    weak var coordinator: PlainTextEditor.Coordinator?

    override init() {
        super.init()
        disableUndoRegistration()
    }

    override var canUndo: Bool {
        MainActor.assumeIsolated { coordinator?.canUndo ?? false }
    }

    override var canRedo: Bool {
        MainActor.assumeIsolated { coordinator?.canRedo ?? false }
    }

    override var undoActionName: String { "" }
    override var redoActionName: String { "" }

    override func undo() {
        MainActor.assumeIsolated { coordinator?.undo() }
    }

    override func redo() {
        MainActor.assumeIsolated { coordinator?.redo() }
    }

    override func registerUndo(withTarget target: Any, selector: Selector, object anObject: Any?) {}

    override func removeAllActions() {}

    override func removeAllActions(withTarget target: Any) {}
}
