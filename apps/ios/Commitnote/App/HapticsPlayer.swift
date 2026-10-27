import AppInteraction
import UIKit

@MainActor
final class HapticsPlayer {
    private var rule = HapticRule()
    private lazy var selection = UISelectionFeedbackGenerator()
    private lazy var impact = UIImpactFeedbackGenerator(style: .light)
    private lazy var notification = UINotificationFeedbackGenerator()

    func play(_ trigger: HapticTrigger) {
        guard let feedback = rule.feedback(for: trigger, at: ProcessInfo.processInfo.systemUptime)
        else { return }
        switch feedback {
        case .selection: selection.selectionChanged()
        case .lightImpact: impact.impactOccurred()
        case .success: notification.notificationOccurred(.success)
        case .warning: notification.notificationOccurred(.warning)
        case .error: notification.notificationOccurred(.error)
        }
    }
}
