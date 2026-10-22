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
        XCTAssertEqual(NativeCoreAPIVersion.current, 3)
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
}
