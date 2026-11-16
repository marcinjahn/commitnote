package io.github.marcinjahn.commitnote.app

import io.github.marcinjahn.commitnote.core.api.ColorTag
import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.SettingsView
import io.github.marcinjahn.commitnote.core.api.TagOptionView
import io.github.marcinjahn.commitnote.core.api.TreeNode

/** [nodes] is null until the core has read the tree. */
data class TreeState(
    val nodes: List<TreeNode>? = null,
    val tagFilter: ColorTag? = null,
    val usedTags: List<ColorTag> = emptyList(),
    val tagsWritable: Boolean = false,
    val tagOptions: List<TagOptionView> = emptyList(),
) {
    companion object {
        fun from(event: CoreEvent.TreeChanged) =
            TreeState(
                event.tree,
                event.tagFilter,
                event.usedTags,
                event.tagsWritable,
                event.tagOptions,
            )
    }
}

/** The appearance settings, as the core's setting ids. */
data class Appearance(
    val colorMode: String = SYSTEM,
    val accentColor: String = SYSTEM,
    val noteFont: String = SYSTEM,
) {
    companion object {
        const val SYSTEM = "system"

        fun from(values: SettingsView.Values) =
            Appearance(values.colorMode, values.accentColor, values.noteFont)
    }
}

/** A file's bytes and MIME type (empty when unknown), to stage for the core. */
class StagedFile(
    val bytes: ByteArray,
    val type: String,
)
