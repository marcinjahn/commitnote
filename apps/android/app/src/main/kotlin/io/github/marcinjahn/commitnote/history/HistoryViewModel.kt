package io.github.marcinjahn.commitnote.history

import androidx.lifecycle.viewModelScope
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.HistoryVersionParams
import io.github.marcinjahn.commitnote.core.api.HistoryVersionView
import io.github.marcinjahn.commitnote.core.api.HistoryView
import io.github.marcinjahn.commitnote.core.api.PathParams
import io.github.marcinjahn.commitnote.core.api.RestoreVersionOutcome
import io.github.marcinjahn.commitnote.core.api.VersionPreview
import io.github.marcinjahn.commitnote.core.runtime.CoreException
import io.github.marcinjahn.commitnote.ui.ActionViewModel
import io.github.marcinjahn.commitnote.ui.UiText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The preview of the version the user opened. */
data class VersionPreviewState(
    val version: HistoryVersionView,
    val restoreTitle: Boolean = false,
    val preview: VersionPreview? = null,
    val loading: Boolean = true,
    val restoring: Boolean = false,
    val restoreMessage: String? = null,
)

/** The version history of one note, and the preview of a version of it. */
class HistoryViewModel(
    private val session: AppSession,
    path: List<String>,
) : ActionViewModel() {
    val history: StateFlow<HistoryView?> = session.screens.history

    private val mutablePreview = MutableStateFlow<VersionPreviewState?>(null)
    val preview: StateFlow<VersionPreviewState?> = mutablePreview.asStateFlow()

    private val leaveChannel = Channel<Unit>(Channel.CONFLATED)

    /** Emits once a version is restored: the history has nothing left to show. */
    val leaveRequests: Flow<Unit> = leaveChannel.receiveAsFlow()

    private var previewJob: Job? = null

    init {
        launchAction {
            session.editor.flush()
            session.send(CoreCommands.historyOpen, PathParams(path))
        }
    }

    fun loadMore() {
        launchAction { session.send(CoreCommands.historyLoadMore, Empty) }
    }

    fun retry() {
        launchAction { session.send(CoreCommands.historyRetry, Empty) }
    }

    fun openVersion(version: HistoryVersionView) {
        load(VersionPreviewState(version))
    }

    fun closeVersion() {
        previewJob?.cancel()
        mutablePreview.value = null
    }

    fun setRestoreTitle(restoreTitle: Boolean) {
        val current = mutablePreview.value ?: return
        load(current.copy(restoreTitle = restoreTitle, preview = null, restoreMessage = null))
    }

    fun reloadPreview() {
        val current = mutablePreview.value ?: return
        load(current.copy(preview = null))
    }

    fun restore() {
        val current = mutablePreview.value ?: return
        if (current.restoring) return
        mutablePreview.value = current.copy(restoring = true, restoreMessage = null)
        viewModelScope.launch {
            val message =
                try {
                    session.editor.flush()
                    val params = HistoryVersionParams(current.version.sha, current.restoreTitle)
                    when (val outcome = session.send(CoreCommands.historyRestore, params).outcome) {
                        RestoreVersionOutcome.Restored, RestoreVersionOutcome.Closed -> null
                        is RestoreVersionOutcome.Blocked -> outcome.message
                        is RestoreVersionOutcome.Error -> outcome.message
                    }
                } catch (error: CancellationException) {
                    throw error
                } catch (failure: CoreException) {
                    failure.error.message
                }
            if (message == null) {
                session.editor.showMessage(UiText.Resource(R.string.history_restored))
                leaveChannel.trySend(Unit)
            } else {
                mutablePreview.update { it?.copy(restoring = false, restoreMessage = message) }
            }
        }
    }

    override fun onCleared() {
        session.launchInSession { session.send(CoreCommands.historyClose, Empty) }
    }

    private fun load(state: VersionPreviewState) {
        previewJob?.cancel()
        mutablePreview.value = state.copy(loading = true)
        previewJob =
            viewModelScope.launch {
                val preview =
                    try {
                        session
                            .send(
                                CoreCommands.historyPreview,
                                HistoryVersionParams(state.version.sha, state.restoreTitle),
                            ).preview
                    } catch (error: CancellationException) {
                        throw error
                    } catch (failure: CoreException) {
                        VersionPreview.Failed(failure.error.message)
                    }
                mutablePreview.update { it?.copy(preview = preview, loading = false) }
            }
    }
}
