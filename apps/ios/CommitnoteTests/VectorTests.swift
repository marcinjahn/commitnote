import Foundation
import NativeCoreAPI
import XCTest

final class VectorTests: RuntimeTestCase {
    func testEveryTestVectorPassesThroughTheCryptoShim() async throws {
        let directory = try TestResources.vectorsDirectory
        let names = try FileManager.default.contentsOfDirectory(atPath: directory.path)
            .filter { $0.hasSuffix(".json") }
            .sorted()
        XCTAssertFalse(names.isEmpty)

        var files: [String: JSONValue] = [:]
        var expectedChecks = 0
        for name in names {
            let data = try Data(contentsOf: directory.appendingPathComponent(name))
            let value = try JSONDecoder().decode(JSONValue.self, from: data)
            files[name] = value
            guard case .object(let fields) = value else {
                XCTFail("\(name) is not an object")
                continue
            }
            expectedChecks += 1
            for case .array(let vectors) in fields.values {
                expectedChecks += vectors.count
            }
        }

        let runtime = try await makeRuntime()
        let result = try await runtime.send(FakeCheckVectors(files: files))

        XCTAssertEqual(result.failures, [])
        XCTAssertEqual(result.checked, expectedChecks)
    }
}
