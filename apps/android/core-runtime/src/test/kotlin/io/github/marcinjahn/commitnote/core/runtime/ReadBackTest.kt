package io.github.marcinjahn.commitnote.core.runtime

import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.DraftContentParams
import io.github.marcinjahn.commitnote.core.api.DraftStartParams
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.FakeCoreCommands
import io.github.marcinjahn.commitnote.core.api.FakeExportRepoParams
import io.github.marcinjahn.commitnote.core.api.FlushOutcome
import io.github.marcinjahn.commitnote.core.api.LoginInspectRepositoryResult
import io.github.marcinjahn.commitnote.core.api.NoteDraftOutcome
import io.github.marcinjahn.commitnote.core.api.NoteEditParams
import io.github.marcinjahn.commitnote.core.api.PassphraseParams
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.core.runtime.testing.FakeCoreRuntimes
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Test
import java.io.File

/** Writes a scenario that the TypeScript read-back checks against the exported repository. */
class ReadBackTest {
    @Test
    fun `an initialized repository with an edited note reads back`() =
        blocking {
            val runtime = FakeCoreRuntimes.start()
            assertInstanceOf(
                LoginInspectRepositoryResult.Uninitialized::class.java,
                runtime.inspect(EMPTY_REPO),
            )
            runtime.send(CoreCommands.loginInitialize, PassphraseParams(Secret(PASSPHRASE)))
            runtime.waitForTree()

            runtime.send(CoreCommands.draftStart, DraftStartParams(parent = emptyList()))
            val draft = DraftContentParams(name = "", content = DRAFT_TEXT)
            val outcome = runtime.send(CoreCommands.draftContent, draft).outcome
            val path = assertInstanceOf(NoteDraftOutcome.Created::class.java, outcome).path
            runtime.send(CoreCommands.noteEdit, NoteEditParams(path, EDITED_TEXT))
            poll {
                runtime
                    .send(
                        CoreCommands.syncFlush,
                        Empty,
                    ).result
                    .takeIf { it == FlushOutcome.Saved }
            }
            val exported =
                runtime.send(FakeCoreCommands.exportRepo, FakeExportRepoParams(EMPTY_REPO)).exported
            runtime.stop()

            val scenario =
                buildJsonObject {
                    put("name", "android initialize and edit")
                    put("passphrase", PASSPHRASE)
                    put("exported", exported)
                    putJsonObject("expect") {
                        put("initialized", true)
                        putJsonArray("notes") {
                            addJsonObject {
                                putJsonArray("path") { path.forEach { add(it) } }
                                put("text", EDITED_TEXT)
                            }
                        }
                        put("deviceName", FakeCoreRuntimes.DEVICE_MODEL)
                    }
                }
            val directory = File(checkNotNull(System.getProperty("commitnote.readBackDir")))
            directory.mkdirs()
            File(directory, "initialize-edit.json").writeText(scenario.toString())
        }

    private companion object {
        const val EMPTY_REPO = "sample/empty"
        const val PASSPHRASE = "native read-back passphrase"
        const val DRAFT_TEXT = "First draft\n"
        const val EDITED_TEXT =
            "Zażółć gęślą jaźń\n\nSecond line: naïve café ✓ 日本語\n\n- list item\n"
    }
}
