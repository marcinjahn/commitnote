package io.github.marcinjahn.commitnote.core.runtime

import io.github.marcinjahn.commitnote.core.api.AnalyticsVisitParams
import io.github.marcinjahn.commitnote.core.api.CoreCommand
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.ExportNotesParams
import io.github.marcinjahn.commitnote.core.api.FakeCoreCommands
import io.github.marcinjahn.commitnote.core.api.ImportArchiveOutcome
import io.github.marcinjahn.commitnote.core.api.NoteOpenParams
import io.github.marcinjahn.commitnote.core.api.OpenNote
import io.github.marcinjahn.commitnote.core.api.PassphraseStrengthParams
import io.github.marcinjahn.commitnote.core.api.PathParams
import io.github.marcinjahn.commitnote.core.api.PrintRenderParams
import io.github.marcinjahn.commitnote.core.api.SearchQueryParams
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.core.api.SettingKeyView
import io.github.marcinjahn.commitnote.core.api.SettingsChangeParams
import io.github.marcinjahn.commitnote.core.runtime.services.LogLevel
import io.github.marcinjahn.commitnote.core.runtime.testing.FakeCoreRuntimes
import io.github.marcinjahn.commitnote.core.runtime.testing.RecordingLogService
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Decodes real core output through the typed commands, so a wrong hand-written shape fails here. */
class TypedApiConformanceTest {
    @Test
    fun `the core answers typed commands and emits typed events`() =
        blocking {
            val logger = RecordingLogService()
            val runtime = FakeCoreRuntimes.start(logger = logger)

            suspend fun <P, R> call(
                command: CoreCommand<P, R>,
                params: P,
            ): R =
                try {
                    runtime.send(command, params)
                } catch (error: CoreException) {
                    throw AssertionError("${command.name} failed: ${error.message}", error)
                }
            val events = mutableListOf<CoreEvent>()
            val collector =
                launch(Dispatchers.Default, CoroutineStart.UNDISPATCHED) {
                    runtime.events.collect { event -> synchronized(events) { events += event } }
                }

            call(CoreCommands.forgesList, Empty)
            call(CoreCommands.loginLastRepository, Empty)
            call(
                CoreCommands.passphraseStrength,
                PassphraseStrengthParams(Secret("correct horse battery staple"), SAMPLE_REPO),
            )
            val tree = runtime.logIn(SAMPLE_REPO, SAMPLE_PASSPHRASE)
            val path = notePaths(tree).first()

            call(CoreCommands.deviceName, Empty)
            call(CoreCommands.lastViewLoad, Empty)
            call(CoreCommands.analyticsVisit, AnalyticsVisitParams(411))
            call(CoreCommands.settingsOpen, Empty)
            call(
                CoreCommands.settingsChange,
                SettingsChangeParams(SettingKeyView.COLOR_MODE, "dark"),
            )
            call(CoreCommands.passphraseChangeForm, Empty)
            poll {
                val note = call(CoreCommands.noteOpen, NoteOpenParams(path)).note
                note.takeIf { it is OpenNote.Loaded }
            }
            call(CoreCommands.noteStats, PathParams(path))
            call(CoreCommands.noteDates, PathParams(path))
            call(CoreCommands.nodeMoveTargets, PathParams(path))
            call(CoreCommands.nodeTrashPreview, PathParams(path))
            call(CoreCommands.shareForm, PathParams(path))
            call(CoreCommands.searchOpen, Empty)
            call(CoreCommands.searchQuery, SearchQueryParams("a"))
            call(CoreCommands.searchClose, Empty)
            call(CoreCommands.historyOpen, PathParams(path))
            call(CoreCommands.historyClose, Empty)
            call(CoreCommands.printRender, PrintRenderParams("Note", "# Heading"))
            call(CoreCommands.exportNotes, ExportNotesParams(includeImages = false))
            assertInstanceOf(
                ImportArchiveOutcome::class.java,
                call(FakeCoreCommands.importArchive, Empty),
            )
            poll { events.takeIf { it.any { event -> event is CoreEvent.SettingsChanged } } }
            collector.cancel()
            runtime.stop()

            val seen = synchronized(events) { events.map { it::class } }
            assertTrue(CoreEvent.TreeChanged::class in seen)
            assertTrue(CoreEvent.SyncStateChanged::class in seen)
            assertTrue(CoreEvent.SettingsChanged::class in seen)
            assertEquals(
                emptyList<String>(),
                logger.entries
                    .filter { it.level == LogLevel.WARN && it.message.startsWith("Ignored") }
                    .map { it.message },
            )
        }
}
