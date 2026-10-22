import CoreRuntime
import Foundation
import NativeCoreAPI
import UIKit
import XCTest

let sampleNotesPassphrase = "sample notes repo passphrase"
let fakeAccessToken = "test-token"

struct TestTimeout: Error, CustomStringConvertible {
    var description: String
}

actor EventCollector {
    private struct Waiter {
        var predicate: @Sendable (CoreEvent) -> Bool
        var continuation: CheckedContinuation<CoreEvent, Error>
    }

    private var events: [CoreEvent] = []
    private var waiters: [UUID: Waiter] = [:]

    var count: Int { events.count }

    static func collecting(_ stream: AsyncStream<CoreEvent>) -> EventCollector {
        let collector = EventCollector()
        Task {
            for await event in stream {
                await collector.append(event)
            }
        }
        return collector
    }

    private func append(_ event: CoreEvent) {
        events.append(event)
        for (id, waiter) in waiters where waiter.predicate(event) {
            waiters.removeValue(forKey: id)
            waiter.continuation.resume(returning: event)
        }
    }

    func wait(
        after index: Int,
        timeout: Duration = .seconds(120),
        description: String,
        where predicate: @escaping @Sendable (CoreEvent) -> Bool
    ) async throws -> CoreEvent {
        if index < events.count, let event = events[index...].first(where: predicate) {
            return event
        }
        let id = UUID()
        return try await withCheckedThrowingContinuation { continuation in
            waiters[id] = Waiter(predicate: predicate, continuation: continuation)
            Task {
                try? await Task.sleep(for: timeout)
                self.expire(id, description: description)
            }
        }
    }

    private func expire(_ id: UUID, description: String) {
        waiters.removeValue(forKey: id)?.continuation.resume(
            throwing: TestTimeout(description: "Timed out waiting for \(description)"))
    }
}

func poll<T>(
    timeout: Duration,
    interval: Duration,
    description: String,
    _ body: () async throws -> T?
) async throws -> T {
    let clock = ContinuousClock()
    let deadline = clock.now + timeout
    while true {
        if let value = try await body() { return value }
        guard clock.now < deadline else {
            throw TestTimeout(description: "Timed out waiting for \(description)")
        }
        try await Task.sleep(for: interval)
    }
}

func timed<T>(_ body: () async throws -> T) async rethrows -> (value: T, milliseconds: Double) {
    let clock = ContinuousClock()
    let start = clock.now
    let value = try await body()
    let components = (clock.now - start).components
    let milliseconds = Double(components.seconds) * 1000 + Double(components.attoseconds) / 1e15
    return (value, milliseconds)
}

func notePaths(in nodes: [TreeNode]) -> [[String]] {
    nodes.flatMap { node -> [[String]] in
        switch node {
        case .note(_, let path, _, _): [path]
        case .folder(_, _, _, let children): notePaths(in: children)
        }
    }
}

func pathKey(_ path: [String]) -> String {
    path.joined(separator: "\u{0}")
}

func exportedMain(_ exported: String) throws -> String? {
    let object = try JSONSerialization.jsonObject(with: Data(exported.utf8)) as? [String: Any]
    return object?["main"] as? String
}

struct TestServices {
    let keychainService: String
    let blobCacheRoot: URL
    let suiteName: String

    init() {
        let id = UUID().uuidString
        keychainService = "io.github.marcinjahn.commitnote.tests.\(id)"
        blobCacheRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("commitnote-tests-\(id)", isDirectory: true)
        suiteName = "commitnote.tests.\(id)"
    }

    var defaults: UserDefaults { UserDefaults(suiteName: suiteName)! }

    var rememberedSession: KeychainRememberedSessionStorage {
        KeychainRememberedSessionStorage(service: keychainService)
    }

    func configuration(bundleURL: URL, deviceModel: String, http: any HTTPClient)
        -> CoreRuntimeConfiguration
    {
        CoreRuntimeConfiguration(
            bundleURL: bundleURL,
            deviceModel: deviceModel,
            rememberedSession: rememberedSession,
            blobCache: FileBlobCacheStorage(root: blobCacheRoot),
            deviceSettings: UserDefaultsDeviceSettingsStorage(defaults: defaults),
            http: http)
    }

    func reset() {
        CoreRuntimeConfiguration.resetStoredState(
            keychainService: keychainService, blobCacheRoot: blobCacheRoot, defaults: defaults)
        try? FileManager.default.removeItem(at: blobCacheRoot)
        UserDefaults.standard.removePersistentDomain(forName: suiteName)
    }
}

