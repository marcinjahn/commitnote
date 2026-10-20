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

    private var runtime: CoreRuntime?
    private var eventsTask: Task<Void, Never>?
    private var pathMonitor: NWPathMonitor?
    private var visible: Bool?
    private var online: Bool?
    private var localNoticeCounter = 0

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
        _ = try? await send(SessionLogout(anyway: true))
        resetSessionState()
        screen = .login(LoginEntry())
    }

    func logInAgain() async {
        await logOut()
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
        case .background: setVisible(false)
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

    private func didLogIn() {
        loadingStep = nil
        screen = .notes
    }

    private func resetSessionState() {
        tree = nil
        openNote = nil
        notices = []
        refreshStatus = RefreshStatus()
        loadingStep = nil
    }

    private func setVisible(_ value: Bool) {
        visible = value
        guard runtime != nil else { return }
        Task { _ = try? await send(LifecycleSetVisible(visible: value)) }
    }

    private func setOnline(_ value: Bool) {
        guard online != value else { return }
        online = value
        guard runtime != nil else { return }
        Task { _ = try? await send(LifecycleSetOnline(online: value)) }
    }

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
            openNote = change.note
        case .noteContentChangedRemotely(let change):
            localNoticeCounter += 1
            notices.append(
                AppNotice(
                    id: "local-\(localNoticeCounter)", tone: .info, message: change.message,
                    persistent: false, isLocal: true))
        case .syncStateChanged(let state):
            refreshStatus = RefreshStatus(
                online: state.online, refreshing: state.refreshing,
                treeLoaded: state.treeLoaded, lastRefreshError: state.lastRefreshError)
        case .notice(let notice):
            let value = AppNotice(
                id: notice.id, tone: notice.tone, message: notice.message,
                persistent: notice.persistent, isLocal: false)
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
                    unsavedCount: info.unsavedCount, message: info.message, detail: info.detail))
        case .sessionEnded:
            resetSessionState()
            screen = .login(LoginEntry())
        case .unknown:
            break
        }
    }
}
