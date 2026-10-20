import EditorText
import Foundation
import NativeCoreAPI
import XCTest

final class EditingTests: RuntimeTestCase {
    private func failSaves(_ runtime: TestRuntime) async throws {
        _ = try await runtime.send(
            FakeFailNext(repo: "sample/notes", operation: "commit", kind: "Network", count: 50))
    }

    private func clearSaveFailures(_ runtime: TestRuntime) async throws {
        _ = try await runtime.send(FakeClearFailures(repo: "sample/notes", operation: "commit"))
    }

    func testFailedFlushReportsUnsavedAndRetrySaves() async throws {
        let runtime = try await makeRuntime()
        try await runtime.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)
        _ = try await runtime.openNoteLoaded(["Welcome"])
        try await failSaves(runtime)

        let index = await runtime.events.count
        _ = try await runtime.send(NoteEdit(path: ["Welcome"], text: "Edited offline"))
        let flushed = try await runtime.send(SyncFlush()).result
        XCTAssertEqual(flushed, .unsaved(count: 1))

        let event = try await runtime.events.wait(after: index, description: "a retryable sync state") {
            guard case .syncStateChanged(let changed) = $0 else { return false }
            return changed.canRetry
        }
        guard case .syncStateChanged(let changed) = event else { return XCTFail("No sync state") }
        XCTAssertEqual(changed.state, .outOfSync(.failed))

        try await clearSaveFailures(runtime)
        _ = try await runtime.send(SyncRetry())
        let outcome: FlushOutcome = try await poll(
            timeout: .seconds(30), interval: .milliseconds(200), description: "the retried save"
        ) {
            let outcome = try await runtime.send(SyncFlush()).result
            return outcome == .saved ? outcome : nil
        }
        XCTAssertEqual(outcome, .saved)
    }

    func testLogoutKeepsSessionWhileUnsavedUnlessForced() async throws {
        let runtime = try await makeRuntime()
        try await runtime.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)
        _ = try await runtime.openNoteLoaded(["Welcome"])
        try await failSaves(runtime)
        _ = try await runtime.send(NoteEdit(path: ["Welcome"], text: "Unsaved words"))

        let refused = try await runtime.send(SessionLogout(anyway: false)).outcome
        guard case .unsaved(let count, let message) = refused else {
            return XCTFail("Logout did not report unsaved notes: \(refused)")
        }
        XCTAssertEqual(count, 1)
        XCTAssertFalse(message.isEmpty)
        _ = try await runtime.send(TreeGet())

        let index = await runtime.events.count
        let forced = try await runtime.send(SessionLogout(anyway: true)).outcome
        XCTAssertEqual(forced, .loggedOut)
        _ = try await runtime.events.wait(after: index, description: "the session to end") {
            if case .sessionEnded = $0 { return true }
            return false
        }
    }

    func testExportWorksAfterKeyChangeWithUnsavedNotes() async throws {
        let runtime = try await makeRuntime()
        try await runtime.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)
        _ = try await runtime.openNoteLoaded(["Welcome"])

        let index = await runtime.events.count
        _ = try await runtime.send(FakeChangeRepoKey(repo: "sample/notes"))
        _ = try await runtime.send(NoteEdit(path: ["Welcome"], text: "Unsaved words"))
        _ = try await runtime.send(SyncFlush())

        let event = try await runtime.events.wait(after: index, description: "the key change") {
            if case .keyChanged = $0 { return true }
            return false
        }
        guard case .keyChanged(let changed) = event else { return XCTFail("No key change") }
        XCTAssertEqual(changed.unsavedCount, 1)
        XCTAssertEqual(changed.exportLabel, "Export unsaved notes")

        let archive = try await runtime.send(ExportNotes())
        XCTAssertEqual(archive.mimeType, "application/zip")
        XCTAssertNotNil(
            archive.fileName.range(
                of: #"^commitnote-export-\d{4}-\d{2}-\d{2}\.zip$"#, options: .regularExpression))
        let bytes = try XCTUnwrap(Data(base64Encoded: archive.base64))
        XCTAssertEqual(Array(bytes.prefix(4)), [0x50, 0x4B, 0x03, 0x04])
    }

    func testRemoteEditOfOpenNoteArrivesAsMinimalEdits() async throws {
        let runtime = try await makeRuntime()
        try await runtime.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)
        let original = try await runtime.openNoteLoaded(["Welcome"])
        let remoteText = original + "\nAppended remotely: zażółć 🙂\n"

        let index = await runtime.events.count
        _ = try await runtime.send(
            FakeRemoteEdit(
                repo: "sample/notes", path: ["Welcome"], text: remoteText, device: "Other iPhone"))
        _ = try await runtime.send(SyncRefresh())

        let event = try await runtime.events.wait(after: index, description: "the remote edit") {
            guard case .noteChanged(let changed) = $0 else { return false }
            return changed.edits != nil
        }
        guard case .noteChanged(let changed) = event,
            case .loaded(_, let content, _)? = changed.note,
            let edits = changed.edits
        else { return XCTFail("The event carried no edits") }

        XCTAssertEqual(content, remoteText)
        let applied = TextEdits.apply(
            edits.map { TextEdit(from: $0.from, to: $0.to, insert: $0.insert) }, to: original)
        XCTAssertEqual(applied, content)
    }
}
