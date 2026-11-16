package io.github.marcinjahn.commitnote.login

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.app.GettingInStep
import io.github.marcinjahn.commitnote.core.api.RepositoryView
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.ui.ErrorText
import io.github.marcinjahn.commitnote.ui.FormScaffold
import io.github.marcinjahn.commitnote.ui.FormViewModel
import io.github.marcinjahn.commitnote.ui.Progress
import io.github.marcinjahn.commitnote.ui.RememberSwitch
import io.github.marcinjahn.commitnote.ui.SecretField
import io.github.marcinjahn.commitnote.ui.UiText

class UnlockViewModel(
    private val session: AppSession,
) : FormViewModel() {
    fun unlock(
        passphrase: String,
        remember: Boolean,
    ) = submit(
        invalid = UiText.Resource(R.string.passphrase_blank).takeIf { passphrase.isEmpty() },
    ) {
        session.gettingIn.unlock(Secret(passphrase), remember)
        null
    }
}

@Composable
fun UnlockScreen(
    session: AppSession,
    step: GettingInStep.Unlock,
) {
    val viewModel: UnlockViewModel =
        viewModel(factory = viewModelFactory { initializer { UnlockViewModel(session) } })
    val form by viewModel.form.collectAsStateWithLifecycle()
    val loading by session.loading.collectAsStateWithLifecycle()
    var passphrase by remember { mutableStateOf("") }
    var rememberMe by rememberSaveable { mutableStateOf(true) }
    val submit = { viewModel.unlock(passphrase, rememberMe) }

    FormScaffold(
        title = stringResource(R.string.unlock_title),
        onBack = { session.gettingIn.back() },
    ) {
        RepositorySummary(step.repository)
        SecretField(
            value = passphrase,
            onValueChange = { passphrase = it },
            label = stringResource(R.string.passphrase_label),
            tag = "passphrase-field",
            error = form.error?.resolve(),
            enabled = !form.busy,
            imeAction = ImeAction.Go,
            onIme = submit,
        )
        RememberSwitch(
            checked = rememberMe,
            onCheckedChange = { rememberMe = it },
            enabled = !form.busy,
        )
        if (form.busy) {
            Progress(loading ?: stringResource(R.string.unlock_progress))
        } else {
            Button(onClick = submit, modifier = Modifier.fillMaxWidth().testTag("unlock-button")) {
                Text(stringResource(R.string.unlock_action))
            }
        }
    }
}

@Composable
internal fun RepositorySummary(repository: RepositoryView) {
    Text(stringResource(R.string.repository_label), style = MaterialTheme.typography.labelLarge)
    Text(
        repository.label,
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.testTag("repository-label"),
    )
    repository.publicWarning?.let { ErrorText(it) }
}
