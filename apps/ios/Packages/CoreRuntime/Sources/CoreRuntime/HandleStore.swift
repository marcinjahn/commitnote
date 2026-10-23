import Foundation
import Synchronization

struct StagedImageInput: Sendable {
    let data: Data
    let type: String
}

/// Once closed, it stays empty: later inserts still return a handle that resolves to nothing.
final class HandleStore<Value: Sendable>: Sendable {
    private struct State {
        var values: [String: Value] = [:]
        var closed = false
    }

    private let state = Mutex(State())

    func insert(_ value: Value) -> String {
        let handle = UUID().uuidString
        state.withLock { state in
            if !state.closed { state.values[handle] = value }
        }
        return handle
    }

    func value(_ handle: String) -> Value? {
        state.withLock { $0.values[handle] }
    }

    @discardableResult
    func remove(_ handle: String) -> Value? {
        state.withLock { $0.values.removeValue(forKey: handle) }
    }

    func remove(_ handles: [String]) {
        state.withLock { state in
            for handle in handles {
                state.values.removeValue(forKey: handle)
            }
        }
    }

    func close() {
        state.withLock { state in
            state.closed = true
            state.values.removeAll()
        }
    }
}
