package io.github.marcinjahn.commitnote.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import io.github.marcinjahn.commitnote.R

@Composable
fun NameDialog(
    title: String,
    label: String,
    initial: String,
    error: String?,
    confirmLabel: String,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by rememberSaveable(initial) { mutableStateOf(initial) }
    val confirm = { if (name.isNotBlank()) onConfirm(name) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Heading(title, MaterialTheme.typography.headlineSmall) },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text(label) },
                    singleLine = true,
                    isError = error != null,
                    supportingText = error?.let { { Text(it) } },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { confirm() }),
                    modifier = Modifier.fillMaxWidth().testTag("name-field"),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = confirm,
                enabled = name.isNotBlank(),
                modifier = Modifier.testTag("dialog-confirm"),
            ) {
                Text(confirmLabel)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
        },
    )
}

@Composable
fun ConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String,
    confirmTag: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Heading(title, MaterialTheme.typography.headlineSmall) },
        text = { ScrollingText(message) },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                modifier = Modifier.testTag(confirmTag),
            ) { Text(confirmLabel) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
        },
    )
}

/** The text of a dialog, which scrolls when the window is too short to show all of it. */
@Composable
fun ScrollingText(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(text, modifier = modifier.verticalScroll(rememberScrollState()))
}

/** A dialog with a scrolling [content] and only a cancel button, for picking among options. */
@Composable
fun ChoiceDialog(
    title: String,
    onDismiss: () -> Unit,
    content: @Composable () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Heading(title, MaterialTheme.typography.headlineSmall) },
        text = { Column(modifier = Modifier.verticalScroll(rememberScrollState())) { content() } },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
        },
    )
}

/** One folder of a destination list, indented by its [depth]; a disabled one cannot be picked. */
@Composable
fun FolderTargetRow(
    label: String,
    depth: Int,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    onClick: () -> Unit,
) {
    Text(
        label,
        style = MaterialTheme.typography.bodyLarge,
        fontWeight = if (selected) FontWeight.Bold else null,
        color =
            if (enabled) {
                MaterialTheme.colorScheme.onSurface
            } else {
                MaterialTheme.colorScheme.onSurface.copy(alpha = DISABLED_ALPHA)
            },
        modifier =
            Modifier
                .fillMaxWidth()
                .selectable(
                    selected = selected,
                    enabled = enabled,
                    role = Role.Button,
                    onClick = onClick,
                ).heightIn(min = 48.dp)
                .padding(start = 16.dp * depth, top = 12.dp, bottom = 12.dp)
                .then(modifier),
    )
}

private const val DISABLED_ALPHA = 0.38f

/** Warns that [count] changes are not saved yet and offers to log out anyway. */
@Composable
fun LogoutUnsavedDialog(
    count: Int,
    message: String,
    onLogOutAnyway: () -> Unit,
    onDismiss: () -> Unit,
) {
    ConfirmDialog(
        title = pluralStringResource(R.plurals.logout_unsaved_title, count, count),
        message = message,
        confirmLabel = stringResource(R.string.logout_anyway),
        confirmTag = "logout-anyway",
        onConfirm = onLogOutAnyway,
        onDismiss = onDismiss,
    )
}
