import Foundation
import NativeCoreAPI
import UIKit
import XCTest

final class OrganisationTests: RuntimeTestCase {
    private let whiteboard = ["Journal", "2026", "Whiteboard"]
    private let zazolc = ["Zażółć gęślą jaźń"]

    private func topLevelNames(_ nodes: [TreeNode]) -> [String] {
        nodes.map {
            switch $0 {
            case .note(let name, _, _, _): name
            case .folder(let name, _, _, _): name
            }
        }
    }

    private func colorTag(of path: [String], in nodes: [TreeNode]) -> ColorTag? {
        for node in nodes {
            switch node {
            case .note(_, let notePath, let tag, _) where notePath == path:
                return tag
            case .folder(_, _, _, let children):
                if let tag = colorTag(of: path, in: children) { return tag }
            default:
                continue
            }
        }
        return nil
    }

    func testImageReadDecodesWithSystemDecoder() async throws {
        let runtime = try await makeRuntime()
        try await runtime.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)
        let text = try await runtime.openNoteLoaded(whiteboard)

        let pattern = try NSRegularExpression(pattern: #"image:([a-z2-7]{26})#(\d+)x(\d+)"#)
        let match = try XCTUnwrap(
            pattern.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)))
        func group(_ index: Int) throws -> String {
            String(text[try XCTUnwrap(Range(match.range(at: index), in: text))])
        }
        let imageId = try group(1)
        let width = try XCTUnwrap(Int(try group(2)))
        let height = try XCTUnwrap(Int(try group(3)))

        let payload = try await runtime.send(ImageRead(imageId: imageId)).image
        let image = try XCTUnwrap(payload)
        XCTAssertEqual(image.type, .webp)
        let data = try XCTUnwrap(Data(base64Encoded: image.base64))
        let decoded = try XCTUnwrap(UIImage(data: data)?.cgImage)
        XCTAssertEqual(decoded.width, width)
        XCTAssertEqual(decoded.height, height)

        let unknown = String(repeating: "a", count: 26)
        let missing = try await runtime.send(ImageRead(imageId: unknown)).image
        XCTAssertNil(missing)
    }

    func testTrashAndUndo() async throws {
        let runtime = try await makeRuntime()
        try await runtime.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)

        let index = await runtime.events.count
        let outcome = try await runtime.send(NodeTrash(path: zazolc, shareCount: 0)).outcome
        guard case .trashed = outcome else { return XCTFail("The note was not trashed: \(outcome)") }

        let trashEvent = try await runtime.events.wait(after: index, description: "the trash entry") {
            guard case .trashChanged(let changed) = $0 else { return false }
            return changed.entries.contains { $0.name == "Zażółć gęślą jaźń" }
        }
        guard case .trashChanged = trashEvent else { return XCTFail("No trash event") }

        let noticeEvent = try await runtime.events.wait(after: index, description: "the undo notice") {
            guard case .notice(let notice) = $0 else { return false }
            return notice.action?.kind == .undo
        }
        guard case .notice(let notice) = noticeEvent else { return XCTFail("No notice") }

        let afterTrash = await runtime.events.count
        _ = try await runtime.send(NoticesPerform(id: notice.id))
        let restored = try await runtime.events.wait(after: afterTrash, description: "the restored note") {
            guard case .treeChanged(let changed) = $0, let tree = changed.tree else { return false }
            return notePaths(in: tree).contains(self.zazolc)
        }
        guard case .treeChanged = restored else { return XCTFail("No tree event") }
    }

    func testPlaceAndColorTag() async throws {
        let runtime = try await makeRuntime()
        try await runtime.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)

        let placeIndex = await runtime.events.count
        let placed = try await runtime.send(
            NodePlace(path: zazolc, parent: [], before: "Welcome")
        ).outcome
        XCTAssertEqual(placed, .ok(path: zazolc))
        let placedEvent = try await runtime.events.wait(after: placeIndex, description: "the new order") {
            guard case .treeChanged(let changed) = $0, let tree = changed.tree else { return false }
            let names = self.topLevelNames(tree)
            guard let polish = names.firstIndex(of: "Zażółć gęślą jaźń"),
                let welcome = names.firstIndex(of: "Welcome")
            else { return false }
            return polish < welcome
        }
        guard case .treeChanged(let placedChange) = placedEvent, let placedTree = placedChange.tree
        else { return XCTFail("No tree event") }
        let names = topLevelNames(placedTree)
        let polishIndex = try XCTUnwrap(names.firstIndex(of: "Zażółć gęślą jaźń"))
        let welcomeIndex = try XCTUnwrap(names.firstIndex(of: "Welcome"))
        XCTAssertLessThan(polishIndex, welcomeIndex)

        let tagIndex = await runtime.events.count
        let tagged = try await runtime.send(NodeSetColorTag(path: ["Welcome"], tag: .green)).outcome
        XCTAssertEqual(tagged, .ok(path: ["Welcome"]))
        let taggedEvent = try await runtime.events.wait(after: tagIndex, description: "the tagged note") {
            guard case .treeChanged(let changed) = $0, let tree = changed.tree else { return false }
            return self.colorTag(of: ["Welcome"], in: tree) == .green
        }
        guard case .treeChanged(let taggedChange) = taggedEvent else { return XCTFail("No tree event") }
        XCTAssertTrue(taggedChange.usedTags.contains(.green))
    }

    func testSearchFindsContent() async throws {
        let runtime = try await makeRuntime()
        try await runtime.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)

        let index = await runtime.events.count
        _ = try await runtime.send(SearchOpen())
        _ = try await runtime.events.wait(after: index, description: "the search index") {
            guard case .searchStatusChanged(let changed) = $0 else { return false }
            return changed.status == nil && !changed.partial
        }

        let results = try await runtime.send(SearchQuery(query: "encrypted")).results
        let row = try XCTUnwrap(results.contents.first { $0.path == ["Welcome"] })
        let snippet = try XCTUnwrap(row.snippet)
        XCTAssertTrue(snippet.contains { $0.match })
        _ = try await runtime.send(SearchClose())
    }

    func testLastViewRoundTrip() async throws {
        let services = newServices()
        let first = try await makeRuntime(services: services)
        try await first.logIn(repo: "sample/notes", passphrase: sampleNotesPassphrase)
        let saved = LastView(note: ["Welcome"], folders: [["Journal"]])
        _ = try await first.send(LastViewSave(note: saved.note, folders: saved.folders))
        let persisted: LastView = try await poll(
            timeout: .seconds(30), interval: .milliseconds(100), description: "the saved last view"
        ) {
            let view = try await first.send(LastViewLoad()).view
            return view == saved ? view : nil
        }
        XCTAssertEqual(persisted, saved)
        await first.stop()

        let second = try await makeRuntime(services: services)
        let resumed = try await second.send(SessionResume())
        XCTAssertEqual(resumed, .resumed)
        _ = try await second.waitForTree()
        let view = try await second.send(LastViewLoad()).view
        XCTAssertEqual(view, saved)
    }
}
