import NativeCoreAPI
import XCTest

private func isLaunchAction(_ event: CoreEvent) -> Bool {
    if case .launchAction = event { return true }
    return false
}

final class LaunchActionTests: RuntimeTestCase {
    func testLaunchActionIsHeldUntilAnAcceptingAttach() async throws {
        let runtime = try await makeRuntime()

        _ = try await runtime.send(LaunchDeliver(action: .search))

        var index = await runtime.events.count
        _ = try await runtime.send(LaunchAttach(accepts: [.newNote]))
        await assertNoLaunchEvent(runtime, after: index)

        index = await runtime.events.count
        _ = try await runtime.send(LaunchAttach(accepts: [.newNote, .search]))
        let event = try await runtime.events.wait(
            after: index, timeout: .seconds(2), description: "the held search action"
        ) { isLaunchAction($0) }
        XCTAssertEqual(event, .launchAction(.search))

        _ = try await runtime.send(LaunchDetach())
        index = await runtime.events.count
        _ = try await runtime.send(LaunchDeliver(action: .newNote))
        await assertNoLaunchEvent(runtime, after: index)

        _ = try await runtime.send(LaunchAttach(accepts: [.newNote]))
        let delivered = try await runtime.events.wait(
            after: index, timeout: .seconds(2), description: "the action held while detached"
        ) { isLaunchAction($0) }
        XCTAssertEqual(delivered, .launchAction(.newNote))
    }

    private func assertNoLaunchEvent(_ runtime: TestRuntime, after index: Int) async {
        do {
            _ = try await runtime.events.wait(
                after: index, timeout: .milliseconds(300), description: "no launch action"
            ) { isLaunchAction($0) }
            XCTFail("A launch action was delivered")
        } catch is TestTimeout {
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }
}
