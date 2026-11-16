package io.github.marcinjahn.commitnote.share

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import io.github.marcinjahn.commitnote.core.api.ShareActionId
import io.github.marcinjahn.commitnote.core.api.ShareActionView
import io.github.marcinjahn.commitnote.core.api.ShareCopy
import io.github.marcinjahn.commitnote.core.api.ShareRowView
import io.github.marcinjahn.commitnote.ui.ConfirmDialog
import io.github.marcinjahn.commitnote.ui.NameDialog
import io.github.marcinjahn.commitnote.ui.Progress
import io.github.marcinjahn.commitnote.ui.openUrl

/**
 * Runs the share action the user picked from a row's menu. [onOpenNote] navigates to a shared note;
 * a sheet that already shows the note passes null, which hides that action.
 */
@Composable
fun rememberShareActions(
    viewModel: SharesViewModel,
    copy: ShareCopy?,
    onOpenNote: ((List<String>) -> Unit)?,
): (ShareRowView, ShareActionId) -> Unit {
    val context = LocalContext.current
    return { row, action ->
        when (action) {
            ShareActionId.COPY_LINK -> {
                context.copyToClipboard(row.link, sensitive = false)
                copy?.let { viewModel.notify(it.linkCopied) }
            }

            ShareActionId.COPY_PASSWORD -> {
                row.password?.let { context.copyToClipboard(it, sensitive = true) }
                copy?.let { viewModel.notify(it.passwordCopied) }
            }

            ShareActionId.UPDATE -> {
                viewModel.update(row)
            }

            ShareActionId.VIEW -> {
                viewModel.viewVersion(row)
            }

            ShareActionId.OPEN -> {
                row.notePath?.let { onOpenNote?.invoke(it) }
            }

            ShareActionId.RENAME -> {
                viewModel.requestRename(row)
            }

            ShareActionId.REVOKE -> {
                viewModel.requestRevoke(row)
            }
        }
    }
}

/** The rename and revoke confirmations that a row's menu opens. */
@Composable
fun ShareDialogs(
    dialog: ShareDialog?,
    copy: ShareCopy?,
    viewModel: SharesViewModel,
) {
    if (copy == null) return
    when (val shown = dialog) {
        null -> {}

        is ShareDialog.Rename -> {
            NameDialog(
                title = copy.rename.title,
                label = copy.rename.fieldLabel,
                initial = shown.row.label.orEmpty(),
                error = shown.error,
                confirmLabel = copy.rename.confirmLabel,
                onConfirm = { viewModel.rename(shown.row, it) },
                onDismiss = viewModel::dismissDialog,
            )
        }

        is ShareDialog.Revoke -> {
            ConfirmDialog(
                title = copy.revoke.title,
                message = copy.revoke.message,
                confirmLabel = copy.revoke.confirmLabel,
                confirmTag = "share-revoke-confirm",
                onConfirm = { viewModel.revoke(shown.row) },
                onDismiss = viewModel::dismissDialog,
            )
        }
    }
}

/** One share: what it is, whether it is protected, and a menu of what can be done to it. */
@Composable
fun ShareRow(
    row: ShareRowView,
    copy: ShareCopy,
    updating: Boolean,
    hidden: Set<ShareActionId>,
    onAction: (ShareRowView, ShareActionId) -> Unit,
    modifier: Modifier = Modifier,
) {
    var menuOpen by remember { mutableStateOf(false) }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = modifier.fillMaxWidth().heightIn(min = 56.dp).padding(start = 16.dp),
    ) {
        Column(modifier = Modifier.weight(1f).padding(vertical = 8.dp)) {
            Text(row.label ?: row.title, style = MaterialTheme.typography.bodyLarge)
            if (row.label != null) {
                Text(
                    row.title,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                if (row.passwordProtected) "${row.date} · ${copy.passwordProtected}" else row.date,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (updating) Progress(copy.updating)
        }
        Column {
            IconButton(
                onClick = { menuOpen = true },
                modifier = Modifier.testTag("share-row-menu"),
            ) {
                Icon(Icons.Filled.MoreVert, row.menuLabel)
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                row.actions.filter { it.id !in hidden }.forEach { action ->
                    ShareMenuItem(action) {
                        menuOpen = false
                        onAction(row, action.id)
                    }
                }
            }
        }
    }
}

@Composable
private fun ShareMenuItem(
    action: ShareActionView,
    onClick: () -> Unit,
) {
    DropdownMenuItem(
        text = {
            Text(
                action.label,
                color =
                    with(
                        MaterialTheme.colorScheme,
                    ) { if (action.destructive) error else onSurface },
            )
        },
        enabled = !action.disabled,
        onClick = onClick,
        modifier =
            Modifier.testTag("share-action-${action.id.name.lowercase().replace('_', '-')}"),
    )
}
