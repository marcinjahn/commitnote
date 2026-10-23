import Foundation
import JavaScriptCore
import NativeCoreAPI
import os

public actor CoreRuntime {
    private static let marker = "commitnote-native-core"

    public nonisolated let events: AsyncStream<CoreEvent>

    private let queue = DispatchSerialQueue(label: "io.github.marcinjahn.commitnote.core-runtime", qos: .userInitiated)
    private let configuration: CoreRuntimeConfiguration
    private let logger: Logger
    private let router: ResponseRouter
    private let exceptions = ExceptionRecorder()
    private nonisolated let stagedInputs = HandleStore<StagedInput>()
    private var virtualMachine: JSVirtualMachine?
    private var context: JSContext?
    private var host: HostServicesObject?
    private var handle: JSValue?
    private var nextRequestId = 1
    private var stopped = false
    private var watchdog: DispatchSourceTimer?

    public nonisolated var unownedExecutor: UnownedSerialExecutor {
        queue.asUnownedSerialExecutor()
    }

    public init(configuration: CoreRuntimeConfiguration) {
        self.configuration = configuration
        let logger = Logger(subsystem: "io.github.marcinjahn.commitnote", category: "core")
        self.logger = logger
        let (events, continuation) = AsyncStream.makeStream(of: CoreEvent.self, bufferingPolicy: .unbounded)
        self.events = events
        self.router = ResponseRouter(events: continuation, logger: logger)
    }

    public func start() async throws {
        guard !stopped else { throw CoreRuntimeError.stopped }
        guard handle == nil else { return }

        let source: String
        do {
            source = try String(contentsOf: configuration.bundleURL, encoding: .utf8)
        } catch {
            throw CoreRuntimeError.bundleMissing
        }

        guard let virtualMachine = JSVirtualMachine(),
            let context = JSContext(virtualMachine: virtualMachine)
        else {
            throw CoreRuntimeError.bundleInvalid
        }
        context.name = "commitnote core runtime"
        let exceptions = self.exceptions
        let logger = self.logger
        context.exceptionHandler = { _, exception in
            let name = exception?.forProperty("name")?.toString() ?? "unknown"
            logger.error("JavaScript exception: \(name, privacy: .public)")
            exceptions.record(name)
        }

        _ = try evaluate { context.evaluateScript(source, withSourceURL: configuration.bundleURL) }

        guard let global = context.objectForKeyedSubscript("CommitnoteNativeCore"), global.isObject,
            global.forProperty("marker")?.toString() == Self.marker,
            let apiVersion = global.forProperty("apiVersion"), apiVersion.isNumber,
            let found = Int(exactly: apiVersion.toDouble())
        else {
            throw CoreRuntimeError.bundleInvalid
        }
        guard found == NativeCoreAPIVersion.current else {
            throw CoreRuntimeError.apiVersionMismatch(expected: NativeCoreAPIVersion.current, found: found)
        }

        let router = self.router
        let host = HostServicesObject(
            context: context,
            queue: queue,
            configuration: configuration,
            stagedInputs: stagedInputs,
            logger: logger,
            onPost: { message in router.receive(message) })
        let options = JSBridge.newObject(in: context, [("deviceModel", configuration.deviceModel)])

        let started: JSValue?
        do {
            started = try evaluate { global.invokeMethod("start", withArguments: [host.makeObject(), options]) }
        } catch {
            host.stop()
            throw error
        }
        guard let started, started.isObject, !started.isNull else {
            host.stop()
            throw CoreRuntimeError.bundleInvalid
        }

        self.virtualMachine = virtualMachine
        self.context = context
        self.host = host
        self.handle = started
        if configuration.stallDiagnostics {
            watchdog = Self.startWatchdog(queue: queue, router: router, logger: logger)
        }
    }

    private static func startWatchdog(
        queue: DispatchSerialQueue, router: ResponseRouter, logger: Logger
    ) -> DispatchSourceTimer {
        let pings = PingState()
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        timer.schedule(deadline: .now() + 5, repeating: 5)
        timer.setEventHandler {
            if let waiting = pings.outstanding(), waiting > 4 {
                logger.notice("Core queue has not run a block for \(Int(waiting), privacy: .public) s")
            }
            guard pings.send() else { return }
            queue.async {
                pings.answered()
                for stalled in router.stalled(olderThan: 10) {
                    logger.notice(
                        "Core request \(stalled.id, privacy: .public) \(stalled.command, privacy: .public) unanswered for \(Int(stalled.age), privacy: .public) s"
                    )
                }
            }
        }
        timer.resume()
        return timer
    }

    public func send<C: NativeCoreCommand>(_ command: C) async throws -> C.Result {
        guard !stopped, let handle else { throw CoreRuntimeError.stopped }
        let id = nextRequestId
        nextRequestId += 1
        let json = try CoreRequest(id: id, command: command).jsonString()
        let router = self.router
        let exceptions = self.exceptions
        let value: JSONValue = try await withCheckedThrowingContinuation { continuation in
            router.register(id, command: C.name, continuation)
            exceptions.reset()
            handle.invokeMethod("send", withArguments: [json])
            if let name = exceptions.take() {
                router.fail(id, CoreRuntimeError.javaScriptException(name: name))
            }
        }
        return try decodeResult(C.self, from: value)
    }

    /// The returned id is what the core's core takes as an input; each can be taken once.
    public nonisolated func stageInput(_ data: Data, type: String) -> String {
        stagedInputs.insert(StagedInput(data: data, type: type))
    }

    public nonisolated func discardStagedInputs(_ ids: [String]) {
        stagedInputs.remove(ids)
    }

    public func flushHostStorage() async {
        guard let host else { return }
        do {
            try await host.flushBlobCache()
        } catch {
            logger.error("Blob cache flush failed")
        }
    }

    /// The native core posts nothing after its `stop()`, so requests still in flight fail with `.stopped`.
    public func stop() {
        guard !stopped else { return }
        stopped = true
        if let handle {
            exceptions.reset()
            handle.invokeMethod("stop", withArguments: [])
            _ = exceptions.take()
        }
        watchdog?.cancel()
        watchdog = nil
        host?.stop()
        stagedInputs.close()
        router.finish()
        handle = nil
        host = nil
        context = nil
        virtualMachine = nil
    }

    private func evaluate<T>(_ body: () -> T) throws -> T {
        exceptions.reset()
        let result = body()
        if let name = exceptions.take() {
            throw CoreRuntimeError.javaScriptException(name: name)
        }
        return result
    }
}

