package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class CommandShapesTest {
    private fun <P, R> CoreCommand<P, R>.result(json: String): R =
        decodeResult(CoreWire.json.parseToJsonElement(json))

    private val repository =
        RepositoryView("owner/repo", "https://github.com/owner/repo", true, null)

    @Test
    fun `secrets serialize as plain strings and never show in toString`() {
        val params = LoginListRepositoriesParams(ForgeKind.GITHUB, Secret("ghp_token"))

        assertEquals(
            """{"id":1,"command":"login.listRepositories","params":{"forge":"github","accessToken":"ghp_token"}}""",
            CoreCommands.loginListRepositories.encodeRequest(1, params),
        )
        assertFalse(params.toString().contains("ghp_token"))
        assertFalse(Secret("ghp_token").toString().contains("ghp_token"))
        assertEquals("Secret(<redacted>)", Secret("x").toString())
        assertEquals(Secret("x"), Secret("x"))
    }

    @Test
    fun `login unlock and initialize decode the loggedIn marker`() {
        assertEquals(LoggedIn.Done, CoreCommands.loginUnlock.result("""{"kind":"loggedIn"}"""))
        assertEquals(LoggedIn.Done, CoreCommands.loginInitialize.result("""{"kind":"loggedIn"}"""))
    }

    @Test
    fun `listRepositories decodes the listings`() {
        val result =
            CoreCommands.loginListRepositories.result(
                """{"repositories":[{"url":"https://github.com/o/r","label":"o/r","private":true}]}""",
            )

        assertEquals(
            LoginListRepositoriesResult(
                listOf(RepositoryListing("https://github.com/o/r", "o/r", true)),
            ),
            result,
        )
    }

    @Test
    fun `inspectRepository decodes each variant`() {
        val view =
            """{"label":"owner/repo","url":"https://github.com/owner/repo",""" +
                """"private":true,"publicWarning":null}"""

        assertEquals(
            LoginInspectRepositoryResult.NotesRepo(repository),
            CoreCommands.loginInspectRepository.result(
                """{"kind":"notesRepo","repository":$view}""",
            ),
        )
        assertEquals(
            LoginInspectRepositoryResult.Uninitialized(repository, "Set it up"),
            CoreCommands.loginInspectRepository.result(
                """{"kind":"uninitialized","repository":$view,"setUpDescription":"Set it up"}""",
            ),
        )
        assertEquals(
            LoginInspectRepositoryResult.Unusable(
                repository,
                CoreError(CoreErrorKind.FOREIGN, "m", false),
                canCheckAgain = true,
                foreignHint = null,
            ),
            CoreCommands.loginInspectRepository.result(
                """{"kind":"unusable","repository":$view,""" +
                    """"error":{"kind":"foreign","message":"m","transient":false},""" +
                    """"canCheckAgain":true,"foreignHint":null}""",
            ),
        )
    }

    @Test
    fun `session resume decodes each variant`() {
        assertEquals(
            SessionResumeResult.None,
            CoreCommands.sessionResume.result("""{"kind":"none"}"""),
        )
        assertEquals(
            SessionResumeResult.Resumed,
            CoreCommands.sessionResume.result("""{"kind":"resumed"}"""),
        )
        assertEquals(
            SessionResumeResult.Failed(
                CoreError(CoreErrorKind.NETWORK, "m", true),
                canRetry = true,
            ),
            CoreCommands.sessionResume.result(
                """{"kind":"failed","error":{"kind":"network","message":"m","transient":true},"canRetry":true}""",
            ),
        )
    }

    @Test
    fun `session logout decodes both outcomes`() {
        assertEquals(
            SessionLogoutResult(LogoutOutcome.LoggedOut),
            CoreCommands.sessionLogout.result("""{"outcome":{"kind":"loggedOut"}}"""),
        )
        assertEquals(
            SessionLogoutResult(LogoutOutcome.Unsaved(2, "Two unsaved")),
            CoreCommands.sessionLogout.result(
                """{"outcome":{"kind":"unsaved","count":2,"message":"Two unsaved"}}""",
            ),
        )
        assertEquals(
            """{"id":4,"command":"session.logout","params":{"anyway":true}}""",
            CoreCommands.sessionLogout.encodeRequest(4, SessionLogoutParams(true)),
        )
    }

    @Test
    fun `note open decodes every note state`() {
        val path = listOf("A", "B")

        assertEquals(
            NoteOpenResult(null),
            CoreCommands.noteOpen.result("""{"note":null}"""),
        )
        assertEquals(
            NoteOpenResult(OpenNote.Loading(path)),
            CoreCommands.noteOpen.result("""{"note":{"state":"loading","path":["A","B"]}}"""),
        )
        assertEquals(
            NoteOpenResult(OpenNote.Loaded(path, "# Hi", null, ColorTag.RED, false)),
            CoreCommands.noteOpen.result(
                """{"note":{"state":"loaded","path":["A","B"],"content":"# Hi","conflict":null,""" +
                    """"colorTag":"red","shared":false}}""",
            ),
        )
        assertEquals(
            NoteOpenResult(OpenNote.Trashed(path, "In trash")),
            CoreCommands.noteOpen.result(
                """{"note":{"state":"trashed","path":["A","B"],"message":"In trash"}}""",
            ),
        )
        assertEquals(
            NoteOpenResult(OpenNote.Missing(path, "Gone")),
            CoreCommands.noteOpen.result(
                """{"note":{"state":"missing","path":["A","B"],"message":"Gone"}}""",
            ),
        )
        assertEquals(
            NoteOpenResult(
                OpenNote.Failed(path, "Bad", CoreError(CoreErrorKind.UNDECRYPTABLE, "m", false)),
            ),
            CoreCommands.noteOpen.result(
                """{"note":{"state":"failed","path":["A","B"],"message":"Bad",""" +
                    """"error":{"kind":"undecryptable","message":"m","transient":false}}}""",
            ),
        )
    }

    @Test
    fun `note open decodes a loaded note with a conflict`() {
        val result =
            CoreCommands.noteOpen.result(
                """{"note":{"state":"loaded","path":["A"],"content":"c",""" +
                    """"conflict":{"otherDevice":null,"heading":"h","text":"t",""" +
                    """"keepThisLabel":"a","keepOtherLabel":"b","editMergedLabel":"c",""" +
                    """"editHint":"e","merged":"m","editing":false},"colorTag":null,"shared":true}}""",
            )

        val note = (result.note as OpenNote.Loaded)
        assertEquals(
            OpenNoteConflict(null, "h", "t", "a", "b", "c", "e", "m", false),
            note.conflict,
        )
    }

    @Test
    fun `note open and edit encode their params`() {
        assertEquals(
            """{"id":1,"command":"note.open","params":{"path":["A","B"]}}""",
            CoreCommands.noteOpen.encodeRequest(1, NoteOpenParams(listOf("A", "B"))),
        )
        assertEquals(
            """{"id":2,"command":"note.edit","params":{"path":["A"],"text":"line\nnext"}}""",
            CoreCommands.noteEdit.encodeRequest(2, NoteEditParams(listOf("A"), "line\nnext")),
        )
    }

    @Test
    fun `empty results decode from an empty object`() {
        assertEquals(Empty, CoreCommands.syncRefresh.result("{}"))
        assertEquals(Empty, CoreCommands.lifecycleSetVisible.result("{}"))
        assertEquals(
            SyncFlushResult(FlushOutcome.Saved),
            CoreCommands.syncFlush.result("""{"result":{"kind":"saved"}}"""),
        )
        assertEquals(
            SyncFlushResult(FlushOutcome.Unsaved(3)),
            CoreCommands.syncFlush.result("""{"result":{"kind":"unsaved","count":3}}"""),
        )
    }

    @Test
    fun `lifecycle commands encode their params`() {
        assertEquals(
            """{"id":6,"command":"lifecycle.setOnline","params":{"online":false}}""",
            CoreCommands.lifecycleSetOnline.encodeRequest(6, LifecycleSetOnlineParams(false)),
        )
    }

    @Test
    fun `core errors decode optional fields and keep unknown kinds`() {
        val minimal =
            CoreWire.json.decodeFromString(
                CoreError.serializer(),
                """{"kind":"notReady","message":"m","transient":false}""",
            )
        val limited =
            CoreWire.json.decodeFromString(
                CoreError.serializer(),
                """{"kind":"rateLimited","message":"m","transient":true,"retryAfterMs":1500}""",
            )
        val newer =
            CoreWire.json.decodeFromString(
                CoreError.serializer(),
                """{"kind":"newerFormat","message":"m","transient":false,"formatVersion":9}""",
            )
        val unknown =
            CoreWire.json.decodeFromString(
                CoreError.serializer(),
                """{"kind":"brandNew","message":"m","transient":false}""",
            )

        assertEquals(CoreError(CoreErrorKind.NOT_READY, "m", false), minimal)
        assertEquals(1500L, limited.retryAfterMs)
        assertNull(limited.formatVersion)
        assertEquals(9, newer.formatVersion)
        assertEquals("brandNew", unknown.kind.wireName)
        assertEquals(
            """{"kind":"brandNew","message":"m","transient":false}""",
            CoreWire.json.encodeToString(CoreError.serializer(), unknown),
        )
    }

    @Test
    fun `fake commands encode and decode`() {
        assertEquals(
            """{"id":1,"command":"fake.exportRepo","params":{"repoKey":"k"}}""",
            FakeCoreCommands.exportRepo.encodeRequest(1, FakeExportRepoParams("k")),
        )
        assertEquals(
            FakeExportRepoResult("{}"),
            FakeCoreCommands.exportRepo.result("""{"exported":"{}"}"""),
        )
        assertEquals(
            FakeExpectedSampleNotesResult(listOf(FakeSampleNote(listOf("A"), "t"))),
            FakeCoreCommands.expectedSampleNotes.result(
                """{"notes":[{"path":["A"],"text":"t"}]}""",
            ),
        )
        assertEquals(
            FakeCheckVectorsResult(2, listOf("one failed")),
            FakeCoreCommands.checkVectors.result("""{"checked":2,"failures":["one failed"]}"""),
        )
        assertEquals(
            FakeHttpRequestResult(200, mapOf("a" to "b"), "ok"),
            FakeCoreCommands.httpRequest.result(
                """{"status":200,"headers":{"a":"b"},"bodyText":"ok"}""",
            ),
        )
        assertEquals(
            FakeTimerProbeResult(listOf(0, 2)),
            FakeCoreCommands.timerProbe.result("""{"fired":[0,2]}"""),
        )
        assertEquals(
            """{"id":2,"command":"fake.timerProbe","params":{"delaysMs":[5,10],"cancelIndex":null}}""",
            FakeCoreCommands.timerProbe.encodeRequest(2, FakeTimerProbeParams(listOf(5, 10), null)),
        )
    }

    @Test
    fun `checkVectors params carry arbitrary JSON files`() {
        val files =
            mapOf(
                "primitives.json" to buildJsonObject { put("count", 1) },
                "plain.json" to JsonPrimitive("x"),
            )

        assertEquals(
            """{"id":3,"command":"fake.checkVectors","params":{"files":{"primitives.json":{"count":1},"plain.json":"x"}}}""",
            FakeCoreCommands.checkVectors.encodeRequest(3, FakeCheckVectorsParams(files)),
        )
    }

    @Test
    fun `processImage decodes an encoded and a rejected image`() {
        assertEquals(
            FakeProcessImageResult(FakeProcessedImage.Encoded("image/webp", 4, 3, "AAAA")),
            FakeCoreCommands.processImage.result(
                """{"result":{"ok":true,"type":"image/webp","width":4,"height":3,"base64":"AAAA"}}""",
            ),
        )
        assertEquals(
            FakeProcessImageResult(FakeProcessedImage.Rejected("too big")),
            FakeCoreCommands.processImage.result(
                """{"result":{"ok":false,"rejection":"too big"}}""",
            ),
        )
        assertEquals(
            """{"id":1,"command":"fake.processImage","params":{"base64":"AA","type":"image/png","profile":"share"}}""",
            FakeCoreCommands.processImage.encodeRequest(
                1,
                FakeProcessImageParams("AA", "image/png", FakeImageProfile.SHARE),
            ),
        )
    }
}
