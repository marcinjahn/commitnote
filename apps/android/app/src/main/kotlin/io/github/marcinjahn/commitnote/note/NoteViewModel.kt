package io.github.marcinjahn.commitnote.note

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.app.Appearance
import io.github.marcinjahn.commitnote.app.EditorState
import io.github.marcinjahn.commitnote.app.EditorTarget
import io.github.marcinjahn.commitnote.core.api.ConflictResolution
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.NodeTrashParams
import io.github.marcinjahn.commitnote.core.api.NoteImage
import io.github.marcinjahn.commitnote.core.api.PathParams
import io.github.marcinjahn.commitnote.core.api.PrintRenderParams
import io.github.marcinjahn.commitnote.core.api.TrashOutcome
import io.github.marcinjahn.commitnote.core.api.TrashPreview
import io.github.marcinjahn.commitnote.core.api.TreeNode
import io.github.marcinjahn.commitnote.core.runtime.CoreException
import io.github.marcinjahn.commitnote.editor.NoteEditorController
import io.github.marcinjahn.commitnote.editor.NoteMatch
import io.github.marcinjahn.commitnote.ui.UiText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch

/** The dialog the note screen shows, if any. */
sealed interface NoteDialog {
    data class Rename(
        val name: String,
        val error: String? = null,
    ) : NoteDialog

    data class Delete(
        val path: List<String>,
        val preview: TrashPreview,
    ) : NoteDialog
}

/** A note rendered for printing. */
class PrintJob(
    val name: String,
    val html: String,
)

/**
 * The screen of one note or new note. Text typed but not yet sent and the text of a draft are kept
 * in [savedState], so a process the system ends brings them back.
 */