/// Confined to the core runtime's queue.
final class ExceptionRecorder {
    private var name: String?

    func record(_ name: String) {
        self.name = name
    }

    func reset() {
        name = nil
    }

    func take() -> String? {
        defer { name = nil }
        return name
    }
}

private final class PingState: @unchecked Sendable {
    private let lock = NSLock()
    private var sentAt: Date?

    /// False while the previous ping is still waiting for the queue.
    func send() -> Bool {
        lock.withLock {
            guard sentAt == nil else { return false }
            sentAt = Date()
            return true
        }
    }

    func answered() {
        lock.withLock { sentAt = nil }
    }

    func outstanding() -> TimeInterval? {
        lock.withLock { sentAt.map { Date().timeIntervalSince($0) } }
    }
}

/// Confined to the core runtime's queue.
final class ResponseRouter: @unchecked Sendable {
    private var pending: [Int: CheckedContinuation<JSONValue, Error>] = [:]
    private var started: [Int: (command: String, at: Date)] = [:]
    private let events: AsyncStream<CoreEvent>.Continuation
    private let logger: Logger
    private var finished = false

    init(events: AsyncStream<CoreEvent>.Continuation, logger: Logger) {
        self.events = events
        self.logger = logger
    }

    func register(_ id: Int, command: String, _ continuation: CheckedContinuation<JSONValue, Error>) {
        guard !finished else {
            continuation.resume(throwing: CoreRuntimeError.stopped)
            return
        }
        pending[id] = continuation
        started[id] = (command, Date())
    }

    func fail(_ id: Int, _ error: Error) {
        started.removeValue(forKey: id)
        pending.removeValue(forKey: id)?.resume(throwing: error)
    }

    func stalled(olderThan seconds: TimeInterval) -> [(id: Int, command: String, age: TimeInterval)] {
        let now = Date()
        return started.compactMap { id, entry in
            let age = now.timeIntervalSince(entry.at)
            return age > seconds ? (id, entry.command, age) : nil
        }
    }

    func receive(_ text: String) {
        guard !finished else { return }
        let message: CoreMessage
        do {
            message = try CoreMessage.decode(text)
        } catch {
            logger.error("Unreadable core message")
            return
        }
        switch message {
        case .response(let id, let result):
            started.removeValue(forKey: id)
            guard let continuation = pending.removeValue(forKey: id) else {
                logger.error("Core response for no pending request: \(id, privacy: .public)")
                return
            }
            continuation.resume(with: result)
        case .event(let event):
            events.yield(event)
        }
    }

    func finish() {
        guard !finished else { return }
        finished = true
        let continuations = pending.values
        pending.removeAll()
        started.removeAll()
        for continuation in continuations {
            continuation.resume(throwing: CoreRuntimeError.stopped)
        }
        events.finish()
    }
}