final class TestRuntime: @unchecked Sendable {
    let core: CoreRuntime
    let events: EventCollector
    let deviceModel: String

    init(configuration: CoreRuntimeConfiguration) {
        core = CoreRuntime(configuration: configuration)
        events = EventCollector.collecting(core.events)
        deviceModel = configuration.deviceModel
    }

    func send<C: NativeCoreCommand>(_ command: C) async throws -> C.Result {
        try await core.send(command)
    }

    func stop() async {
        await core.stop()
    }

    @discardableResult
    func logIn(
        repo: String,
        passphrase: String,
        beforeUnlock: (() async throws -> Void)? = nil
    ) async throws -> [TreeNode] {
        let inspection = try await inspect(repo: repo)
        guard case .notesRepo = inspection else {
            throw TestTimeout(description: "\(repo) was not inspected as a notes repo")
        }
        try await beforeUnlock?()
        _ = try await send(LoginUnlock(passphrase: passphrase))
        return try await waitForTree()
    }

    func inspect(repo: String) async throws -> InspectionResult {
        let listing = try await send(
            LoginListRepositories(forge: .github, accessToken: fakeAccessToken))
        guard
            let repository = listing.repositories.first(where: {
                $0.url.lowercased().hasSuffix("/\(repo)")
            })
        else {
            throw TestTimeout(description: "login.listRepositories does not list \(repo)")
        }
        return try await send(
            LoginInspectRepository(
                forge: .github, accessToken: fakeAccessToken, repositoryUrl: repository.url))
    }

    func waitForTree() async throws -> [TreeNode] {
        let index = await events.count
        if let tree = try await send(TreeGet()).tree { return tree }
        let event = try await events.wait(after: index, description: "the tree to load") {
            if case .treeChanged(let changed) = $0 { return changed.tree != nil }
            return false
        }
        guard case .treeChanged(let changed) = event, let tree = changed.tree else {
            throw TestTimeout(description: "The tree event carried no tree")
        }
        return tree
    }

    func openNoteLoaded(_ path: [String]) async throws -> String {
        let index = await events.count
        let opened = try await send(NoteOpen(path: path)).note
        let note: OpenNote
        if let opened, case .loading = opened {
            let event = try await events.wait(after: index, description: "a note to load") {
                guard case .noteChanged(let changed) = $0, let note = changed.note else {
                    return false
                }
                if case .loading = note { return false }
                return note.path == path
            }
            guard case .noteChanged(let changed) = event, let loaded = changed.note else {
                throw TestTimeout(description: "The note event carried no note")
            }
            note = loaded
        } else if let opened {
            note = opened
        } else {
            throw TestTimeout(description: "note.open returned no note")
        }
        guard case .loaded(_, let content, _, _, _) = note else {
            throw TestTimeout(description: "A note did not load")
        }
        return content
    }

    func exportRepo(_ repoKey: String) async throws -> String {
        try await send(FakeExportRepo(repoKey: repoKey)).exported
    }
}

private final class BundleMarker {}

enum TestResources {
    static var coreBundleURL: URL {
        get throws {
            guard let url = Bundle.main.url(forResource: "commitnote-core", withExtension: "js") else {
                throw TestTimeout(description: "The app bundle contains no core bundle")
            }
            return url
        }
    }

    static var vectorsDirectory: URL {
        get throws {
            guard
                let url = Bundle(for: BundleMarker.self).url(
                    forResource: "test-vectors", withExtension: nil)
            else {
                throw TestTimeout(description: "The test bundle contains no test vectors")
            }
            return url
        }
    }

    static func deviceModel() async -> String {
        await MainActor.run { UIDevice.current.model }
    }
}

class RuntimeTestCase: XCTestCase {
    private var runtimes: [TestRuntime] = []
    private var allServices: [TestServices] = []

    override func tearDown() async throws {
        for runtime in runtimes {
            await runtime.stop()
        }
        for services in allServices {
            services.reset()
        }
        runtimes = []
        allServices = []
        try await super.tearDown()
    }

    func newServices() -> TestServices {
        let services = TestServices()
        allServices.append(services)
        return services
    }

    func makeRuntime(
        services: TestServices? = nil,
        http: any HTTPClient = URLSessionHTTPClient(),
        started: Bool = true
    ) async throws -> TestRuntime {
        let services = services ?? newServices()
        let runtime = TestRuntime(
            configuration: services.configuration(
                bundleURL: try TestResources.coreBundleURL,
                deviceModel: await TestResources.deviceModel(),
                http: http))
        runtimes.append(runtime)
        if started {
            try await runtime.core.start()
        }
        return runtime
    }
}
