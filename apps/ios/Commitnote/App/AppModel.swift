import CoreRuntime
import Foundation
import Network
import NativeCoreAPI
import Observation
import SwiftUI
import UIKit

struct LoginEntry: Equatable {
    var errorMessage: String?
}

struct KeyChangedInfo: Equatable {
    var unsavedCount: Int
    var message: String
    var detail: String
    var exportLabel: String
}

enum LogoutState: Equatable {
    case idle
    case saving
    case unsaved(count: Int, message: String)
}

enum ExportState: Equatable {
    case idle
    case exporting
    case failed
}

@MainActor
private final class BackgroundTaskToken {
    private var identifier = UIBackgroundTaskIdentifier.invalid

    func begin(name: String) {
        identifier = UIApplication.shared.beginBackgroundTask(withName: name) { [self] in
            MainActor.assumeIsolated { end() }
        }
    }

    func end() {
        guard identifier != .invalid else { return }
        let current = identifier
        identifier = .invalid
        UIApplication.shared.endBackgroundTask(current)
    }
}

enum LoadingState: Equatable {
    case inProgress
    case failed(message: String, canRetry: Bool)
}

struct AppNotice: Identifiable, Equatable {
    var id: String
    var tone: NoticeTone
    var message: String
    var persistent: Bool
    var isLocal: Bool
    var action: NoticeAction?
}

struct RefreshStatus: Equatable {
    var online = true
    var refreshing = false
    var treeLoaded = false
    var lastRefreshError: CoreError?
}

@MainActor @Observable
final class AppModel {
    enum Screen: Equatable {
        case starting
        case loading(LoadingState)
        case login(LoginEntry)
        case keyChanged(KeyChangedInfo)
        case notes
        case fatal(String)
    }

    static let genericErrorMessage = "Something went wrong. Try again."

    private(set) var screen: Screen = .starting
    private(set) var forges: [ForgeView] = []
    private(set) var lastRepository: LoginLastRepository.Result?
    private(set) var loadingStep: String?
    private(set) var tree: [TreeNode]?
    private(set) var openNote: OpenNote?
    private(set) var refreshStatus = RefreshStatus()
    private(set) var notices: [AppNotice] = []
    private(set) var deviceName = ""
    private(set) var editorTarget: EditorTarget = .none
    private(set) var editorSwitch = 0
    private(set) var noteUpdate: NoteContentUpdate?
    private(set) var syncStatus: SyncStateChanged?
    var draftName = ""
    private(set) var draftError: String?
    private(set) var logoutState: LogoutState = .idle
    private(set) var exportState: ExportState = .idle

    @ObservationIgnored private var editSender: EditSender?
    private var noteUpdateSerial = 0
    private var runtime: CoreRuntime?
    private var eventsTask: Task<Void, Never>?
    private var pathMonitor: NWPathMonitor?
    private var visible: Bool?
    private var online: Bool?
    private var localNoticeCounter = 0
    #if FAKE_CORE
    private(set) var forcedOffline = false
    #endif

    init() {
        editSender = EditSender(
            editNote: { [weak self] path, text in
                await self?.sendNoteEdit(path: path, text: text)
            },
            draftContent: { [weak self] text in
                await self?.sendDraftContent(text)
            })
    }

    var treeLoadError: String? {
        guard tree == nil else { return nil }
        return refreshStatus.lastRefreshError?.message
    }

    func start() async {
        guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil,
            runtime == nil
        else { return }

        guard let bundleURL = Bundle.main.url(forResource: "commitnote-core", withExtension: "js")
        else {
            screen = .fatal(Self.inconsistentBuildMessage)
            return
        }
        let runtime = CoreRuntime(
            configuration: .production(bundleURL: bundleURL, deviceModel: UIDevice.current.model))
        do {
            try await runtime.start()
        } catch CoreRuntimeError.apiVersionMismatch {
            screen = .fatal(Self.inconsistentBuildMessage)
            return
        } catch {
            screen = .fatal(Self.inconsistentBuildMessage)
            return
        }
        self.runtime = runtime

        eventsTask = Task { [weak self] in
            for await event in runtime.events {
                guard let self else { return }
                self.handle(event)
            }
        }
        startPathMonitor()
        await sendPendingLifecycle()

        forges = (try? await runtime.send(ForgesList()).forges) ?? []
        lastRepository = try? await runtime.send(LoginLastRepository())
        deviceName = (try? await runtime.send(DeviceName()).name) ?? ""
        await resume()
    }

