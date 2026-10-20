import XCTest

final class TimerTests: RuntimeTestCase {
    func testTimersFireInDelayOrderAndCancelledTimersDoNot() async throws {
        let runtime = try await makeRuntime()

        let (result, milliseconds) = try await timed {
            try await runtime.send(FakeTimerProbe(delaysMs: [50, 10, 30], cancelIndex: 0))
        }

        XCTAssertEqual(result.fired, [1, 2])
        XCTAssertGreaterThanOrEqual(milliseconds, 30)
    }
}
