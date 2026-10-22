import EditorText
import MarkdownStyling
import NativeCoreAPI
import SwiftUI
import UIKit

struct MarkdownEditor: UIViewRepresentable {
    let model: AppModel
    let target: EditorTarget
    let editorSwitch: Int
    let update: NoteContentUpdate?
    @Binding var focusRequested: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> MarkdownEditorContainer {
        // Not `init(usingTextLayoutManager:)`: that factory skips the subclass initialiser.
        // A nil container still gives TextKit 2.
        let textView = MarkdownTextView(frame: .zero, textContainer: nil)
        let coordinator = context.coordinator
        coordinator.textView = textView
        textView.editorUndoManager = coordinator.undoManager
        textView.delegate = coordinator
        textView.pasteHandler = { [weak coordinator] string in
            coordinator?.paste(string) ?? false
        }
        textView.formatHandler = { [weak coordinator] command in
            coordinator?.format(command)
        }
        textView.contentSizeCategoryHandler = { [weak coordinator] in
            coordinator?.contentSizeCategoryDidChange()
        }
        textView.checkboxHandler = { [weak coordinator] range in
            coordinator?.toggleCheckbox(range)
        }
        textView.linkURLProvider = { [weak coordinator] offset in
            coordinator?.linkURL(at: offset)
        }
        textView.imageStore = coordinator.images
        textView.imageTapHandler = { [weak coordinator] imageId in
            coordinator?.retryImage(imageId)
        }
        textView.imageLayoutHandler = { [weak coordinator] in
            coordinator?.imageLayoutDidChange()
        }

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
        return MarkdownEditorContainer(textView: textView)
    }

    func updateUIView(_ container: MarkdownEditorContainer, context: Context) {
        let coordinator = context.coordinator
        coordinator.model = model
        coordinator.sync(target: target, editorSwitch: editorSwitch, update: update)
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
        private var syncedKey: SyncKey?
        private var applying = false
        private var composing = false

        override init() {
            super.init()
            undoManager.coordinator = self
            styler.images = images
            images.load = { [weak self] imageId in
                await self?.model?.image(for: imageId)
            }
            images.didResolve = { [weak self] imageId in
                self?.imageResolved(imageId)
            }
        }

        private func restyle(_ textView: UITextView) {
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

        func retryImage(_ imageId: String) {
            images.retry(imageId)
        }

        func imageLayoutDidChange() {
            guard let textView else { return }
            restyle(textView)
        }

        private var isReady: Bool { appliedSwitch == currentSwitch }

        var canUndo: Bool { isReady && history.canUndo }
        var canRedo: Bool { isReady && history.canRedo }

        func sync(target: EditorTarget, editorSwitch: Int, update: NoteContentUpdate?) {
            currentSwitch = editorSwitch
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

        func savePosition() {
            guard let appliedPath, let textView, let model else { return }
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
            model?.edit(text: lastText)
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
            guard isReady, let textView, textView.markedTextRange == nil,
                let result = MarkdownCommands.pasteLink(lastText, Self.selection(of: textView), string)
            else { return false }
            applyCommand(result, in: textView)
            return true
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
            guard isReady, let textView, textView.markedTextRange == nil else { return }
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
            model?.edit(text: lastText)
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
            restyle(textView)
            if !edits.isEmpty {
                model?.edit(text: text)
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
                if state == EditorImageState.unavailable.accessibilityValue {
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
    var imageLayoutHandler: (() -> Void)?
    private let previewLayout = PreviewLayoutDelegate()
    private let previewTapDelegate = PreviewTapDelegate()
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
        let tap = UITapGestureRecognizer(target: self, action: #selector(handlePreviewTap(_:)))
        tap.delegate = previewTapDelegate
        addGestureRecognizer(tap)
        registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) {
            (textView: MarkdownTextView, _: UITraitCollection) in
            textView.contentSizeCategoryHandler?()
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
        if UIPasteboard.general.hasStrings, let string = UIPasteboard.general.string,
            pasteHandler?(string) == true
        {
            return
        }
        super.paste(sender)
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

    private func makeFormatToolbar() -> UIToolbar {
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
        toolbar.items = items
        toolbar.sizeToFit()
        return toolbar
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