class NoteViewModel(
    private val session: AppSession,
    path: List<String>?,
    typed: String?,
    match: NoteMatch?,
    private val savedState: SavedStateHandle,
    private val imageFiles: NoteImageFiles,
) : ViewModel() {
    private val editor = session.editor

    val state: StateFlow<EditorState> = editor.state
    val sync: StateFlow<CoreEvent.SyncStateChanged?> = session.sync
    val appearance: StateFlow<Appearance> = session.appearance
    val messages: Flow<UiText> = editor.messages

    val controller =
        NoteEditorController(
            editor,
            savedState[UNSENT_TEXT],
            ::onLocalEdit,
            match.takeIf { savedState.get<ArrayList<String>>(PATH) == null },
        )

    private val mutableDialog = MutableStateFlow<NoteDialog?>(null)
    val dialog: StateFlow<NoteDialog?> = mutableDialog.asStateFlow()

    private val printChannel = Channel<PrintJob>(Channel.CONFLATED)
    val printJobs: Flow<PrintJob> = printChannel.receiveAsFlow()

    private val closeChannel = Channel<Unit>(Channel.CONFLATED)

    /** Emits once the note is gone and the screen should close. */
    val closeRequests: Flow<Unit> = closeChannel.receiveAsFlow()

    private var unsentJob: Job? = null

    init {
        editor.claim(this)
        val savedPath = savedState.get<ArrayList<String>>(PATH)
        val draftName = savedState.get<String>(DRAFT_NAME)
        val draftText = savedState.get<String>(DRAFT_TEXT)
        when {
            savedPath != null -> {
                editor.open(savedPath)
            }

            path != null -> {
                editor.open(path)
            }

            draftName != null || draftText != null -> {
                editor.restoreDraft(
                    draftName.orEmpty(),
                    draftText.orEmpty(),
                )
            }

            else -> {
                editor.startNew(typed, treeReady = session.tree.value.nodes != null)
            }
        }
        viewModelScope.launch { editor.state.collect(::onState) }
    }

    /** The note's name as the tree shows it, or the last segment of its path. */
    fun noteName(path: List<String>): String =
        findNote(
            session.tree.value.nodes
                .orEmpty(),
            path,
        )?.name ?: path.last()

    fun setDraftName(name: String) {
        editor.setDraftName(name)
        savedState[DRAFT_NAME] = name
    }

    fun commitDraftName() = editor.commitDraftName()

    fun resolveConflict(resolution: ConflictResolution) = editor.resolveConflict(resolution)

    fun retrySync() {
        viewModelScope.launch { sendReporting { session.send(CoreCommands.syncRetry, Empty) } }
    }

    fun retryOpen() {
        state.value.target.notePath
            ?.let(editor::open)
    }

    suspend fun loadImage(imageId: String): NoteImage? = editor.image(imageId)

    fun openRename() {
        val path = state.value.target.notePath ?: return
        mutableDialog.value = NoteDialog.Rename(noteName(path))
    }

    fun rename(name: String) {
        viewModelScope.launch {
            val error = editor.rename(name)
            mutableDialog.value = error?.let { NoteDialog.Rename(name, it) }
        }
    }

    fun requestDelete() {
        val path = state.value.target.notePath ?: return
        viewModelScope.launch {
            sendReporting {
                val preview = session.send(CoreCommands.nodeTrashPreview, PathParams(path)).preview
                mutableDialog.value = NoteDialog.Delete(path, preview)
            }
        }
    }

    fun confirmDelete(dialog: NoteDialog.Delete) {
        mutableDialog.value = null
        viewModelScope.launch {
            sendReporting {
                editor.flush()
                val params = NodeTrashParams(dialog.path, dialog.preview.shareCount)
                when (val outcome = session.send(CoreCommands.nodeTrash, params).outcome) {
                    is TrashOutcome.Trashed, TrashOutcome.Deleted -> {
                        closeChannel.trySend(Unit)
                    }

                    is TrashOutcome.Confirm -> {
                        mutableDialog.value =
                            NoteDialog.Delete(dialog.path, outcome.preview)
                    }

                    is TrashOutcome.Error -> {
                        editor.showMessage(UiText.Plain(outcome.message))
                    }
                }
            }
        }
    }

    fun dismissDialog() {
        mutableDialog.value = null
    }

    fun print() {
        val path = state.value.target.notePath ?: return
        val name = noteName(path)
        val text = controller.text
        viewModelScope.launch {
            sendReporting {
                val html =
                    session
                        .send(
                            CoreCommands.printRender,
                            PrintRenderParams(name, text),
                        ).html
                printChannel.trySend(PrintJob(name, html))
            }
        }
    }

    fun newPhoto(): Uri = imageFiles.newPhoto()

    /** Inserts the images at [uris]; [fromCamera] when they are photos the camera wrote. */
    fun insertImages(
        uris: List<Uri>,
        fromCamera: Boolean = false,
    ) {
        viewModelScope.launch {
            try {
                val inputs = imageFiles.read(uris)
                if (inputs.isEmpty()) {
                    editor.showMessage(UiText.Resource(R.string.image_unavailable))
                    return@launch
                }
                controller.insertImageReferences(editor.insertImages(inputs))
            } finally {
                if (fromCamera) imageFiles.clearPhotos()
            }
        }
    }

    /** Photos the camera did not write, as when the user backed out of it. */
    fun discardPhotos() {
        viewModelScope.launch { imageFiles.clearPhotos() }
    }

    override fun onCleared() {
        editor.close(this)
    }

    private fun onState(state: EditorState) {
        controller.onState(state)
        val path = state.target.notePath ?: return
        if (savedState.get<ArrayList<String>>(PATH) != path) savedState[PATH] = ArrayList(path)
        savedState.remove<String>(DRAFT_NAME)
        savedState.remove<String>(DRAFT_TEXT)
    }

    private fun onLocalEdit(text: String) {
        val saved = text.takeIf { it.length <= SAVED_TEXT_LIMIT }
        if (state.value.target.isDraft) {
            savedState[DRAFT_TEXT] = saved
            return
        }
        savedState[UNSENT_TEXT] = saved
        unsentJob?.cancel()
        unsentJob =
            viewModelScope.launch {
                editor.flush()
                if (savedState.get<String>(UNSENT_TEXT) ==
                    saved
                ) {
                    savedState.remove<String>(UNSENT_TEXT)
                }
            }
    }

    private suspend fun sendReporting(block: suspend () -> Unit) {
        try {
            block()
        } catch (error: CancellationException) {
            throw error
        } catch (error: CoreException) {
            editor.showMessage(UiText.Plain(error.error.message))
        } catch (_: Exception) {
            editor.showMessage(UiText.Resource(R.string.note_action_failed))
        }
    }

    private companion object {
        const val PATH = "path"
        const val UNSENT_TEXT = "unsentText"
        const val DRAFT_NAME = "draftName"
        const val DRAFT_TEXT = "draftText"

        /** Saved state travels in a Binder transaction, which fails above about 1 MB. */
        const val SAVED_TEXT_LIMIT = 100_000

        fun findNote(
            nodes: List<TreeNode>,
            path: List<String>,
        ): TreeNode.Note? {
            for (node in nodes) {
                when (node) {
                    is TreeNode.Note -> if (node.path == path) return node
                    is TreeNode.Folder -> findNote(node.children, path)?.let { return it }
                }
            }
            return null
        }
    }
}
