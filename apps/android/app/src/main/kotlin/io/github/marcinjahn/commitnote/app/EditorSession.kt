package io.github.marcinjahn.commitnote.app

import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.core.api.ConflictResolution
import io.github.marcinjahn.commitnote.core.api.ConflictResolveParams
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.DetailItemText
import io.github.marcinjahn.commitnote.core.api.DraftCommitNameParams
import io.github.marcinjahn.commitnote.core.api.DraftContentParams
import io.github.marcinjahn.commitnote.core.api.DraftStartParams
import io.github.marcinjahn.commitnote.core.api.EarlyDraftHandOffParams
import io.github.marcinjahn.commitnote.core.api.EarlyDraftOutcome
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.ImageInsertParams
import io.github.marcinjahn.commitnote.core.api.ImageReadParams
import io.github.marcinjahn.commitnote.core.api.NameCommitOutcome
import io.github.marcinjahn.commitnote.core.api.NoteDraftOutcome
import io.github.marcinjahn.commitnote.core.api.NoteEditParams
import io.github.marcinjahn.commitnote.core.api.NoteImage
import io.github.marcinjahn.commitnote.core.api.NoteOpenParams
import io.github.marcinjahn.commitnote.core.api.NoteRenameParams
import io.github.marcinjahn.commitnote.core.api.OpenNote
import io.github.marcinjahn.commitnote.core.api.PathParams
import io.github.marcinjahn.commitnote.core.runtime.CoreException
import io.github.marcinjahn.commitnote.core.runtime.services.StagedInputsService
import io.github.marcinjahn.commitnote.editor.EditDestination
import io.github.marcinjahn.commitnote.editor.EditSender
import io.github.marcinjahn.commitnote.editor.TextChange
import io.github.marcinjahn.commitnote.editor.TextSelection
import io.github.marcinjahn.commitnote.ui.UiText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID
import kotlin.time.Duration.Companion.milliseconds

val OpenNote.path: List<String>
    get() =
        when (this) {
            is OpenNote.Loading -> path
            is OpenNote.Loaded -> path
            is OpenNote.Missing -> path
            is OpenNote.Trashed -> path
            is OpenNote.Failed -> path
        }

/** What the editor edits. */
sealed interface EditorTarget {
    data object None : EditorTarget

    data class Note(
        val path: List<String>,
    ) : EditorTarget

    data class Draft(
        val parent: List<String>,
    ) : EditorTarget

    /** A new note typed before the core can hold a draft; handed over once the tree has loaded. */
    data object EarlyDraft : EditorTarget

    val notePath: List<String>? get() = (this as? Note)?.path

    val isDraft: Boolean get() = this is Draft || this is EarlyDraft
}

enum class DraftFocus { Name, Body }

/** A note's content as the core reported it; [edits] are set when it changed on another device. */
data class NoteContentUpdate(
    val serial: Int,
    val path: List<String>,
    val content: String,
    val edits: List<TextChange>?,
)

/**
 * [switch] changes whenever the editor must replace its whole text, and [lineage] whenever the
 * editor starts on another note or draft.
 */
data class EditorState(
    val target: EditorTarget = EditorTarget.None,
    val switch: Int = 0,
    val lineage: Int = 0,
    val openNote: OpenNote? = null,
    val update: NoteContentUpdate? = null,
    val draftName: String = "",
    val draftFocus: DraftFocus = DraftFocus.Name,
    val nameError: String? = null,
    val focusAtEnd: List<String>? = null,
    val words: DetailItemText? = null,
) {
    /** The open note when it is the one the editor targets. */
    val targetNote: OpenNote? get() = openNote?.takeIf { it.path == target.notePath }
}

/** Image bytes picked or pasted by the user, to hand to the core. */
class ImageInput(
    val bytes: ByteArray,
    val type: String,
)

/**
 * The one note editor of the session: the note or draft being edited, the text sent to the core and
 * the core's reports of that note. Each note screen [claim]s it while showing; operations run in
 * the session scope so leaving a screen never cuts one short. Call it from the main thread.
 */