    func resume() async {
        screen = .loading(.inProgress)
        guard let runtime else { return }
        do {
            switch try await runtime.send(SessionResume()) {
            case .none:
                screen = .login(LoginEntry())
            case .resumed:
                screen = .notes
            case .failed(let error, let canRetry):
                if canRetry {
                    screen = .loading(.failed(message: error.message, canRetry: true))
                } else {
                    screen = .login(LoginEntry(errorMessage: error.message))
                }
            }
        } catch {
            screen = .loading(.failed(message: Self.message(for: error), canRetry: true))
        }
    }

    func showLogin() {
        screen = .login(LoginEntry())
    }

    func listRepositories(forge: ForgeID, token: String) async throws -> [RepositoryListing] {
        try await send(LoginListRepositories(forge: forge, accessToken: token)).repositories
    }

    func inspect(forge: ForgeID, token: String, repositoryUrl: String) async throws
        -> InspectionResult
    {
        try await send(
            LoginInspectRepository(
                forge: forge, accessToken: token, repositoryUrl: repositoryUrl))
    }

    func unlock(passphrase: String) async throws {
        _ = try await send(LoginUnlock(passphrase: passphrase))
        didLogIn()
    }

    func initialize(passphrase: String) async throws {
        _ = try await send(LoginInitialize(passphrase: passphrase))
        didLogIn()
    }

    func strength(passphrase: String, repositoryLabel: String) async throws -> PassphraseStrength {
        try await send(
            PassphraseStrengthCheck(passphrase: passphrase, repositoryLabel: repositoryLabel))
    }

    func open(path: [String]?) async {
        await flushEdits()
        if let path, editorTarget == .note(path) {
            await sendNoteOpen(path: path)
            return
        }
        editorTarget = path.map { .note($0) } ?? .none
        editorSwitch += 1
        draftError = nil
        await sendNoteOpen(path: path)
    }

    func edit(text: String) {
        switch editorTarget {
        case .none:
            return
        case .note(let path):
            editSender?.submit(text, to: .note(path))
        case .draft:
            editSender?.submit(text, to: .draft)
        }
    }

    func flushEdits() async {
        await editSender?.flush()
    }

    func startDraft(parent: [String]) async {
        await flushEdits()
        do {
            let draft = try await send(DraftStart(parent: parent)).draft
            editorTarget = .draft(draft)
            draftName = ""
            draftError = nil
            editorSwitch += 1
        } catch {
            showError(error)
        }
    }

    func commitDraftName() async {
        await flushEdits()
        guard editorTarget.isDraft else { return }
        do {
            switch try await send(DraftCommitName(name: draftName)).outcome {
            case .none:
                break
            case .error(let message):
                draftError = message
            case .created(let path, let fieldError):
                editorTarget = .note(path)
                draftError = fieldError
                editorSwitch += 1
            }
        } catch {
            showError(error)
        }
    }

    func leaveDraft() async {
        await flushEdits()
        guard editorTarget.isDraft else { return }
        do {
            _ = try await send(DraftLeave())
        } catch {
            showError(error)
        }
        if editorTarget.isDraft {
            editorTarget = .none
            draftError = nil
        }
    }

    func createFolder(parent: [String], name: String) async -> String? {
        do {
            switch try await send(FolderCreate(parent: parent, name: name)).outcome {
            case .created:
                return nil
            case .error(let message):
                return message
            }
        } catch {
            return Self.message(for: error)
        }
    }

    func resolveConflict(_ resolution: ConflictResolution) async {
        await flushEdits()
        guard case .loaded(let path, _, _?, _, _)? = openNote else { return }
        do {
            _ = try await send(ConflictResolve(path: path, resolution: resolution))
            if resolution == .editMerged {
                editorSwitch += 1
            }
        } catch {
            showError(error)
        }
    }

