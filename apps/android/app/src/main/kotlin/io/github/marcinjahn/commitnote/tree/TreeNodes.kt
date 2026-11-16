package io.github.marcinjahn.commitnote.tree

import io.github.marcinjahn.commitnote.core.api.TreeNode

val TreeNode.name: String
    get() =
        when (this) {
            is TreeNode.Folder -> name
            is TreeNode.Note -> name
        }

val TreeNode.path: List<String>
    get() =
        when (this) {
            is TreeNode.Folder -> path
            is TreeNode.Note -> path
        }
