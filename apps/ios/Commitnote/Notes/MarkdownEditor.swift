import EditorText
import MarkdownStyling
import NativeCoreAPI
import SwiftUI
import UIKit

struct MarkdownEditor: UIViewRepresentable {
    let model: AppModel
    let target: EditorTarget
    let editorSwitch: Int
    let editorLineage: Int
    let update: NoteContentUpdate?
    @Binding var focusRequested: Bool
    /// Shows this text read-only: no edit ever reaches the model, and the editor target is never read or changed.
    var readOnlyText: String? = nil
    let appearance: AppAppearance

    func makeCoordinator() -> Coordinator {
        Coordinator(readOnly: readOnlyText != nil)
    }

    func makeUIView(context: Context) -> MarkdownEditorContainer {
        // Not `init(usingTextLayoutManager:)`: that factory skips the subclass initialiser.
        // A nil container still gives TextKit 2.
        let textView = MarkdownTextView(frame: .zero, textContainer: nil)
        let coordinator = context.coordinator
        coordinator.textView = textView
        textView.editorUndoManager = coordinator.undoManager
        textView.delegate = coordinator
        textView.linkURLProvider = { [weak coordinator] offset in
            coordinator?.linkURL(at: offset)
        }
        textView.imageStore = coordinator.images
        textView.imageTapHandler = { [weak coordinator] imageId in
            coordinator?.tapImage(imageId)
        }
        textView.imageLayoutHandler = { [weak coordinator] in
            coordinator?.imageLayoutDidChange()
        }
        textView.contentSizeCategoryHandler = { [weak coordinator] in
            coordinator?.contentSizeCategoryDidChange()
        }
        configure(textView)
        coordinator.setAppearance(appearance)
        if coordinator.readOnly {
            textView.isEditable = false
            textView.isSelectable = true
            textView.inputAccessoryView = nil
            textView.accessibilityIdentifier = "shared-version-content"
            return MarkdownEditorContainer(textView: textView)
        }

        textView.pasteHandler = { [weak coordinator] string in
            coordinator?.paste(string) ?? false
        }
        textView.formatHandler = { [weak coordinator] command in
            coordinator?.format(command)
        }
        textView.checkboxHandler = { [weak coordinator] range in
            coordinator?.toggleCheckbox(range)
        }
        textView.imagePasteHandler = { [weak coordinator] providers in
            coordinator?.pasteImages(providers) ?? false
        }
        textView.imageDropHandler = { [weak coordinator] offset, providers in
            coordinator?.dropImages(providers, at: offset)
        }
        textView.imageSourceHandler = { [weak coordinator] source in
            coordinator?.model?.imageSourceRequest = source
        }
        textView.keyboardDismissMode = .interactive
        textView.accessibilityIdentifier = "note-editor"
        return MarkdownEditorContainer(textView: textView)
    }

    private func configure(_ textView: MarkdownTextView) {
        textView.adjustsFontForContentSizeCategory = true
        textView.textColor = .label
        textView.backgroundColor = .systemBackground
        textView.smartQuotesType = .no
        textView.smartDashesType = .no
        textView.smartInsertDeleteType = .no
        textView.autocorrectionType = .default
        textView.dataDetectorTypes = []
        textView.allowsEditingTextAttributes = false
        textView.alwaysBounceVertical = true
    }

    func updateUIView(_ container: MarkdownEditorContainer, context: Context) {
        let coordinator = context.coordinator
        coordinator.model = model
        coordinator.setAppearance(appearance)
        if let readOnlyText {
            coordinator.show(readOnlyText)
            return
        }
        coordinator.sync(target: target, editorSwitch: editorSwitch, editorLineage: editorLineage, update: update)
        if let picked = model.pickedImages {
            coordinator.receivePickedImages(id: picked.id)
        }
        if focusRequested {
            Task { @MainActor in
                container.textView.becomeFirstResponder()
                focusRequested = false
            }
        }
    }

