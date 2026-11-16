import Foundation
import NativeCoreAPI
import XCTest

final class SampleNotesRepoTests: RuntimeTestCase {
    func testWholeSampleNotesRepoDecrypts() async throws {
        let runtime = try await makeRuntime()
        let tree = try await runtime.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)

        let expected = try await runtime.send(FakeExpectedSampleNotes()).notes
        let paths = notePaths(in: tree)
        XCTAssertEqual(Set(paths.map(pathKey)), Set(expected.map { pathKey($0.path) }))
        XCTAssertEqual(paths.count, expected.count)

        var actual: [String: String] = [:]
        for path in paths {
            actual[pathKey(path)] = try await runtime.openNoteLoaded(path)
        }
        for note in expected {
            XCTAssertEqual(actual[pathKey(note.path)], note.text)
        }
    }
}
