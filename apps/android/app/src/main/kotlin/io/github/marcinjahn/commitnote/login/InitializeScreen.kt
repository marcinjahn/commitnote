package io.github.marcinjahn.commitnote.login

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.app.GettingInStep
import io.github.marcinjahn.commitnote.core.api.PassphraseStrengthResult
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.ui.FormScaffold
import io.github.marcinjahn.commitnote.ui.FormViewModel
import io.github.marcinjahn.commitnote.ui.PassphraseStrengthTracker
import io.github.marcinjahn.commitnote.ui.Progress
import io.github.marcinjahn.commitnote.ui.RememberSwitch
import io.github.marcinjahn.commitnote.ui.SecretField
import io.github.marcinjahn.commitnote.ui.StrengthMeter
import io.github.marcinjahn.commitnote.ui.UiText
import kotlinx.coroutines.flow.StateFlow

class InitializeViewModel(
    private val session: AppSession,
) : FormViewModel() {
    private val strengthTracker = PassphraseStrengthTracker(session, viewModelScope)
    val strength: StateFlow<PassphraseStrengthResult?> = strengthTracker.strength

    fun passphraseChanged(
        passphrase: String,
        repositoryLabel: String,
    ) = strengthTracker.passphraseChanged(passphrase, repositoryLabel)

    fun initialize(
        passphrase: String,
        repeated: String,
        remember: Boolean,
    ) {
        val invalid =
            when {
                passphrase.isEmpty() -> UiText.Resource(R.string.initialize_passphrase_blank)
                passphrase != repeated -> UiText.Resource(R.string.initialize_mismatch)
                else -> null
            }
        submit(invalid) {
            session.gettingIn.initialize(Secret(passphrase), remember)
            null
        }
    }
}

@Composable
fun InitializeScreen(
    session: AppSession,
    step: GettingInStep.Initialize,
) {
    val viewModel: InitializeViewModel =
        viewModel(factory = viewModelFactory { initializer { InitializeViewModel(session) } })
    val form by viewModel.form.collectAsStateWithLifecycle()
    val strength by viewModel.strength.collectAsStateWithLifecycle()
    val loading by session.loading.collectAsStateWithLifecycle()
    var passphrase by remember { mutableStateOf("") }
    var repeated by remember { mutableStateOf("") }
    var rememberMe by rememberSaveable { mutableStateOf(true) }
    val submit = { viewModel.initialize(passphrase, repeated, rememberMe) }
    LaunchedEffect(passphrase) { viewModel.passphraseChanged(passphrase, step.repository.label) }

    FormScaffold(title = stringResource(R.string.initialize_title), onBack = {
        session.gettingIn.back()
    }) {
        RepositorySummary(step.repository)
        Text(step.setUpDescription, style = MaterialTheme.typography.bodyMedium)
        Text(
            stringResource(R.string.initialize_hint),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SecretField(
            value = passphrase,
            onValueChange = { passphrase = it },
            label = stringResource(R.string.initialize_passphrase_label),
            tag = "passphrase-field",
            error = null,
            enabled = !form.busy,
            imeAction = ImeAction.Next,
            onIme = {},
        )
        strength?.let { StrengthMeter(it) }
        SecretField(
            value = repeated,
            onValueChange = { repeated = it },
            label = stringResource(R.string.initialize_repeat_label),
            tag = "repeat-field",
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
            Progress(loading ?: stringResource(R.string.initialize_progress))
        } else {
            Button(
                onClick = submit,
                modifier = Modifier.fillMaxWidth().testTag("initialize-button"),
            ) {
                Text(stringResource(R.string.initialize_action))
            }
        }
    }
}
