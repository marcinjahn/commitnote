package io.github.marcinjahn.commitnote.login

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.app.GettingInStep
import io.github.marcinjahn.commitnote.ui.ErrorText
import io.github.marcinjahn.commitnote.ui.FormScaffold
import io.github.marcinjahn.commitnote.ui.FormViewModel
import io.github.marcinjahn.commitnote.ui.Progress

class UnusableRepositoryViewModel(
    private val session: AppSession,
) : FormViewModel() {
    fun checkAgain() =
        submit {
            session.gettingIn.checkAgain()
            null
        }
}

@Composable
fun UnusableRepositoryScreen(
    session: AppSession,
    step: GettingInStep.Unusable,
) {
    val viewModel: UnusableRepositoryViewModel =
        viewModel(
            factory = viewModelFactory { initializer { UnusableRepositoryViewModel(session) } },
        )
    val form by viewModel.form.collectAsStateWithLifecycle()
    val loading by session.loading.collectAsStateWithLifecycle()

    FormScaffold(title = step.repository.label, onBack = { session.gettingIn.back() }) {
        Text(
            step.message,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.testTag("unusable-message"),
        )
        step.foreignHint?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        form.error?.let { ErrorText(it.resolve()) }
        if (form.busy) {
            Progress(loading ?: stringResource(R.string.login_checking))
        } else {
            if (step.canCheckAgain) {
                Button(
                    onClick = viewModel::checkAgain,
                    modifier = Modifier.fillMaxWidth().testTag("check-again-button"),
                ) {
                    Text(stringResource(R.string.action_check_again))
                }
            }
            OutlinedButton(
                onClick = { session.gettingIn.chooseAnotherRepository() },
                modifier = Modifier.fillMaxWidth().testTag("choose-another-button"),
            ) {
                Text(stringResource(R.string.unusable_choose_another))
            }
        }
    }
}
