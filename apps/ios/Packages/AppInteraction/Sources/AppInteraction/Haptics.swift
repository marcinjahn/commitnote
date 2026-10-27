import NativeCoreAPI

public enum HapticFeedback: Equatable, Sendable {
    case selection, lightImpact, success, warning, error
}

public enum HapticTrigger: Equatable, Sendable {
    case dragStarted
    case dropTargetChanged
    case dropFinished(succeeded: Bool)
    case notice(tone: NoticeTone)
    case saveFailed
    case conflictAppeared
    case actionFinished(succeeded: Bool)
}

public struct HapticRule: Sendable {
    private static let selectionInterval = 0.1

    private let minimumInterval: Double
    private var lastFeedback: HapticFeedback?
    private var lastTime = 0.0

    public init(minimumInterval: Double = 0.4) {
        self.minimumInterval = minimumInterval
    }

    public mutating func feedback(for trigger: HapticTrigger, at time: Double) -> HapticFeedback? {
        guard let feedback = Self.map(trigger) else { return nil }
        if lastFeedback == feedback {
            let window = feedback == .selection ? Self.selectionInterval : minimumInterval
            if time - lastTime < window { return nil }
        }
        lastFeedback = feedback
        lastTime = time
        return feedback
    }

    private static func map(_ trigger: HapticTrigger) -> HapticFeedback? {
        switch trigger {
        case .dragStarted: .lightImpact
        case .dropTargetChanged: .selection
        case .dropFinished(let succeeded), .actionFinished(let succeeded):
            succeeded ? .success : .error
        case .notice(let tone):
            switch tone {
            case .success: .success
            case .error: .error
            case .warning: .warning
            case .info: nil
            }
        case .saveFailed: .error
        case .conflictAppeared: .warning
        }
    }
}
