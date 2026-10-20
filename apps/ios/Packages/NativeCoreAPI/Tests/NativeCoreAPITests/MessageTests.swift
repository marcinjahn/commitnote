import Foundation
import XCTest

@testable import NativeCoreAPI

final class MessageTests: XCTestCase {
    private func event(_ text: String) throws -> CoreEvent {
        guard case .event(let event) = try CoreMessage.decode(text) else {
            throw XCTSkip("not an event")
        }
        return event
    }

    func testCoreErrorShape() throws {
        let error = try JSONDecoder().decode(
            CoreError.self,
            from: Data(
                #"{"kind":"newerFormat","message":"m","transient":false,"formatVersion":2}"#.utf8))
        XCTAssertEqual(
            error,
            CoreError(kind: "newerFormat", message: "m", transient: false, formatVersion: 2))
        let limited = try JSONDecoder().decode(
            CoreError.self,
            from: Data(
                #"{"kind":"rateLimited","message":"m","transient":true,"retryAfterMs":1500}"#.utf8))
        XCTAssertEqual(limited.retryAfterMs, 1500)
        XCTAssertNil(limited.formatVersion)
        let unknown = try JSONDecoder().decode(
            CoreError.self, from: Data(#"{"kind":"brandNew","message":"m","transient":false}"#.utf8))
        XCTAssertEqual(unknown.kind, "brandNew")
    }

    func testSuccessResponse() throws {
        let message = try CoreMessage.decode(
            #"{"kind":"response","id":3,"ok":true,"result":{"name":"iPhone"}}"#)
        guard case .response(let id, let result) = message else { return XCTFail("response") }
        XCTAssertEqual(id, 3)
        XCTAssertEqual(try result.get(), .object(["name": .string("iPhone")]))
        XCTAssertEqual(try decodeResult(DeviceName.self, from: try result.get()).name, "iPhone")
    }

    func testErrorResponse() throws {
        let message = try CoreMessage.decode(
            #"""
            {"kind":"response","id":4,"ok":false,
            "error":{"kind":"notReady","message":"Something went wrong. Try again.","transient":false}}
            """#)
        guard case .response(let id, let result) = message else { return XCTFail("response") }
        XCTAssertEqual(id, 4)
        XCTAssertThrowsError(try result.get()) { error in
            XCTAssertEqual((error as? CoreError)?.kind, CoreError.Kind.notReady)
        }
    }

    func testUnknownRequestIdResponse() throws {
        let message = try CoreMessage.decode(
            #"""
            {"kind":"response","id":-1,"ok":false,
            "error":{"kind":"invalidParams","message":"Something went wrong. Try again.","transient":false}}
            """#)
        guard case .response(let id, .failure(let error)) = message else {
            return XCTFail("failure response")
        }
        XCTAssertEqual(id, -1)
        XCTAssertEqual(error.kind, CoreError.Kind.invalidParams)
    }

    func testEmptyResultObject() throws {
        let message = try CoreMessage.decode(#"{"kind":"response","id":1,"ok":true,"result":{}}"#)
        guard case .response(_, let result) = message else { return XCTFail("response") }
        XCTAssertEqual(try decodeResult(SyncRetry.self, from: try result.get()), Empty())
    }

    func testEvents() throws {
        XCTAssertEqual(
            try event(
                #"{"kind":"event","event":"loadingProgress","payload":{"step":"derivingKeys","message":"Deriving"}}"#
            ),
            .loadingProgress(LoadingProgress(step: .derivingKeys, message: "Deriving")))
        XCTAssertEqual(
            try event(
                #"""
                {"kind":"event","event":"treeChanged","payload":{"tree":[
                {"kind":"note","name":"A","path":["A"]}]}}
                """#),
            .treeChanged(try JSONDecoder().decode(
                TreeChanged.self, from: Data(#"{"tree":[{"kind":"note","name":"A","path":["A"]}]}"#.utf8))))
        XCTAssertEqual(
            try event(#"{"kind":"event","event":"treeChanged","payload":{"tree":null}}"#),
            .treeChanged(try JSONDecoder().decode(TreeChanged.self, from: Data(#"{"tree":null}"#.utf8))))
        XCTAssertEqual(
            try event(#"{"kind":"event","event":"noteChanged","payload":{"note":null}}"#).name,
            "noteChanged")
        guard
            case .noteChanged(let changed) = try event(
                #"{"kind":"event","event":"noteChanged","payload":{"note":{"state":"loaded","path":["A"],"content":"c","conflict":null},"edits":null}}"#
            )
        else { return XCTFail("noteChanged") }
        XCTAssertEqual(changed.note, .loaded(path: ["A"], content: "c", conflict: nil))
        XCTAssertNil(changed.edits)
        guard
            case .noteChanged(let withEdits) = try event(
                #"""
                {"kind":"event","event":"noteChanged","payload":{"note":{"state":"loaded","path":["A"],
                "content":"Hi there","conflict":{"otherDevice":"Other device",
                "heading":"This note was also changed on Other device","text":"t",
                "keepThisLabel":"Keep this device's version (iPhone)",
                "keepOtherLabel":"Keep other device's version (Other device)",
                "editMergedLabel":"Edit merged","editHint":"hint","merged":"<<<<<<< x","editing":true}},
                "edits":[{"from":2,"to":2,"insert":" there"}]}}
                """#)
        else { return XCTFail("noteChanged with edits") }
        XCTAssertEqual(withEdits.edits, [RemoteTextEdit(from: 2, to: 2, insert: " there")])
        guard case .loaded(_, _, let conflict?) = withEdits.note else {
            return XCTFail("conflict")
        }
        XCTAssertEqual(conflict.otherDevice, "Other device")
        XCTAssertEqual(conflict.keepOtherLabel, "Keep other device's version (Other device)")
        XCTAssertTrue(conflict.editing)
        XCTAssertEqual(
            try event(
                #"{"kind":"event","event":"noteContentChangedRemotely","payload":{"change":"relocated","message":"m"}}"#
            ),
            .noteContentChangedRemotely(RemoteNoteChange(change: .relocated, message: "m")))
        guard
            case .syncStateChanged(let sync) = try event(
                #"""
                {"kind":"event","event":"syncStateChanged","payload":{"online":true,"refreshing":false,
                "treeLoaded":true,"lastRefreshError":{"kind":"network","message":"m","transient":true},
                "state":{"kind":"out-of-sync","reason":"failed"},"label":"Out of sync: failed to save",
                "status":"Out of sync: failed to save","unsavedCount":1,"canRetry":true,
                "unsavedMenu":[{"id":"note-0","label":"Welcome","path":["Welcome"]},
                {"id":"retry","label":"Retry now","path":null}]}}
                """#)
        else { return XCTFail("syncStateChanged") }
        XCTAssertTrue(sync.online)
        XCTAssertFalse(sync.refreshing)
        XCTAssertTrue(sync.treeLoaded)
        XCTAssertEqual(sync.lastRefreshError?.kind, "network")
        XCTAssertEqual(sync.state, .outOfSync(.failed))
        XCTAssertEqual(sync.label, "Out of sync: failed to save")
        XCTAssertEqual(sync.status, "Out of sync: failed to save")
        XCTAssertEqual(sync.unsavedCount, 1)
        XCTAssertTrue(sync.canRetry)
        XCTAssertEqual(
            sync.unsavedMenu,
            [
                SyncStatusMenuItem(id: "note-0", label: "Welcome", path: ["Welcome"]),
                SyncStatusMenuItem(id: "retry", label: "Retry now", path: nil),
            ])
        guard
            case .syncStateChanged(let clean) = try event(
                #"{"kind":"event","event":"syncStateChanged","payload":{"online":false,"refreshing":true,"treeLoaded":false,"lastRefreshError":null,"state":{"kind":"synced"},"label":"Synced","status":null,"unsavedCount":0,"canRetry":false,"unsavedMenu":[{"id":"none","label":"No unsaved changes","path":null}]}}"#
            )
        else { return XCTFail("syncStateChanged") }
        XCTAssertNil(clean.lastRefreshError)
        XCTAssertEqual(clean.state, .synced)
        XCTAssertNil(clean.status)
        XCTAssertFalse(clean.canRetry)
        XCTAssertEqual(
            try event(
                #"{"kind":"event","event":"notice","payload":{"id":"engine-1","tone":"warning","message":"m","persistent":true,"action":{"kind":"openNote","label":"Open note","path":["A"]}}}"#
            ),
            .notice(
                Notice(
                    id: "engine-1", tone: .warning, message: "m", persistent: true,
                    action: NoticeAction(kind: .openNote, label: "Open note", path: ["A"]))))
        XCTAssertEqual(
            try event(
                #"{"kind":"event","event":"notice","payload":{"id":"x","tone":"info","message":"m","persistent":false,"action":null}}"#
            ),
            .notice(Notice(id: "x", tone: .info, message: "m", persistent: false, action: nil)))
        XCTAssertEqual(
            try event(#"{"kind":"event","event":"noticeCleared","payload":{"id":"refresh"}}"#),
            .noticeCleared(NoticeCleared(id: "refresh")))
        XCTAssertEqual(
            try event(
                #"{"kind":"event","event":"keyChanged","payload":{"unsavedCount":2,"message":"m","detail":"d","exportLabel":"Export unsaved notes"}}"#
            ),
            .keyChanged(
                KeyChanged(
                    unsavedCount: 2, message: "m", detail: "d", exportLabel: "Export unsaved notes")))
        XCTAssertEqual(
            try event(#"{"kind":"event","event":"sessionEnded","payload":{"reason":"loggedOut"}}"#),
            .sessionEnded(SessionEnded(reason: .loggedOut)))
    }

    func testAllLoadingStepsAndTonesDecode() throws {
        for step in ["listingRepositories", "checkingRepository", "derivingKeys", "initializing"] {
            XCTAssertNotNil(LoadingStep(rawValue: step))
        }
        for tone in ["info", "warning", "error", "success"] {
            XCTAssertNotNil(NoticeTone(rawValue: tone))
        }
    }

    func testUnknownEventIsTolerated() throws {
        XCTAssertEqual(
            try event(#"{"kind":"event","event":"somethingNew","payload":{"x":1}}"#),
            .unknown(name: "somethingNew"))
    }

    func testEventNameMatchesCase() throws {
        XCTAssertEqual(CoreEvent.knownNames.count, 9)
        XCTAssertEqual(
            CoreEvent.noticeCleared(NoticeCleared(id: "x")).name, "noticeCleared")
    }
}
