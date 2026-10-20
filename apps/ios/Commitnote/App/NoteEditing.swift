import NativeCoreAPI

enum EditorTarget: Equatable {
    case none
    case note([String])
    case draft(NoteDraft)

    var notePath: [String]? {
        if case .note(let path) = self { return path }
        return nil
    }

    var isDraft: Bool {
        if case .draft = self { return true }
        return false
    }
}

struct NoteContentUpdate: Equatable {
    let serial: Int
    let path: [String]
    let content: String
    let edits: [RemoteTextEdit]?
}

enum EditDestination: Equatable {
    case note([String])
    case draft
}

@MainActor
final class EditSender {
    typealias NoteEditAction = @MainActor ([String], String) async -> Void
    typealias DraftContentAction = @MainActor (String) async -> NoteDraftOutcome?

    private struct PendingEdit {
        var destination: EditDestination
        var text: String
    }

    private let editNote: NoteEditAction
    private let draftContent: DraftContentAction
    private var pending: PendingEdit?
    private var sending = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(editNote: @escaping NoteEditAction, draftContent: @escaping DraftContentAction) {
        self.editNote = editNote
        self.draftContent = draftContent
    }

    var isIdle: Bool { !sending && pending == nil }

    func submit(_ text: String, to destination: EditDestination) {
        pending = PendingEdit(destination: destination, text: text)
        guard !sending else { return }
        sending = true
        Task { await drain() }
    }

    func flush() async {
        guard !isIdle else { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    private func drain() async {
        while let edit = pending {
            pending = nil
            switch edit.destination {
            case .note(let path):
                await editNote(path, edit.text)
            case .draft:
                // Text typed while the draft was being created belongs to the created note.
                if case .created(let path, _) = await draftContent(edit.text),
                    pending?.destination == .draft
                {
                    pending?.destination = .note(path)
                }
            }
        }
        sending = false
        let resumed = waiters
        waiters = []
        for waiter in resumed {
            waiter.resume()
        }
    }
}
