package io.github.marcinjahn.commitnote.transfer

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import io.github.marcinjahn.commitnote.core.api.ImportDestinationView
import io.github.marcinjahn.commitnote.core.api.ImportForm
import io.github.marcinjahn.commitnote.core.api.ImportFormCopy
import io.github.marcinjahn.commitnote.core.api.ImportPolicy
import io.github.marcinjahn.commitnote.ui.ErrorText
import io.github.marcinjahn.commitnote.ui.FolderTargetRow
import io.github.marcinjahn.commitnote.ui.FormScaffold

private enum class Placement { NewFolder, Existing }

/** The import of a chosen archive: where its notes go, a preview of that, and the conflict and setup steps. */
@Composable
fun ImportScreen(
    form: ImportForm,
    state: ImportUiState,
    onPreview: (ImportDestinationView) -> Unit,
    onCommit: (ImportDestinationView, ImportPolicy) -> Unit,
    onEnableAtomic: () -> Unit,
    onCancel: () -> Unit,
) {
    val copy = form.copy
    var placement by rememberSaveable { mutableStateOf(Placement.NewFolder) }
    var folderName by rememberSaveable(form.fileName) { mutableStateOf(form.defaultFolderName) }
    var selected by rememberSaveable { mutableIntStateOf(0) }

    val destination =
        when (placement) {
            Placement.NewFolder -> {
                ImportDestinationView.NewFolder(emptyList(), folderName.trim())
            }

            Placement.Existing -> {
                form.targets
                    .getOrNull(selected)
                    ?.path
                    ?.takeIf { it.isNotEmpty() }
                    ?.let(ImportDestinationView::Folder) ?: ImportDestinationView.Root
            }
        }
    val validDestination =
        (destination as? ImportDestinationView.NewFolder)?.name?.isNotEmpty() != false

    LaunchedEffect(destination, form.empty) {
        if (!form.empty) onPreview(destination)
    }
    BackHandler(onBack = onCancel)

    val setup = state.setup
    val title =
        when {
            setup != null -> copy.setupTitle
            state.offersRename -> copy.conflictsTitle
            else -> copy.title
        }

    FormScaffold(title = title, onBack = onCancel) {
        when {
            setup != null -> {
                Text(setup.message, modifier = Modifier.testTag("import-message"))
                if (setup.canConfigure) {
                    Button(
                        onClick = onEnableAtomic,
                        enabled = !state.busy,
                        modifier = Modifier.fillMaxWidth().testTag("import-enable-atomic"),
                    ) { Text(copy.enableAtomicLabel) }
                }
            }

            state.offersRename -> {
                state.message?.let { Text(it, modifier = Modifier.testTag("import-message")) }
                Button(
                    onClick = { onCommit(destination, ImportPolicy.RENAME) },
                    enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth().testTag("import-rename"),
                ) { Text(copy.renameLabel) }
            }

            else -> {
                Text(form.fileName, style = MaterialTheme.typography.titleMedium)
                form.skipped?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.testTag("import-skipped"),
                    )
                }
                if (form.empty) {
                    Text(
                        copy.emptyText,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.testTag("import-empty"),
                    )
                } else {
                    PlacementChoice(
                        copy = copy,
                        form = form,
                        placement = placement,
                        onPlacement = { placement = it },
                        folderName = folderName,
                        onFolderName = { folderName = it },
                        selected = selected,
                        onSelected = { selected = it },
                    )
                    state.preview?.let { Text(it, modifier = Modifier.testTag("import-preview")) }
                    state.message?.let { ErrorText(it, Modifier.testTag("import-message")) }
                    Button(
                        onClick = { onCommit(destination, ImportPolicy.STOP) },
                        enabled = !state.busy && validDestination,
                        modifier = Modifier.fillMaxWidth().testTag("import-confirm"),
                    ) { Text(if (state.busy) copy.importingLabel else copy.importLabel) }
                }
            }
        }
        OutlinedButton(
            onClick = onCancel,
            modifier = Modifier.fillMaxWidth().testTag("import-cancel"),
        ) {
            Text(copy.cancelLabel)
        }
    }
}

@Composable
private fun PlacementChoice(
    copy: ImportFormCopy,
    form: ImportForm,
    placement: Placement,
    onPlacement: (Placement) -> Unit,
    folderName: String,
    onFolderName: (String) -> Unit,
    selected: Int,
    onSelected: (Int) -> Unit,
) {
    Column(
        modifier = Modifier.selectableGroup(),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(copy.intoLabel, style = MaterialTheme.typography.titleSmall)
        PlacementOption(
            copy.newFolderLabel,
            placement == Placement.NewFolder,
            "import-new-folder",
        ) {
            onPlacement(Placement.NewFolder)
        }
        PlacementOption(
            copy.existingFolderLabel,
            placement == Placement.Existing,
            "import-existing-folder",
        ) {
            onPlacement(Placement.Existing)
        }
    }
    when (placement) {
        Placement.NewFolder -> {
            OutlinedTextField(
                value = folderName,
                onValueChange = onFolderName,
                label = { Text(copy.folderNameLabel) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("import-folder-name"),
            )
        }

        Placement.Existing -> {
            Column(modifier = Modifier.selectableGroup()) {
                form.targets.forEachIndexed { index, target ->
                    FolderTargetRow(
                        label = if (index == 0) copy.rootLabel else target.label,
                        depth = target.depth,
                        enabled = true,
                        selected = index == selected,
                        modifier = Modifier.testTag("import-folder"),
                        onClick = { onSelected(index) },
                    )
                }
            }
        }
    }
}

@Composable
private fun PlacementOption(
    label: String,
    selected: Boolean,
    tag: String,
    onClick: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .selectable(selected, role = Role.RadioButton, onClick = onClick)
                .padding(end = 8.dp)
                .testTag(tag),
    ) {
        RadioButton(selected = selected, onClick = null)
        Text(
            label,
            modifier = Modifier.padding(start = 12.dp),
            style = MaterialTheme.typography.bodyLarge,
        )
    }
}
