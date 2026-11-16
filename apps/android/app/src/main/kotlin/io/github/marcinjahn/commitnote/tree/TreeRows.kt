package io.github.marcinjahn.commitnote.tree

import android.content.ClipData
import android.content.ClipDescription
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.draganddrop.dragAndDropSource
import androidx.compose.foundation.draganddrop.dragAndDropTarget
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Notes
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.DragIndicator
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draganddrop.DragAndDropEvent
import androidx.compose.ui.draganddrop.DragAndDropTarget
import androidx.compose.ui.draganddrop.DragAndDropTransferData
import androidx.compose.ui.draganddrop.toAndroidDragEvent
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.focused
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.core.api.ColorTag
import io.github.marcinjahn.commitnote.core.api.TreeNode
import io.github.marcinjahn.commitnote.ui.LocalDarkTheme
import io.github.marcinjahn.commitnote.ui.Palette
import kotlinx.serialization.json.Json

/** What a row's long-press menu and accessibility actions offer. */
enum class NodeAction { Rename, MoveTo, ColorTag, Trash }

private const val NODE_CLIP_LABEL = "commitnote-node"
private val indent = 24.dp

/**
 * One tree row. A click opens a note or toggles a folder, a long press shows the node's actions,
 * and the handle drags the node onto a folder row.
 */
@Composable
fun TreeNodeRow(
    row: TreeRow,
    tagLabel: (ColorTag) -> String,
    canTag: Boolean,
    onActivate: () -> Unit,
    onAction: (NodeAction) -> Unit,
    onDrop: (path: List<String>, parent: List<String>) -> Unit,
    modifier: Modifier = Modifier,
) {
    val node = row.node
    val folder = node as? TreeNode.Folder
    val note = node as? TreeNode.Note
    var menuOpen by remember { mutableStateOf(false) }
    var focused by remember { mutableStateOf(false) }
    val actions =
        buildList {
            add(NodeAction.Rename)
            add(NodeAction.MoveTo)
            if (note != null && canTag) add(NodeAction.ColorTag)
            add(NodeAction.Trash)
        }
    val description = rowDescription(node, tagLabel)
    val state =
        folder?.let {
            stringResource(if (row.expanded) R.string.node_expanded else R.string.node_collapsed)
        }
    val clickLabel =
        when {
            folder == null -> stringResource(R.string.node_open)
            row.expanded -> stringResource(R.string.node_collapse)
            else -> stringResource(R.string.node_expand)
        }
    val menuLabel = stringResource(R.string.node_menu)
    val customActions =
        actions.map { action ->
            CustomAccessibilityAction(actionLabel(action)) {
                onAction(action)
                true
            }
        }

    Box(modifier = modifier) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier =
                Modifier
                    .fillMaxWidth()
                    .testTag("tree-node-${node.name}")
                    .then(
                        if (folder !=
                            null
                        ) {
                            Modifier.folderDropTarget(folder.path, onDrop)
                        } else {
                            Modifier
                        },
                    ).clearAndSetSemantics {
                        contentDescription = description
                        state?.let { stateDescription = it }
                        this.focused = focused
                        this.customActions = customActions
                        onClick(clickLabel) {
                            onActivate()
                            true
                        }
                        onLongClick(menuLabel) {
                            menuOpen = true
                            true
                        }
                    }.onFocusChanged { focused = it.isFocused }
                    .onKeyEvent { event ->
                        val opensMenu =
                            event.key == Key.Menu || (event.key == Key.F10 && event.isShiftPressed)
                        if (opensMenu && event.type == KeyEventType.KeyDown) menuOpen = true
                        opensMenu
                    }.combinedClickable(onClick = onActivate, onLongClick = { menuOpen = true })
                    .heightIn(min = 48.dp)
                    .padding(start = 8.dp + indent * row.depth, end = 4.dp),
        ) {
            NodeIcon(row)
            Text(
                node.name,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.weight(1f).padding(vertical = 8.dp),
            )
            note?.colorTag?.let { TagDot(it) }
            if (note?.shared == true) {
                Icon(
                    Icons.Outlined.Share,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                )
            }
            if (folder != null) {
                Text(
                    folder.noteCount.toString(),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DragHandle(node.path)
        }
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
            actions.forEach { action ->
                DropdownMenuItem(
                    text = { Text(actionLabel(action)) },
                    onClick = {
                        menuOpen = false
                        onAction(action)
                    },
                    modifier = Modifier.testTag("node-action-${action.name.lowercase()}"),
                )
            }
        }
    }
}

