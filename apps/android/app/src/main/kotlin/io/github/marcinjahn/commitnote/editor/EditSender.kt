package io.github.marcinjahn.commitnote.editor

import io.github.marcinjahn.commitnote.core.api.NoteDraftOutcome
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

sealed interface EditDestination {
    data class Note(
        val path: List<String>,
    ) : EditDestination

    data object Draft : EditDestination
}

/**
 * Sends the editor's text one command at a time. Text submitted while a send is in flight replaces
 * any text still waiting, so only the newest one goes next. Call it from the main thread.
 */
class EditSender(
    private val scope: CoroutineScope,
    private val editNote: suspend (path: List<String>, text: String) -> Unit,
    private val draftContent: suspend (text: String) -> NoteDraftOutcome?,
) {
    private data class Pending(
        val destination: EditDestination,
        val text: String,
    )

    private var pending: Pending? = null
    private var sending = false
    private val waiters = mutableListOf<CompletableDeferred<Unit>>()

    val isIdle: Boolean get() = !sending && pending == null

    fun submit(
        text: String,
        destination: EditDestination,
    ) {
        pending = Pending(destination, text)
        if (sending) return
        sending = true
        scope.launch { drain() }
    }

    suspend fun flush() {
        if (isIdle) return
        CompletableDeferred<Unit>().also(waiters::add).await()
    }

    private suspend fun drain() {
        try {
            while (true) {
                val edit = pending ?: break
                pending = null
                when (val destination = edit.destination) {
                    is EditDestination.Note -> {
                        editNote(destination.path, edit.text)
                    }

                    EditDestination.Draft -> {
                        val outcome = draftContent(edit.text)
                        val waiting = pending
                        // Text typed while the draft was being created belongs to the created note.
                        if (outcome is NoteDraftOutcome.Created &&
                            waiting?.destination == EditDestination.Draft
                        ) {
                            pending = waiting.copy(destination = EditDestination.Note(outcome.path))
                        }
                    }
                }
            }
        } finally {
            sending = false
            val resumed = waiters.toList()
            waiters.clear()
            resumed.forEach { it.complete(Unit) }
        }
    }
}