    static func dismantleUIView(_ container: MarkdownEditorContainer, coordinator: Coordinator) {
        coordinator.savePosition()
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate {
        private struct SyncKey: Equatable {
            let serial: Int?
            let editorSwitch: Int
            let target: EditorTarget
        }

        weak var model: AppModel?
        weak var textView: MarkdownTextView?
        let readOnly: Bool
        let undoManager = EditorUndoManager()
        let images = EditorImageStore()

        private let styler = MarkdownStyler()
        private var history = EditorHistory()
        private var lastText = ""
        private var lastSelection = EditorText.TextSelection(location: 0, length: 0)
        private var base = ""
        private var appliedSwitch: Int?
        private var appliedPath: [String]?
        private var currentSwitch = 0
        private var currentLineage = 0
        private var syncedKey: SyncKey?
        private var applying = false
        private var composing = false
        private var receivedPickedId: UUID?
        private var currentNoteFont: String?
        private var appliedNoteFont: String?
        private var tintKey: [String?]?

        private struct InsertionAnchor {
            let editorLineage: Int
            let text: String
            let selection: EditorText.TextSelection
        }

        init(readOnly: Bool) {
            self.readOnly = readOnly
            super.init()
            undoManager.coordinator = self
            styler.images = images
            styler.revealsSelectedLines = !readOnly
            images.load = { [weak self] imageId in
                await self?.model?.image(for: imageId)
            }
            images.didResolve = { [weak self] imageId in
                self?.imageResolved(imageId)
            }
        }

        func setAppearance(_ appearance: AppAppearance) {
            guard let textView else { return }
            if tintKey != [appearance.accentLight, appearance.accentDark] {
                tintKey = [appearance.accentLight, appearance.accentDark]
                textView.tintColor = appearance.tint
            }
            guard appearance.noteFont != currentNoteFont else { return }
            currentNoteFont = appearance.noteFont
            restyle(textView)
        }

        private func applyNoteFont(to textView: UITextView) {
            guard let noteFont = currentNoteFont, appliedNoteFont != noteFont, textView.markedTextRange == nil
            else { return }
            appliedNoteFont = noteFont
            styler.noteFont = noteFont
            textView.font = styler.baseAttributes[.font] as? UIFont
            textView.typingAttributes = styler.baseAttributes
            (textView as? MarkdownTextView)?.previewBodyFont = styler.baseAttributes[.font] as? UIFont
        }

        private func restyle(_ textView: UITextView) {
            applyNoteFont(to: textView)
            styler.restyle(textView)
            images.request(
                styler.placements.compactMap { placement in
                    if case .image(let reference, _, _) = placement { reference.imageId } else { nil }
                })
        }

        private func imageResolved(_ imageId: String) {
            guard let textView else { return }
            restyle(textView)
            styler.invalidateImage(imageId, in: textView)
            textView.previewLayoutHandler?()
        }

        func tapImage(_ imageId: String) {
            switch images.state(for: imageId) {
            case .loaded:
                model?.viewerImageId = imageId
            case .unavailable:
                images.retry(imageId)
            case .loading:
                break
            }
        }

        func imageLayoutDidChange() {
            guard let textView else { return }
            restyle(textView)
        }

        private var isReady: Bool { appliedSwitch == currentSwitch }

        var canUndo: Bool { isReady && history.canUndo }
        var canRedo: Bool { isReady && history.canRedo }

        func sync(target: EditorTarget, editorSwitch: Int, editorLineage: Int, update: NoteContentUpdate?) {
            currentSwitch = editorSwitch
            currentLineage = editorLineage
            let key = SyncKey(serial: update?.serial, editorSwitch: editorSwitch, target: target)
            guard key != syncedKey, let textView else { return }
            syncedKey = key

            if editorSwitch != appliedSwitch {
                savePosition()
            } else if let path = target.notePath, appliedPath != nil {
                appliedPath = path
            }

            switch target {
            case .none:
                return
            case .draft:
                if appliedSwitch != editorSwitch {
                    replaceAll(with: "", in: textView)
                    appliedSwitch = editorSwitch
                    appliedPath = nil
                    base = ""
                }
            case .note(let path):
                guard let update, update.path == path else { return }
                apply(update, editorSwitch: editorSwitch, in: textView)
            }
        }

        func show(_ text: String) {
            guard let textView, !isReady || lastText != text else { return }
            replaceAll(with: text, in: textView)
            appliedSwitch = currentSwitch
        }

        func savePosition() {
            guard !readOnly, let appliedPath, let textView, let model else { return }
            model.savePosition(
                NotePosition(
                    selection: Self.selection(of: textView),
                    contentOffsetY: Double(textView.contentOffset.y)),
                for: appliedPath)
        }

        private func apply(_ update: NoteContentUpdate, editorSwitch: Int, in textView: MarkdownTextView) {
            let doc = textView.text ?? ""
            let decision = EditorTextSync.decide(
                noteSwitch: editorSwitch, appliedSwitch: appliedSwitch ?? Int.min,
                text: update.content, doc: doc, base: base)
            switch decision {
            case .set:
                replaceAll(with: update.content, in: textView)
                appliedSwitch = editorSwitch
                appliedPath = update.path
                base = update.content
                placeCaret(for: update.path, in: textView)
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

        private func placeCaret(for path: [String], in textView: MarkdownTextView) {
            guard let model else { return }
            let length = textView.textStorage.length
            if model.editorFocusAtEnd == path {
                setSelection(EditorText.TextSelection(location: length, length: 0), in: textView)
                Task { @MainActor in
                    model.clearEditorFocusAtEnd()
                    textView.becomeFirstResponder()
                    textView.scrollRangeToVisible(textView.selectedRange)
                }
            } else if let position = model.position(for: path) {
                setSelection(position.selection, in: textView)
                textView.pendingOffsetY = CGFloat(position.contentOffsetY)
            }
        }

        private func setSelection(_ selection: EditorText.TextSelection, in textView: MarkdownTextView) {
            applying = true
            textView.selectedRange = Self.range(selection, length: textView.textStorage.length)
            applying = false
            lastSelection = Self.selection(of: textView)
            restyle(textView)
        }

        private func replaceAll(with text: String, in textView: MarkdownTextView) {
            applying = true
            textView.pendingOffsetY = nil
            textView.attributedText = NSAttributedString(string: text, attributes: styler.baseAttributes)
            textView.typingAttributes = styler.baseAttributes
            textView.selectedRange = NSRange(location: 0, length: 0)
            textView.setContentOffset(
                CGPoint(x: 0, y: -textView.adjustedContentInset.top), animated: false)
            applying = false
            history.reset()
            lastText = text
            lastSelection = EditorText.TextSelection(location: 0, length: 0)
            composing = false
            images.reset()
            styler.invalidateAll()
            restyle(textView)
        }

        private func applyRemote(_ edits: [TextEdit], in textView: MarkdownTextView) {
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
            restyle(textView)
        }

        private func applyLocal(_ step: HistoryStep, in textView: MarkdownTextView) {
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
            restyle(textView)
            textView.scrollRangeToVisible(textView.selectedRange)
            sendEdit(lastText)
        }

        private func sendEdit(_ text: String) {
            guard !readOnly else { return }
            model?.edit(text: text)
        }

        private func replace(_ edit: TextEdit, in textView: MarkdownTextView) {
            let storage = textView.textStorage
            let from = min(max(0, edit.from), storage.length)
            let to = min(max(from, edit.to), storage.length)
            storage.replaceCharacters(
                in: NSRange(location: from, length: to - from),
                with: NSAttributedString(string: edit.insert, attributes: styler.baseAttributes))
        }

        private func applyCommand(_ result: CommandResult, in textView: MarkdownTextView) {
            let text = TextEdits.apply(result.edits, to: lastText)
            guard let edit = TextEdits.diff(old: lastText, new: text).first else {
                setSelection(result.selection, in: textView)
                return
            }
            history.breakGroup()
            history.recordLocal(
                edit, in: lastText, selectionBefore: lastSelection, selectionAfter: result.selection,
                at: ProcessInfo.processInfo.systemUptime)
            history.breakGroup()
            applyLocal(HistoryStep(edits: [edit], selection: result.selection), in: textView)
        }

        func paste(_ string: String) -> Bool {
            guard isReady, let textView, textView.markedTextRange == nil else { return false }
            let selection = Self.selection(of: textView)
            if ImageReference.containsReference(in: string), let model {
                let anchor = InsertionAnchor(editorLineage: currentLineage, text: lastText, selection: selection)
                Task { @MainActor [weak self] in
                    let text = await model.clonePastedImages(string, current: anchor.text)
                    self?.finishPaste(text, anchor: anchor)
                }
                return true
            }
            guard let result = MarkdownCommands.pasteLink(lastText, selection, string) else { return false }
            applyCommand(result, in: textView)
            return true
        }

        private func finishPaste(_ pasted: String, anchor: InsertionAnchor) {
            guard let textView, let edits = editsSince(anchor, in: textView) else { return }
            let selection = TextEdits.mapSelection(anchor.selection, through: edits)
            let result =
                MarkdownCommands.pasteLink(lastText, selection, pasted)
                ?? CommandResult(
                    edits: [TextEdit(from: selection.location, to: selection.location + selection.length, insert: pasted)],
                    selection: EditorText.TextSelection(location: selection.location + pasted.utf16.count, length: 0))
            applyCommand(result, in: textView)
        }

        func pasteImages(_ providers: [NSItemProvider]) -> Bool {
            guard isReady, let textView, textView.markedTextRange == nil else { return false }
            let selection = Self.selection(of: textView)
            insertImages(
                from: providers,
                anchor: InsertionAnchor(
                    editorLineage: currentLineage, text: lastText,
                    selection: EditorText.TextSelection(location: selection.location + selection.length, length: 0)))
            return true
        }

        func dropImages(_ providers: [NSItemProvider], at offset: Int) {
            guard isReady else { return }
            insertImages(
                from: providers,
                anchor: InsertionAnchor(
                    editorLineage: currentLineage, text: lastText,
                    selection: EditorText.TextSelection(location: offset, length: 0)))
        }

        func receivePickedImages(id: UUID) {
            guard id != receivedPickedId else { return }
            receivedPickedId = id
            Task { @MainActor [weak self] in
                guard let self, let inputs = self.model?.takePickedImages(id: id), self.isReady else { return }
                let selection = self.lastSelection
                let anchor = InsertionAnchor(
                    editorLineage: self.currentLineage, text: self.lastText,
                    selection: EditorText.TextSelection(location: selection.location + selection.length, length: 0))
                self.insertImages(inputs, anchor: anchor)
            }
        }

        private func insertImages(from providers: [NSItemProvider], anchor: InsertionAnchor) {
            guard !providers.isEmpty else { return }
            Task { @MainActor [weak self] in
                let inputs = await EditorImageItems.load(providers)
                self?.insertImages(inputs, anchor: anchor)
            }
        }

        private func insertImages(_ inputs: [ImageInput], anchor: InsertionAnchor) {
            guard !inputs.isEmpty, let model else { return }
            Task { @MainActor [weak self] in
                let references = await model.insertImages(inputs)
                guard let self, let textView = self.textView, !references.isEmpty,
                    let edits = self.editsSince(anchor, in: textView)
                else { return }
                let position = TextEdits.mapPosition(anchor.selection.location, through: edits, assoc: .before)
                guard
                    let result = MarkdownCommands.insertImageReferences(
                        text: self.lastText, at: position, selection: self.lastSelection, references: references)
                else { return }
                self.applyCommand(result, in: textView)
            }
        }

        /// The edits made since `anchor` was taken, or nil when the editor moved to another note or draft.
        private func editsSince(_ anchor: InsertionAnchor, in textView: MarkdownTextView) -> [TextEdit]? {
            guard isReady, anchor.editorLineage == currentLineage else { return nil }
            if textView.markedTextRange != nil {
                textView.unmarkText()
                if (textView.text ?? "") != lastText {
                    textViewDidChange(textView)
                }
            }
            return InsertionAnchorRule.edits(
                anchorLineage: anchor.editorLineage, currentLineage: currentLineage,
                anchorText: anchor.text, currentText: lastText)
        }

        func format(_ command: FormatCommand) {
            guard isReady, let textView, textView.markedTextRange == nil else { return }
            let selection = Self.selection(of: textView)
            let result: CommandResult? =
                switch command {
                case .bold: MarkdownCommands.toggleBold(lastText, selection)
                case .italic: MarkdownCommands.toggleItalic(lastText, selection)
                case .strikethrough: MarkdownCommands.toggleStrikethrough(lastText, selection)
                case .link: MarkdownCommands.insertLink(lastText, selection)
                case .task: MarkdownCommands.toggleTask(lastText, selection)
                }
            guard let result else { return }
            applyCommand(result, in: textView)
        }

        func toggleCheckbox(_ markerRange: Range<Int>) {
            guard !readOnly, isReady, let textView, textView.markedTextRange == nil else { return }
            let current = lastText as NSString
            guard markerRange.lowerBound >= 0, markerRange.upperBound <= current.length,
                ["[ ]", "[x]", "[X]"].contains(
                    current.substring(with: NSRange(location: markerRange.lowerBound, length: markerRange.count)))
            else { return }
            let result = MarkdownCommands.toggleCheckbox(lastText, markerRange: markerRange)
            let text = TextEdits.apply(result.edits, to: lastText)
            guard let edit = TextEdits.diff(old: lastText, new: text).first else { return }
            history.breakGroup()
            history.recordLocal(
                edit, in: lastText, selectionBefore: lastSelection,
                selectionAfter: TextEdits.mapSelection(lastSelection, through: [edit]),
                at: ProcessInfo.processInfo.systemUptime)
            history.breakGroup()
            applying = true
            textView.inputDelegate?.textWillChange(textView)
            let storage = textView.textStorage
            storage.beginEditing()
            replace(edit, in: textView)
            storage.endEditing()
            textView.inputDelegate?.textDidChange(textView)
            applying = false
            lastText = textView.text ?? ""
            lastSelection = Self.selection(of: textView)
            composing = false
            restyle(textView)
            sendEdit(lastText)
        }

        func linkURL(at offset: Int) -> URL? {
            guard isReady else { return nil }
            return MarkdownCommands.linkURL(in: styler.parsed(lastText), at: offset)
        }

        func textView(
            _ textView: UITextView, editMenuForTextIn range: NSRange, suggestedActions: [UIMenuElement]
        ) -> UIMenu? {
            guard textView.markedTextRange == nil,
                let url = linkURL(at: range.location) ?? (range.length > 0 ? linkURL(at: NSMaxRange(range)) : nil)
            else { return nil }
            let open = UIAction(title: "Open Link", image: UIImage(systemName: "safari")) { _ in
                UIApplication.shared.open(url)
            }
            return UIMenu(children: [open] + suggestedActions)
        }

        func contentSizeCategoryDidChange() {
            guard let textView else { return }
            styler.contentSizeCategoryDidChange()
            textView.typingAttributes = styler.baseAttributes
            (textView as? MarkdownTextView)?.previewBodyFont = styler.baseAttributes[.font] as? UIFont
            restyle(textView)
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
            isReady && !readOnly
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
            restyle(textView)
            if !edits.isEmpty {
                sendEdit(text)
            }
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            #if FAKE_CORE
            (textView as? MarkdownTextView)?.previewLayoutHandler?()
            #endif
            guard !applying, (textView.text ?? "") == lastText else { return }
            lastSelection = Self.selection(of: textView)
            restyle(textView)
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

extension MarkdownEditor {
    init(model: AppModel, readOnlyText: String, appearance: AppAppearance) {
        self.init(
            model: model, target: .none, editorSwitch: 0, editorLineage: 0, update: nil, focusRequested: .constant(false),
            readOnlyText: readOnlyText, appearance: appearance)
    }
}

enum FormatCommand: CaseIterable {
    case bold, italic, strikethrough, link, task

    var symbol: String {
        switch self {
        case .bold: "bold"
        case .italic: "italic"
        case .strikethrough: "strikethrough"
        case .link: "link"
        case .task: "checklist"
        }
    }

    var label: String {
        switch self {
        case .bold: "Bold"
        case .italic: "Italic"
        case .strikethrough: "Strikethrough"
        case .link: "Link"
        case .task: "Task"
        }
    }

    var identifier: String {
        switch self {
        case .bold: "format-bold"
        case .italic: "format-italic"
        case .strikethrough: "format-strikethrough"
        case .link: "format-link"
        case .task: "format-task"
        }
    }
}

final class MarkdownEditorContainer: UIView {
    let textView: MarkdownTextView
    private var previewElements: [EditorActionElement] = []
    private var previewElementKeys: [String] = []
    private var previewElementsValid = false

    init(textView: MarkdownTextView) {
        self.textView = textView
        super.init(frame: .zero)
        textView.frame = bounds
        textView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(textView)
        textView.previewLayoutHandler = { [weak self] in
            self?.previewElementsValid = false
        }
    }

    override var accessibilityElements: [Any]? {
        get {
            var elements: [Any] = [textView]
            elements.append(contentsOf: currentPreviewElements())
            #if FAKE_CORE
            let selection = UIAccessibilityElement(accessibilityContainer: self)
            selection.accessibilityIdentifier = "testing-editor-selection"
            selection.accessibilityValue = "\(textView.selectedRange.length)"
            selection.accessibilityFrameInContainerSpace = CGRect(x: 0, y: 0, width: 1, height: 1)
            elements.append(selection)
            #endif
            return elements
        }
        set {}
    }

    private func currentPreviewElements() -> [EditorActionElement] {
        if previewElementsValid { return previewElements }
        previewElementsValid = true
        var reusable: [String: EditorActionElement] = [:]
        for (key, element) in zip(previewElementKeys, previewElements) {
            reusable[key] = element
        }
        var keys: [String] = []
        var elements: [EditorActionElement] = []
        let visible = textView.bounds
        for item in textView.visiblePreviewItems() where item.frame.intersects(visible) {
            let key: String
            switch item.kind {
            case .checkbox(let range, _, _): key = "checkbox:\(range.lowerBound)"
            case .link(let offset, _): key = "link:\(offset)"
            case .image(let imageKey, _, _, _): key = "image:\(imageKey)"
            }
            let element = reusable.removeValue(forKey: key) ?? EditorActionElement(accessibilityContainer: self)
            element.accessibilityFrameInContainerSpace = textView.convert(item.frame, to: self)
            switch item.kind {
            case .checkbox(let range, let checked, let label):
                element.accessibilityIdentifier = "editor-task-checkbox"
                element.accessibilityLabel = label
                element.accessibilityValue = checked ? "checked" : "unchecked"
                element.accessibilityTraits = .button
                element.action = { [weak textView] in
                    textView?.checkboxHandler?(range)
                }
            case .link(let offset, let label):
                element.accessibilityIdentifier = "editor-link"
                element.accessibilityLabel = label
                element.accessibilityValue = nil
                element.accessibilityTraits = .link
                element.action = { [weak textView] in
                    if let url = textView?.linkURLProvider?(offset) {
                        UIApplication.shared.open(url)
                    }
                }
            case .image(_, let imageId, let label, let state):
                element.accessibilityIdentifier = "editor-image"
                element.accessibilityLabel = label
                element.accessibilityValue = state
                if state != EditorImageState.loading.accessibilityValue {
                    element.accessibilityTraits = [.image, .button]
                    element.action = { [weak textView] in
                        textView?.imageTapHandler?(imageId)
                    }
                } else {
                    element.accessibilityTraits = .image
                    element.action = nil
                }
            }
            keys.append(key)
            elements.append(element)
        }
        previewElementKeys = keys
        previewElements = elements
        return elements
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

final class MarkdownTextView: UITextView {
    var editorUndoManager: UndoManager?
    var pasteHandler: ((String) -> Bool)?
    var formatHandler: ((FormatCommand) -> Void)?
    var contentSizeCategoryHandler: (() -> Void)?
    var checkboxHandler: ((Range<Int>) -> Void)?
    var linkURLProvider: ((Int) -> URL?)?
    var previewLayoutHandler: (() -> Void)?
    var imageTapHandler: ((String) -> Void)?
    var imagePasteHandler: (([NSItemProvider]) -> Bool)?
    var imageDropHandler: ((Int, [NSItemProvider]) -> Void)?
    var imageSourceHandler: ((ImageSourceKind) -> Void)?
    var imageLayoutHandler: (() -> Void)?
    private let previewLayout = PreviewLayoutDelegate()
    var previewBodyFont: UIFont? {
        didSet {
            guard let previewBodyFont else { return }
            previewLayout.bodyFont = previewBodyFont
        }
    }
    private let previewTapDelegate = PreviewTapDelegate()
    private let imageDropDelegate = EditorImageDropDelegate()
    private var imageLayoutKey: [CGFloat] = []

    var imageStore: EditorImageStore? {
        get { previewLayout.images }
        set { previewLayout.images = newValue }
    }
    var pendingOffsetY: CGFloat? {
        didSet {
            if pendingOffsetY != nil { setNeedsLayout() }
        }
    }

    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        inputAccessoryView = makeFormatToolbar()
        textLayoutManager?.delegate = previewLayout
        previewTapDelegate.textView = self
        imageDropDelegate.textView = self
        textDropDelegate = imageDropDelegate
        pasteDelegate = imageDropDelegate
        let tap = UITapGestureRecognizer(target: self, action: #selector(handlePreviewTap(_:)))
        tap.delegate = previewTapDelegate
        addGestureRecognizer(tap)
        registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) {
            (textView: MarkdownTextView, _: UITraitCollection) in
            textView.contentSizeCategoryHandler?()
        }
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (textView: MarkdownTextView, _: UITraitCollection) in
            textView.matchKeyboardToStyle()
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        matchKeyboardToStyle()
    }

    /// The keyboard and this view's toolbar are shown in system windows, which do not take the
    /// style the app sets on its own windows.
    private func matchKeyboardToStyle() {
        let style: UIUserInterfaceStyle = traitCollection.userInterfaceStyle == .dark ? .dark : .light
        let appearance: UIKeyboardAppearance = style == .dark ? .dark : .light
        guard keyboardAppearance != appearance || inputAccessoryView?.overrideUserInterfaceStyle != style else {
            return
        }
        keyboardAppearance = appearance
        inputAccessoryView?.overrideUserInterfaceStyle = style
        guard isFirstResponder else { return }
        DispatchQueue.main.async { [weak self] in
            if self?.isFirstResponder == true { self?.reloadInputViews() }
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var undoManager: UndoManager? {
        editorUndoManager ?? super.undoManager
    }

    override func paste(_ sender: Any?) {
        imageDropDelegate.reset()
        let pasteboard = UIPasteboard.general
        if pasteboard.hasStrings {
            if let string = pasteboard.string, pasteHandler?(string) == true {
                return
            }
        } else if pasteboard.hasImages, imagePasteHandler?(pasteboard.itemProviders) == true {
            return
        }
        super.paste(sender)
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(paste(_:)), isEditable, UIPasteboard.general.hasImages {
            return true
        }
        return super.canPerformAction(action, withSender: sender)
    }

    override func tintColorDidChange() {
        super.tintColorDidChange()
        previewLayout.tint = tintColor
    }

    @objc private func handlePreviewTap(_ recognizer: UITapGestureRecognizer) {
        guard recognizer.state == .ended, let hit = previewHit(at: recognizer.location(in: self)) else { return }
        switch hit {
        case .checkbox(let range):
            checkboxHandler?(range)
        case .link(let url):
            UIApplication.shared.open(url)
        case .image(let imageId):
            imageTapHandler?(imageId)
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        previewLayout.hairline = 1 / max(1, traitCollection.displayScale)
        if let textLayout = textLayoutManager, textLayout.delegate !== previewLayout {
            textLayout.delegate = previewLayout
        }
        previewLayoutHandler?()
        let side = max(16, (bounds.width - 720) / 2)
        if textContainerInset.left != side {
            textContainerInset = UIEdgeInsets(top: 12, left: side, bottom: 24, right: side)
        }
        let key = [
            textLayoutManager?.textContainer?.size.width ?? 0,
            traitCollection.horizontalSizeClass == .compact ? 1 : 0,
            traitCollection.displayScale,
        ]
        if key != imageLayoutKey {
            imageLayoutKey = key
            Task { @MainActor [weak self] in
                self?.imageLayoutHandler?()
            }
        }
        if let offsetY = pendingOffsetY, bounds.height > 0 {
            pendingOffsetY = nil
            var height = contentSize.height
            if let textLayout = textLayoutManager {
                textLayout.ensureLayout(for: textLayout.documentRange)
                height = max(
                    height,
                    textLayout.usageBoundsForTextContainer.maxY + textContainerInset.top
                        + textContainerInset.bottom)
            }
            let top = -adjustedContentInset.top
            let bottom = max(top, height + adjustedContentInset.bottom - bounds.height)
            contentOffset = CGPoint(x: contentOffset.x, y: min(max(offsetY, top), bottom))
        }
    }

    private func makeFormatToolbar() -> UIView {
        let toolbar = UIToolbar(frame: CGRect(x: 0, y: 0, width: 320, height: 44))
        var items: [UIBarButtonItem] = []
        for command in FormatCommand.allCases {
            let item = UIBarButtonItem(
                image: UIImage(systemName: command.symbol),
                primaryAction: UIAction { [weak self] _ in self?.formatHandler?(command) })
            item.accessibilityLabel = command.label
            item.accessibilityIdentifier = command.identifier
            if !items.isEmpty {
                items.append(.flexibleSpace())
            }
            items.append(item)
        }
        items.append(.flexibleSpace())
        items.append(makeImageToolbarItem())
        toolbar.items = items
        toolbar.sizeToFit()
        #if FAKE_CORE
        if TestingHooks.editorHooksRequested {
            return withTestingToolbar(above: toolbar)
        }
        #endif
        return toolbar
    }

    #if FAKE_CORE
    /// The hooks get a row of their own so the format buttons keep their places on narrow screens.
    private func withTestingToolbar(above toolbar: UIToolbar) -> UIView {
        let testing = UIToolbar(frame: toolbar.frame)
        testing.items = [.flexibleSpace()] + makeTestingToolbarItems()
        testing.sizeToFit()
        let stack = UIStackView(arrangedSubviews: [testing, toolbar])
        stack.axis = .vertical
        stack.frame = CGRect(
            x: 0, y: 0, width: toolbar.frame.width, height: testing.frame.height + toolbar.frame.height)
        stack.autoresizingMask = [.flexibleWidth]
        return stack
    }

    private func makeTestingToolbarItems() -> [UIBarButtonItem] {
        let hooks: [(String, String, () -> Void)] = [
            ("testing-select-word", "W", { [weak self] in self?.selectWordBeforeCaret() }),
            ("testing-caret-end", "E", { [weak self] in self?.moveCaretToEnd() }),
            ("testing-undo", "U", { [weak self] in self?.undoManager?.undo() }),
            ("testing-hide-keyboard", "H", { [weak self] in _ = self?.resignFirstResponder() }),
        ]
        return hooks.map { identifier, title, action in
            let item = UIBarButtonItem(
                title: title, primaryAction: UIAction { _ in action() })
            item.accessibilityIdentifier = identifier
            return item
        }
    }

    private func selectWordBeforeCaret() {
        let text = self.text as NSString
        func isWordCharacter(_ index: Int) -> Bool {
            CharacterSet.alphanumerics.contains(Unicode.Scalar(text.character(at: index)) ?? " ")
        }
        var end = selectedRange.location
        if end == 0 || !isWordCharacter(end - 1) {
            end = text.length
            while end > 0 && !isWordCharacter(end - 1) {
                end -= 1
            }
        }
        var start = end
        while start > 0 && isWordCharacter(start - 1) {
            start -= 1
        }
        selectedRange = NSRange(location: start, length: end - start)
    }

    private func moveCaretToEnd() {
        selectedRange = NSRange(location: (text as NSString).length, length: 0)
        scrollRangeToVisible(selectedRange)
    }
    #endif

    private func makeImageToolbarItem() -> UIBarButtonItem {
        var sources: [(String, String, String, ImageSourceKind)] = [
            ("Photo Library", "photo.on.rectangle", "insert-image-photos", .photos)
        ]
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            sources.append(("Take Photo", "camera", "insert-image-camera", .camera))
        }
        sources.append(("Choose File", "folder", "insert-image-files", .files))
        let actions = sources.map { title, symbol, identifier, source in
            UIAction(
                title: title, image: UIImage(systemName: symbol), identifier: UIAction.Identifier(identifier)
            ) { [weak self] _ in
                self?.imageSourceHandler?(source)
            }
        }
        let item = UIBarButtonItem(image: UIImage(systemName: "photo"), menu: UIMenu(children: actions))
        item.accessibilityLabel = "Insert image"
        item.accessibilityIdentifier = "format-image"
        return item
    }
}

/// Lets the preview tap begin only on a checkbox, link or image, so UIKit's own text taps place
/// the caret everywhere else; once it recognizes, it keeps those taps from also firing.
private final class PreviewTapDelegate: NSObject, UIGestureRecognizerDelegate {
    weak var textView: MarkdownTextView?

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard let textView else { return false }
        return textView.previewHit(at: gestureRecognizer.location(in: textView)) != nil
    }
}

/// Owns undo for the editor: UIKit's own registrations are discarded so that undo and redo only
/// ever revert local edits recorded in `EditorHistory`, never remote ones.
final class EditorUndoManager: UndoManager {
    weak var coordinator: MarkdownEditor.Coordinator?

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
