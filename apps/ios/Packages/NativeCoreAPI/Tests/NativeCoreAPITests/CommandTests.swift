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
        XCTAssertEqual(try params(TreeGet()), empty)
        XCTAssertEqual(try params(SyncRefresh()), empty)
        XCTAssertEqual(try params(DeviceName()), empty)
        XCTAssertEqual(try params(SettingsOpen()), empty)
        XCTAssertEqual(try params(SettingsRetry()), empty)
        XCTAssertEqual(try params(SettingsFlush()), empty)
        XCTAssertEqual(try params(AnalyticsVisit()), empty)
        XCTAssertEqual(try params(ImportCancel()), empty)
        XCTAssertEqual(try params(ImportEnableAtomic()), empty)
        XCTAssertEqual(try params(ImportSaveWithoutAtomic()), empty)
        XCTAssertEqual(try params(PassphraseChangeForm()), empty)
        XCTAssertEqual(try params(PassphraseCommitChange()), empty)
        XCTAssertEqual(try params(PassphraseSettle()), empty)
        XCTAssertEqual(try params(PassphraseCancelChange()), empty)
        XCTAssertEqual(try params(PassphraseEnableAtomic()), empty)
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
            {"kind":"note","name":"Plan","path":["Work","Plan"],"colorTag":"red","shared":true}]},
            {"kind":"note","name":"Inbox","path":["Inbox"],"colorTag":null,"shared":false}]}
            """#)
        XCTAssertEqual(
            tree.tree,
            [
                .folder(
                    name: "Work", path: ["Work"], noteCount: 1,
                    children: [
                        .note(name: "Plan", path: ["Work", "Plan"], colorTag: .red, shared: true)
                    ]),
                .note(name: "Inbox", path: ["Inbox"], colorTag: nil, shared: false),
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
            try result(NoteOpen.self, ##"{"note":{"state":"loaded",\##(path),"content":"# hi","conflict":null,"colorTag":"blue","shared":true}}"##).note,
            .loaded(path: ["a", "b"], content: "# hi", conflict: nil, colorTag: .blue, shared: true))
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
            .loaded(path: ["a"], content: "x", conflict: nil, colorTag: nil, shared: false),
            .loaded(path: ["a"], content: "x", conflict: conflict, colorTag: .red, shared: true),
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
        try roundTrip(NoticeAction(kind: .undo, label: "Undo"))
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

    func testVersion3CommandParams() throws {
        XCTAssertEqual(NativeCoreAPIVersion.current, 7)
        XCTAssertEqual(
            try params(NodeRename(path: ["a"], name: "b")), try json(#"{"path":["a"],"name":"b"}"#))
        XCTAssertEqual(
            try params(NodeMove(path: ["a"], parent: ["f"])),
            try json(#"{"path":["a"],"parent":["f"]}"#))
        XCTAssertEqual(
            try params(NodePlace(path: ["a"], parent: [], before: nil)),
            try json(#"{"path":["a"],"parent":[],"before":null}"#))
        XCTAssertEqual(
            try params(NodePlace(path: ["a"], parent: ["f"], before: "b")),
            try json(#"{"path":["a"],"parent":["f"],"before":"b"}"#))
        XCTAssertEqual(
            try params(NodeMoveSibling(path: ["a"], direction: .up)),
            try json(#"{"path":["a"],"direction":"up"}"#))
        XCTAssertEqual(
            try params(NodeMoveTargets(path: ["a"])), try json(#"{"path":["a"]}"#))
        XCTAssertEqual(
            try params(NodeTrashPreview(path: ["a"])), try json(#"{"path":["a"]}"#))
        XCTAssertEqual(
            try params(NodeTrash(path: ["a"], shareCount: 2)),
            try json(#"{"path":["a"],"shareCount":2}"#))
        XCTAssertEqual(
            try params(NodeSetColorTag(path: ["a"], tag: .purple)),
            try json(#"{"path":["a"],"tag":"purple"}"#))
        XCTAssertEqual(
            try params(NodeSetColorTag(path: ["a"], tag: nil)),
            try json(#"{"path":["a"],"tag":null}"#))
        XCTAssertEqual(try params(NoticesPerform(id: "n1")), try json(#"{"id":"n1"}"#))
        XCTAssertEqual(
            try params(TrashRestoreTargets(entryId: "e", subPath: ["x"])),
            try json(#"{"entryId":"e","subPath":["x"]}"#))
        XCTAssertEqual(
            try params(TrashRestore(entryId: "e", subPath: [], parent: ["f"])),
            try json(#"{"entryId":"e","subPath":[],"parent":["f"]}"#))
        XCTAssertEqual(try params(TrashDelete(entryId: "e")), try json(#"{"entryId":"e"}"#))
        XCTAssertEqual(try params(TrashEmpty()), try json("{}"))
        XCTAssertEqual(try params(TagsSetFilter(tag: .blue)), try json(#"{"tag":"blue"}"#))
        XCTAssertEqual(try params(TagsSetFilter(tag: nil)), try json(#"{"tag":null}"#))
        XCTAssertEqual(try params(SearchOpen()), try json("{}"))
        XCTAssertEqual(try params(SearchClose()), try json("{}"))
        XCTAssertEqual(try params(SearchQuery(query: "q")), try json(#"{"query":"q"}"#))
        XCTAssertEqual(
            try params(NoteRename(path: ["a"], name: "b")), try json(#"{"path":["a"],"name":"b"}"#))
        XCTAssertEqual(try params(NoteStats(path: ["a"])), try json(#"{"path":["a"]}"#))
        XCTAssertEqual(try params(NoteDates(path: ["a"])), try json(#"{"path":["a"]}"#))
        XCTAssertEqual(try params(ImageRead(imageId: "i")), try json(#"{"imageId":"i"}"#))
        XCTAssertEqual(try params(LastViewLoad()), try json("{}"))
        XCTAssertEqual(
            try params(LastViewSave(note: nil, folders: [["a"], ["a", "b"]])),
            try json(#"{"note":null,"folders":[["a"],["a","b"]]}"#))
        XCTAssertEqual(
            try params(LastViewSave(note: ["a", "n"], folders: [])),
            try json(#"{"note":["a","n"],"folders":[]}"#))
        XCTAssertEqual(
            try params(EarlyDraftHandOff(name: "n", body: "b", nameConfirmed: true)),
            try json(#"{"name":"n","body":"b","nameConfirmed":true}"#))
    }

    func testStructureResults() throws {
        let ok = #"{"outcome":{"kind":"ok","path":["a","b"]}}"#
        let error = #"{"outcome":{"kind":"error","message":"m"}}"#
        XCTAssertEqual(try result(NodeRename.self, ok).outcome, .ok(path: ["a", "b"]))
        XCTAssertEqual(try result(NodeMove.self, error).outcome, .error(message: "m"))
        XCTAssertEqual(try result(NodePlace.self, ok).outcome, .ok(path: ["a", "b"]))
        XCTAssertEqual(try result(NodeSetColorTag.self, ok).outcome, .ok(path: ["a", "b"]))
        XCTAssertEqual(try result(TrashRestore.self, error).outcome, .error(message: "m"))
        XCTAssertEqual(
            try result(NodeMoveSibling.self, #"{"outcome":{"kind":"none"}}"#).outcome, .none)
        XCTAssertEqual(
            try result(NodeMoveSibling.self, ok).outcome, .ok(path: ["a", "b"]))
        XCTAssertEqual(
            try result(NodeMoveSibling.self, error).outcome, .error(message: "m"))
        let targets =
            #"{"targets":[{"path":[],"label":"Top level","depth":0,"disabled":false},{"path":["a"],"label":"a","depth":1,"disabled":true}]}"#
        let expected = [
            MoveTargetView(path: [], label: "Top level", depth: 0, disabled: false),
            MoveTargetView(path: ["a"], label: "a", depth: 1, disabled: true),
        ]
        XCTAssertEqual(try result(NodeMoveTargets.self, targets).targets, expected)
        XCTAssertEqual(try result(TrashRestoreTargets.self, targets).targets, expected)
    }

    func testTrashResults() throws {
        let preview = TrashPreview(
            title: "Move to trash?", message: "m\n\ns", confirmLabel: "Revoke links and move to trash",
            itemCount: 3, shareCount: 1)
        let previewJSON =
            #"{"title":"Move to trash?","message":"m\n\ns","confirmLabel":"Revoke links and move to trash","itemCount":3,"shareCount":1}"#
        XCTAssertEqual(
            try result(NodeTrashPreview.self, #"{"preview":\#(previewJSON)}"#).preview, preview)
        XCTAssertEqual(
            try result(NodeTrash.self, #"{"outcome":{"kind":"trashed","entryId":"e1"}}"#).outcome,
            .trashed(entryId: "e1"))
        XCTAssertEqual(
            try result(NodeTrash.self, #"{"outcome":{"kind":"deleted"}}"#).outcome, .deleted)
        XCTAssertEqual(
            try result(
                NodeTrash.self, #"{"outcome":{"kind":"confirm","preview":\#(previewJSON)}}"#
            ).outcome, .confirm(preview: preview))
        XCTAssertEqual(
            try result(NodeTrash.self, #"{"outcome":{"kind":"error","message":"m"}}"#).outcome,
            .error(message: "m"))
        XCTAssertEqual(try result(TrashDelete.self, "{}"), Empty())
        XCTAssertEqual(try result(TrashEmpty.self, "{}"), Empty())
        XCTAssertEqual(try result(NoticesPerform.self, "{}"), Empty())
        XCTAssertEqual(try result(TagsSetFilter.self, "{}"), Empty())
        XCTAssertEqual(try result(SearchOpen.self, "{}"), Empty())
        XCTAssertEqual(try result(SearchClose.self, "{}"), Empty())
        XCTAssertEqual(try result(LastViewSave.self, "{}"), Empty())
    }

    func testSearchResults() throws {
        let value = try result(
            SearchQuery.self,
            #"""
            {"results":{"recent":[],"names":[
            {"path":["a","Plan"],"name":"Plan","folder":"a","nameRanges":[[0,2],[3,4]],"snippet":null,"colorTag":"green"}],
            "contents":[{"path":["Inbox"],"name":"Inbox","folder":null,"nameRanges":[],
            "snippet":[{"text":"see ","match":false},{"text":"plan","match":true}],"colorTag":null}],
            "countText":"2 results","namesMore":null,"contentsMore":"Showing first 50",
            "copy":{"recentHeading":"Recent","namesHeading":"Titles","contentsHeading":"Contents (partial)",
            "noMatches":"No notes match “plan”","stillReading":"Still reading notes…","hint":"Search note titles and contents"}}}
            """#
        ).results
        XCTAssertEqual(
            value.names,
            [
                SearchRow(
                    path: ["a", "Plan"], name: "Plan", folder: "a",
                    nameRanges: [SearchRange(start: 0, end: 2), SearchRange(start: 3, end: 4)],
                    snippet: nil, colorTag: .green)
            ])
        XCTAssertEqual(
            value.contents,
            [
                SearchRow(
                    path: ["Inbox"], name: "Inbox", folder: nil, nameRanges: [],
                    snippet: [
                        SnippetPart(text: "see ", match: false),
                        SnippetPart(text: "plan", match: true),
                    ], colorTag: nil)
            ])
        XCTAssertEqual(value.countText, "2 results")
        XCTAssertNil(value.namesMore)
        XCTAssertEqual(value.contentsMore, "Showing first 50")
        XCTAssertEqual(
            value.copy,
            SearchCopy(
                recentHeading: "Recent", namesHeading: "Titles",
                contentsHeading: "Contents (partial)", noMatches: "No notes match “plan”",
                stillReading: "Still reading notes…", hint: "Search note titles and contents"))
        XCTAssertTrue(value.recent.isEmpty)
        let data = try JSONEncoder().encode(value)
        XCTAssertEqual(try JSONDecoder().decode(SearchResults.self, from: data), value)
    }

    func testNoteDetailResults() throws {
        XCTAssertEqual(
            try result(
                NoteStats.self,
                #"{"words":{"label":"Words","value":"12"},"tasks":{"label":"Tasks","value":"1 of 2 done"}}"#),
            NoteStatsResult(
                words: DetailItemText(label: "Words", value: "12"),
                tasks: DetailItemText(label: "Tasks", value: "1 of 2 done")))
        XCTAssertNil(
            try result(NoteStats.self, #"{"words":{"label":"Words","value":"0"},"tasks":null}"#).tasks)
        XCTAssertEqual(
            try result(
                NoteDates.self,
                #"{"notSaved":false,"created":{"label":"Created","value":"c"},"updated":{"label":"Updated","value":"u"}}"#
            ),
            NoteDatesResult(
                notSaved: false, created: DetailItemText(label: "Created", value: "c"),
                updated: DetailItemText(label: "Updated", value: "u")))
        XCTAssertEqual(
            try result(NoteDates.self, #"{"notSaved":true,"created":null,"updated":null}"#),
            NoteDatesResult(notSaved: true, created: nil, updated: nil))
    }

    func testNoteRenameAndEarlyDraftResults() throws {
        XCTAssertEqual(
            try result(NoteRename.self, #"{"outcome":{"kind":"none"}}"#).outcome, .none)
        XCTAssertEqual(
            try result(NoteRename.self, #"{"outcome":{"kind":"restore"}}"#).outcome, .restore)
        XCTAssertEqual(
            try result(NoteRename.self, #"{"outcome":{"kind":"error","message":"m"}}"#).outcome,
            .error(message: "m"))
        XCTAssertEqual(
            try result(NoteRename.self, #"{"outcome":{"kind":"ok","path":["n"]}}"#).outcome,
            .ok(path: ["n"]))
        XCTAssertEqual(
            try result(EarlyDraftHandOff.self, #"{"outcome":{"kind":"none"}}"#).outcome, .none)
        XCTAssertEqual(
            try result(
                EarlyDraftHandOff.self, #"{"outcome":{"kind":"draft","name":"n","error":null}}"#
            ).outcome, .draft(name: "n", error: nil))
        XCTAssertEqual(
            try result(
                EarlyDraftHandOff.self, #"{"outcome":{"kind":"draft","name":"n","error":"e"}}"#
            ).outcome, .draft(name: "n", error: "e"))
        XCTAssertEqual(
            try result(
                EarlyDraftHandOff.self,
                #"{"outcome":{"kind":"created","path":["n"],"fieldError":null}}"#
            ).outcome, .created(path: ["n"], fieldError: nil))
    }

    func testImageAndLastViewResults() throws {
        XCTAssertEqual(
            try result(ImageRead.self, #"{"image":{"type":"image/webp","base64":"AA=="}}"#).image,
            ImagePayload(type: .webp, base64: "AA=="))
        XCTAssertEqual(
            try result(ImageRead.self, #"{"image":{"type":"image/gif","base64":"AA=="}}"#).image?.type,
            .gif)
        XCTAssertNil(try result(ImageRead.self, #"{"image":null}"#).image)
        XCTAssertNil(try result(LastViewLoad.self, #"{"view":null}"#).view)
        XCTAssertEqual(
            try result(LastViewLoad.self, #"{"view":{"note":["a","n"],"folders":[["a"]]}}"#).view,
            LastView(note: ["a", "n"], folders: [["a"]]))
        XCTAssertEqual(
            try result(LastViewLoad.self, #"{"view":{"note":null,"folders":[]}}"#).view,
            LastView(note: nil, folders: []))
    }

    func testVersion3ShapesRoundTrip() throws {
        func roundTrip<T: Codable & Equatable>(_ value: T) throws {
            let data = try JSONEncoder().encode(value)
            XCTAssertEqual(try JSONDecoder().decode(T.self, from: data), value)
        }
        for tag in ColorTag.allCases { try roundTrip(tag) }
        try roundTrip(TagOption(tag: .orange, label: "Orange"))
        try roundTrip(StructureOutcome.ok(path: ["a"]))
        try roundTrip(StructureOutcome.error(message: "m"))
        try roundTrip(SiblingMoveOutcome.none)
        try roundTrip(TrashOutcome.deleted)
        try roundTrip(TrashOutcome.trashed(entryId: "e"))
        try roundTrip(NameCommitOutcome.restore)
        try roundTrip(EarlyDraftOutcome.draft(name: "n", error: nil))
        try roundTrip(EarlyDraftOutcome.created(path: ["n"], fieldError: "e"))
        try roundTrip(
            TreeNode.note(name: "n", path: ["n"], colorTag: .yellow, shared: true))
        try roundTrip(
            TrashEntryView(
                id: "e", kind: .folder, name: "F", originalFolder: "Top level", daysLeft: "30 days left",
                colorTag: nil,
                children: [
                    TrashItemView(
                        kind: .folder, name: "S", subPath: ["S"],
                        children: [
                            TrashItemView(kind: .note, name: "N", subPath: ["S", "N"], children: [])
                        ])
                ]))
        XCTAssertThrowsError(
            try JSONDecoder().decode(ColorTag.self, from: Data(#""pink""#.utf8)))
        XCTAssertThrowsError(
            try JSONDecoder().decode(StructureOutcome.self, from: Data(#"{"kind":"none"}"#.utf8)))
    }

    func testVersion4Params() throws {
        XCTAssertEqual(try params(ImageInsert(inputs: ["a", "b"])), try json(#"{"inputs":["a","b"]}"#))
        XCTAssertEqual(
            try params(ImageClonePasted(path: ["n"], current: "c", pasted: "p")),
            try json(#"{"path":["n"],"current":"c","pasted":"p"}"#))
        XCTAssertEqual(
            try params(ImageClonePasted(path: nil, current: "c", pasted: "p")),
            try json(#"{"path":null,"current":"c","pasted":"p"}"#))
        XCTAssertEqual(try params(HistoryOpen(path: ["a", "n"])), try json(#"{"path":["a","n"]}"#))
        let empty = try json("{}")
        XCTAssertEqual(try params(HistoryClose()), empty)
        XCTAssertEqual(try params(HistoryLoadMore()), empty)
        XCTAssertEqual(try params(HistoryRetry()), empty)
        XCTAssertEqual(
            try params(HistoryPreview(sha: "s", restoreTitle: true)),
            try json(#"{"sha":"s","restoreTitle":true}"#))
        XCTAssertEqual(
            try params(HistoryRestore(sha: "s", restoreTitle: false)),
            try json(#"{"sha":"s","restoreTitle":false}"#))
        XCTAssertEqual(try params(ShareForm(path: ["n"])), try json(#"{"path":["n"]}"#))
        XCTAssertEqual(
            try params(ShareCreate(path: ["n"], password: "", label: "L")),
            try json(#"{"path":["n"],"password":"","label":"L"}"#))
        XCTAssertEqual(try params(ShareUpdate(id: "i")), try json(#"{"id":"i"}"#))
        XCTAssertEqual(
            try params(ShareRename(id: "i", label: "L")), try json(#"{"id":"i","label":"L"}"#))
        XCTAssertEqual(try params(ShareRevoke(id: "i")), try json(#"{"id":"i"}"#))
        XCTAssertEqual(try params(ShareSharedVersion(id: "i")), try json(#"{"id":"i"}"#))
    }

    func testImageResults() throws {
        XCTAssertEqual(
            try result(ImageInsert.self, #"{"references":["image:abc#4x3"]}"#).references,
            ["image:abc#4x3"])
        XCTAssertEqual(try result(ImageInsert.self, #"{"references":[]}"#).references, [])
        XCTAssertEqual(try result(ImageClonePasted.self, #"{"text":"t"}"#).text, "t")
    }

    func testHistoryResults() throws {
        _ = try result(HistoryOpen.self, "{}")
        _ = try result(HistoryClose.self, "{}")
        let version =
            #"{"kind":"version","titleChange":"Renamed from \u201cA\u201d","body":{"kind":"diff","items":[{"kind":"line","line":{"kind":"same","text":"x"}},{"kind":"fold","label":"3 unchanged lines","lines":[{"kind":"same","text":"y"}]},{"kind":"line","line":{"kind":"added","segments":[{"text":"a","changed":false},{"text":"b","changed":true}]}},{"kind":"line","line":{"kind":"removed","segments":[{"text":"c","changed":true}]}}],"finalNewline":"No newline at end of file"},"restoreTitle":null,"restore":{"label":"Restore this version","enabled":false,"reason":"r"}}"#
        XCTAssertEqual(
            try result(HistoryPreview.self, #"{"preview":\#(version)}"#).preview,
            .version(
                titleChange: "Renamed from \u{201C}A\u{201D}",
                body: .diff(
                    items: [
                        .line(.same(text: "x")),
                        .fold(label: "3 unchanged lines", lines: [.same(text: "y")]),
                        .line(
                            .added(segments: [
                                DiffSegment(text: "a", changed: false),
                                DiffSegment(text: "b", changed: true),
                            ])),
                        .line(.removed(segments: [DiffSegment(text: "c", changed: true)])),
                    ], finalNewline: "No newline at end of file"),
                restoreTitle: nil,
                restore: RestoreAvailability(
                    label: "Restore this version", enabled: false, reason: "r")))
        XCTAssertEqual(
            try result(HistoryPreview.self, #"{"preview":{"kind":"failed","message":"m"}}"#).preview,
            .failed(message: "m"))
        XCTAssertEqual(
            try result(HistoryPreview.self, #"{"preview":{"kind":"undecryptable","message":"m"}}"#)
                .preview, .undecryptable(message: "m"))
        XCTAssertEqual(
            try result(HistoryPreview.self, #"{"preview":{"kind":"closed","message":"m"}}"#).preview,
            .closed(message: "m"))
        XCTAssertEqual(
            try result(
                HistoryPreview.self,
                #"{"preview":{"kind":"version","titleChange":null,"body":{"kind":"tooLarge","message":"m"},"restoreTitle":"t","restore":{"label":"l","enabled":true,"reason":null}}}"#
            ).preview,
            .version(
                titleChange: nil, body: .tooLarge(message: "m"), restoreTitle: "t",
                restore: RestoreAvailability(label: "l", enabled: true, reason: nil)))
        XCTAssertEqual(
            try result(
                HistoryPreview.self,
                #"{"preview":{"kind":"version","titleChange":null,"body":{"kind":"unchanged","message":"m"},"restoreTitle":null,"restore":{"label":"l","enabled":true,"reason":null}}}"#
            ).preview,
            .version(
                titleChange: nil, body: .unchanged(message: "m"), restoreTitle: nil,
                restore: RestoreAvailability(label: "l", enabled: true, reason: nil)))
        XCTAssertEqual(
            try result(HistoryRestore.self, #"{"outcome":{"kind":"restored"}}"#).outcome, .restored)
        XCTAssertEqual(
            try result(HistoryRestore.self, #"{"outcome":{"kind":"blocked","message":"m"}}"#).outcome,
            .blocked(message: "m"))
        XCTAssertEqual(
            try result(HistoryRestore.self, #"{"outcome":{"kind":"error","message":"m"}}"#).outcome,
            .error(message: "m"))
        XCTAssertEqual(
            try result(HistoryRestore.self, #"{"outcome":{"kind":"closed"}}"#).outcome, .closed)
    }

    func testShareResults() throws {
        XCTAssertEqual(try result(ShareForm.self, #"{"title":"Share \u201cn\u201d"}"#).title, "Share \u{201C}n\u{201D}")
        XCTAssertEqual(
            try result(ShareCreate.self, #"{"outcome":{"kind":"created","link":"l","password":null}}"#)
                .outcome, .created(link: "l", password: nil))
        XCTAssertEqual(
            try result(ShareCreate.self, #"{"outcome":{"kind":"created","link":"l","password":"p"}}"#)
                .outcome, .created(link: "l", password: "p"))
        XCTAssertEqual(
            try result(
                ShareCreate.self,
                #"{"outcome":{"kind":"error","parts":[{"kind":"text","text":"t"},{"kind":"link","text":"x","href":"https://e.test"}]}}"#
            ).outcome,
            .error(parts: [.text("t"), .link(text: "x", href: "https://e.test")]))
        _ = try result(ShareUpdate.self, "{}")
        _ = try result(ShareRevoke.self, "{}")
        XCTAssertEqual(
            try result(ShareRename.self, #"{"outcome":{"kind":"ok"}}"#).outcome, .ok)
        XCTAssertEqual(
            try result(ShareRename.self, #"{"outcome":{"kind":"error","message":"m"}}"#).outcome,
            .error(message: "m"))
        XCTAssertEqual(
            try result(
                ShareSharedVersion.self,
                #"{"outcome":{"kind":"readable","name":null,"content":"c","date":"d"}}"#
            ).outcome, .readable(name: nil, content: "c", date: "d"))
        XCTAssertEqual(
            try result(
                ShareSharedVersion.self,
                #"{"outcome":{"kind":"readable","name":"n","content":"c","date":"d"}}"#
            ).outcome, .readable(name: "n", content: "c", date: "d"))
        XCTAssertEqual(
            try result(ShareSharedVersion.self, #"{"outcome":{"kind":"message","message":"m"}}"#)
                .outcome, .message("m"))
        XCTAssertEqual(
            try result(ShareSharedVersion.self, #"{"outcome":{"kind":"failed","message":"m"}}"#)
                .outcome, .failed(message: "m"))
    }

    func testVersion4ShapesRoundTrip() throws {
        func roundTrip<T: Codable & Equatable>(_ value: T) throws {
            let data = try JSONEncoder().encode(value)
            XCTAssertEqual(try JSONDecoder().decode(T.self, from: data), value)
        }
        let version = HistoryVersionView(
            sha: "s", time: "t", dateTime: "dt", current: true, shared: false, events: ["e"],
            name: nil)
        XCTAssertEqual(version.id, "s")
        try roundTrip(version)
        try roundTrip(HistoryRow.single(version))
        try roundTrip(HistoryRow.session(title: "t", shared: true, versions: [version]))
        try roundTrip(
            HistoryView(
                path: ["n"], phase: .ready, message: nil,
                sections: [HistorySection(title: "Today", rows: [.single(version)])], loading: false,
                error: nil, end: "e", canLoadMore: false))
        try roundTrip(PreviewBody.diff(items: [.line(.same(text: "x"))], finalNewline: nil))
        try roundTrip(HistoryRestoreOutcome.closed)
        try roundTrip(MessagePart.link(text: "t", href: "h"))
        try roundTrip(ShareActionView(id: .copyLink, label: "l", disabled: false, destructive: false))
        try roundTrip(ShareCreateOutcome.created(link: "l", password: "p"))
        try roundTrip(ShareRenameOutcome.error(message: "m"))
        try roundTrip(SharedVersionOutcome.readable(name: "n", content: "c", date: "d"))
        for id in ["copy-link", "copy-password", "update", "view", "open", "rename", "revoke"] {
            XCTAssertNotNil(ShareActionID(rawValue: id))
        }
        XCTAssertThrowsError(
            try JSONDecoder().decode(MessagePart.self, from: Data(#"{"kind":"x","text":"t"}"#.utf8)))
        XCTAssertThrowsError(
            try JSONDecoder().decode(HistoryRestoreOutcome.self, from: Data(#"{"kind":"x"}"#.utf8)))
    }

    func testVersion5Params() throws {
        XCTAssertEqual(
            try params(ExportNotes(includeImages: true)), try json(#"{"includeImages":true}"#))
        XCTAssertEqual(
            try params(SettingsChange(key: .newFolderPlacement, value: "top")),
            try json(#"{"key":"newFolderPlacement","value":"top"}"#))
        XCTAssertEqual(
            try params(SettingsChange(key: .typeToStart, value: "false")),
            try json(#"{"key":"typeToStart","value":"false"}"#))
        XCTAssertEqual(
            try params(SettingsSetScope(key: .typeToStart, scope: .synced)),
            try json(#"{"key":"typeToStart","scope":"synced"}"#))
        XCTAssertEqual(
            try params(SettingsSetScope(key: .noteFont, scope: .device)),
            try json(#"{"key":"noteFont","scope":"device"}"#))
        XCTAssertEqual(
            try params(SettingsSetScope(key: .colorMode, scope: .synced)),
            try json(#"{"key":"colorMode","scope":"synced"}"#))
        XCTAssertEqual(
            try params(DeviceSetName(name: "Phone")), try json(#"{"name":"Phone"}"#))
        XCTAssertEqual(try params(DeviceSetName(name: nil)), try json(#"{"name":null}"#))
        XCTAssertEqual(
            try params(
                LastViewSetEnabled(enabled: true, view: LastView(note: nil, folders: [["a"]]))),
            try json(#"{"enabled":true,"view":{"note":null,"folders":[["a"]]}}"#))
        XCTAssertEqual(
            try params(AnalyticsSetCounted(counted: false)), try json(#"{"counted":false}"#))
        XCTAssertEqual(
            try params(PrintRender(name: "n", text: "t")), try json(#"{"name":"n","text":"t"}"#))
        XCTAssertEqual(
            try params(ImportReadArchive(input: "id", fileName: "a.zip")),
            try json(#"{"input":"id","fileName":"a.zip"}"#))
        XCTAssertEqual(
            try params(ImportPreview(destination: .root)),
            try json(#"{"destination":{"kind":"root"}}"#))
        XCTAssertEqual(
            try params(ImportPreview(destination: .folder(path: ["a", "b"]))),
            try json(#"{"destination":{"kind":"folder","path":["a","b"]}}"#))
        XCTAssertEqual(
            try params(
                ImportCommit(destination: .newFolder(parent: ["a"], name: "n"), policy: .rename)),
            try json(
                #"{"destination":{"kind":"newFolder","parent":["a"],"name":"n"},"policy":"rename"}"#
            ))
        XCTAssertEqual(
            try params(ImportCommit(destination: .root, policy: .stop)),
            try json(#"{"destination":{"kind":"root"},"policy":"stop"}"#))
        XCTAssertEqual(
            try params(
                ImportDropFiles(
                    files: [ImportDroppedFile(input: "i", name: "n.md")], parent: nil,
                    source: .picker)),
            try json(#"{"files":[{"input":"i","name":"n.md"}],"parent":null,"source":"picker"}"#))
        XCTAssertEqual(
            try params(ImportDropFiles(files: [], parent: ["a"], source: .tree)),
            try json(#"{"files":[],"parent":["a"],"source":"tree"}"#))
        XCTAssertEqual(
            try params(PassphrasePrepareChange(current: "c", next: "n", removeHistory: true)),
            try json(#"{"current":"c","next":"n","removeHistory":true}"#))
    }

    private let settingsViewJSON =
        #"{"values":{"colorMode":"system","accentColor":"system","noteFont":"sans","newNotePlacement":"top","newFolderPlacement":"bottom","typeToStart":true},"scopes":{"colorMode":"synced","accentColor":"device","noteFont":"synced","typeToStart":"device"},"deviceName":"","automaticDeviceName":"iPhone","reopenLastView":true,"analyticsCounted":false,"canExport":true,"canImport":true,"canChangePassphrase":false}"#
    private let saveViewJSON =
        #"{"state":"failed","label":"Not saved","detail":"Settings not saved","canRetry":true}"#
    private let choiceJSON =
        #"{"label":"Mode","options":[{"id":"a","label":"A","description":null},{"id":"b","label":"B","description":"d"}]}"#

    private var settingsCopyJSON: String {
        ##"{"title":"Settings","intro":"i","sections":{"appearance":"a","editor":"e","notes":"n","thisDevice":"t","dataSecurity":"d"},"scopeLabels":{"synced":"All devices","device":"This device"},"colorMode":\##(choiceJSON),"accentColor":{"label":"Accent","options":[{"id":"system","label":"System","light":null,"dark":null},{"id":"blue","label":"Blue","light":"#0000ff","dark":"#8888ff"}]},"noteFont":{"label":"Font","options":[{"id":"sans","label":"Sans","description":null}],"previewHeading":"h","previewBody":"b","previewCode":"c"},"editorUnavailable":"u","newNotePlacement":\##(choiceJSON),"newFolderPlacement":\##(choiceJSON),"deviceName":{"label":"l","hint":"h","maxLength":40},"typeToStart":{"label":"Type to start","hint":"th"},"reopenLastView":{"label":"r"},"analytics":{"label":"l","hint":"h"},"data":{"exportLabel":"1","exportingLabel":"2","exportShareLabel":"3","exportFilesLabel":"4","exportFailed":"5","importLabel":"6","importingLabel":"7","changePassphraseLabel":"8"},"retryLabel":"Retry"}"##
    }

    func testVersion5SettingsResults() throws {
        let value = try result(
            SettingsOpen.self,
            #"{"copy":\#(settingsCopyJSON),"view":\#(settingsViewJSON),"save":\#(saveViewJSON)}"#)
        XCTAssertEqual(value.copy.title, "Settings")
        XCTAssertEqual(value.copy.scopeLabels.device, "This device")
        XCTAssertEqual(value.copy.colorMode.options[1].description, "d")
        XCTAssertNil(value.copy.colorMode.options[0].description)
        XCTAssertNil(value.copy.accentColor.options[0].light)
        XCTAssertEqual(value.copy.accentColor.options[1].dark, "#8888ff")
        XCTAssertEqual(value.copy.noteFont.previewCode, "c")
        XCTAssertEqual(value.copy.deviceName.maxLength, 40)
        XCTAssertEqual(value.copy.data.changePassphraseLabel, "8")
        XCTAssertEqual(value.view.scopes.accentColor, .device)
        XCTAssertEqual(value.view.values.newFolderPlacement, "bottom")
        XCTAssertTrue(value.view.values.typeToStart)
        XCTAssertEqual(value.view.scopes.typeToStart, .device)
        XCTAssertEqual(value.copy.typeToStart.label, "Type to start")
        XCTAssertEqual(value.copy.typeToStart.hint, "th")
        XCTAssertEqual(value.view.automaticDeviceName, "iPhone")
        XCTAssertFalse(value.view.canChangePassphrase)
        XCTAssertEqual(value.save.state, .failed)
        XCTAssertTrue(value.save.canRetry)

        XCTAssertEqual(try result(SettingsChange.self, "{}"), Empty())
        XCTAssertEqual(try result(SettingsSetScope.self, "{}"), Empty())
        XCTAssertEqual(try result(SettingsRetry.self, "{}"), Empty())
        XCTAssertEqual(try result(SettingsFlush.self, "{}"), Empty())
        XCTAssertEqual(try result(LastViewSetEnabled.self, "{}"), Empty())
        XCTAssertEqual(try result(AnalyticsSetCounted.self, "{}"), Empty())
        XCTAssertEqual(try result(DeviceSetName.self, #"{"name":"iPhone"}"#).name, "iPhone")
        XCTAssertEqual(
            try result(AnalyticsVisit.self, #"{"url":"https://example.test/"}"#).url,
            "https://example.test/")
        XCTAssertNil(try result(AnalyticsVisit.self, #"{"url":null}"#).url)
        XCTAssertEqual(try result(PrintRender.self, #"{"html":"<p>x</p>"}"#).html, "<p>x</p>")

        for state in ["synced", "syncing", "pending", "failed"] {
            XCTAssertNotNil(SettingsSaveState(rawValue: state))
        }
    }

    private let importFormJSON =
        #"{"fileName":"a.zip","defaultFolderName":"a","skipped":null,"empty":false,"targets":[{"path":["x"],"label":"x","depth":0}],"copy":{"title":"1","conflictsTitle":"2","setupTitle":"3","intoLabel":"4","newFolderLabel":"5","folderNameLabel":"6","existingFolderLabel":"7","rootLabel":"8","emptyText":"9","importLabel":"10","importingLabel":"11","renameLabel":"12","enableAtomicLabel":"13","cancelLabel":"14"}}"#

    func testVersion5ImportResults() throws {
        let ready = try result(ImportReadArchive.self, #"{"kind":"ready","form":\#(importFormJSON)}"#)
        guard case .ready(let form) = ready else { return XCTFail("expected ready") }
        XCTAssertEqual(form.defaultFolderName, "a")
        XCTAssertNil(form.skipped)
        XCTAssertEqual(form.targets, [ImportTargetView(path: ["x"], label: "x", depth: 0)])
        XCTAssertEqual(form.copy.cancelLabel, "14")
        XCTAssertEqual(
            try result(ImportReadArchive.self, #"{"kind":"error","message":"m"}"#),
            .error(message: "m"))

        XCTAssertEqual(try result(ImportPreview.self, #"{"text":null}"#).text, nil)
        XCTAssertEqual(try result(ImportPreview.self, #"{"text":"t"}"#).text, "t")

        let outcomes: [(String, ImportOutcomeView)] = [
            (#"{"kind":"queued","expand":["a"]}"#, .queued(expand: ["a"])),
            (#"{"kind":"queued","expand":null}"#, .queued(expand: nil)),
            (#"{"kind":"conflicts","count":2,"message":"m"}"#, .conflicts(count: 2, message: "m")),
            (
                #"{"kind":"needsSetup","canConfigure":true,"message":"m","actionLabel":"a"}"#,
                .needsSetup(canConfigure: true, message: "m", actionLabel: "a")
            ),
            (#"{"kind":"error","message":"m"}"#, .error(message: "m")),
        ]
        for (text, expected) in outcomes {
            XCTAssertEqual(
                try result(ImportCommit.self, #"{"outcome":\#(text)}"#).outcome, expected)
            XCTAssertEqual(
                try result(ImportDropFiles.self, #"{"outcome":\#(text)}"#).outcome, expected)
        }

        let enabled = try result(
            ImportEnableAtomic.self,
            #"{"error":null,"outcome":{"kind":"queued","expand":null}}"#)
        XCTAssertNil(enabled.error)
        XCTAssertEqual(enabled.outcome, .queued(expand: nil))
        let failed = try result(ImportEnableAtomic.self, #"{"error":"e","outcome":null}"#)
        XCTAssertEqual(failed.error, "e")
        XCTAssertNil(failed.outcome)

        XCTAssertEqual(try result(ImportCancel.self, "{}"), Empty())
        XCTAssertEqual(try result(ImportSaveWithoutAtomic.self, "{}"), Empty())
        XCTAssertThrowsError(try result(ImportReadArchive.self, #"{"kind":"x"}"#))
        XCTAssertThrowsError(try result(ImportCommit.self, #"{"outcome":{"kind":"x"}}"#))
    }

    private let passphraseCopyJSON =
        #"{"title":"1","intro":"2","currentLabel":"3","newLabel":"4","repeatLabel":"5","newHint":"6","removeHistoryLabel":"7","removeHistoryDescription":"8","historyWarning":"9","otherDevicesWarning":"10","versionHistoryNotice":"11","continueLabel":"12","confirmLabel":"13","cancelLabel":"14","checkAgainLabel":"15","checkingLabel":"16","logOutLabel":"21","startingLabel":"17","enableAtomicLabel":"18","passphrasesDiffer":"19","enterCurrentPassphrase":"20"}"#

    func testVersion5PassphraseResults() throws {
        let form = try result(
            PassphraseChangeForm.self,
            #"{"copy":\#(passphraseCopyJSON),"canRemoveHistory":true,"repositoryLabel":"a/b"}"#)
        XCTAssertEqual(form.copy.enterCurrentPassphrase, "20")
        XCTAssertEqual(form.copy.logOutLabel, "21")
        XCTAssertTrue(form.canRemoveHistory)
        XCTAssertEqual(form.repositoryLabel, "a/b")

        let outcomes: [(String, PassphraseChangeOutcome)] = [
            (
                #"{"kind":"review","summary":"s","carriedOver":["a"],"historyWarning":"w"}"#,
                .review(summary: "s", carriedOver: ["a"], historyWarning: "w")
            ),
            (
                #"{"kind":"review","summary":"s","carriedOver":[],"historyWarning":null}"#,
                .review(summary: "s", carriedOver: [], historyWarning: nil)
            ),
            (#"{"kind":"changed"}"#, .changed),
            (
                #"{"kind":"failed","message":"m","clearCurrent":true}"#,
                .failed(message: "m", clearCurrent: true)
            ),
            (
                #"{"kind":"needsSetup","canConfigure":false,"message":"m","actionLabel":"a"}"#,
                .needsSetup(canConfigure: false, message: "m", actionLabel: "a")
            ),
            (#"{"kind":"unsettled","message":"m"}"#, .unsettled(message: "m")),
        ]
        for (text, expected) in outcomes {
            XCTAssertEqual(
                try result(PassphrasePrepareChange.self, #"{"outcome":\#(text)}"#).outcome, expected)
            XCTAssertEqual(
                try result(PassphraseCommitChange.self, #"{"outcome":\#(text)}"#).outcome, expected)
            XCTAssertEqual(
                try result(PassphraseSettle.self, #"{"outcome":\#(text)}"#).outcome, expected)
        }
        XCTAssertThrowsError(
            try result(PassphraseSettle.self, #"{"outcome":{"kind":"x"}}"#))
        XCTAssertEqual(try result(PassphraseCancelChange.self, "{}"), Empty())
        XCTAssertNil(try result(PassphraseEnableAtomic.self, #"{"error":null}"#).error)
        XCTAssertEqual(try result(PassphraseEnableAtomic.self, #"{"error":"e"}"#).error, "e")
    }

    func testVersion5Events() throws {
        func event(_ name: String, _ payload: String) throws -> CoreEvent {
            try JSONDecoder().decode(
                CoreEvent.self, from: Data(#"{"event":"\#(name)","payload":\#(payload)}"#.utf8))
        }
        guard
            case .settingsChanged(let changed) = try event(
                "settingsChanged", #"{"view":\#(settingsViewJSON)}"#)
        else { return XCTFail("expected settingsChanged") }
        XCTAssertEqual(changed.view.automaticDeviceName, "iPhone")

        guard
            case .settingsSaveChanged(let save) = try event(
                "settingsSaveChanged", #"{"save":\#(saveViewJSON)}"#)
        else { return XCTFail("expected settingsSaveChanged") }
        XCTAssertEqual(save.save.state, .failed)

        guard
            case .importStatusChanged(let idle) = try event(
                "importStatusChanged", #"{"importing":false,"atomicBlocked":null}"#)
        else { return XCTFail("expected importStatusChanged") }
        XCTAssertFalse(idle.importing)
        XCTAssertNil(idle.atomicBlocked)
        guard
            case .importStatusChanged(let blocked) = try event(
                "importStatusChanged",
                #"{"importing":true,"atomicBlocked":{"title":"t","message":"m","enableLabel":"e","saveWithoutLabel":"s","canConfigure":true}}"#
            )
        else { return XCTFail("expected importStatusChanged") }
        XCTAssertEqual(
            blocked.atomicBlocked,
            AtomicBlockedView(
                title: "t", message: "m", enableLabel: "e", saveWithoutLabel: "s",
                canConfigure: true))

        guard
            case .passphraseChangeProgress(let progress) = try event(
                "passphraseChangeProgress", #"{"message":"m","done":1,"total":5}"#)
        else { return XCTFail("expected passphraseChangeProgress") }
        XCTAssertEqual(progress, PassphraseChangeProgress(message: "m", done: 1, total: 5))
        guard
            case .passphraseChangeProgress(let open) = try event(
                "passphraseChangeProgress", #"{"message":"m","done":null,"total":null}"#)
        else { return XCTFail("expected passphraseChangeProgress") }
        XCTAssertNil(open.done)
        XCTAssertNil(open.total)
    }

    func testVersion6LaunchCommands() throws {
        XCTAssertEqual(
            try params(LaunchDeliver(action: .newNote)), try json(#"{"action":"new-note"}"#))
        XCTAssertEqual(
            try params(LaunchDeliver(action: .search)), try json(#"{"action":"search"}"#))
        XCTAssertEqual(
            try params(LaunchAttach(accepts: [.newNote, .search])),
            try json(#"{"accepts":["new-note","search"]}"#))
        XCTAssertEqual(try params(LaunchAttach(accepts: [])), try json(#"{"accepts":[]}"#))
        XCTAssertEqual(try params(LaunchDetach()), try json("{}"))
        XCTAssertEqual(LaunchAction.allCases, [.newNote, .search])
        XCTAssertEqual(try result(LaunchDeliver.self, "{}"), Empty())
        XCTAssertEqual(try result(LaunchAttach.self, "{}"), Empty())
        XCTAssertEqual(try result(LaunchDetach.self, "{}"), Empty())
    }

    func testVersion6LaunchActionEvent() throws {
        func decode(_ json: String) throws -> CoreEvent {
            try JSONDecoder().decode(CoreEvent.self, from: Data(json.utf8))
        }
        XCTAssertEqual(
            try decode(#"{"event":"launchAction","payload":{"action":"new-note"}}"#),
            .launchAction(.newNote))
        XCTAssertEqual(
            try decode(#"{"event":"launchAction","payload":{"action":"search"}}"#),
            .launchAction(.search))
        XCTAssertEqual(CoreEvent.launchAction(.search).name, "launchAction")
        XCTAssertThrowsError(
            try decode(#"{"event":"launchAction","payload":{"action":"other"}}"#))
    }
}
