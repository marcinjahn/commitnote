package io.github.marcinjahn.commitnote.tree

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.app.TreeState
import io.github.marcinjahn.commitnote.core.api.ColorTag
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.FolderCreateOutcome
import io.github.marcinjahn.commitnote.core.api.FolderCreateParams
import io.github.marcinjahn.commitnote.core.api.LogoutOutcome
import io.github.marcinjahn.commitnote.core.api.MoveTargetView
import io.github.marcinjahn.commitnote.core.api.NodeMoveParams
import io.github.marcinjahn.commitnote.core.api.NodeRenameParams
import io.github.marcinjahn.commitnote.core.api.NodeSetColorTagParams
import io.github.marcinjahn.commitnote.core.api.NodeTrashParams
import io.github.marcinjahn.commitnote.core.api.PathParams
import io.github.marcinjahn.commitnote.core.api.StructureOutcome
import io.github.marcinjahn.commitnote.core.api.TagsSetFilterParams
import io.github.marcinjahn.commitnote.core.api.TrashOutcome
import io.github.marcinjahn.commitnote.core.api.TrashPreview
import io.github.marcinjahn.commitnote.core.api.TreeNode
import io.github.marcinjahn.commitnote.core.runtime.CoreException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** One visible line of the tree; [expanded] is meaningful for folders only. */
data class TreeRow(
    val node: TreeNode,
    val depth: Int,
    val expanded: Boolean,
)

/** The dialog the tree shows, if any. */
sealed interface TreeDialog {
    data class NewFolder(
        val error: String? = null,
    ) : TreeDialog

    data class Rename(
        val path: List<String>,
        val name: String,
        val error: String? = null,
    ) : TreeDialog

    data class MoveTo(
        val path: List<String>,
        val targets: List<MoveTargetView>,
    ) : TreeDialog

    data class ColorTagPicker(
        val path: List<String>,
        val current: ColorTag?,
    ) : TreeDialog

    data class Trash(
        val path: List<String>,
        val preview: TrashPreview,
    ) : TreeDialog

    data class LogoutUnsaved(
        val count: Int,
        val message: String,
    ) : TreeDialog

    data class Failure(
        val message: String,
    ) : TreeDialog
}

class TreeViewModel(
    private val session: AppSession,
) : ViewModel() {
    val tree: StateFlow<TreeState> = session.tree
    val sync: StateFlow<CoreEvent.SyncStateChanged?> = session.sync

    val typeToStart: StateFlow<Boolean> = session.typeToStart

    val rows: StateFlow<List<TreeRow>> =
        combine(session.tree, session.lastView.expanded) { tree, expanded ->
            flatten(tree.nodes.orEmpty(), expanded, expandAll = tree.tagFilter != null)
        }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    private val mutableDialog = MutableStateFlow<TreeDialog?>(null)
    val dialog: StateFlow<TreeDialog?> = mutableDialog.asStateFlow()

    fun toggle(path: List<String>) = session.lastView.toggle(path)

    fun dismissDialog() {
        mutableDialog.value = null
    }

    fun openNewFolder() {
        mutableDialog.value = TreeDialog.NewFolder()
    }

    fun createFolder(name: String) =
        perform {
            when (
                val outcome =
                    session
                        .send(
                            CoreCommands.folderCreate,
                            FolderCreateParams(emptyList(), name.trim()),
                        ).outcome
            ) {
                is FolderCreateOutcome.Created -> null
                is FolderCreateOutcome.Error -> TreeDialog.NewFolder(outcome.message)
            }
        }

    fun openRename(node: TreeNode) {
        mutableDialog.value = TreeDialog.Rename(node.path, node.name)
    }

    fun rename(
        path: List<String>,
        name: String,
    ) = perform {
        when (
            val outcome =
                session
                    .send(
                        CoreCommands.nodeRename,
                        NodeRenameParams(path, name.trim()),
                    ).outcome
        ) {
            is StructureOutcome.Ok -> null
            is StructureOutcome.Error -> TreeDialog.Rename(path, name, outcome.message)
        }
    }

    fun openMoveTo(path: List<String>) =
        perform {
            TreeDialog.MoveTo(
                path,
                session.send(CoreCommands.nodeMoveTargets, PathParams(path)).targets,
            )
        }

    fun move(
        path: List<String>,
        parent: List<String>,
    ) = perform {
        session
            .send(
                CoreCommands.nodeMove,
                NodeMoveParams(path, parent),
            ).outcome
            .failure()
    }

    fun openColorTag(node: TreeNode.Note) {
        mutableDialog.value = TreeDialog.ColorTagPicker(node.path, node.colorTag)
    }

    fun setColorTag(
        path: List<String>,
        tag: ColorTag?,
    ) = perform {
        session
            .send(
                CoreCommands.nodeSetColorTag,
                NodeSetColorTagParams(path, tag),
            ).outcome
            .failure()
    }

    fun requestTrash(path: List<String>) =
        perform {
            TreeDialog.Trash(
                path,
                session.send(CoreCommands.nodeTrashPreview, PathParams(path)).preview,
            )
        }

    fun confirmTrash(
        path: List<String>,
        preview: TrashPreview,
    ) = perform {
        when (
            val outcome =
                session
                    .send(
                        CoreCommands.nodeTrash,
                        NodeTrashParams(path, preview.shareCount),
                    ).outcome
        ) {
            is TrashOutcome.Trashed, TrashOutcome.Deleted -> null
            is TrashOutcome.Confirm -> TreeDialog.Trash(path, outcome.preview)
            is TrashOutcome.Error -> TreeDialog.Failure(outcome.message)
        }
    }

    fun setFilter(tag: ColorTag?) =
        perform {
            session.send(CoreCommands.tagsSetFilter, TagsSetFilterParams(tag))
            null
        }

    fun refresh() =
        perform {
            session.send(CoreCommands.syncRefresh, Empty)
            null
        }

    fun retry() =
        perform {
            session.send(CoreCommands.syncRetry, Empty)
            null
        }

    fun logOut(anyway: Boolean) =
        perform {
            when (val outcome = session.logOut(anyway)) {
                LogoutOutcome.LoggedOut -> null
                is LogoutOutcome.Unsaved -> TreeDialog.LogoutUnsaved(outcome.count, outcome.message)
            }
        }

    /** Closes the dialog, runs [action], and shows the dialog it returns or the core's error. */
    private fun perform(action: suspend () -> TreeDialog?) {
        mutableDialog.value = null
        viewModelScope.launch {
            mutableDialog.value =
                try {
                    action()
                } catch (failure: CoreException) {
                    TreeDialog.Failure(failure.error.message)
                }
        }
    }

    private fun StructureOutcome.failure(): TreeDialog? =
        when (this) {
            is StructureOutcome.Ok -> null
            is StructureOutcome.Error -> TreeDialog.Failure(message)
        }
}

private fun flatten(
    nodes: List<TreeNode>,
    expanded: Set<List<String>>,
    expandAll: Boolean,
): List<TreeRow> =
    buildList {
        fun visit(
            level: List<TreeNode>,
            depth: Int,
        ) {
            for (node in level) {
                val open = node is TreeNode.Folder && (expandAll || node.path in expanded)
                add(TreeRow(node, depth, open))
                if (open) visit(node.children, depth + 1)
            }
        }
        visit(nodes, 0)
    }
