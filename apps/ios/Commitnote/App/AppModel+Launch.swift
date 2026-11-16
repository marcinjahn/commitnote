import Foundation
import NativeCoreAPI
import Observation
import SwiftUI
import os

enum PresentedView: Hashable {
    case treeAction
    case imageSource
}

extension AppModel {
    private static let launchLog = Logger(subsystem: "io.github.marcinjahn.commitnote", category: "launch")

    var launchAccepts: [LaunchAction]? {
        switch screen {
        case .starting, .loading(.inProgress): [.newNote]
        case .notes where initialEntrySettled: [.newNote, .search]
        default: nil
        }
    }

    var isModalPresented: Bool {
        isSettingsPresented || isTrashPresented || isHistoryPresented || isSharedLinksPresented
            || sharePath != nil || imageSourceRequest != nil || viewerImageId != nil
            || dropSetup != nil || atomicBlocked != nil || logoutState != .idle
            || isConflictShown || !presentedViews.isEmpty
    }

    private var isConflictShown: Bool {
        guard case .note(let path) = editorTarget,
            case .loaded(let notePath, _, let conflict?, _, _)? = openNote, notePath == path
        else { return false }
        return !conflict.editing
    }

    func setPresented(_ view: PresentedView, _ presented: Bool) {
        guard presentedViews.contains(view) != presented else { return }
        if presented {
            presentedViews.insert(view)
        } else {
            presentedViews.remove(view)
        }
    }

    func startLaunchSync() {
        guard !launchSyncActive else { return }
        launchSyncActive = true
        forwardLaunchActions()
        syncLaunchAttachment()
    }

    func stopLaunchSync() {
        launchSyncActive = false
    }

    func handleLaunchAction(_ action: LaunchAction) {
        switch screen {
        case .starting, .loading(.inProgress):
            if action == .newNote {
                earlyDraftFocusRequest = true
                earlyNewNoteTaken = true
            }
        case .notes:
            guard initialEntrySettled, !isModalPresented, !isSearchActive else { return }
            switch action {
            case .newNote:
                Task { await startDraft(parent: []) }
            case .search:
                Task { await presentSearch() }
            }
        default:
            // The core ran it under an attachment whose detach was still on its way.
            if action == .newNote {
                earlyNewNoteTaken = true
                redeliverEarlyNewNote()
            }
        }
    }

    func presentSearch() async {
        if usesCompactLayout, editorTarget != .none {
            await leaveEditor()
        }
        searchFocusRequest = true
        await activateSearch()
    }

    func leaveEditor() async {
        if editorTarget.isDraft {
            await leaveDraft()
        }
        if editorTarget != .none {
            await open(path: nil)
        }
    }

    private func forwardLaunchActions() {
        guard launchSyncActive, runtime != nil else { return }
        let hasPending = withObservationTracking {
            !LaunchInbox.shared.pending.isEmpty
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in self?.forwardLaunchActions() }
        }
        guard hasPending else { return }
        earlyNewNoteTaken = false
        for action in LaunchInbox.shared.take() {
            enqueueLaunchCommand(LaunchDeliver(action: action))
        }
    }

    private func syncLaunchAttachment() {
        guard launchSyncActive, runtime != nil else { return }
        let accepts = withObservationTracking {
            launchAccepts
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in self?.syncLaunchAttachment() }
        }
        if screen == .notes {
            earlyNewNoteTaken = false
        }
        guard accepts != attachedLaunchAccepts else { return }
        attachedLaunchAccepts = accepts
        if let accepts {
            enqueueLaunchCommand(LaunchAttach(accepts: accepts))
        } else {
            enqueueLaunchCommand(LaunchDetach())
            redeliverEarlyNewNote()
        }
    }

    /// A start-up that ends without the notes, such as on the login screen, leaves the new note the
    /// early draft took unused unless something was typed there, so it goes back to the core to wait
    /// for the notes. It must reach the core after the detach: while the start-up attachment stands,
    /// the core would run it again at once.
    private func redeliverEarlyNewNote() {
        guard earlyNewNoteTaken, attachedLaunchAccepts == nil, screen != .notes else { return }
        earlyNewNoteTaken = false
        guard earlyDraft.isEmpty else { return }
        enqueueLaunchCommand(LaunchDeliver(action: .newNote))
    }

    private func enqueueLaunchCommand<C: NativeCoreCommand>(_ command: C) {
        let previous = launchCommandTask
        launchCommandTask = Task { [weak self] in
            await previous?.value
            guard let self else { return }
            do {
                _ = try await self.send(command)
            } catch {
                let kind = (error as? CoreError)?.kind ?? "unknown"
                Self.launchLog.error(
                    "\(C.name, privacy: .public) failed: \(kind, privacy: .public)")
            }
        }
    }
}

extension View {
    func reportsPresentation(_ view: PresentedView, presented: Bool, model: AppModel) -> some View {
        onAppear { model.setPresented(view, presented) }
            .onChange(of: presented) { _, value in model.setPresented(view, value) }
            .onDisappear { model.setPresented(view, false) }
    }
}