class EditorSession internal constructor(
    private val core: CoreSender,
    private val stagedInputs: StagedInputsService,
    private val lastView: LastViewTracker,
    private val scope: CoroutineScope,
) {
    private val mutableState = MutableStateFlow(EditorState())
    val state: StateFlow<EditorState> = mutableState.asStateFlow()

    private val messageChannel = Channel<UiText>(Channel.UNLIMITED)
    val messages: Flow<UiText> = messageChannel.receiveAsFlow()

    /** The text of the draft or early draft, which the core does not report back. */
    var draftText: String = ""
        private set

    val isIdle: Boolean get() = sender.isIdle

    private val target: EditorTarget get() = state.value.target
    private val sender = EditSender(scope, ::sendNoteEdit, ::sendDraftContent)
    private val noteEventCounts = HashMap<List<String>, Int>()
    private val positions = HashMap<List<String>, TextSelection>()
    private var owner: Any? = null
    private var updateSerial = 0
    private var earlyNameConfirmed = false
    private var handOff: Deferred<Boolean>? = null
    private var statsJob: Job? = null

    fun claim(owner: Any) {
        this.owner = owner
    }

    /** Leaves what [owner] opened, unless another screen claimed the editor since. */
    fun close(owner: Any) {
        if (this.owner !== owner) return
        this.owner = null
        perform {
            flush()
            if (this.owner != null) return@perform
            when (target) {
                is EditorTarget.Note -> core.send(CoreCommands.noteOpen, NoteOpenParams(null))
                is EditorTarget.Draft -> core.send(CoreCommands.draftLeave, Empty)
                EditorTarget.EarlyDraft, EditorTarget.None -> Unit
            }
            if (this.owner != null) return@perform
            setTarget(EditorTarget.None) { copy(openNote = null, update = null, nameError = null) }
        }
    }

    fun open(path: List<String>) =
        perform {
            flush()
            if (target == EditorTarget.Note(path)) {
                sendNoteOpen(path)
                return@perform
            }
            setTarget(EditorTarget.Note(path)) { nextLineage().copy(nameError = null) }
            sendNoteOpen(path)
        }

    /**
     * Starts a new note: a draft once the tree has loaded, an early draft before. [typed] is text
     * typed before the editor showed, which the core takes as the note's first content.
     */
    fun startNew(
        typed: String?,
        treeReady: Boolean,
    ) {
        if (treeReady && typed == null) {
            perform { startDraft() }
            return
        }
        draftText = typed.orEmpty()
        earlyNameConfirmed = false
        val focus = if (typed == null) DraftFocus.Name else DraftFocus.Body
        setTarget(EditorTarget.EarlyDraft) {
            nextLineage().copy(draftName = "", draftFocus = focus, nameError = null)
        }
        if (treeReady) perform { handOffEarlyDraft() }
    }

    /** Starts a draft holding [text], as when restoring a draft the process lost. */
    fun restoreDraft(
        name: String,
        text: String,
    ) = perform {
        if (!startDraft()) return@perform
        mutableState.update { it.copy(draftName = name) }
        if (text.isNotEmpty()) {
            draftText = text
            mutableState.update { it.nextLineage() }
            sender.submit(text, EditDestination.Draft)
        }
    }

    fun edit(text: String) {
        when (val current = target) {
            EditorTarget.None -> {
                return
            }

            is EditorTarget.Note -> {
                sender.submit(text, EditDestination.Note(current.path))
                scheduleStats(STATS_DELAY)
            }

            is EditorTarget.Draft -> {
                draftText = text
                sender.submit(text, EditDestination.Draft)
            }

            EditorTarget.EarlyDraft -> {
                draftText = text
            }
        }
    }

    suspend fun flush() = sender.flush()

    fun setDraftName(name: String) {
        if (!target.isDraft) return
        earlyNameConfirmed = false
        mutableState.update { it.copy(draftName = name, nameError = null) }
    }

    fun commitDraftName() =
        perform {
            flush()
            when (target) {
                EditorTarget.EarlyDraft -> {
                    earlyNameConfirmed = true
                }

                is EditorTarget.Draft -> {
                    val name = state.value.draftName
                    val params = DraftCommitNameParams(name)
                    when (val outcome = core.send(CoreCommands.draftCommitName, params).outcome) {
                        NoteDraftOutcome.None -> Unit
                        is NoteDraftOutcome.Error -> showNameError(outcome.message)
                        is NoteDraftOutcome.Created -> created(outcome.path, outcome.fieldError)
                    }
                }

                else -> {}
            }
        }

    /** Renames the open note; returns the error to show next to the name, if any. */
    suspend fun rename(name: String): String? {
        val path = target.notePath ?: return null
        flush()
        return try {
            val params = NoteRenameParams(path, name)
            when (val outcome = core.send(CoreCommands.noteRename, params).outcome) {
                NameCommitOutcome.None, NameCommitOutcome.Restore -> {
                    null
                }

                is NameCommitOutcome.Error -> {
                    outcome.message
                }

                is NameCommitOutcome.Ok -> {
                    if (target.notePath == path &&
                        outcome.path != path
                    ) {
                        relocate(path, outcome.path)
                    }
                    null
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            messageChannel.trySend(messageFor(error))
            null
        }
    }

    fun resolveConflict(resolution: ConflictResolution) =
        perform {
            flush()
            val note = state.value.targetNote as? OpenNote.Loaded ?: return@perform
            if (note.conflict == null) return@perform
            core.send(CoreCommands.conflictResolve, ConflictResolveParams(note.path, resolution))
            if (resolution == ConflictResolution.EDIT_MERGED) {
                mutableState.update { it.copy(switch = it.switch + 1) }
            }
        }

    /** Hands [images] to the core and returns the references to insert into the text. */
    suspend fun insertImages(images: List<ImageInput>): List<String> {
        if (images.isEmpty()) return emptyList()
        val ids =
            images.map { image ->
                UUID.randomUUID().toString().also {
                    stagedInputs.stage(
                        it,
                        image.bytes,
                        image.type,
                    )
                }
            }
        return try {
            core.send(CoreCommands.imageInsert, ImageInsertParams(ids)).references
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            messageChannel.trySend(messageFor(error))
            emptyList()
        } finally {
            ids.forEach(stagedInputs::take)
        }
    }

    suspend fun image(imageId: String): NoteImage? =
        try {
            core.send(CoreCommands.imageRead, ImageReadParams(imageId)).image
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            null
        }

    fun savePosition(
        path: List<String>,
        selection: TextSelection,
    ) {
        positions[path] = selection
    }

    fun position(path: List<String>): TextSelection? = positions[path]

    fun clearFocusAtEnd() {
        mutableState.update { it.copy(focusAtEnd = null) }
    }

    fun showMessage(text: UiText) {
        messageChannel.trySend(text)
    }

    internal fun onNoteChanged(event: CoreEvent.NoteChanged) {
        val note = event.note
        if (note != null) noteEventCounts[note.path] = (noteEventCounts[note.path] ?: 0) + 1
        val previousPath = state.value.openNote?.path
        mutableState.update { it.copy(openNote = note) }
        if (note !is OpenNote.Loaded) return
        val delivered = state.value.update
        if (delivered != null && delivered.path == note.path && delivered.content == note.content &&
            event.edits.isNullOrEmpty()
        ) {
            refreshStatsIfMissing()
            return
        }
        val targetPath = target.notePath
        val moved = targetPath != null && targetPath != note.path && previousPath == targetPath
        if (moved && event.edits != null) {
            relocate(targetPath, note.path)
        }
        deliver(note.path, note.content, event.edits?.map { TextChange(it.from, it.to, it.insert) })
        refreshStatsIfMissing()
    }

    /** Hands the early draft to the core; true when the editor then shows a draft or note. */
    internal suspend fun handOffEarlyDraft(): Boolean {
        handOff?.let { return it.await() }
        if (target != EditorTarget.EarlyDraft) return false
        val running = scope.async { performHandOff() }
        handOff = running
        return try {
            running.await()
        } finally {
            handOff = null
        }
    }

    internal fun reset() {
        statsJob?.cancel()
        owner = null
        draftText = ""
        earlyNameConfirmed = false
        noteEventCounts.clear()
        positions.clear()
        val previous = state.value
        mutableState.value =
            EditorState(switch = previous.switch + 1, lineage = previous.lineage + 1)
    }

    private suspend fun performHandOff(): Boolean {
        val name = state.value.draftName
        val body = draftText
        val params = EarlyDraftHandOffParams(name, body, earlyNameConfirmed)
        val outcome =
            try {
                core.send(CoreCommands.earlyDraftHandOff, params).outcome
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                messageChannel.trySend(messageFor(error))
                return false
            }
        if (target != EditorTarget.EarlyDraft) return false
        when (outcome) {
            EarlyDraftOutcome.None -> {
                return startDraft()
            }

            is EarlyDraftOutcome.Draft -> {
                setTarget(EditorTarget.Draft(emptyList())) {
                    copy(
                        draftName = if (draftName == name) outcome.name else draftName,
                        nameError = outcome.error,
                    )
                }
                if (draftText != body) sender.submit(draftText, EditDestination.Draft)
            }

            is EarlyDraftOutcome.Created -> {
                created(outcome.path, outcome.fieldError)
                if (draftText != body) sender.submit(draftText, EditDestination.Note(outcome.path))
            }
        }
        return true
    }

    private suspend fun startDraft(): Boolean =
        try {
            val draft = core.send(CoreCommands.draftStart, DraftStartParams(emptyList())).draft
            draftText = ""
            setTarget(EditorTarget.Draft(draft.parent)) {
                nextLineage().copy(draftName = "", draftFocus = DraftFocus.Name, nameError = null)
            }
            true
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            messageChannel.trySend(messageFor(error))
            false
        }

    /** The draft became a note; the editor keeps its text, which is the note's content. */
    private fun created(
        path: List<String>,
        fieldError: String?,
    ) {
        setTarget(EditorTarget.Note(path)) { copy(nameError = fieldError, focusAtEnd = path) }
    }

    private fun relocate(
        from: List<String>,
        to: List<String>,
    ) {
        positions.remove(from)?.let { positions[to] = it }
        setTarget(EditorTarget.Note(to))
    }

    private fun deliver(
        path: List<String>,
        content: String,
        edits: List<TextChange>?,
    ) {
        updateSerial += 1
        val update = NoteContentUpdate(updateSerial, path, content, edits)
        mutableState.update { it.copy(update = update) }
    }

    private suspend fun sendNoteOpen(path: List<String>?) {
        val eventsBefore = path?.let { noteEventCounts[it] ?: 0 }
        val note =
            try {
                core.send(CoreCommands.noteOpen, NoteOpenParams(path)).note
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                messageChannel.trySend(messageFor(error))
                return
            }
        if (note == null) {
            if (path == null) mutableState.update { it.copy(openNote = null) }
            return
        }
        // The response and the note's events travel separately, so an event that overtook the
        // response is newer than it.
        val overtaken = note.path == path && (noteEventCounts[note.path] ?: 0) != eventsBefore
        if (overtaken) return
        mutableState.update { it.copy(openNote = note) }
        if (note is OpenNote.Loaded) {
            val delivered = state.value.update
            val current = delivered?.path == note.path && delivered.content == note.content
            if (!current) {
                deliver(note.path, note.content, null)
            }
            refreshStatsIfMissing()
        }
    }

    private suspend fun sendNoteEdit(
        path: List<String>,
        text: String,
    ) {
        try {
            core.send(CoreCommands.noteEdit, NoteEditParams(path, text))
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            messageChannel.trySend(messageFor(error))
        }
    }

    private fun showNameError(message: String) {
        mutableState.update { it.copy(nameError = message) }
    }

    private suspend fun sendDraftContent(text: String): NoteDraftOutcome? =
        try {
            val name = state.value.draftName
            val params = DraftContentParams(name, text)
            val outcome = core.send(CoreCommands.draftContent, params).outcome
            when (outcome) {
                NoteDraftOutcome.None -> {}

                is NoteDraftOutcome.Error -> {
                    showNameError(outcome.message)
                }

                is NoteDraftOutcome.Created -> {
                    if (target is EditorTarget.Draft) created(outcome.path, outcome.fieldError)
                }
            }
            outcome
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            messageChannel.trySend(messageFor(error))
            null
        }

    private fun refreshStatsIfMissing() {
        val note = state.value.targetNote
        val missing = note is OpenNote.Loaded && state.value.words == null
        if (missing && statsJob?.isActive != true) scheduleStats(0.milliseconds)
    }

    private fun scheduleStats(after: kotlin.time.Duration) {
        statsJob?.cancel()
        statsJob =
            scope.launch {
                delay(after)
                val path = target.notePath ?: return@launch
                flush()
                val stats =
                    try {
                        core.send(CoreCommands.noteStats, PathParams(path))
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        return@launch
                    }
                if (target.notePath == path) mutableState.update { it.copy(words = stats.words) }
            }
    }

    private fun setTarget(
        next: EditorTarget,
        change: EditorState.() -> EditorState = { this },
    ) {
        val previousPath = target.notePath
        mutableState.update { it.change().copy(target = next) }
        if (next.notePath != previousPath) {
            statsJob?.cancel()
            mutableState.update { it.copy(words = null) }
            lastView.setNote(next.notePath)
            refreshStatsIfMissing()
        }
    }

    private fun EditorState.nextLineage() = copy(switch = switch + 1, lineage = lineage + 1)

    /** Runs [block] in the session scope, showing what fails. */
    private fun perform(block: suspend () -> Unit) {
        scope.launch {
            try {
                block()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                messageChannel.trySend(messageFor(error))
            }
        }
    }

    private fun messageFor(error: Exception): UiText =
        when (error) {
            is CoreException -> UiText.Plain(error.error.message)
            else -> UiText.Resource(R.string.note_action_failed)
        }

    private companion object {
        val STATS_DELAY = 300.milliseconds
    }
}
