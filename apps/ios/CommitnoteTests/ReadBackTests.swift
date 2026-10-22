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
        var folders: [[String]]? = nil
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

    func testEditedNoteReadsBack() async throws {
        let runtime = try await makeRuntime()
        try await runtime.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)
        _ = try await runtime.openNoteLoaded(["Welcome"])

        _ = try await runtime.send(NoteEdit(path: ["Welcome"], text: Self.editedText))
        let flushed = try await runtime.send(SyncFlush()).result
        XCTAssertEqual(flushed, .saved)

        let scenario = ReadBackScenario(
            name: "ios edit",
            passphrase: sampleNotesPassphrase,
            exported: try await runtime.exportRepo("sample/notes"),
            expect: .init(
                initialized: false,
                notes: [.init(path: ["Welcome"], text: Self.editedText)],
                deviceName: runtime.deviceModel))
        try ReadBackOutput.write(scenario, fileName: "edit.json", to: self)
    }

    func testCreatedNotesAndFolderReadBack() async throws {
        let runtime = try await makeRuntime()
        try await runtime.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)
        let firstText = "First thought: żółć 🙂\n"
        let planText = "Plan for Q3 – naïve café\n"

        _ = try await runtime.send(DraftStart(parent: []))
        let first = try await runtime.send(DraftContent(name: "", content: firstText)).outcome
        guard case .created(let firstPath, _) = first else {
            return XCTFail("The draft was not created: \(first)")
        }

        let folder = try await runtime.send(FolderCreate(parent: [], name: "Quarterly")).outcome
        XCTAssertEqual(folder, .created(path: ["Quarterly"]))

        _ = try await runtime.send(DraftStart(parent: ["Quarterly"]))
        let named = try await runtime.send(DraftCommitName(name: "Plan")).outcome
        guard case .created(let planPath, _) = named else {
            return XCTFail("The named draft was not created: \(named)")
        }
        XCTAssertEqual(planPath, ["Quarterly", "Plan"])
        _ = try await runtime.send(NoteEdit(path: planPath, text: planText))

        let flushed = try await runtime.send(SyncFlush()).result
        XCTAssertEqual(flushed, .saved)

        let scenario = ReadBackScenario(
            name: "ios create",
            passphrase: sampleNotesPassphrase,
            exported: try await runtime.exportRepo("sample/notes"),
            expect: .init(
                initialized: false,
                notes: [.init(path: firstPath, text: firstText), .init(path: planPath, text: planText)],
                folders: [["Quarterly"]],
                deviceName: runtime.deviceModel))
        try ReadBackOutput.write(scenario, fileName: "create.json", to: self)
    }

    func testResolvedConflictReadsBack() async throws {
        let runtime = try await makeRuntime()
        try await runtime.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)
        let original = try await runtime.openNoteLoaded(["Welcome"])
        let rest = original.split(separator: "\n", omittingEmptySubsequences: false).dropFirst()
        let remoteText = (["# Remote title"] + rest).joined(separator: "\n")
        let localText = (["# Local title"] + rest).joined(separator: "\n")

        _ = try await runtime.send(
            FakeRemoteEdit(
                repo: "sample/notes", path: ["Welcome"], text: remoteText, device: "Other iPhone"))
        let index = await runtime.events.count
        _ = try await runtime.send(NoteEdit(path: ["Welcome"], text: localText))
        _ = try await runtime.send(SyncFlush())

        let event = try await runtime.events.wait(after: index, description: "the conflict") {
            guard case .noteChanged(let changed) = $0, case .loaded(_, _, let conflict, _, _)? = changed.note
            else { return false }
            return conflict?.otherDevice != nil
        }
        guard case .noteChanged(let changed) = event, case .loaded(_, _, let conflict, _, _)? = changed.note
        else { return XCTFail("The conflict event carried no loaded note") }
        XCTAssertEqual(conflict?.otherDevice, "Other iPhone")

        _ = try await runtime.send(ConflictResolve(path: ["Welcome"], resolution: .keepMine))
        let flushed = try await runtime.send(SyncFlush()).result
        XCTAssertEqual(flushed, .saved)

        let scenario = ReadBackScenario(
            name: "ios conflict",
            passphrase: sampleNotesPassphrase,
            exported: try await runtime.exportRepo("sample/notes"),
            expect: .init(
                initialized: false,
                notes: [.init(path: ["Welcome"], text: localText)],
                deviceName: runtime.deviceModel))
        try ReadBackOutput.write(scenario, fileName: "conflict.json", to: self)
    }
}