    func retrySync() async {
        do {
            _ = try await send(SyncRetry())
        } catch {
            showError(error)
        }
    }

    func performNoticeAction(id: String) async {
        guard let action = notices.first(where: { $0.id == id })?.action else { return }
        switch action.kind {
        case .openNote:
            if let path = action.path {
                await open(path: path)
            }
            await dismissNotice(id: id)
        case .undo:
            await flushEdits()
            do {
                _ = try await send(NoticesPerform(id: id))
            } catch {
                showError(error)
            }
        }
    }

    private func sendNoteOpen(path: [String]?) async {
        if let note = try? await send(NoteOpen(path: path)).note {
            openNote = note
        } else if path == nil {
            openNote = nil
        }
    }

    func refresh() async throws {
        _ = try await send(SyncRefresh())
    }

    func logOut() async {
        await flushEdits()
        logoutState = .saving
        do {
            switch try await send(SessionLogout(anyway: false)).outcome {
            case .loggedOut:
                finishLogOut()
            case .unsaved(let count, let message):
                logoutState = .unsaved(count: count, message: message)
            }
        } catch {
            logoutState = .idle
            showError(error)
        }
    }

    func keepTryingLogOut() async {
        await logOut()
    }

    func logOutAnyway() async {
        _ = try? await send(SessionLogout(anyway: true))
        finishLogOut()
    }

    func cancelLogOut() {
        logoutState = .idle
    }

    func logInAgain() async {
        _ = try? await send(SessionLogout(anyway: true))
        finishLogOut()
    }

    func exportNotes() async -> URL? {
        exportState = .exporting
        do {
            let archive = try await send(ExportNotes())
            guard let data = Data(base64Encoded: archive.base64) else {
                exportState = .failed
                return nil
            }
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent(
                (archive.fileName as NSString).lastPathComponent)
            try data.write(to: url, options: .atomic)
            exportState = .idle
            return url
        } catch {
            exportState = .failed
            return nil
        }
    }

    private func finishLogOut() {
        logoutState = .idle
        resetSessionState()
        screen = .login(LoginEntry())
    }

