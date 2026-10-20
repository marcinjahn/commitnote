import CoreRuntime
import Foundation
import NativeCoreAPI
import XCTest

final class KeychainTests: RuntimeTestCase {
    func testStorageRoundTrip() throws {
        let services = newServices()
        let storage = services.rememberedSession
        XCTAssertNil(try storage.load())

        let record = RememberedSessionMaterial(
            repoUrl: "https://github.com/test/notes",
            coordinates: .init(forge: .github, owner: "test", repo: "notes"),
            accessToken: "token",
            keys: .init(
                contentKey: Data(repeating: 1, count: 32),
                nameKey: Data(repeating: 2, count: 32),
                nameIvKey: Data(repeating: 3, count: 32),
                keyCheckKey: Data(repeating: 4, count: 32)))
        try storage.save(record)
        XCTAssertEqual(try storage.load(), record)

        let replacement = RememberedSessionMaterial(
            repoUrl: "https://github.com/test/other",
            coordinates: .init(forge: .github, owner: "test", repo: "other"),
            accessToken: "other-token",
            keys: record.keys)
        try storage.save(replacement)
        XCTAssertEqual(try storage.load(), replacement)

        try storage.clear()
        XCTAssertNil(try storage.load())
    }

    func testRememberedSessionResumesInNewRuntimeAndLogoutClearsIt() async throws {
        let services = newServices()
        let first = try await makeRuntime(services: services)
        try await first.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)
        XCTAssertNotNil(try services.rememberedSession.load())
        await first.stop()

        let second = try await makeRuntime(services: services)
        let resumed = try await second.send(SessionResume())
        XCTAssertEqual(resumed, .resumed)
        let tree = try await second.waitForTree()
        XCTAssertFalse(tree.isEmpty)

        _ = try await second.send(SessionLogout())
        XCTAssertNil(try services.rememberedSession.load())
    }

    func testResumeWithoutRememberedSessionReturnsNone() async throws {
        let runtime = try await makeRuntime()
        let resumed = try await runtime.send(SessionResume())
        XCTAssertEqual(resumed, .none)
    }
}