@Composable
private fun NodeIcon(row: TreeRow) {
    val tint = MaterialTheme.colorScheme.onSurfaceVariant
    if (row.node is TreeNode.Folder) {
        Icon(
            if (row.expanded) Icons.Filled.ExpandMore else Icons.Filled.ChevronRight,
            contentDescription = null,
            tint = tint,
        )
        Icon(Icons.Outlined.Folder, contentDescription = null, tint = tint)
    } else {
        Box(modifier = Modifier.size(24.dp))
        Icon(Icons.AutoMirrored.Outlined.Notes, contentDescription = null, tint = tint)
    }
}

@Composable
fun TagDot(
    tag: ColorTag,
    modifier: Modifier = Modifier,
) {
    Box(modifier = modifier.size(12.dp).background(tagColor(tag)))
}

@Composable
fun tagColor(tag: ColorTag): Color = Palette.tagColor(tag, LocalDarkTheme.current)

@Composable
private fun DragHandle(path: List<String>) {
    Box(
        contentAlignment = Alignment.Center,
        modifier =
            Modifier
                .size(48.dp)
                .dragAndDropSource { _ ->
                    DragAndDropTransferData(
                        ClipData.newPlainText(NODE_CLIP_LABEL, Json.encodeToString(path)),
                    )
                },
    ) {
        Icon(
            Icons.Filled.DragIndicator,
            contentDescription = stringResource(R.string.node_drag),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun Modifier.folderDropTarget(
    folder: List<String>,
    onDrop: (path: List<String>, parent: List<String>) -> Unit,
): Modifier {
    val currentOnDrop by rememberUpdatedState(onDrop)
    val target =
        remember(folder) {
            object : DragAndDropTarget {
                override fun onDrop(event: DragAndDropEvent): Boolean {
                    val path = event.draggedPath() ?: return false
                    if (path == folder) return false
                    currentOnDrop(path, folder)
                    return true
                }
            }
        }
    return dragAndDropTarget(shouldStartDragAndDrop = { it.isNodeDrag() }, target = target)
}

private fun DragAndDropEvent.isNodeDrag(): Boolean {
    val description = toAndroidDragEvent().clipDescription ?: return false
    return description.label == NODE_CLIP_LABEL &&
        description.hasMimeType(ClipDescription.MIMETYPE_TEXT_PLAIN)
}

private fun DragAndDropEvent.draggedPath(): List<String>? {
    val clip = toAndroidDragEvent().clipData ?: return null
    if (clip.itemCount == 0) return null
    val text = clip.getItemAt(0).text?.toString() ?: return null
    return runCatching { Json.decodeFromString<List<String>>(text) }.getOrNull()
}

@Composable
private fun rowDescription(
    node: TreeNode,
    tagLabel: (ColorTag) -> String,
): String =
    when (node) {
        is TreeNode.Folder -> {
            listOf(
                stringResource(R.string.node_folder, node.name),
                pluralStringResource(R.plurals.folder_note_count, node.noteCount, node.noteCount),
            )
        }

        is TreeNode.Note -> {
            listOfNotNull(
                stringResource(R.string.node_note, node.name),
                node.colorTag?.let { stringResource(R.string.node_tag, tagLabel(it)) },
                stringResource(R.string.node_shared).takeIf { node.shared },
            )
        }
    }.joinToString(", ")

@Composable
fun actionLabel(action: NodeAction): String =
    stringResource(
        when (action) {
            NodeAction.Rename -> R.string.node_rename
            NodeAction.MoveTo -> R.string.node_move_to
            NodeAction.ColorTag -> R.string.node_color_tag
            NodeAction.Trash -> R.string.node_trash
        },
    )
