import AppInteraction
import Foundation
import NativeCoreAPI
import Observation

@MainActor @Observable
final class LaunchInbox {
    static let shared = LaunchInbox()

    private(set) var pending: [LaunchAction] = []

    private init() {}

    func deliver(_ action: LaunchAction) {
        pending.append(action)
    }

    func open(_ url: URL) -> Bool {
        guard let action = LaunchLink.action(from: url) else { return false }
        deliver(action)
        return true
    }

    func quickAction(type: String) -> Bool {
        guard let action = QuickAction.action(forType: type) else { return false }
        deliver(action)
        return true
    }

    func take() -> [LaunchAction] {
        guard !pending.isEmpty else { return [] }
        let actions = pending
        pending = []
        return actions
    }
}
