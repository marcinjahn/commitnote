package io.github.marcinjahn.commitnote.trash

import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.MoveTargetView
import io.github.marcinjahn.commitnote.core.api.StructureOutcome
import io.github.marcinjahn.commitnote.core.api.TrashEntryParams
import io.github.marcinjahn.commitnote.core.api.TrashEntryView
import io.github.marcinjahn.commitnote.core.api.TrashRestoreParams
import io.github.marcinjahn.commitnote.core.api.TrashRestoreTargetsParams
import io.github.marcinjahn.commitnote.ui.ActionViewModel
import io.github.marcinjahn.commitnote.ui.UiText
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** The dialog the trash screen shows, if any. */
sealed interface TrashDialog {
    /** Choosing where to restore the item at [subPath] of entry [entryId] to. */
    data class Restore(
        val entryId: String,
        val subPath: List<String>,
        val targets: List<MoveTargetView>,
    ) : TrashDialog

    data class Delete(
        val entry: TrashEntryView,
    ) : TrashDialog

    data object Empty : TrashDialog
}

class TrashViewModel(
    private val session: AppSession,
) : ActionViewModel() {
    val trash: StateFlow<CoreEvent.TrashChanged?> = session.screens.trash
    val tree = session.tree

    private val mutableDialog = MutableStateFlow<TrashDialog?>(null)
    val dialog: StateFlow<TrashDialog?> = mutableDialog.asStateFlow()

    fun requestRestore(
        entryId: String,
        subPath: List<String>,
    ) {
        launchAction {
            val targets =
                session
                    .send(
                        CoreCommands.trashRestoreTargets,
                        TrashRestoreTargetsParams(entryId, subPath),
                    ).targets
            mutableDialog.value = TrashDialog.Restore(entryId, subPath, targets)
        }
    }

    fun restore(
        dialog: TrashDialog.Restore,
        parent: List<String>,
    ) {
        mutableDialog.value = null
        launchAction {
            val params = TrashRestoreParams(dialog.entryId, dialog.subPath, parent)
            val outcome = session.send(CoreCommands.trashRestore, params).outcome
            if (outcome is StructureOutcome.Error) showMessage(UiText.Plain(outcome.message))
        }
    }

    fun requestDelete(entry: TrashEntryView) {
        mutableDialog.value = TrashDialog.Delete(entry)
    }

    fun delete(entry: TrashEntryView) {
        mutableDialog.value = null
        launchAction { session.send(CoreCommands.trashDelete, TrashEntryParams(entry.id)) }
    }

    fun requestEmpty() {
        mutableDialog.value = TrashDialog.Empty
    }

    fun empty() {
        mutableDialog.value = null
        launchAction { session.send(CoreCommands.trashEmpty, Empty) }
    }

    fun dismissDialog() {
        mutableDialog.value = null
    }
}
