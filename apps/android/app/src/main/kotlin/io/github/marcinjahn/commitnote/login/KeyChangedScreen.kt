package io.github.marcinjahn.commitnote.login

import android.content.ContentResolver
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.app.SessionPhase
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.transfer.ExportState
import io.github.marcinjahn.commitnote.transfer.NotesExporter
import io.github.marcinjahn.commitnote.ui.ErrorText
import io.github.marcinjahn.commitnote.ui.FormScaffold
import io.github.marcinjahn.commitnote.ui.FormViewModel
import io.github.marcinjahn.commitnote.ui.Heading
import io.github.marcinjahn.commitnote.ui.Progress
import io.github.marcinjahn.commitnote.ui.RememberSwitch
import io.github.marcinjahn.commitnote.ui.SecretField
import io.github.marcinjahn.commitnote.ui.UiText
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/** Exports the unsaved notes to a document the user picks, then unlocks with the new passphrase. */
class KeyChangedViewModel(
    private val session: AppSession,
) : FormViewModel() {
    private val exporter = NotesExporter(session, includeImages = false, scope = viewModelScope)
    val export: StateFlow<ExportState> = exporter.state

    /** The file names to ask the user where to save the export under. */
    val saveRequests: Flow<String> = exporter.saveRequests

    fun export() = exporter.export()

    fun save(
        uri: Uri?,
        contentResolver: ContentResolver,
    ) = exporter.save(uri, contentResolver)

    fun unlock(
        passphrase: String,
        remember: Boolean,
    ) = submit(
        invalid = UiText.Resource(R.string.passphrase_blank).takeIf { passphrase.isEmpty() },
    ) {
        session.unlockWithNewKey(Secret(passphrase), remember)
        null
    }

    fun logInAgain() =
        submit {
            session.abandonSession()
            null
        }
}

@Composable
fun KeyChangedScreen(
    session: AppSession,
    phase: SessionPhase.KeyChanged,
) {
    val viewModel: KeyChangedViewModel =
        viewModel(factory = viewModelFactory { initializer { KeyChangedViewModel(session) } })
    val form by viewModel.form.collectAsStateWithLifecycle()
    val export by viewModel.export.collectAsStateWithLifecycle()
    val contentResolver = LocalContext.current.contentResolver
    val saveDocument =
        rememberLauncherForActivityResult(
            ActivityResultContracts.CreateDocument("application/zip"),
        ) { uri ->
            viewModel.save(uri, contentResolver)
        }
    LaunchedEffect(viewModel) { viewModel.saveRequests.collect { saveDocument.launch(it) } }
    var passphrase by remember { mutableStateOf("") }
    var rememberMe by rememberSaveable { mutableStateOf(true) }
    val unlock = { viewModel.unlock(passphrase, rememberMe) }

    FormScaffold(title = stringResource(R.string.key_changed_title), onBack = null) {
        Text(
            phase.message,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.testTag("key-changed-message"),
        )
        Text(
            phase.detail,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (phase.exportLabel.isNotEmpty()) {
            OutlinedButton(
                onClick = viewModel::export,
                enabled = export != ExportState.Exporting && !form.busy,
                modifier = Modifier.fillMaxWidth().testTag("export-button"),
            ) {
                Text(
                    if (export ==
                        ExportState.Exporting
                    ) {
                        stringResource(R.string.export_progress)
                    } else {
                        phase.exportLabel
                    },
                )
            }
            if (export == ExportState.Failed) {
                ErrorText(stringResource(R.string.export_failed), Modifier.testTag("export-error"))
            }
        }
        if (phase.canUnlock) {
            Heading(stringResource(R.string.unlock_title), MaterialTheme.typography.titleMedium)
            SecretField(
                value = passphrase,
                onValueChange = { passphrase = it },
                label = stringResource(R.string.key_changed_passphrase_label),
                tag = "passphrase-field",
                error = null,
                enabled = !form.busy,
                imeAction = ImeAction.Go,
                onIme = unlock,
            )
            RememberSwitch(
                checked = rememberMe,
                onCheckedChange = { rememberMe = it },
                enabled = !form.busy,
            )
        }
        form.error?.let { ErrorText(it.resolve(), Modifier.testTag("unlock-error")) }
        if (form.busy) {
            Progress(stringResource(R.string.unlock_progress))
        } else {
            if (phase.canUnlock) {
                Button(
                    onClick = unlock,
                    modifier = Modifier.fillMaxWidth().testTag("unlock-button"),
                ) {
                    Text(stringResource(R.string.unlock_action))
                }
            }
            OutlinedButton(
                onClick = viewModel::logInAgain,
                modifier = Modifier.fillMaxWidth().testTag("log-in-again-button"),
            ) {
                Text(stringResource(R.string.action_log_in_again))
            }
        }
    }
}
