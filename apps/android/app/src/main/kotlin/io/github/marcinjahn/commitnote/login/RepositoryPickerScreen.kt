package io.github.marcinjahn.commitnote.login

import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Public
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
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

class RepositoryPickerViewModel(
    private val session: AppSession,
) : FormViewModel() {
    fun choose(url: String) =
        submit {
            session.gettingIn.chooseRepository(url)
            null
        }
}

@Composable
fun RepositoryPickerScreen(
    session: AppSession,
    step: GettingInStep.RepositoryPicker,
) {
    val viewModel: RepositoryPickerViewModel =
        viewModel(factory = viewModelFactory { initializer { RepositoryPickerViewModel(session) } })
    val form by viewModel.form.collectAsStateWithLifecycle()
    val loading by session.loading.collectAsStateWithLifecycle()

    FormScaffold(
        title = stringResource(R.string.picker_title),
        onBack = { session.gettingIn.back() },
    ) {
        Text(
            stringResource(R.string.picker_description),
            style = MaterialTheme.typography.bodyMedium,
        )
        form.error?.let { ErrorText(it.resolve()) }
        if (form.busy) Progress(loading ?: stringResource(R.string.login_checking))
        step.repositories.forEach { repository ->
            ListItem(
                headlineContent = { Text(repository.label) },
                supportingContent = {
                    Text(
                        stringResource(
                            if (repository.private) {
                                R.string.repository_private
                            } else {
                                R.string.repository_public
                            },
                        ),
                    )
                },
                leadingContent = {
                    Icon(
                        if (repository.private) Icons.Filled.Lock else Icons.Filled.Public,
                        contentDescription = null,
                    )
                },
                modifier =
                    Modifier
                        .clickable(enabled = !form.busy) { viewModel.choose(repository.url) }
                        .testTag("repo-${repository.label}"),
            )
            HorizontalDivider()
        }
    }
}
