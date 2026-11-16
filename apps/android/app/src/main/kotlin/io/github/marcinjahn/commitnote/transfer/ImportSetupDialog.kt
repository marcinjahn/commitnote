package io.github.marcinjahn.commitnote.transfer

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.ui.ScrollingText

/** Explains what an import needs set up first, and offers to set it up when the user can. */
@Composable
fun ImportSetupDialog(
    setup: ImportSetup,
    onEnable: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        text = {
            ScrollingText(
                setup.message,
                modifier = Modifier.testTag("import-setup-message"),
            )
        },
        confirmButton = {
            if (setup.canConfigure) {
                TextButton(onClick = onEnable, modifier = Modifier.testTag("import-setup-enable")) {
                    Text(setup.actionLabel)
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
        },
    )
}
