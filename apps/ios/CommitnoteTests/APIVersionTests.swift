import CoreRuntime
import Foundation
import NativeCoreAPI
import XCTest

final class APIVersionTests: XCTestCase {
    func testMismatchedAPIVersionRefusesToStart() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("commitnote-version-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let bundleURL = directory.appendingPathComponent("core.js")
        try """
        globalThis.CommitnoteNativeCore = {
          apiVersion: 999,
          marker: "commitnote-native-core",
          start() {}
        };
        """.write(to: bundleURL, atomically: true, encoding: .utf8)

        let services = TestServices()
        defer { services.reset() }
        let runtime = CoreRuntime(
            configuration: services.configuration(
                bundleURL: bundleURL, deviceModel: "iPhone", http: URLSessionHTTPClient()))

        do {
            try await runtime.start()
            XCTFail("start should have thrown")
        } catch {
            XCTAssertEqual(
                error as? CoreRuntimeError,
                .apiVersionMismatch(expected: NativeCoreAPIVersion.current, found: 999))
        }
        await runtime.stop()
    }
}
