package io.github.marcinjahn.commitnote.core.api

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Test

class CoreApiRoundTripTest {
    private fun <P, R> CoreCommand<P, R>.result(json: String): R =
        decodeResult(CoreWire.json.parseToJsonElement(json))

    @Test
    fun `session resume decodes a failure carrying a core error`() {
        val result =
            CoreCommands.sessionResume.result(
                """{"kind":"failed","error":{"kind":"network","message":"offline",""" +
                    """"transient":true,"retryAfterMs":2000},"canRetry":true}""",
            )

        val failed = assertInstanceOf(SessionResumeResult.Failed::class.java, result)
        assertEquals(CoreErrorKind.NETWORK, failed.error.kind)
        assertEquals(2000L, failed.error.retryAfterMs)
        assertEquals(true, failed.canRetry)
    }

    @Test
    fun `note open decodes a loaded note with a conflict and tells states apart`() {
        val loaded =
            CoreCommands.noteOpen
                .result(
                    """{"note":{"state":"loaded","path":["A","b"],"content":"text","conflict":{""" +
                        """"otherDevice":"Phone","heading":"h","text":"t","keepThisLabel":"k1",""" +
                        """"keepOtherLabel":"k2","editMergedLabel":"e","editHint":"hint",""" +
                        """"merged":"m","editing":false},"colorTag":"red","shared":true}}""",
                ).note
        val missing =
            CoreCommands.noteOpen
                .result("""{"note":{"state":"missing","path":["A"],"message":"gone"}}""")
                .note
        val none = CoreCommands.noteOpen.result("""{"note":null}""").note

        val note = assertInstanceOf(OpenNote.Loaded::class.java, loaded)
        assertEquals("Phone", note.conflict?.otherDevice)
        assertEquals(ColorTag.RED, note.colorTag)
        assertEquals(OpenNote.Missing(listOf("A"), "gone"), missing)
        assertEquals(null, none)
    }

    @Test
    fun `tree outcomes decode confirmations and structure errors`() {
        val trash =
            CoreCommands.nodeTrash.result(
                """{"outcome":{"kind":"confirm","preview":{"title":"t","message":"m",""" +
                    """"confirmLabel":"Trash","itemCount":3,"shareCount":1}}}""",
            )
        val sibling = CoreCommands.nodeMoveSibling.result("""{"outcome":{"kind":"none"}}""")
        val rename =
            CoreCommands.nodeRename.result("""{"outcome":{"kind":"error","message":"taken"}}""")

        assertEquals(
            NodeTrashResult(TrashOutcome.Confirm(TrashPreview("t", "m", "Trash", 3, 1))),
            trash,
        )
        assertEquals(NodeMoveSiblingResult(MoveSiblingOutcome.None), sibling)
        assertEquals(StructureOutcomeResult(StructureOutcome.Error("taken")), rename)
    }

    @Test
    fun `search results decode name ranges and snippets`() {
        val row =
            """{"path":["A"],"name":"Alpha","folder":null,"nameRanges":[[0,2],[3,4]],""" +
                """"snippet":[{"text":"al","match":true},{"text":"pha","match":false}],""" +
                """"colorTag":null}"""
        val result =
            CoreCommands.searchQuery.result(
                """{"results":{"recent":[],"names":[$row],"contents":[],"countText":"1 note",""" +
                    """"namesMore":null,"contentsMore":null,"copy":{"recentHeading":"r",""" +
                    """"namesHeading":"n","contentsHeading":"c","noMatches":"none",""" +
                    """"stillReading":"reading","hint":"hint"}}}""",
            )

        val names = result.results.names.single()
        assertEquals(listOf(NameRange(0, 2), NameRange(3, 4)), names.nameRanges)
        assertEquals(listOf(SnippetPart("al", true), SnippetPart("pha", false)), names.snippet)
    }

