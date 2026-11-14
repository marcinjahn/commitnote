package io.github.marcinjahn.commitnote.shell

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.marcinjahn.commitnote.core.api.ForgeKind
import io.github.marcinjahn.commitnote.core.api.RepositoryListing

@Composable
fun ShellRoute(viewModel: ShellViewModel = viewModel(factory = ShellViewModel.Factory)) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    BackHandler(
        enabled = state.screen.hasPreviousScreen,
        onBack = { viewModel.back() },
    )
    ShellContent(
        state = state,
        onForge = viewModel::selectForge,
        onContinue = viewModel::continueWithToken,
        onRepository = viewModel::chooseRepository,
        onUnlock = viewModel::unlock,
    )
}

private val ShellScreen.hasPreviousScreen: Boolean
    get() = this is ShellScreen.Passphrase || this is ShellScreen.Repositories

@Composable
fun ShellContent(
    state: ShellState,
    onForge: (ForgeKind) -> Unit,
    onContinue: (String) -> Unit,
    onRepository: (RepositoryListing) -> Unit,
    onUnlock: (String) -> Unit,
) {
    Scaffold { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            when (val screen = state.screen) {
                ShellScreen.Starting -> {
                    if (state.error == null) CircularProgressIndicator()
                }

                is ShellScreen.Token -> {
                    TokenScreen(screen.forge, state.busy, onForge, onContinue)
                }

                is ShellScreen.Repositories -> {
                    RepositoriesScreen(screen.repositories, onRepository)
                }

                is ShellScreen.Passphrase -> {
                    PassphraseScreen(screen.repository.label, state.busy, onUnlock)
                }

                is ShellScreen.Tree -> {
                    TreeScreen(screen)
                }
            }
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
private fun TokenScreen(
    forge: ForgeKind,
    busy: Boolean,
    onForge: (ForgeKind) -> Unit,
    onContinue: (String) -> Unit,
) {
    var token by remember { mutableStateOf("") }
    val forges = listOf(ForgeKind.GITHUB to "GitHub", ForgeKind.GITLAB to "GitLab")
    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
        forges.forEachIndexed { index, (kind, label) ->
            SegmentedButton(
                selected = kind == forge,
                onClick = { onForge(kind) },
                shape = SegmentedButtonDefaults.itemShape(index, forges.size),
            ) {
                Text(label)
            }
        }
    }
    OutlinedTextField(
        value = token,
        onValueChange = { token = it },
        label = { Text("Access token") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        modifier = Modifier.fillMaxWidth().testTag("token-field"),
    )
    Button(
        onClick = { onContinue(token) },
        enabled = token.isNotBlank() && !busy,
        modifier = Modifier.testTag("continue-button"),
    ) {
        Text("Continue")
    }
}

@Composable
private fun RepositoriesScreen(
    repositories: List<RepositoryListing>,
    onRepository: (RepositoryListing) -> Unit,
) {
    Text("Choose a repository", style = MaterialTheme.typography.titleMedium)
    LazyColumn {
        items(repositories, key = { it.url }) { repository ->
            Text(
                repository.label,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clickable { onRepository(repository) }
                        .padding(vertical = 12.dp)
                        .testTag("repo-${repository.label}"),
            )
        }
    }
}

@Composable
private fun PassphraseScreen(
    repositoryLabel: String,
    busy: Boolean,
    onUnlock: (String) -> Unit,
) {
    var passphrase by remember { mutableStateOf("") }
    Text(repositoryLabel, style = MaterialTheme.typography.titleMedium)
    OutlinedTextField(
        value = passphrase,
        onValueChange = { passphrase = it },
        label = { Text("Passphrase") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        modifier = Modifier.fillMaxWidth().testTag("passphrase-field"),
    )
    Row(verticalAlignment = Alignment.CenterVertically) {
        Button(
            onClick = { onUnlock(passphrase) },
            enabled = passphrase.isNotEmpty() && !busy,
            modifier = Modifier.testTag("unlock-button"),
        ) {
            Text("Unlock")
        }
        if (busy) CircularProgressIndicator(modifier = Modifier.padding(start = 16.dp))
    }
}

@Composable
private fun TreeScreen(screen: ShellScreen.Tree) {
    val nodes = screen.nodes
    if (nodes == null) {
        CircularProgressIndicator()
        return
    }
    val rows = remember(nodes) { nodes.toRows() }
    LazyColumn(modifier = Modifier.fillMaxSize().testTag("tree-list")) {
        items(rows) { row ->
            Text(
                row.name,
                style =
                    if (row.folder) {
                        MaterialTheme.typography.titleSmall
                    } else {
                        MaterialTheme.typography.bodyLarge
                    },
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(start = (row.depth * 16).dp, top = 8.dp, bottom = 8.dp)
                        .testTag("tree-node-${row.name}"),
            )
        }
    }
}
