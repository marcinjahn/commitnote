package io.github.marcinjahn.commitnote.trash

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Notes
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CollectionInfo
import androidx.compose.ui.semantics.collectionInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.core.api.ColorTag
import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.TrashEntryView
import io.github.marcinjahn.commitnote.core.api.TrashItemKind
import io.github.marcinjahn.commitnote.core.api.TrashItemView
import io.github.marcinjahn.commitnote.tree.TagDot
import io.github.marcinjahn.commitnote.tree.rememberTagLabel
import io.github.marcinjahn.commitnote.ui.ChoiceDialog
import io.github.marcinjahn.commitnote.ui.ConfirmDialog
import io.github.marcinjahn.commitnote.ui.FolderTargetRow
import io.github.marcinjahn.commitnote.ui.Progress
import io.github.marcinjahn.commitnote.ui.ScreenScaffold
import io.github.marcinjahn.commitnote.ui.ShowMessages

/** The trash: deleted notes and folders that can be restored until they expire. */
@Composable
fun TrashScreen(
    session: AppSession,
    onBack: () -> Unit,
) {
    val viewModel: TrashViewModel =
        viewModel(factory = viewModelFactory { initializer { TrashViewModel(session) } })
    val trash by viewModel.trash.collectAsStateWithLifecycle()
    val tree by viewModel.tree.collectAsStateWithLifecycle()
    val dialog by viewModel.dialog.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    ShowMessages(viewModel.messages, snackbar)
    val tagLabel = rememberTagLabel(tree)
    val current = trash

    ScreenScaffold(
        title = stringResource(R.string.trash_title),
        onBack = onBack,
        snackbar = snackbar,
        actions = {
            TextButton(
                onClick = viewModel::requestEmpty,
                enabled = current?.entries?.isNotEmpty() == true,
                modifier = Modifier.testTag("trash-empty"),
            ) {
                Text(stringResource(R.string.trash_empty_action))
            }
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (current == null) {
                Box(
                    modifier = Modifier.padding(24.dp),
                ) { Progress(stringResource(R.string.trash_loading)) }
            } else {
                TrashList(
                    entries = current.entries,
                    tagLabel = tagLabel,
                    onRestore = viewModel::requestRestore,
                    onDelete = viewModel::requestDelete,
                )
            }
        }
    }

    TrashDialogs(dialog, current, viewModel)
}

@Composable
private fun TrashDialogs(
    dialog: TrashDialog?,
    trash: CoreEvent.TrashChanged?,
    viewModel: TrashViewModel,
) {
    when (val shown = dialog) {
        null -> {}

        is TrashDialog.Restore -> {
            ChoiceDialog(
                title = stringResource(R.string.trash_restore_title),
                onDismiss = viewModel::dismissDialog,
            ) {
                shown.targets.forEach { target ->
                    FolderTargetRow(
                        label = target.label,
                        depth = target.depth,
                        enabled = !target.disabled,
                        modifier = Modifier.testTag("trash-target"),
                        onClick = { viewModel.restore(shown, target.path) },
                    )
                }
            }
        }

        is TrashDialog.Delete -> {
            trash?.deleteConfirmation?.let { text ->
                ConfirmDialog(
                    title = text.title,
                    message = text.message,
                    confirmLabel = stringResource(R.string.trash_delete),
                    confirmTag = "trash-delete-confirm",
                    onConfirm = { viewModel.delete(shown.entry) },
                    onDismiss = viewModel::dismissDialog,
                )
            }
        }

        TrashDialog.Empty -> {
            trash?.emptyConfirmation?.let { text ->
                ConfirmDialog(
                    title = text.title,
                    message = text.message,
                    confirmLabel = stringResource(R.string.trash_empty_action),
                    confirmTag = "trash-empty-confirm",
                    onConfirm = viewModel::empty,
                    onDismiss = viewModel::dismissDialog,
                )
            }
        }
    }
}

