import AppInteraction
import NativeCoreAPI
import XCTest

final class HapticsTests: XCTestCase {
    private func feedback(_ trigger: HapticTrigger) -> HapticFeedback? {
        var rule = HapticRule()
        return rule.feedback(for: trigger, at: 10)
    }

    func testMapping() {
        XCTAssertEqual(feedback(.dragStarted), .lightImpact)
        XCTAssertEqual(feedback(.dropTargetChanged), .selection)
        XCTAssertEqual(feedback(.dropFinished(succeeded: true)), .success)
        XCTAssertEqual(feedback(.dropFinished(succeeded: false)), .error)
        XCTAssertEqual(feedback(.actionFinished(succeeded: true)), .success)
        XCTAssertEqual(feedback(.actionFinished(succeeded: false)), .error)
        XCTAssertEqual(feedback(.notice(tone: .success)), .success)
        XCTAssertEqual(feedback(.notice(tone: .error)), .error)
        XCTAssertEqual(feedback(.notice(tone: .warning)), .warning)
        XCTAssertNil(feedback(.notice(tone: .info)))
        XCTAssertEqual(feedback(.saveFailed), .error)
        XCTAssertEqual(feedback(.conflictAppeared), .warning)
    }

    func testSameFeedbackIsDeduplicated() {
        var rule = HapticRule()
        XCTAssertEqual(rule.feedback(for: .dropFinished(succeeded: true), at: 1), .success)
        XCTAssertNil(rule.feedback(for: .notice(tone: .success), at: 1.2))
        XCTAssertEqual(rule.feedback(for: .notice(tone: .success), at: 1.6), .success)
    }

    func testDifferentFeedbackIsNotDeduplicated() {
        var rule = HapticRule()
        XCTAssertEqual(rule.feedback(for: .dragStarted, at: 1), .lightImpact)
        XCTAssertEqual(rule.feedback(for: .dropTargetChanged, at: 1.01), .selection)
        XCTAssertEqual(rule.feedback(for: .saveFailed, at: 1.02), .error)
    }

    func testSelectionWindowIsShorter() {
        var rule = HapticRule()
        XCTAssertEqual(rule.feedback(for: .dropTargetChanged, at: 1), .selection)
        XCTAssertNil(rule.feedback(for: .dropTargetChanged, at: 1.05))
        XCTAssertEqual(rule.feedback(for: .dropTargetChanged, at: 1.15), .selection)
    }

    func testInfoNoticeDoesNotResetWindow() {
        var rule = HapticRule()
        XCTAssertEqual(rule.feedback(for: .saveFailed, at: 1), .error)
        XCTAssertNil(rule.feedback(for: .notice(tone: .info), at: 1.1))
        XCTAssertNil(rule.feedback(for: .notice(tone: .error), at: 1.2))
    }

    func testCustomInterval() {
        var rule = HapticRule(minimumInterval: 1)
        XCTAssertEqual(rule.feedback(for: .saveFailed, at: 0), .error)
        XCTAssertNil(rule.feedback(for: .saveFailed, at: 0.9))
        XCTAssertEqual(rule.feedback(for: .saveFailed, at: 1.0), .error)
    }
}
