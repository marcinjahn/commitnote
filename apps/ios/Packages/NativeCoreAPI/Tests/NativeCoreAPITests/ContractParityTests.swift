import Foundation
import XCTest

@testable import NativeCoreAPI

final class ContractParityTests: XCTestCase {
    private func apiSource() throws -> String {
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { url.deleteLastPathComponent() }
        url.appendPathComponent("src/native-core/api.ts")
        return try String(contentsOf: url, encoding: .utf8)
    }

    private func quotedNames(in source: String, array: String) throws -> [String] {
        let pattern = try NSRegularExpression(
            pattern: "\(array) = \\[(.*?)\\]", options: [.dotMatchesLineSeparators])
        let range = NSRange(source.startIndex..., in: source)
        let match = try XCTUnwrap(pattern.firstMatch(in: source, range: range))
        let body = String(source[try XCTUnwrap(Range(match.range(at: 1), in: source))])
        let name = try NSRegularExpression(pattern: "\"([^\"]+)\"")
        return name.matches(in: body, range: NSRange(body.startIndex..., in: body)).map {
            String(body[Range($0.range(at: 1), in: body)!])
        }
    }

    func testApiVersionMatchesTypeScript() throws {
        let source = try apiSource()
        let pattern = try NSRegularExpression(pattern: "NATIVE_CORE_API_VERSION = (\\d+);")
        let match = try XCTUnwrap(
            pattern.firstMatch(in: source, range: NSRange(source.startIndex..., in: source)))
        let digits = String(source[try XCTUnwrap(Range(match.range(at: 1), in: source))])
        XCTAssertEqual(Int(digits), NativeCoreAPIVersion.current)
    }

    func testCommandNamesMatchTypeScript() throws {
        let names = try quotedNames(in: try apiSource(), array: "CORE_COMMAND_NAMES")
        XCTAssertFalse(names.isEmpty)
        XCTAssertEqual(Set(NativeCoreCommands.names), Set(names))
        XCTAssertEqual(NativeCoreCommands.names.count, Set(NativeCoreCommands.names).count)
    }

    func testEventNamesMatchTypeScript() throws {
        let names = try quotedNames(in: try apiSource(), array: "CORE_EVENT_NAMES")
        XCTAssertFalse(names.isEmpty)
        XCTAssertEqual(Set(CoreEvent.knownNames), Set(names))
        XCTAssertEqual(CoreEvent.knownNames.count, Set(CoreEvent.knownNames).count)
    }
}
