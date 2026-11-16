package io.github.marcinjahn.commitnote.share

import androidx.lifecycle.viewModelScope
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.ShareIdParams
import io.github.marcinjahn.commitnote.core.api.ShareRenameOutcome
import io.github.marcinjahn.commitnote.core.api.ShareRenameParams
import io.github.marcinjahn.commitnote.core.api.ShareRowView
import io.github.marcinjahn.commitnote.core.api.SharedVersionOutcome
import io.github.marcinjahn.commitnote.ui.ActionViewModel
import io.github.marcinjahn.commitnote.ui.UiText
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** A dialog on a share. */
sealed interface ShareDialog {
    data class Rename(
        val row: ShareRowView,
        val error: String? = null,
    ) : ShareDialog

    data class Revoke(
        val row: ShareRowView,
    ) : ShareDialog
}

/** The version of a note a share link shows; [outcome] is null while it is loading or after it failed. */
data class SharedVersionState(
    val title: String,
    val loading: Boolean,
    val outcome: SharedVersionOutcome?,
)

/** The shares the core lists and what can be done to one of them. */
open class SharesViewModel(
    protected val session: AppSession,
) : ActionViewModel() {
    val shares: StateFlow<CoreEvent.SharesChanged?> = session.screens.shares

    private val mutableDialog = MutableStateFlow<ShareDialog?>(null)
    val dialog: StateFlow<ShareDialog?> = mutableDialog.asStateFlow()

    private val mutableVersion = MutableStateFlow<SharedVersionState?>(null)
    val version: StateFlow<SharedVersionState?> = mutableVersion.asStateFlow()

    private var versionJob: Job? = null
    private var versionRow: ShareRowView? = null

    /** Tells the user that [message] happened, such as a copy to the clipboard. */
    fun notify(message: String) = showMessage(UiText.Plain(message))

    fun update(row: ShareRowView) {
        launchAction { session.send(CoreCommands.shareUpdate, ShareIdParams(row.id)) }
    }

    fun requestRename(row: ShareRowView) {
        mutableDialog.value = ShareDialog.Rename(row)
    }

    fun rename(
        row: ShareRowView,
        label: String,
    ) {
        launchAction {
            val outcome =
                session
                    .send(
                        CoreCommands.shareRename,
                        ShareRenameParams(row.id, label),
                    ).outcome
            mutableDialog.value =
                when (outcome) {
                    ShareRenameOutcome.Ok -> null
                    is ShareRenameOutcome.Error -> ShareDialog.Rename(row, outcome.message)
                }
        }
    }

    fun requestRevoke(row: ShareRowView) {
        mutableDialog.value = ShareDialog.Revoke(row)
    }

    fun revoke(row: ShareRowView) {
        mutableDialog.value = null
        launchAction { session.send(CoreCommands.shareRevoke, ShareIdParams(row.id)) }
    }

    fun dismissDialog() {
        mutableDialog.value = null
    }

    fun viewVersion(row: ShareRowView) {
        versionRow = row
        loadVersion(row)
    }

    fun reloadVersion() {
        versionRow?.let(::loadVersion)
    }

    fun closeVersion() {
        versionJob?.cancel()
        versionRow = null
        mutableVersion.value = null
    }

    private fun loadVersion(row: ShareRowView) {
        versionJob?.cancel()
        mutableVersion.value = SharedVersionState(row.title, loading = true, outcome = null)
        versionJob =
            viewModelScope.launch {
                reporting {
                    val outcome =
                        session
                            .send(
                                CoreCommands.shareSharedVersion,
                                ShareIdParams(row.id),
                            ).outcome
                    mutableVersion.update { it?.copy(outcome = outcome) }
                }
                mutableVersion.update { it?.copy(loading = false) }
            }
    }
}
