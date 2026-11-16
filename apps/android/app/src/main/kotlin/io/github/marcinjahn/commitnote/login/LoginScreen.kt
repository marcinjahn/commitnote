package io.github.marcinjahn.commitnote.login

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.app.GettingInStep
import io.github.marcinjahn.commitnote.core.api.ForgeView
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.ui.FormScaffold
import io.github.marcinjahn.commitnote.ui.FormViewModel
import io.github.marcinjahn.commitnote.ui.Progress
import io.github.marcinjahn.commitnote.ui.UiText
import io.github.marcinjahn.commitnote.ui.openUrl

class LoginViewModel(
    private val session: AppSession,
) : FormViewModel() {
    fun continueWith(
        forge: ForgeView,
        accessToken: String,
    ) {
        val token = accessToken.trim()
        submit(invalid = UiText.Resource(R.string.login_token_blank).takeIf { token.isEmpty() }) {
            if (session.gettingIn.listRepositories(forge, Secret(token))) {
                null
            } else {
                UiText.Resource(R.string.login_no_repositories, listOf(forge.name))
            }
        }
    }
}

@Composable
fun LoginScreen(
    session: AppSession,
    step: GettingInStep.Login,
) {
    val viewModel: LoginViewModel =
        viewModel(factory = viewModelFactory { initializer { LoginViewModel(session) } })
    val form by viewModel.form.collectAsStateWithLifecycle()
    val loading by session.loading.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var forgeId by rememberSaveable {
        mutableStateOf(
            (
                step.preferredForge
                    ?: step.forges.firstOrNull()?.id
            )?.name,
        )
    }
    var token by rememberSaveable { mutableStateOf("") }
    val forge =
        step.forges.firstOrNull { it.id.name == forgeId } ?: step.forges.firstOrNull() ?: return
    val error = form.error?.resolve() ?: step.error
    val submit = { viewModel.continueWith(forge, token) }

    FormScaffold(title = stringResource(R.string.login_title), onBack = null) {
        if (step.forges.size > 1) {
            Text(
                stringResource(R.string.login_forge_label),
                style = MaterialTheme.typography.labelLarge,
            )
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                step.forges.forEachIndexed { index, option ->
                    SegmentedButton(
                        selected = option.id == forge.id,
                        onClick = { forgeId = option.id.name },
                        enabled = !form.busy,
                        shape = SegmentedButtonDefaults.itemShape(index, step.forges.size),
                        modifier = Modifier.testTag("forge-${option.id.name.lowercase()}"),
                    ) {
                        Text(option.name)
                    }
                }
            }
        }
        Text(
            stringResource(R.string.login_token_link, forge.name),
            style = MaterialTheme.typography.bodyMedium,
        )
        OutlinedButton(onClick = { context.openUrl(forge.accessTokenCreationUrl) }) {
            Text(stringResource(R.string.login_open_token_page))
        }
        OutlinedTextField(
            value = token,
            onValueChange = { token = it },
            label = { Text(stringResource(R.string.login_token_label)) },
            placeholder = { Text(forge.accessTokenHint) },
            singleLine = true,
            enabled = !form.busy,
            isError = error != null,
            supportingText =
                error?.let {
                    {
                        Text(
                            it,
                            modifier = Modifier.testTag("login-error"),
                        )
                    }
                },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Go,
                ),
            keyboardActions = KeyboardActions(onGo = { submit() }),
            modifier =
                Modifier
                    .fillMaxWidth()
                    .semantics { contentType = ContentType.Password }
                    .testTag("token-field"),
        )
        Text(
            stringResource(R.string.login_new_repository_note),
            style = MaterialTheme.typography.bodyMedium,
        )
        TextButton(onClick = { context.openUrl(forge.repositoryCreationUrl) }) {
            Text(stringResource(R.string.login_create_repository))
        }
        if (form.busy) {
            Progress(loading ?: stringResource(R.string.login_listing))
        } else {
            Button(
                onClick = submit,
                modifier = Modifier.fillMaxWidth().testTag("continue-button"),
            ) {
                Text(stringResource(R.string.action_continue))
            }
        }
    }
}
