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

enum TrashResult: Equatable {
    case trashed
    case deleted
    case confirm(TrashPreview)
    case error(String)
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
    private(set) var tagFilter: ColorTag?
    private(set) var usedTags: [ColorTag] = []
    private(set) var tagsWritable = false
    private(set) var tagOptions: [TagOption] = []
    private(set) var trashEntries: [TrashEntryView] = []
    private(set) var trashDeleteConfirmation: TrashConfirmationText?
    private(set) var trashEmptyConfirmation: TrashConfirmationText?
    var isTrashPresented = false
    private(set) var expandedFolders: Set<[String]> = []
    var earlyDraft = EarlyDraftState()
    private(set) var editorFocusAtEnd: [String]?
    private(set) var noteNameError: String?
    private(set) var noteDetails: NoteDetails?
    private(set) var isSearchActive = false
    private(set) var searchQuery = ""
    private(set) var searchResults: SearchResults?
    private(set) var searchStatus: SearchStatusChanged?
    @ObservationIgnored private(set) var notePositions: [[String]: NotePosition] = [:]

    @ObservationIgnored private var editSender: EditSender?
    @ObservationIgnored private var imageLoader: ImageLoader?
    @ObservationIgnored private var lastViewRestorePending = false
    @ObservationIgnored private var lastViewTracking = false
    @ObservationIgnored private var detailsPath: [String]?
    @ObservationIgnored private var statsTask: Task<Void, Never>?
    @ObservationIgnored private var datesTimer: Task<Void, Never>?
    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var searchRefreshTask: Task<Void, Never>?
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
        imageLoader = ImageLoader(fetch: { [weak self] imageId in
            try? await self?.send(ImageRead(imageId: imageId)).image
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
        #if FAKE_CORE
        if TestingHooks.holdLoadingRequested {
            _ = try? await runtime.send(FakeHoldLoading())
        }
        #endif
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
                await enterNotes(restoringLastView: true)
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
        await didLogIn()
    }

    func initialize(passphrase: String) async throws {
        _ = try await send(LoginInitialize(passphrase: passphrase))
        await didLogIn()
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
        setEditorTarget(path.map { .note($0) } ?? .none)
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
            scheduleStatsRefresh()
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
            draftName = ""
            setEditorTarget(.draft(draft))
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
                setEditorTarget(.note(path))
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
            setEditorTarget(.none)
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

    func rename(path: [String], name: String) async -> String? {
        await flushEdits()
        do {
            switch try await send(NodeRename(path: path, name: name)).outcome {
            case .ok:
                return nil
            case .error(let message):
                return message
            }
        } catch {
            return Self.message(for: error)
        }
    }

    func move(path: [String], to parent: [String]) async -> String? {
        await flushEdits()
        do {
            switch try await send(NodeMove(path: path, parent: parent)).outcome {
            case .ok:
                return nil
            case .error(let message):
                return message
            }
        } catch {
            return Self.message(for: error)
        }
    }

    func place(path: [String], parent: [String], before: String?) async -> String? {
        await flushEdits()
        do {
            switch try await send(NodePlace(path: path, parent: parent, before: before)).outcome {
            case .ok:
                return nil
            case .error(let message):
                appendLocalNotice(tone: .error, message: message)
                return message
            }
        } catch {
            showError(error)
            return Self.message(for: error)
        }
    }

    func moveSibling(path: [String], direction: SiblingDirection) async {
        await flushEdits()
        do {
            switch try await send(NodeMoveSibling(path: path, direction: direction)).outcome {
            case .none, .ok:
                break
            case .error(let message):
                appendLocalNotice(tone: .error, message: message)
            }
        } catch {
            showError(error)
        }
    }

    func moveTargets(for path: [String]) async -> [MoveTargetView] {
        (try? await send(NodeMoveTargets(path: path)).targets) ?? []
    }

    func trashPreview(for path: [String]) async -> TrashPreview? {
        try? await send(NodeTrashPreview(path: path)).preview
    }

    func trash(path: [String], shareCount: Int) async -> TrashResult {
        await flushEdits()
        do {
            switch try await send(NodeTrash(path: path, shareCount: shareCount)).outcome {
            case .trashed:
                return .trashed
            case .deleted:
                return .deleted
            case .confirm(let preview):
                return .confirm(preview)
            case .error(let message):
                return .error(message)
            }
        } catch {
            return .error(Self.message(for: error))
        }
    }

    func setColorTag(_ tag: ColorTag?, for path: [String]) async {
        do {
            switch try await send(NodeSetColorTag(path: path, tag: tag)).outcome {
            case .ok:
                break
            case .error(let message):
                appendLocalNotice(tone: .error, message: message)
            }
        } catch {
            showError(error)
        }
    }

    func setTagFilter(_ tag: ColorTag?) async {
        do {
            _ = try await send(TagsSetFilter(tag: tag))
        } catch {
            showError(error)
        }
    }

    func restoreTargets(entryId: String, subPath: [String]) async -> [MoveTargetView] {
        (try? await send(TrashRestoreTargets(entryId: entryId, subPath: subPath)).targets) ?? []
    }

    func restore(entryId: String, subPath: [String], to parent: [String]) async -> String? {
        do {
            switch try await send(
                TrashRestore(entryId: entryId, subPath: subPath, parent: parent)
            ).outcome {
            case .ok:
                return nil
            case .error(let message):
                return message
            }
        } catch {
            return Self.message(for: error)
        }
    }

    func deleteFromTrash(entryId: String) async {
        do {
            _ = try await send(TrashDelete(entryId: entryId))
        } catch {
            showError(error)
        }
    }

    func emptyTrash() async {
        do {
            _ = try await send(TrashEmpty())
        } catch {
            showError(error)
        }
    }

    func setExpandedFolders(_ folders: Set<[String]>) {
        guard folders != expandedFolders else { return }
        expandedFolders = folders
        saveLastView()
    }

    func expandAncestors(of path: [String]) {
        guard path.count > 1 else { return }
        var folders = expandedFolders
        for length in 1..<path.count {
            folders.insert(Array(path.prefix(length)))
        }
        setExpandedFolders(folders)
    }

    func clearEditorFocusAtEnd() {
        editorFocusAtEnd = nil
    }

    func renameOpenNote(to name: String) async -> NoteRenameResult {
        guard let path = editorTarget.notePath else { return .none }
        await flushEdits()
        do {
            switch try await send(NoteRename(path: path, name: name)).outcome {
            case .none:
                noteNameError = nil
                return .none
            case .restore:
                noteNameError = nil
                return .restore
            case .error(let message):
                noteNameError = message
                return .error(message)
            case .ok(let renamed):
                if editorTarget.notePath == path, renamed != path {
                    relocateOpenNote(from: path, to: renamed)
                }
                noteNameError = nil
                return .renamed
            }
        } catch {
            let message = Self.message(for: error)
            noteNameError = message
            return .error(message)
        }
    }

    func activateSearch() async {
        guard !isSearchActive else { return }
        isSearchActive = true
        searchResults = nil
        do {
            _ = try await send(SearchOpen())
        } catch {
            showError(error)
        }
        guard isSearchActive else { return }
        await runSearch(query: searchQuery)
    }

    func setSearchQuery(_ query: String) {
        guard query != searchQuery else { return }
        searchQuery = query
        guard isSearchActive else { return }
        searchTask?.cancel()
        searchTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .milliseconds(150))
            } catch {
                return
            }
            await self?.runSearch(query: query)
        }
    }

    func deactivateSearch() async {
        guard isSearchActive else { return }
        isSearchActive = false
        searchTask?.cancel()
        searchTask = nil
        searchRefreshTask?.cancel()
        searchRefreshTask = nil
        searchQuery = ""
        searchResults = nil
        searchStatus = nil
        _ = try? await send(SearchClose())
    }

    /// Opens before closing search: on iPhone a push started while the search bar is still
    /// dismissing is dropped.
    func openSearchResult(path: [String]) async {
        await open(path: path)
        await deactivateSearch()
    }

    func image(for imageId: String) async -> UIImage? {
        await imageLoader?.image(for: imageId)
    }

    func savePosition(_ position: NotePosition, for path: [String]) {
        notePositions[path] = position
    }

    func position(for path: [String]) -> NotePosition? {
        notePositions[path]
    }

    private func runSearch(query: String) async {
        guard let results = try? await send(SearchQuery(query: query)).results,
            isSearchActive, searchQuery == query
        else { return }
        searchResults = results
    }

    private func scheduleSearchRefresh() {
        guard isSearchActive, searchRefreshTask == nil else { return }
        searchRefreshTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .milliseconds(150))
            } catch {
                return
            }
            guard let self else { return }
            searchRefreshTask = nil
            await runSearch(query: searchQuery)
        }
    }

    private func enterNotes(restoringLastView: Bool) async {
        screen = .notes
        startDatesTimer()
        let handedOff = await handOffEarlyDraft()
        guard restoringLastView, screen == .notes else { return }
        if handedOff {
            lastViewTracking = true
        } else {
            lastViewRestorePending = true
            await restoreLastViewIfReady()
        }
    }

    private func handOffEarlyDraft() async -> Bool {
        guard !earlyDraft.isEmpty else { return false }
        let draft = earlyDraft
        let outcome: EarlyDraftOutcome
        do {
            outcome = try await send(
                EarlyDraftHandOff(
                    name: draft.name, body: draft.body, nameConfirmed: draft.nameConfirmed)
            ).outcome
        } catch {
            showError(error)
            return false
        }
        earlyDraft = EarlyDraftState()
        switch outcome {
        case .none:
            return false
        case .draft(let name, let error):
            draftName = name
            setEditorTarget(.draft(NoteDraft(parent: [], name: name)))
            draftError = error
            editorSwitch += 1
        case .created(let path, let fieldError):
            setEditorTarget(.note(path))
            draftError = fieldError
            editorFocusAtEnd = path
            editorSwitch += 1
        }
        return true
    }

    private func restoreLastViewIfReady() async {
        guard lastViewRestorePending, tree != nil, screen == .notes else { return }
        lastViewRestorePending = false
        let view = try? await send(LastViewLoad()).view
        guard screen == .notes else { return }
        if let view {
            expandedFolders.formUnion(view.folders)
            if let note = view.note, editorTarget == .none {
                await open(path: note)
            }
        }
        lastViewTracking = true
    }

    private func saveLastView() {
        guard lastViewTracking else { return }
        let note = editorTarget.notePath
        let folders = expandedFolders.sorted { $0.lexicographicallyPrecedes($1) }
        Task { _ = try? await send(LastViewSave(note: note, folders: folders)) }
    }

    private func setEditorTarget(_ target: EditorTarget) {
        let previousPath = editorTarget.notePath
        editorTarget = target
        if target.notePath != previousPath {
            noteNameError = nil
            saveLastView()
        }
        updateNoteDetailsTarget()
    }

    private func relocateOpenNote(from oldPath: [String], to newPath: [String]) {
        if let position = notePositions.removeValue(forKey: oldPath) {
            notePositions[newPath] = position
        }
        setEditorTarget(.note(newPath))
    }

    private func updateNoteDetailsTarget() {
        switch editorTarget {
        case .none:
            detailsPath = nil
            noteDetails = nil
            statsTask?.cancel()
        case .draft:
            detailsPath = nil
            noteDetails = .draft
            statsTask?.cancel()
        case .note(let path):
            guard case .loaded(let loadedPath, _, _, _, let shared)? = openNote, loadedPath == path else {
                if detailsPath != path {
                    detailsPath = nil
                    noteDetails = nil
                    statsTask?.cancel()
                }
                return
            }
            if detailsPath == path {
                noteDetails?.shared = shared
                return
            }
            detailsPath = path
            var details = NoteDetails()
            details.shared = shared
            noteDetails = details
            statsTask?.cancel()
            Task {
                await refreshStats(for: path)
                await refreshDates(for: path)
            }
        }
    }

    private func scheduleStatsRefresh() {
        statsTask?.cancel()
        statsTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .milliseconds(300))
            } catch {
                return
            }
            guard let self, let path = self.detailsPath else { return }
            await self.refreshStats(for: path)
        }
    }

    private func refreshStats(for path: [String]) async {
        await flushEdits()
        guard detailsPath == path,
            let stats = try? await send(NoteStats(path: path)),
            detailsPath == path
        else { return }
        noteDetails?.words = stats.words
        noteDetails?.tasks = stats.tasks
    }

    private func refreshDates(for path: [String]) async {
        guard detailsPath == path,
            let dates = try? await send(NoteDates(path: path)),
            detailsPath == path
        else { return }
        noteDetails?.notSaved = dates.notSaved
        noteDetails?.created = dates.created
        noteDetails?.updated = dates.updated
    }

    private func startDatesTimer() {
        datesTimer?.cancel()
        datesTimer = Task { [weak self] in
            while true {
                do {
                    try await Task.sleep(for: .seconds(60))
                } catch {
                    return
                }
                guard let self else { return }
                if self.screen == .notes, self.visible != false, let path = self.detailsPath {
                    await self.refreshDates(for: path)
                }
            }
        }
    }

    func openNoteColorTag(for path: [String]) -> ColorTag? {
        guard case .loaded(let loadedPath, _, _, let colorTag, _)? = openNote, loadedPath == path
        else { return nil }
        return colorTag
    }

    private func sendNoteOpen(path: [String]?) async {
        if let note = try? await send(NoteOpen(path: path)).note {
            openNote = note
        } else if path == nil {
            openNote = nil
        }
        updateNoteDetailsTarget()
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
                    setEditorTarget(.note(path))
                }
                draftError = fieldError
            }
            return outcome
        } catch {
            showError(error)
            return nil
        }
    }

    func showErrorNotice(_ message: String) {
        appendLocalNotice(tone: .error, message: message)
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

    private func didLogIn() async {
        loadingStep = nil
        await enterNotes(restoringLastView: true)
    }

    private func resetSessionState() {
        tree = nil
        openNote = nil
        editorTarget = .none
        editorFocusAtEnd = nil
        expandedFolders = []
        lastViewRestorePending = false
        lastViewTracking = false
        noteNameError = nil
        noteDetails = nil
        detailsPath = nil
        statsTask?.cancel()
        statsTask = nil
        datesTimer?.cancel()
        datesTimer = nil
        searchTask?.cancel()
        searchTask = nil
        searchRefreshTask?.cancel()
        searchRefreshTask = nil
        isSearchActive = false
        searchQuery = ""
        searchResults = nil
        searchStatus = nil
        notePositions = [:]
        imageLoader?.clear()
        noteUpdate = nil
        syncStatus = nil
        draftName = ""
        draftError = nil
        exportState = .idle
        tagFilter = nil
        usedTags = []
        tagsWritable = false
        tagOptions = []
        trashEntries = []
        trashDeleteConfirmation = nil
        trashEmptyConfirmation = nil
        isTrashPresented = false
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
            tagFilter = change.tagFilter
            usedTags = change.usedTags
            tagsWritable = change.tagsWritable
            tagOptions = change.tagOptions
            if lastViewRestorePending {
                Task { await restoreLastViewIfReady() }
            }
            scheduleSearchRefresh()
        case .trashChanged(let change):
            trashEntries = change.entries
            trashDeleteConfirmation = change.deleteConfirmation
            trashEmptyConfirmation = change.emptyConfirmation
        case .noteChanged(let change):
            handleNoteChanged(change)
        case .noteContentChangedRemotely(let change):
            appendLocalNotice(tone: .info, message: change.message)
        case .syncStateChanged(let state):
            let wasSynced = syncStatus?.state == .synced
            syncStatus = state
            if !wasSynced, state.state == .synced, let detailsPath {
                Task { await refreshDates(for: detailsPath) }
            }
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
        case .searchStatusChanged(let status):
            searchStatus = status
            scheduleSearchRefresh()
        case .sessionEnded:
            resetSessionState()
            screen = .login(LoginEntry())
        case .unknown:
            break
        }
    }

    private func handleNoteChanged(_ change: NoteChanged) {
        let previousPath = openNote?.path
        openNote = change.note
        defer { updateNoteDetailsTarget() }
        guard case .loaded(let path, let content, _, _, _)? = change.note else { return }
        // Compared with the last update the editor received, not `openNote`: a NoteOpen response
        // can mark the note loaded before its first `noteChanged` arrives.
        if let delivered = noteUpdate, delivered.path == path, delivered.content == content,
            change.edits?.isEmpty ?? true
        {
            return
        }
        if let targetPath = editorTarget.notePath, targetPath != path, change.edits != nil,
            previousPath == targetPath
        {
            relocateOpenNote(from: targetPath, to: path)
        }
        noteUpdateSerial += 1
        noteUpdate = NoteContentUpdate(
            serial: noteUpdateSerial, path: path, content: content, edits: change.edits)
    }
}
