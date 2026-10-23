import Foundation
import ImageIO
import NativeCoreAPI
import XCTest

struct ReadBackScenario: Encodable {
    struct Note: Encodable {
        var path: [String]
        var text: String
    }

    struct Order: Encodable {
        var parent: [String]
        var names: [String]
    }

    struct Tag: Encodable {
        var path: [String]
        var tag: ColorTag?

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(path, forKey: .path)
            try container.encode(tag, forKey: .tag)
        }

        private enum CodingKeys: String, CodingKey {
            case path, tag
        }
    }

    struct Trash: Encodable {
        var count: Int
        var names: [String]
    }

    struct Image: Encodable {
        var reference: String
        var type: String
    }

    struct Expectation: Encodable {
        var initialized: Bool
        var notes: [Note]
        var folders: [[String]]? = nil
        var order: [Order]? = nil
        var tags: [Tag]? = nil
        var trash: Trash? = nil
        var images: [Image]? = nil
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

protocol StructureResult {
    var outcome: StructureOutcome { get }
}

extension NodeRename.Result: StructureResult {}
extension NodeMove.Result: StructureResult {}
extension NodePlace.Result: StructureResult {}
extension NodeSetColorTag.Result: StructureResult {}
extension TrashRestore.Result: StructureResult {}

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

    func testOrganisedRepoReadsBack() async throws {
        let runtime = try await makeRuntime()
        try await runtime.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)
        let sampleNotes = try await runtime.send(FakeExpectedSampleNotes()).notes
        func textOf(_ path: [String]) throws -> String {
            try XCTUnwrap(sampleNotes.first { $0.path == path }).text
        }
        func structure<C: NativeCoreCommand>(_ command: C) async throws -> [String]
        where C.Result: StructureResult {
            let outcome = try await runtime.send(command).outcome
            guard case .ok(let path) = outcome else {
                throw TestTimeout(description: "\(C.name) returned \(outcome)")
            }
            return path
        }
        func trash(_ path: [String]) async throws -> String {
            let outcome = try await runtime.send(NodeTrash(path: path, shareCount: 0)).outcome
            guard case .trashed(let entryId) = outcome else {
                throw TestTimeout(description: "node.trash returned \(outcome)")
            }
            return entryId
        }

        let welcome = ["Welcome"]
        let polish = ["Zażółć gęślą jaźń"]
        let roadmap = ["Projects", "commitnote", "Roadmap"]
        let welcomeText = try textOf(welcome)
        let polishText = try textOf(polish)
        let roadmapText = try textOf(roadmap)

        let renamed = try await structure(NodeRename(path: welcome, name: "Hello"))
        let moved = try await structure(NodeMove(path: polish, parent: ["Projects"]))
        _ = try await structure(NodePlace(path: renamed, parent: [], before: "Empty folder"))
        _ = try await structure(NodeSetColorTag(path: renamed, tag: .yellow))
        _ = try await trash(["Journal", "2026", "Whiteboard"])
        let folderEntry = try await trash(["Projects", "commitnote"])
        let restored = try await structure(
            TrashRestore(entryId: folderEntry, subPath: ["Roadmap"], parent: []))

        let flushed = try await runtime.send(SyncFlush()).result
        XCTAssertEqual(flushed, .saved)

        let scenario = ReadBackScenario(
            name: "ios organise",
            passphrase: sampleNotesPassphrase,
            exported: try await runtime.exportRepo("sample/notes"),
            expect: .init(
                initialized: false,
                notes: [
                    .init(path: renamed, text: welcomeText),
                    .init(path: moved, text: polishText),
                    .init(path: restored, text: roadmapText),
                ],
                folders: [["Projects"], ["Journal", "2026"]],
                order: [
                    .init(
                        parent: [],
                        names: ["Hello", "Empty folder", "Journal", "Projects", "Roadmap"])
                ],
                tags: [
                    .init(path: renamed, tag: .yellow),
                    .init(path: moved, tag: .purple),
                    .init(path: restored, tag: .blue),
                    .init(path: ["Journal", "2026", "January"], tag: .orange),
                ],
                trash: .init(count: 2, names: ["Whiteboard", "commitnote"]),
                deviceName: runtime.deviceModel))
        try ReadBackOutput.write(scenario, fileName: "organise.json", to: self)
    }

    func testImagesReadBack() async throws {
        let runtime = try await makeRuntime()
        try await runtime.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)
        let original = try await runtime.openNoteLoaded(["Welcome"])
        let photo = try TestImages.encode(
            TestImages.photo(width: 3000, height: 2000), as: .jpeg,
            properties: [kCGImageDestinationLossyCompressionQuality: 0.9])
        let gif = try TestImages.encode(TestImages.photo(width: 48, height: 32), as: .gif)

        let inputs = [
            runtime.core.stageImageInput(photo, type: "image/jpeg"),
            runtime.core.stageImageInput(gif, type: "image/gif"),
        ]
        let references = try await runtime.send(ImageInsert(inputs: inputs)).references
        XCTAssertEqual(references.count, 2)

        let text = "\(original)\n\(references.joined(separator: "\n"))\n"
        _ = try await runtime.send(NoteEdit(path: ["Welcome"], text: text))
        let flushed = try await runtime.send(SyncFlush()).result
        XCTAssertEqual(flushed, .saved)

        let scenario = ReadBackScenario(
            name: "ios images",
            passphrase: sampleNotesPassphrase,
            exported: try await runtime.exportRepo("sample/notes"),
            expect: .init(
                initialized: false,
                notes: [.init(path: ["Welcome"], text: text)],
                images: [
                    .init(reference: references[0], type: "image/webp"),
                    .init(reference: references[1], type: "image/gif"),
                ],
                deviceName: runtime.deviceModel))
        try ReadBackOutput.write(scenario, fileName: "images.json", to: self)
    }
}