@Composable
private fun TrashList(
    entries: List<TrashEntryView>,
    tagLabel: (ColorTag) -> String,
    onRestore: (String, List<String>) -> Unit,
    onDelete: (TrashEntryView) -> Unit,
) {
    LazyColumn(
        modifier =
            Modifier
                .fillMaxSize()
                .semantics {
                    collectionInfo =
                        CollectionInfo(rowCount = entries.size, columnCount = 1)
                }.testTag("trash-list"),
    ) {
        if (entries.isEmpty()) {
            item(key = "empty") {
                Text(
                    stringResource(R.string.trash_is_empty),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(24.dp).testTag("trash-placeholder"),
                )
            }
        }
        items(entries, key = { it.id }) { entry ->
            TrashEntryRow(entry, tagLabel, onRestore, onDelete)
            HorizontalDivider()
        }
        item(key = "retention") {
            Text(
                stringResource(R.string.trash_retention),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth().padding(16.dp).testTag("trash-retention"),
            )
        }
    }
}

@Composable
private fun TrashEntryRow(
    entry: TrashEntryView,
    tagLabel: (ColorTag) -> String,
    onRestore: (String, List<String>) -> Unit,
    onDelete: (TrashEntryView) -> Unit,
) {
    var expanded by rememberSaveable(entry.id) { mutableStateOf(false) }
    val expandable = entry.children.isNotEmpty()
    val subtitle =
        if (entry.originalFolder.isBlank()) {
            entry.daysLeft
        } else {
            stringResource(R.string.trash_subtitle, entry.originalFolder, entry.daysLeft)
        }
    Column {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 56.dp)
                    .then(
                        if (expandable) {
                            val state =
                                stringResource(
                                    if (expanded) {
                                        R.string.node_expanded
                                    } else {
                                        R.string.node_collapsed
                                    },
                                )
                            Modifier
                                .clickable(
                                    onClickLabel =
                                        stringResource(
                                            if (expanded) {
                                                R.string.node_collapse
                                            } else {
                                                R.string.node_expand
                                            },
                                        ),
                                    onClick = { expanded = !expanded },
                                ).semantics { stateDescription = state }
                        } else {
                            Modifier
                        },
                    ).padding(start = 16.dp)
                    .testTag("trash-entry"),
        ) {
            ItemIcon(entry.kind, expandable, expanded)
            Column(modifier = Modifier.weight(1f).padding(vertical = 8.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        entry.name,
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    entry.colorTag?.let { tag ->
                        TagDot(
                            tag,
                            Modifier.semantics { contentDescription = tagLabel(tag) },
                        )
                    }
                }
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            EntryMenu(
                entry,
                onRestore = { onRestore(entry.id, emptyList()) },
                onDelete = { onDelete(entry) },
            )
        }
        if (expanded) {
            entry.children.forEach { child -> ChildRow(entry, child, depth = 1, onRestore) }
        }
    }
}

@Composable
private fun ChildRow(
    entry: TrashEntryView,
    item: TrashItemView,
    depth: Int,
    onRestore: (String, List<String>) -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .padding(start = 16.dp + 24.dp * depth)
                .testTag("trash-child"),
    ) {
        ItemIcon(item.kind, expandable = false, expanded = false)
        Text(
            item.name,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = { onRestore(entry.id, item.subPath) }) {
            Text(stringResource(R.string.trash_restore_child, item.name))
        }
    }
    item.children.forEach { child -> ChildRow(entry, child, depth + 1, onRestore) }
}

@Composable
private fun ItemIcon(
    kind: TrashItemKind,
    expandable: Boolean,
    expanded: Boolean,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (expandable) {
            Icon(
                if (expanded) Icons.Filled.ExpandMore else Icons.Filled.ChevronRight,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
            )
        }
        Icon(
            if (kind ==
                TrashItemKind.FOLDER
            ) {
                Icons.Outlined.Folder
            } else {
                Icons.AutoMirrored.Outlined.Notes
            },
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun EntryMenu(
    entry: TrashEntryView,
    onRestore: () -> Unit,
    onDelete: () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }, modifier = Modifier.testTag("trash-entry-menu")) {
            Icon(
                Icons.Filled.MoreVert,
                stringResource(R.string.trash_entry_actions, entry.name),
            )
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.trash_restore)) },
                onClick = {
                    open = false
                    onRestore()
                },
                modifier = Modifier.testTag("trash-restore"),
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.trash_delete)) },
                onClick = {
                    open = false
                    onDelete()
                },
                modifier = Modifier.testTag("trash-delete"),
            )
        }
    }
}
