package io.github.marcinjahn.commitnote.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.app.SessionPhase
import io.github.marcinjahn.commitnote.app.StartupFailure
import io.github.marcinjahn.commitnote.ui.ErrorText
import io.github.marcinjahn.commitnote.ui.FormViewModel
import io.github.marcinjahn.commitnote.ui.Heading
import io.github.marcinjahn.commitnote.ui.Progress
import io.github.marcinjahn.commitnote.ui.isCompactHeight

class StartupViewModel(
    private val session: AppSession,
) : FormViewModel() {
    fun logInAgain() =
        submit {
            session.abandonSession()
            null
        }
}

/** Starting the core and resuming the remembered session, or why resuming failed. */
@Composable
fun StartupScreen(
    session: AppSession,
    failure: SessionPhase.ResumeFailed?,
) {
    val viewModel: StartupViewModel =
        viewModel(factory = viewModelFactory { initializer { StartupViewModel(session) } })
    val form by viewModel.form.collectAsStateWithLifecycle()
    val loading by session.loading.collectAsStateWithLifecycle()
    CenteredPage {
        if (failure == null || form.busy) {
            Progress(loading ?: stringResource(R.string.progress_loading))
        } else {
            ErrorText(form.error?.resolve() ?: failure.message, Modifier.testTag("resume-error"))
            Button(
                onClick = session::retryResume,
                modifier = Modifier.testTag("try-again-button"),
            ) {
                Text(stringResource(R.string.action_try_again))
            }
            OutlinedButton(
                onClick = viewModel::logInAgain,
                modifier = Modifier.testTag("log-in-again-button"),
            ) {
                Text(stringResource(R.string.action_log_in_again))
            }
        }
    }
}

@Composable
fun StartupFailedScreen(
    failure: StartupFailure,
    onClose: () -> Unit,
) {
    CenteredPage {
        Text(
            when (failure) {
                is StartupFailure.ApiVersionMismatch -> {
                    stringResource(R.string.startup_failed_version, failure.found, failure.expected)
                }

                StartupFailure.Unloadable -> {
                    stringResource(R.string.startup_failed_unloadable)
                }
            },
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.testTag("startup-failed"),
        )
        Button(onClick = onClose, modifier = Modifier.testTag("close-button")) {
            Text(stringResource(R.string.action_close))
        }
    }
}

@Composable
private fun CenteredPage(content: @Composable () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier =
                Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(
                    rememberScrollState(),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                modifier = Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                val compact = isCompactHeight()
                Heading(
                    stringResource(R.string.app_name),
                    if (compact) {
                        MaterialTheme.typography.titleLarge
                    } else {
                        MaterialTheme.typography.headlineMedium
                    },
                )
                if (!compact) {
                    Text(
                        stringResource(R.string.tagline),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                content()
            }
        }
    }
}
