package io.github.marcinjahn.commitnote.tree

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.core.api.ColorTag
import io.github.marcinjahn.commitnote.ui.ChoiceDialog
import io.github.marcinjahn.commitnote.ui.ConfirmDialog
import io.github.marcinjahn.commitnote.ui.FolderTargetRow
import io.github.marcinjahn.commitnote.ui.LogoutUnsavedDialog
import io.github.marcinjahn.commitnote.ui.NameDialog
import io.github.marcinjahn.commitnote.ui.ScrollingText

@Composable
fun TreeDialogHost(
    dialog: TreeDialog,
    viewModel: TreeViewModel,
    tagLabel: (ColorTag) -> String,
) {
    val dismiss = viewModel::dismissDialog
    when (dialog) {
        is TreeDialog.NewFolder -> {
            NameDialog(
                title = stringResource(R.string.new_folder_title),
                label = stringResource(R.string.folder_name),
                initial = "",
                error = dialog.error,
                confirmLabel = stringResource(R.string.action_create),
                onConfirm = viewModel::createFolder,
                onDismiss = dismiss,
            )
        }

        is TreeDialog.Rename -> {
            NameDialog(
                title = stringResource(R.string.node_rename),
                label = stringResource(R.string.node_name),
                initial = dialog.name,
                error = dialog.error,
                confirmLabel = stringResource(R.string.node_rename),
                onConfirm = { viewModel.rename(dialog.path, it) },
                onDismiss = dismiss,
            )
        }

        is TreeDialog.MoveTo -> {
            ChoiceDialog(stringResource(R.string.move_to_title), dismiss) {
                dialog.targets.forEach { target ->
                    FolderTargetRow(
                        label = target.label,
                        depth = target.depth,
                        enabled = !target.disabled,
                        modifier = Modifier.testTag("move-target-${target.label}"),
                    ) { viewModel.move(dialog.path, target.path) }
                }
            }
        }

        is TreeDialog.ColorTagPicker -> {
            ChoiceDialog(stringResource(R.string.node_color_tag), dismiss) {
                (listOf(null) + ColorTag.entries).forEach { tag ->
                    val selected = tag == dialog.current
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .selectable(
                                    selected,
                                    role = Role.RadioButton,
                                ) { viewModel.setColorTag(dialog.path, tag) }
                                .heightIn(min = 48.dp)
                                .testTag("color-tag-${tag?.name?.lowercase() ?: "none"}"),
                    ) {
                        RadioButton(selected = selected, onClick = null)
                        if (tag != null) TagDot(tag, Modifier.padding(start = 16.dp))
                        Text(
                            tag?.let(tagLabel) ?: stringResource(R.string.tag_none),
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.padding(start = 16.dp),
                        )
                    }
                }
            }
        }

        is TreeDialog.Trash -> {
            ConfirmDialog(
                title = dialog.preview.title,
                message = dialog.preview.message,
                confirmLabel = dialog.preview.confirmLabel,
                confirmTag = "trash-confirm",
                onConfirm = { viewModel.confirmTrash(dialog.path, dialog.preview) },
                onDismiss = dismiss,
            )
        }

        is TreeDialog.LogoutUnsaved -> {
            LogoutUnsavedDialog(
                count = dialog.count,
                message = dialog.message,
                onLogOutAnyway = { viewModel.logOut(anyway = true) },
                onDismiss = dismiss,
            )
        }

        is TreeDialog.Failure -> {
            AlertDialog(
                onDismissRequest = dismiss,
                confirmButton = {
                    TextButton(
                        onClick = dismiss,
                    ) { Text(stringResource(R.string.action_ok)) }
                },
                text = { ScrollingText(dialog.message, modifier = Modifier.testTag("tree-error")) },
            )
        }
    }
}
