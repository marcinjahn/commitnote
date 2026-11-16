package io.github.marcinjahn.commitnote.transfer

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.ui.Heading
import io.github.marcinjahn.commitnote.ui.ScrollingText

/**
 * Asks what to do when the repository cannot save changes atomically while an import runs: set it
 * up, or save without. Closing it without an answer hides it until the core reports the block again.
 */
@Composable
fun AtomicBlockedDialog(session: AppSession) {
    val status by session.screens.importStatus.collectAsStateWithLifecycle()
    val blocked = status?.atomicBlocked
    var dismissed by remember(blocked) { mutableStateOf(false) }
    if (blocked == null || dismissed) return

    AlertDialog(
        onDismissRequest = { dismissed = true },
        title = { Heading(blocked.title, MaterialTheme.typography.headlineSmall) },
        text = { ScrollingText(blocked.message) },
        confirmButton = {
            if (blocked.canConfigure) {
                TextButton(
                    onClick = {
                        dismissed = true
                        session.launchInSession {
                            session.send(
                                CoreCommands.importEnableAtomic,
                                Empty,
                            )
                        }
                    },
                    modifier = Modifier.testTag("atomic-enable"),
                ) { Text(blocked.enableLabel) }
            }
        },
        dismissButton = {
            TextButton(
                onClick = {
                    dismissed = true
                    session.launchInSession {
                        session.send(
                            CoreCommands.importSaveWithoutAtomic,
                            Empty,
                        )
                    }
                },
                modifier = Modifier.testTag("atomic-save-without"),
            ) { Text(blocked.saveWithoutLabel) }
        },
    )
}