    func dismissNotice(id: String) async {
        guard let notice = notices.first(where: { $0.id == id }) else { return }
        notices.removeAll { $0.id == id }
        if !notice.isLocal {
            _ = try? await send(NoticesDismiss(id: id))
        }
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .active: setVisible(true)
        case .background: saveInBackground()
        default: break
        }
    }

    private static let inconsistentBuildMessage =
        "This build of commitnote is inconsistent. Reinstall the app."

    private static func message(for error: Error) -> String {
        (error as? CoreError)?.message ?? genericErrorMessage
    }

    private func send<C: NativeCoreCommand>(_ command: C) async throws -> C.Result {
        guard let runtime else {
            throw CoreError(
                kind: CoreError.Kind.notReady, message: Self.genericErrorMessage, transient: false)
        }
        return try await runtime.send(command)
    }

    private func sendNoteEdit(path: [String], text: String) async {
        do {
            _ = try await send(NoteEdit(path: path, text: text))
        } catch {
            showError(error)
        }
    }

    private func sendDraftContent(_ text: String) async -> NoteDraftOutcome? {
        do {
            let outcome = try await send(DraftContent(name: draftName, content: text)).outcome
            switch outcome {
            case .none:
                break
            case .error(let message):
                draftError = message
            case .created(let path, let fieldError):
                if editorTarget.isDraft {
                    editorTarget = .note(path)
                }
                draftError = fieldError
            }
            return outcome
        } catch {
            showError(error)
            return nil
        }
    }

    private func showError(_ error: Error) {
        appendLocalNotice(tone: .error, message: Self.message(for: error))
    }

    private func appendLocalNotice(tone: NoticeTone, message: String) {
        localNoticeCounter += 1
        notices.append(
            AppNotice(
                id: "local-\(localNoticeCounter)", tone: tone, message: message,
                persistent: false, isLocal: true, action: nil))
    }

    private func didLogIn() {
        loadingStep = nil
        screen = .notes
    }

    private func resetSessionState() {
        tree = nil
        openNote = nil
        editorTarget = .none
        noteUpdate = nil
        syncStatus = nil
        draftName = ""
        draftError = nil
        exportState = .idle
        notices = []
        refreshStatus = RefreshStatus()
        loadingStep = nil
    }

    private func setVisible(_ value: Bool) {
        visible = value
        guard runtime != nil else { return }
        Task { _ = try? await send(LifecycleSetVisible(visible: value)) }
    }

    private func saveInBackground() {
        visible = false
        guard let runtime else { return }
        let token = BackgroundTaskToken()
        token.begin(name: "Save notes")
        Task {
            await flushEdits()
            if visible == false {
                _ = try? await send(LifecycleSetVisible(visible: false))
            }
            _ = try? await send(SyncFlush())
            await runtime.flushHostStorage()
            token.end()
        }
    }

    private func setOnline(_ value: Bool) {
        #if FAKE_CORE
        if forcedOffline { return }
        #endif
        guard online != value else { return }
        online = value
        guard runtime != nil else { return }
        Task { _ = try? await send(LifecycleSetOnline(online: value)) }
    }

    #if FAKE_CORE
    func sendTesting<C: NativeCoreCommand>(_ command: C) async {
        _ = try? await send(command)
    }

    func setForcedOffline(_ value: Bool) async {
        forcedOffline = value
        online = !value
        _ = try? await send(LifecycleSetOnline(online: !value))
    }
    #endif

    private func sendPendingLifecycle() async {
        if let visible {
            _ = try? await send(LifecycleSetVisible(visible: visible))
        }
        if let online {
            _ = try? await send(LifecycleSetOnline(online: online))
        }
    }

    private func startPathMonitor() {
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            Task { @MainActor in self?.setOnline(satisfied) }
        }
        monitor.start(queue: DispatchQueue(label: "commitnote.network-path"))
        pathMonitor = monitor
    }

    private func handle(_ event: CoreEvent) {
        switch event {
        case .loadingProgress(let progress):
            loadingStep = progress.message
        case .treeChanged(let change):
            tree = change.tree
        case .noteChanged(let change):
            handleNoteChanged(change)
        case .noteContentChangedRemotely(let change):
            appendLocalNotice(tone: .info, message: change.message)
        case .syncStateChanged(let state):
            syncStatus = state
            refreshStatus = RefreshStatus(
                online: state.online, refreshing: state.refreshing,
                treeLoaded: state.treeLoaded, lastRefreshError: state.lastRefreshError)
        case .notice(let notice):
            let value = AppNotice(
                id: notice.id, tone: notice.tone, message: notice.message,
                persistent: notice.persistent, isLocal: false, action: notice.action)
            if let index = notices.firstIndex(where: { $0.id == notice.id }) {
                notices[index] = value
            } else {
                notices.append(value)
            }
        case .noticeCleared(let cleared):
            notices.removeAll { $0.id == cleared.id }
        case .keyChanged(let info):
            screen = .keyChanged(
                KeyChangedInfo(
                    unsavedCount: info.unsavedCount, message: info.message, detail: info.detail,
                    exportLabel: info.exportLabel))
        case .sessionEnded:
            resetSessionState()
            screen = .login(LoginEntry())
        case .trashChanged, .searchStatusChanged, .unknown:
            break
        }
    }

    private func handleNoteChanged(_ change: NoteChanged) {
        let previousPath = openNote?.path
        openNote = change.note
        guard case .loaded(let path, let content, _, _, _)? = change.note else { return }
        if let targetPath = editorTarget.notePath, targetPath != path, change.edits != nil,
            previousPath == targetPath
        {
            editorTarget = .note(path)
        }
        noteUpdateSerial += 1
        noteUpdate = NoteContentUpdate(
            serial: noteUpdateSerial, path: path, content: content, edits: change.edits)
    }
}
