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
                {"kind":"note","name":"A","path":["A"],"colorTag":"blue","shared":true}],
                "tagFilter":"blue","usedTags":["blue","red"],"tagsWritable":true,
                "tagOptions":[{"tag":"red","label":"Red"},{"tag":"blue","label":"Blue"}]}}
                """#),
            .treeChanged(
                TreeChanged(
                    tree: [.note(name: "A", path: ["A"], colorTag: .blue, shared: true)],
                    tagFilter: .blue, usedTags: [.blue, .red], tagsWritable: true,
                    tagOptions: [
                        TagOption(tag: .red, label: "Red"), TagOption(tag: .blue, label: "Blue"),
                    ])))
        XCTAssertEqual(
            try event(
                #"{"kind":"event","event":"treeChanged","payload":{"tree":null,"tagFilter":null,"usedTags":[],"tagsWritable":false,"tagOptions":[]}}"#
            ),
            .treeChanged(
                TreeChanged(
                    tree: nil, tagFilter: nil, usedTags: [], tagsWritable: false, tagOptions: [])))
        XCTAssertEqual(
            try event(
                #"""
                {"kind":"event","event":"trashChanged","payload":{"entries":[
                {"id":"e1","kind":"folder","name":"F","originalFolder":"Top level","daysLeft":"29 days left","colorTag":null,
                "children":[{"kind":"note","name":"N","subPath":["N"],"children":[]}]}],
                "deleteConfirmation":{"title":"Delete permanently?","message":"d"},
                "emptyConfirmation":{"title":"Empty trash?","message":"e"}}}
                """#),
            .trashChanged(
                TrashChanged(
                    entries: [
                        TrashEntryView(
                            id: "e1", kind: .folder, name: "F", originalFolder: "Top level",
                            daysLeft: "29 days left", colorTag: nil,
                            children: [
                                TrashItemView(kind: .note, name: "N", subPath: ["N"], children: [])
                            ])
                    ],
                    deleteConfirmation: TrashConfirmationText(title: "Delete permanently?", message: "d"),
                    emptyConfirmation: TrashConfirmationText(title: "Empty trash?", message: "e"))))
        XCTAssertEqual(
            try event(
                #"{"kind":"event","event":"searchStatusChanged","payload":{"status":"Indexing","progress":0.5,"partial":true}}"#
            ),
            .searchStatusChanged(SearchStatusChanged(status: "Indexing", progress: 0.5, partial: true)))
        XCTAssertEqual(
            try event(
                #"{"kind":"event","event":"searchStatusChanged","payload":{"status":null,"progress":null,"partial":false}}"#
            ),
            .searchStatusChanged(SearchStatusChanged(status: nil, progress: nil, partial: false)))
        XCTAssertEqual(
            try event(#"{"kind":"event","event":"noteChanged","payload":{"note":null}}"#).name,
            "noteChanged")
        guard
            case .noteChanged(let changed) = try event(
                #"{"kind":"event","event":"noteChanged","payload":{"note":{"state":"loaded","path":["A"],"content":"c","conflict":null,"colorTag":"green","shared":true},"edits":null}}"#
            )
        else { return XCTFail("noteChanged") }
        XCTAssertEqual(changed.note, .loaded(path: ["A"], content: "c", conflict: nil, colorTag: .green, shared: true))
        XCTAssertNil(changed.edits)
        guard
            case .noteChanged(let withEdits) = try event(
                #"""
                {"kind":"event","event":"noteChanged","payload":{"note":{"state":"loaded","path":["A"],
                "content":"Hi there","conflict":{"otherDevice":"Other device",
                "heading":"This note was also changed on Other device","text":"t",
                "keepThisLabel":"Keep this device's version (iPhone)",
                "keepOtherLabel":"Keep other device's version (Other device)",
                "editMergedLabel":"Edit merged","editHint":"hint","merged":"<<<<<<< x","editing":true},"colorTag":null,"shared":false},
                "edits":[{"from":2,"to":2,"insert":" there"}]}}
                """#)
        else { return XCTFail("noteChanged with edits") }
        XCTAssertEqual(withEdits.edits, [RemoteTextEdit(from: 2, to: 2, insert: " there")])
        guard case .loaded(_, _, let conflict?, _, _) = withEdits.note else {
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
                #"{"kind":"event","event":"notice","payload":{"id":"u","tone":"success","message":"m","persistent":false,"action":{"kind":"undo","label":"Undo"}}}"#
            ),
            .notice(
                Notice(
                    id: "u", tone: .success, message: "m", persistent: false,
                    action: NoticeAction(kind: .undo, label: "Undo"))))
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

    func testHistoryChangedEvents() throws {
        XCTAssertEqual(
            try event(#"{"kind":"event","event":"historyChanged","payload":{"history":null}}"#),
            .historyChanged(HistoryChanged(history: nil)))
        let text =
            #"""
            {"kind":"event","event":"historyChanged","payload":{"history":{"path":["a","n"],"phase":"ready","message":null,
            "sections":[{"title":"Today","rows":[
            {"kind":"single","version":{"sha":"s1","time":"10:00","dateTime":"1 Jan 2026, 10:00","current":true,"shared":false,"events":["Edited"],"name":null}},
            {"kind":"session","title":"3 edits","shared":true,"versions":[{"sha":"s2","time":"09:00","dateTime":"1 Jan 2026, 09:00","current":false,"shared":true,"events":[],"name":"Old"}]}]}],
            "loading":false,"error":null,"end":"That is the start of this note.","canLoadMore":false}}}
            """#
        guard case .historyChanged(let changed) = try event(text), let history = changed.history
        else { return XCTFail("history") }
        XCTAssertEqual(history.path, ["a", "n"])
        XCTAssertEqual(history.phase, .ready)
        XCTAssertNil(history.message)
        XCTAssertEqual(history.end, "That is the start of this note.")
        XCTAssertEqual(history.sections.count, 1)
        XCTAssertEqual(history.sections[0].rows.count, 2)
        guard case .session(let title, let shared, let versions) = history.sections[0].rows[1]
        else { return XCTFail("session") }
        XCTAssertEqual(title, "3 edits")
        XCTAssertTrue(shared)
        XCTAssertEqual(versions.map(\.id), ["s2"])
        XCTAssertEqual(versions[0].name, "Old")
    }

    func testSharesChangedEvent() throws {
        let copy =
            #"{"explanation":"e","labelField":"lf","passwordField":"pf","passwordHint":"ph","create":"c","creating":"cg","createAnother":"ca","shareLink":"sl","sharePassword":"sp","sharedLinksTitle":"st","sharedLinksEmpty":"se","passwordProtected":"pp","updating":"u","linkCopied":"lc","passwordCopied":"pc","revoke":{"title":"rt","message":"rm","confirmLabel":"rc"},"rename":{"title":"nt","fieldLabel":"nf","confirmLabel":"nc"},"sharedVersionTitle":"sv","loadingSharedVersion":"ls"}"#
        let text =
            #"""
            {"kind":"event","event":"sharesChanged","payload":{"shares":[{"id":"i","title":"n","label":null,"date":"1 Jan 2026","passwordProtected":true,"link":"https://e.test/#x","password":"p","notePath":["n"],"menuLabel":"Actions for n","actions":[{"id":"copy-link","label":"Copy link","disabled":false,"destructive":false},{"id":"revoke","label":"Revoke","disabled":true,"destructive":true}]}],"unreadable":null,"updatingId":"i","copy":\#(copy)}}
            """#
        guard case .sharesChanged(let changed) = try event(text) else { return XCTFail("shares") }
        XCTAssertEqual(changed.updatingId, "i")
        XCTAssertNil(changed.unreadable)
        XCTAssertEqual(changed.shares.count, 1)
        XCTAssertEqual(changed.shares[0].notePath, ["n"])
        XCTAssertNil(changed.shares[0].label)
        XCTAssertEqual(changed.shares[0].actions.map(\.id), [.copyLink, .revoke])
        XCTAssertEqual(changed.shares[0].actions[1].destructive, true)
        XCTAssertEqual(changed.copy.revoke, ShareCopy.RevokeCopy(title: "rt", message: "rm", confirmLabel: "rc"))
        XCTAssertEqual(changed.copy.rename.fieldLabel, "nf")
        XCTAssertEqual(changed.copy.loadingSharedVersion, "ls")
        let data = try JSONEncoder().encode(changed)
        XCTAssertEqual(try JSONDecoder().decode(SharesChanged.self, from: data), changed)
        XCTAssertEqual(
            try event(
                #"{"kind":"event","event":"sharesChanged","payload":{"shares":[],"unreadable":"u","updatingId":null,"copy":\#(copy)}}"#
            ).name, "sharesChanged")
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
        XCTAssertEqual(CoreEvent.knownNames.count, 17)
        XCTAssertEqual(
            CoreEvent.noticeCleared(NoticeCleared(id: "x")).name, "noticeCleared")
    }
}