    @Test
    fun `history preview decodes a diff nested in a version`() {
        val result =
            CoreCommands.historyPreview.result(
                """{"preview":{"kind":"version","titleChange":null,""" +
                    """"body":{"kind":"diff","items":[""" +
                    """{"kind":"line","line":{"kind":"same","text":"a"}},""" +
                    """{"kind":"fold","label":"2 lines","lines":[{"kind":"same","text":"b"}]},""" +
                    """{"kind":"line","line":{"kind":"added","segments":""" +
                    """[{"text":"x","changed":true}]}}],"finalNewline":null},""" +
                    """"restoreTitle":null,"restore":{"label":"Restore","enabled":true,""" +
                    """"reason":null}}}""",
            )

        val version = assertInstanceOf(VersionPreview.Version::class.java, result.preview)
        val diff = assertInstanceOf(PreviewBody.Diff::class.java, version.body)
        assertEquals(
            listOf(
                DiffItemView.Line(DiffLineView.Same("a")),
                DiffItemView.Fold("2 lines", listOf(DiffLineView.Same("b"))),
                DiffItemView.Line(DiffLineView.Added(listOf(DiffSegment("x", true)))),
            ),
            diff.items,
        )
    }

    @Test
    fun `share create decodes a link or a message made of parts`() {
        val created =
            CoreCommands.shareCreate.result(
                """{"outcome":{"kind":"created","link":"https://s/1","password":null}}""",
            )
        val error =
            CoreCommands.shareCreate.result(
                """{"outcome":{"kind":"error","parts":[{"kind":"text","text":"See "},""" +
                    """{"kind":"link","text":"docs","href":"https://d"}]}}""",
            )

        assertEquals(ShareCreateResult(ShareCreateOutcome.Created("https://s/1", null)), created)
        assertEquals(
            ShareCreateResult(
                ShareCreateOutcome.Error(
                    listOf(MessagePart.Text("See "), MessagePart.Link("docs", "https://d")),
                ),
            ),
            error,
        )
    }

    @Test
    fun `import and passphrase outcomes decode their variants`() {
        val needsSetup =
            CoreCommands.importCommit.result(
                """{"outcome":{"kind":"needsSetup","canConfigure":true,"message":"m",""" +
                    """"actionLabel":"Enable"}}""",
            )
        val queued =
            CoreCommands.importDropFiles.result("""{"outcome":{"kind":"queued","expand":["A"]}}""")
        val review =
            CoreCommands.passphrasePrepareChange.result(
                """{"outcome":{"kind":"review","summary":"s","carriedOver":["x"],""" +
                    """"historyWarning":null}}""",
            )
        val changed = CoreCommands.passphraseSettle.result("""{"outcome":{"kind":"changed"}}""")

        assertEquals(
            ImportOutcomeResult(ImportOutcomeView.NeedsSetup(true, "m", "Enable")),
            needsSetup,
        )
        assertEquals(ImportOutcomeResult(ImportOutcomeView.Queued(listOf("A"))), queued)
        assertEquals(
            PassphraseChangeOutcomeResult(PassphraseChangeOutcome.Review("s", listOf("x"), null)),
            review,
        )
        assertEquals(PassphraseChangeOutcomeResult(PassphraseChangeOutcome.Changed), changed)
    }

    @Test
    fun `import destinations and passphrases encode as the core expects`() {
        assertEquals(
            """{"id":1,"command":"import.preview","params":{"destination":""" +
                """{"kind":"newFolder","parent":["A"],"name":"Imported"}}}""",
            CoreCommands.importPreview.encodeRequest(
                1,
                ImportPreviewParams(ImportDestinationView.NewFolder(listOf("A"), "Imported")),
            ),
        )
        assertEquals(
            """{"id":2,"command":"passphrase.prepareChange","params":{"current":"old",""" +
                """"next":"new","removeHistory":false}}""",
            CoreCommands.passphrasePrepareChange.encodeRequest(
                2,
                PassphraseChangePrepareParams(Secret("old"), Secret("new"), false),
            ),
        )
    }

    @Test
    fun `an empty result decodes to Empty and a sync state decodes its reason`() {
        assertEquals(Empty, CoreCommands.settingsFlush.result("{}"))
        assertEquals(
            SyncState.OutOfSync(OutOfSyncReason.CONFLICT),
            CoreWire.json.decodeFromString(
                SyncState.serializer(),
                """{"kind":"out-of-sync","reason":"conflict"}""",
            ),
        )
    }
}
