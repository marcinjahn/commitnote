import Foundation
import XCTest

@testable import NativeCoreAPI

final class CommandTests: XCTestCase {
    private func json(_ text: String) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
    }

    private func params<C: NativeCoreCommand>(_ command: C) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(command))
    }

    private func result<C: NativeCoreCommand>(_ type: C.Type, _ text: String) throws -> C.Result {
        try decodeResult(type, from: try json(text))
    }

    private let repository = RepositoryView(
        label: "sample/notes", url: "https://example.test/sample/notes", private: true,
        publicWarning: nil)
    private let repositoryJSON =
        #"{"label":"sample/notes","url":"https://example.test/sample/notes","private":true,"publicWarning":null}"#

    func testEmptyParamsEncodeAsEmptyObject() throws {
        let empty = try json("{}")
        XCTAssertEqual(try params(ForgesList()), empty)
        XCTAssertEqual(try params(LoginLastRepository()), empty)
        XCTAssertEqual(try params(SessionResume()), empty)
        XCTAssertEqual(try params(SyncRetry()), empty)
        XCTAssertEqual(try params(SyncFlush()), empty)
        XCTAssertEqual(try params(DraftLeave()), empty)
        XCTAssertEqual(try params(ExportNotes()), empty)
        XCTAssertEqual(try params(TreeGet()), empty)
        XCTAssertEqual(try params(SyncRefresh()), empty)
        XCTAssertEqual(try params(DeviceName()), empty)
    }

    func testParams() throws {
        XCTAssertEqual(
            try params(LoginListRepositories(forge: .github, accessToken: "t")),
            try json(#"{"forge":"github","accessToken":"t"}"#))
        XCTAssertEqual(
            try params(LoginInspectRepository(forge: .gitlab, accessToken: "t", repositoryUrl: "u")),
            try json(#"{"forge":"gitlab","accessToken":"t","repositoryUrl":"u"}"#))
        XCTAssertEqual(
            try params(LoginUnlock(passphrase: "p")), try json(#"{"passphrase":"p"}"#))
        XCTAssertEqual(
            try params(LoginInitialize(passphrase: "p")), try json(#"{"passphrase":"p"}"#))
        XCTAssertEqual(
            try params(PassphraseStrengthCheck(passphrase: "p", repositoryLabel: "a/b")),
            try json(#"{"passphrase":"p","repositoryLabel":"a/b"}"#))
        XCTAssertEqual(
            try params(NoteOpen(path: ["a", "b.md"])), try json(#"{"path":["a","b.md"]}"#))
        XCTAssertEqual(try params(NoteOpen(path: nil)), try json(#"{"path":null}"#))
        XCTAssertEqual(
            try params(LifecycleSetVisible(visible: false)), try json(#"{"visible":false}"#))
        XCTAssertEqual(
            try params(LifecycleSetOnline(online: true)), try json(#"{"online":true}"#))
        XCTAssertEqual(try params(NoticesDismiss(id: "refresh")), try json(#"{"id":"refresh"}"#))
        XCTAssertEqual(
            try params(SessionLogout(anyway: true)), try json(#"{"anyway":true}"#))
        XCTAssertEqual(
            try params(NoteEdit(path: ["a"], text: "t")), try json(#"{"path":["a"],"text":"t"}"#))
        XCTAssertEqual(
            try params(ConflictResolve(path: ["a"], resolution: .keepMine)),
            try json(#"{"path":["a"],"resolution":"keepMine"}"#))
        XCTAssertEqual(
            try params(ConflictResolve(path: ["a"], resolution: .keepTheirs)),
            try json(#"{"path":["a"],"resolution":"keepTheirs"}"#))
        XCTAssertEqual(
            try params(ConflictResolve(path: [], resolution: .editMerged)),
            try json(#"{"path":[],"resolution":"editMerged"}"#))
        XCTAssertEqual(
            try params(DraftStart(parent: [])), try json(#"{"parent":[]}"#))
        XCTAssertEqual(
            try params(DraftCommitName(name: "n")), try json(#"{"name":"n"}"#))
        XCTAssertEqual(
            try params(DraftContent(name: "n", content: "c")),
            try json(#"{"name":"n","content":"c"}"#))
        XCTAssertEqual(
            try params(FolderCreate(parent: ["a"], name: "n")),
            try json(#"{"parent":["a"],"name":"n"}"#))
    }

    func testRequestEncoding() throws {
        let text = try CoreRequest(id: 7, command: LoginUnlock(passphrase: "p")).jsonString()
        XCTAssertEqual(
            try json(text),
            try json(#"{"id":7,"command":"login.unlock","params":{"passphrase":"p"}}"#))
        let empty = try CoreRequest(id: 1, command: TreeGet()).jsonString()
        XCTAssertEqual(
            try json(empty), try json(#"{"id":1,"command":"tree.get","params":{}}"#))
    }

    func testForgesAndRepositoryResults() throws {
        let forges = try result(
            ForgesList.self,
            #"""
            {"forges":[{"id":"github","name":"GitHub","accessTokenHint":"hint",
            "accessTokenCreationUrl":"https://a.test/token","repositoryCreationUrl":"https://a.test/new"}]}
            """#)
        XCTAssertEqual(forges.forges.count, 1)
        XCTAssertEqual(forges.forges[0].id, .github)
        XCTAssertEqual(forges.forges[0].accessTokenCreationUrl, "https://a.test/token")
        XCTAssertEqual(forges.forges[0].repositoryCreationUrl, "https://a.test/new")

        let last = try result(
            LoginLastRepository.self, #"{"repoUrl":"https://a.test/x/y","forge":"gitlab"}"#)
        XCTAssertEqual(last.repoUrl, "https://a.test/x/y")
        XCTAssertEqual(last.forge, .gitlab)
        let none = try result(LoginLastRepository.self, #"{"repoUrl":null,"forge":null}"#)
        XCTAssertNil(none.repoUrl)
        XCTAssertNil(none.forge)

        let listed = try result(
            LoginListRepositories.self,
            #"{"repositories":[{"url":"u","label":"a/b","private":false}]}"#)
        XCTAssertEqual(listed.repositories, [RepositoryListing(url: "u", label: "a/b", private: false)])
    }

    func testInspectionResults() throws {
        XCTAssertEqual(
            try result(
                LoginInspectRepository.self, #"{"kind":"notesRepo","repository":\#(repositoryJSON)}"#),
            .notesRepo(repository: repository))
        XCTAssertEqual(
            try result(
                LoginInspectRepository.self,
                #"{"kind":"uninitialized","repository":\#(repositoryJSON),"setUpDescription":"d"}"#),
            .uninitialized(repository: repository, setUpDescription: "d"))

        let publicJSON =
            #"{"label":"a/b","url":"u","private":false,"publicWarning":"Public!"}"#
        let unusable = try result(
            LoginInspectRepository.self,
            #"""
            {"kind":"unusable","repository":\#(publicJSON),
            "error":{"kind":"foreign","message":"m","transient":false},
            "canCheckAgain":true,"foreignHint":"hint"}
            """#)
        XCTAssertEqual(
            unusable,
            .unusable(
                repository: RepositoryView(
                    label: "a/b", url: "u", private: false, publicWarning: "Public!"),
                error: CoreError(kind: CoreError.Kind.foreign, message: "m", transient: false),
                canCheckAgain: true, foreignHint: "hint"))

        let noHint = try result(
            LoginInspectRepository.self,
            #"""
            {"kind":"unusable","repository":\#(repositoryJSON),
            "error":{"kind":"unauthorized","message":"m","transient":false},
            "canCheckAgain":false,"foreignHint":null}
            """#)
        guard case .unusable(_, _, let canCheckAgain, let hint) = noHint else {
            return XCTFail("expected unusable")
        }
        XCTAssertFalse(canCheckAgain)
        XCTAssertNil(hint)
    }

    func testLoginAndStrengthResults() throws {
        XCTAssertEqual(try result(LoginUnlock.self, #"{"kind":"loggedIn"}"#).kind, "loggedIn")
        XCTAssertEqual(try result(LoginInitialize.self, #"{"kind":"loggedIn"}"#).kind, "loggedIn")
        let strength = try result(
            PassphraseStrengthCheck.self,
            #"{"score":3,"label":"Good","filledSegments":3,"weak":false,"warning":""}"#)
        XCTAssertEqual(
            strength,
            PassphraseStrength(
                score: 3, label: "Good", filledSegments: 3, weak: false, warning: ""))
    }

    func testResumeResults() throws {
        XCTAssertEqual(try result(SessionResume.self, #"{"kind":"none"}"#), .none)
        XCTAssertEqual(try result(SessionResume.self, #"{"kind":"resumed"}"#), .resumed)
        XCTAssertEqual(
            try result(
                SessionResume.self,
                #"""
                {"kind":"failed","error":{"kind":"network","message":"m","transient":true,
                "retryAfterMs":500},"canRetry":true}
                """#),
            .failed(
                error: CoreError(
                    kind: CoreError.Kind.network, message: "m", transient: true, retryAfterMs: 500),
                canRetry: true))
    }

    func testEmptyResults() throws {
        XCTAssertEqual(try result(NoteEdit.self, "{}"), Empty())
        XCTAssertEqual(try result(SyncRetry.self, "{}"), Empty())
        XCTAssertEqual(try result(ConflictResolve.self, "{}"), Empty())
        XCTAssertEqual(try result(DraftLeave.self, "{}"), Empty())
        XCTAssertEqual(try result(SyncRefresh.self, "{}"), Empty())
        XCTAssertEqual(try result(LifecycleSetVisible.self, "{}"), Empty())
        XCTAssertEqual(try result(LifecycleSetOnline.self, "{}"), Empty())
        XCTAssertEqual(try result(NoticesDismiss.self, "{}"), Empty())
        XCTAssertEqual(try result(DeviceName.self, #"{"name":"iPhone"}"#).name, "iPhone")
    }

    func testTreeResults() throws {
        let tree = try result(
            TreeGet.self,
            #"""
            {"tree":[{"kind":"folder","name":"Work","path":["Work"],"noteCount":1,"children":[
            {"kind":"note","name":"Plan","path":["Work","Plan"]}]},
            {"kind":"note","name":"Inbox","path":["Inbox"]}]}
            """#)
        XCTAssertEqual(
            tree.tree,
            [
                .folder(
                    name: "Work", path: ["Work"], noteCount: 1,
                    children: [.note(name: "Plan", path: ["Work", "Plan"])]),
                .note(name: "Inbox", path: ["Inbox"]),
            ])
        XCTAssertNil(try result(TreeGet.self, #"{"tree":null}"#).tree)
    }

    func testNoteOpenResults() throws {
        let path = #""path":["a","b"]"#
        XCTAssertNil(try result(NoteOpen.self, #"{"note":null}"#).note)
        XCTAssertEqual(
            try result(NoteOpen.self, #"{"note":{"state":"loading",\#(path)}}"#).note,
            .loading(path: ["a", "b"]))
        XCTAssertEqual(
            try result(NoteOpen.self, ##"{"note":{"state":"loaded",\##(path),"content":"# hi","conflict":null}}"##).note,
            .loaded(path: ["a", "b"], content: "# hi", conflict: nil))
        XCTAssertEqual(
            try result(NoteOpen.self, #"{"note":{"state":"missing",\#(path),"message":"gone"}}"#).note,
            .missing(path: ["a", "b"], message: "gone"))
        XCTAssertEqual(
            try result(NoteOpen.self, #"{"note":{"state":"trashed",\#(path),"message":"bin"}}"#).note,
            .trashed(path: ["a", "b"], message: "bin"))
        XCTAssertEqual(
            try result(
                NoteOpen.self,
                #"""
                {"note":{"state":"failed",\#(path),"message":"oops",
                "error":{"kind":"undecryptable","message":"m","transient":false}}}
                """#
            ).note,
            .failed(
                path: ["a", "b"], message: "oops",
                error: CoreError(kind: CoreError.Kind.undecryptable, message: "m", transient: false)))
    }

    private let conflict = OpenNoteConflict(
        otherDevice: "Other", heading: "h", text: "t", keepThisLabel: "k1", keepOtherLabel: "k2",
        editMergedLabel: "Edit merged", editHint: "hint", merged: "<<<<<<<", editing: false)

    func testOpenNoteRoundTrip() throws {
        let notes: [OpenNote] = [
            .loading(path: ["a"]),
            .loaded(path: ["a"], content: "x", conflict: nil),
            .loaded(path: ["a"], content: "x", conflict: conflict),
            .missing(path: ["a"], message: "m"),
            .trashed(path: ["a"], message: "m"),
            .failed(
                path: ["a"], message: "m",
                error: CoreError(kind: "network", message: "e", transient: true)),
        ]
        for note in notes {
            let data = try JSONEncoder().encode(note)
            XCTAssertEqual(try JSONDecoder().decode(OpenNote.self, from: data), note)
        }
    }

    func testCommandResultDecodingFailsOnWrongShape() throws {
        XCTAssertThrowsError(try result(DeviceName.self, #"{"nombre":"x"}"#))
    }

    func testEditingResults() throws {
        XCTAssertEqual(
            try result(SyncFlush.self, #"{"result":{"kind":"saved"}}"#).result, .saved)
        XCTAssertEqual(
            try result(SyncFlush.self, #"{"result":{"kind":"unsaved","count":2}}"#).result,
            .unsaved(count: 2))
        XCTAssertEqual(
            try result(DraftStart.self, #"{"draft":{"parent":["a"],"name":""}}"#).draft,
            NoteDraft(parent: ["a"], name: ""))
        XCTAssertEqual(
            try result(DraftCommitName.self, #"{"outcome":{"kind":"none"}}"#).outcome, .none)
        XCTAssertEqual(
            try result(DraftCommitName.self, #"{"outcome":{"kind":"error","message":"m"}}"#).outcome,
            .error(message: "m"))
        XCTAssertEqual(
            try result(
                DraftContent.self,
                #"{"outcome":{"kind":"created","path":["a","n"],"fieldError":null}}"#
            ).outcome,
            .created(path: ["a", "n"], fieldError: nil))
        XCTAssertEqual(
            try result(
                DraftContent.self,
                #"{"outcome":{"kind":"created","path":["n"],"fieldError":"bad"}}"#
            ).outcome,
            .created(path: ["n"], fieldError: "bad"))
        XCTAssertEqual(
            try result(FolderCreate.self, #"{"outcome":{"kind":"created","path":["a","f"]}}"#)
                .outcome,
            .created(path: ["a", "f"]))
        XCTAssertEqual(
            try result(FolderCreate.self, #"{"outcome":{"kind":"error","message":"m"}}"#).outcome,
            .error(message: "m"))
        XCTAssertEqual(
            try result(SessionLogout.self, #"{"outcome":{"kind":"loggedOut"}}"#).outcome,
            .loggedOut)
        XCTAssertEqual(
            try result(
                SessionLogout.self, #"{"outcome":{"kind":"unsaved","count":3,"message":"m"}}"#
            ).outcome,
            .unsaved(count: 3, message: "m"))
        XCTAssertEqual(
            try result(
                ExportNotes.self,
                #"{"fileName":"commitnote-export-2026-01-02.zip","mimeType":"application/zip","base64":"UEs="}"#
            ),
            ExportedArchive(fileName: "commitnote-export-2026-01-02.zip", base64: "UEs="))
    }

    func testNewShapesRoundTrip() throws {
        func roundTrip<T: Codable & Equatable>(_ value: T) throws {
            let data = try JSONEncoder().encode(value)
            XCTAssertEqual(try JSONDecoder().decode(T.self, from: data), value)
        }
        try roundTrip(FlushOutcome.saved)
        try roundTrip(FlushOutcome.unsaved(count: 1))
        try roundTrip(LogoutOutcome.loggedOut)
        try roundTrip(LogoutOutcome.unsaved(count: 1, message: "m"))
        try roundTrip(NoteDraft(parent: [], name: "x"))
        try roundTrip(NoteDraftOutcome.none)
        try roundTrip(NoteDraftOutcome.error(message: "m"))
        try roundTrip(NoteDraftOutcome.created(path: ["a"], fieldError: nil))
        try roundTrip(NoteDraftOutcome.created(path: ["a"], fieldError: "e"))
        try roundTrip(FolderCreateOutcome.created(path: ["a"]))
        try roundTrip(FolderCreateOutcome.error(message: "m"))
        try roundTrip(ExportedArchive(fileName: "f.zip", base64: "UEs="))
        try roundTrip(RemoteTextEdit(from: 1, to: 2, insert: "x"))
        try roundTrip(conflict)
        try roundTrip(NoticeAction(kind: .openNote, label: "Open note", path: ["a"]))
        try roundTrip(SyncStatusMenuItem(id: "retry", label: "Retry now", path: nil))
        try roundTrip(SyncStatusMenuItem(id: "note-0", label: "W", path: ["W"]))
        for state: SyncState in [
            .synced, .syncing, .outOfSync(.pending), .outOfSync(.failed), .outOfSync(.conflict),
        ] {
            try roundTrip(state)
        }
        XCTAssertEqual(
            try JSONDecoder().decode(
                SyncState.self, from: Data(#"{"kind":"out-of-sync","reason":"failed"}"#.utf8)),
            .outOfSync(.failed))
        XCTAssertThrowsError(
            try JSONDecoder().decode(
                ConflictResolution.self, from: Data(#""keepBoth""#.utf8)))
    }
}
