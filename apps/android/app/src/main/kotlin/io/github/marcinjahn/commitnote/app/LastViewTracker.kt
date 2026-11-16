package io.github.marcinjahn.commitnote.app

import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.LastViewSetEnabledParams
import io.github.marcinjahn.commitnote.core.api.LastViewState
import io.github.marcinjahn.commitnote.core.runtime.CoreException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The open note and the expanded folders, which the core keeps per repository so the next unlock
 * opens where the user left. Nothing is saved until the stored view has been restored, so an
 * unlock does not overwrite it before reading it. Call it from the main thread.
 */
class LastViewTracker(
    private val core: CoreSender,
    private val scope: CoroutineScope,
) {
    private val mutableExpanded = MutableStateFlow<Set<List<String>>>(emptySet())
    val expanded: StateFlow<Set<List<String>>> = mutableExpanded.asStateFlow()

    private var note: List<String>? = null
    private var tracking = false

    fun toggle(folder: List<String>) {
        mutableExpanded.update {
            if (folder in it) it.minusElement(folder) else it.plusElement(folder)
        }
        save()
    }

    fun setNote(path: List<String>?) {
        if (path == note) return
        note = path
        save()
    }

    /** Expands the stored folders and returns the stored note, then starts saving changes. */
    suspend fun restore(): List<String>? {
        val view =
            try {
                core.send(CoreCommands.lastViewLoad, Empty).view
            } catch (_: CoreException) {
                null
            }
        if (view != null) mutableExpanded.update { it.union(view.folders) }
        tracking = true
        return view?.note
    }

    /** Starts saving changes without restoring, when the session opened something else first. */
    fun startTracking() {
        tracking = true
        save()
    }

    fun save() {
        if (!tracking) return
        val view = currentView()
        scope.launch {
            try {
                core.send(CoreCommands.lastViewSave, view)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
            }
        }
    }

    /** Turns remembering the view on or off; turning it off clears what was stored. */
    suspend fun setEnabled(enabled: Boolean) {
        core.send(
            CoreCommands.lastViewSetEnabled,
            LastViewSetEnabledParams(enabled, currentView()),
        )
    }

    fun reset() {
        tracking = false
        note = null
        mutableExpanded.value = emptySet()
    }

    private fun currentView() = LastViewState(note, expanded.value.sortedWith(pathOrder))

    private companion object {
        val pathOrder =
            Comparator<List<String>> { a, b ->
                a.zip(b).firstNotNullOfOrNull { (x, y) -> x.compareTo(y).takeIf { it != 0 } }
                    ?: a.size.compareTo(b.size)
            }
    }
}
