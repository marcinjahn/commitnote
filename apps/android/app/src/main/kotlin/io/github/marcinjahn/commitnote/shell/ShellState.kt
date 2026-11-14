package io.github.marcinjahn.commitnote.shell

import io.github.marcinjahn.commitnote.core.api.ForgeKind
import io.github.marcinjahn.commitnote.core.api.RepositoryListing
import io.github.marcinjahn.commitnote.core.api.RepositoryView
import io.github.marcinjahn.commitnote.core.api.TreeNode

sealed interface ShellScreen {
    data object Starting : ShellScreen

    data class Token(
        val forge: ForgeKind,
    ) : ShellScreen

    data class Repositories(
        val forge: ForgeKind,
        val repositories: List<RepositoryListing>,
    ) : ShellScreen

    data class Passphrase(
        val repository: RepositoryView,
    ) : ShellScreen

    /** [nodes] is null until the core has decrypted the tree. */
    data class Tree(
        val nodes: List<TreeNode>?,
    ) : ShellScreen
}

data class ShellState(
    val screen: ShellScreen = ShellScreen.Starting,
    val busy: Boolean = false,
    val error: String? = null,
)

data class TreeRow(
    val name: String,
    val depth: Int,
    val folder: Boolean,
)

fun List<TreeNode>.toRows(depth: Int = 0): List<TreeRow> =
    flatMap { node ->
        when (node) {
            is TreeNode.Folder -> {
                listOf(TreeRow(node.name, depth, folder = true)) +
                    node.children.toRows(depth + 1)
            }

            is TreeNode.Note -> {
                listOf(TreeRow(node.name, depth, folder = false))
            }
        }
    }
