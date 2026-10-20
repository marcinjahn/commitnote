import Foundation
import NativeCoreAPI
import XCTest

struct ReadBackScenario: Encodable {
    struct Note: Encodable {
        var path: [String]
        var text: String
    }

    struct Expectation: Encodable {
        var initialized: Bool
        var notes: [Note]
        var deviceName: String
    }

    var name: String
    var passphrase: String
    var exported: String
    var expect: Expectation
}

enum ReadBackOutput {
    static var directory: (url: URL, fromEnvironment: Bool) {
        if let path = ProcessInfo.processInfo.environment["COMMITNOTE_READBACK_DIR"], !path.isEmpty {
            return (URL(fileURLWithPath: path, isDirectory: true), true)
        }
        return (
            FileManager.default.temporaryDirectory
                .appendingPathComponent("commitnote-readback-\(UUID().uuidString)", isDirectory: true),
            false
        )
    }

    static func write<T: Encodable>(
        _ value: T, fileName: String, subdirectory: String? = nil, to test: XCTestCase
    ) throws {
        let output = directory
        var target = output.url
        if let subdirectory {
            target = target.appendingPathComponent(subdirectory, isDirectory: true)
        }
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(value)
        try data.write(to: target.appendingPathComponent(fileName), options: .atomic)
        if !output.fromEnvironment {
            let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
            attachment.name = fileName
            attachment.lifetime = .keepAlways
            test.add(attachment)
        }
    }
}

final class ReadBackTests: RuntimeTestCase {
    private static let initializePassphrase = "native read-back passphrase"
    private static let editedText = "Zażółć gęślą jaźń\n\nSecond line: naïve café ✓ 日本語\n\n- list item\n"

    func testInitializedRepoReadsBack() async throws {
        let runtime = try await makeRuntime()
        let inspection = try await runtime.inspect(repo: "sample/empty")
        guard case .uninitialized = inspection else {
            return XCTFail("sample/empty was not inspected as uninitialized")
        }
        _ = try await runtime.send(LoginInitialize(passphrase: Self.initializePassphrase))
        _ = try await runtime.waitForTree()

        let scenario = ReadBackScenario(
            name: "ios initialize",
            passphrase: Self.initializePassphrase,
            exported: try await runtime.exportRepo("sample/empty"),
            expect: .init(initialized: true, notes: [], deviceName: runtime.deviceModel))
        try ReadBackOutput.write(scenario, fileName: "initialize.json", to: self)
    }

    func testSavedNoteReadsBack() async throws {
        let runtime = try await makeRuntime()
        let tree = try await runtime.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)
        let path = try XCTUnwrap(notePaths(in: tree).first)
        _ = try await runtime.openNoteLoaded(path)

        _ = try await runtime.send(FakeSaveNote(path: path, text: Self.editedText))

        let scenario = ReadBackScenario(
            name: "ios save",
            passphrase: sampleNotesPassphrase,
            exported: try await runtime.exportRepo("sample/notes"),
            expect: .init(
                initialized: false,
                notes: [.init(path: path, text: Self.editedText)],
                deviceName: runtime.deviceModel))
        try ReadBackOutput.write(scenario, fileName: "save.json", to: self)
    }

    func testHousekeepingCommitReadsBack() async throws {
        let runtime = try await makeRuntime()
        var fixtureMain: String?
        try await runtime.logIn(repo: "sample/trash", passphrase: sampleNotesPassphrase) {
            fixtureMain = try exportedMain(try await runtime.exportRepo("sample/trash"))
        }
        let baseline = try XCTUnwrap(fixtureMain)

        let exported: String = try await poll(
            timeout: .seconds(30), interval: .milliseconds(200),
            description: "the automatic trash purge commit"
        ) {
            let exported = try await runtime.exportRepo("sample/trash")
            return try exportedMain(exported) == baseline ? nil : exported
        }

        let scenario = ReadBackScenario(
            name: "ios housekeeping",
            passphrase: sampleNotesPassphrase,
            exported: exported,
            expect: .init(initialized: false, notes: [], deviceName: runtime.deviceModel))
        try ReadBackOutput.write(scenario, fileName: "housekeeping.json", to: self)
    }
}
