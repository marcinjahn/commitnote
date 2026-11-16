package io.github.marcinjahn.commitnote.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.app.SettingsState
import io.github.marcinjahn.commitnote.core.api.AccentOptionView
import io.github.marcinjahn.commitnote.core.api.ScopedSettingKey
import io.github.marcinjahn.commitnote.core.api.SettingChoiceCopy
import io.github.marcinjahn.commitnote.core.api.SettingKeyView
import io.github.marcinjahn.commitnote.core.api.SettingOptionView
import io.github.marcinjahn.commitnote.core.api.SettingScope
import io.github.marcinjahn.commitnote.core.api.SettingsCopy
import io.github.marcinjahn.commitnote.core.api.SettingsSaveState
import io.github.marcinjahn.commitnote.core.api.SettingsView
import io.github.marcinjahn.commitnote.navigation.About
import io.github.marcinjahn.commitnote.navigation.ChangePassphrase
import io.github.marcinjahn.commitnote.navigation.MainRoute
import io.github.marcinjahn.commitnote.navigation.SharedLinks
import io.github.marcinjahn.commitnote.navigation.Trash
import io.github.marcinjahn.commitnote.transfer.ExportState
import io.github.marcinjahn.commitnote.transfer.IMPORT_MIME_TYPES
import io.github.marcinjahn.commitnote.transfer.ImportScreen
import io.github.marcinjahn.commitnote.transfer.ImportSetupDialog
import io.github.marcinjahn.commitnote.transfer.TransferViewModel
import io.github.marcinjahn.commitnote.ui.ChoiceDialog
import io.github.marcinjahn.commitnote.ui.ErrorText
import io.github.marcinjahn.commitnote.ui.Heading
import io.github.marcinjahn.commitnote.ui.LocalDarkTheme
import io.github.marcinjahn.commitnote.ui.LogoutUnsavedDialog
import io.github.marcinjahn.commitnote.ui.NoteFonts
import io.github.marcinjahn.commitnote.ui.Palette
import io.github.marcinjahn.commitnote.ui.Progress
import io.github.marcinjahn.commitnote.ui.ScreenScaffold
import io.github.marcinjahn.commitnote.ui.ShowMessages
import io.github.marcinjahn.commitnote.ui.SwitchRow

private const val CONTENT_MAX_WIDTH = 600

/** The settings, with the data, security and about entries that lead to the other screens. */
@Composable
fun SettingsScreen(
    session: AppSession,
    onBack: () -> Unit,
    navigate: (MainRoute) -> Unit,
) {
    val viewModel: SettingsViewModel =
        viewModel(factory = viewModelFactory { initializer { SettingsViewModel(session) } })
    val transfer: TransferViewModel =
        viewModel(factory = viewModelFactory { initializer { TransferViewModel(session) } })
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val unsavedLogout by viewModel.unsavedLogout.collectAsStateWithLifecycle()
    val importState by transfer.importState.collectAsStateWithLifecycle()
    val importing by transfer.importing.collectAsStateWithLifecycle()
    val exportState by transfer.exporter.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    ShowMessages(viewModel.messages, snackbar)
    ShowMessages(transfer.messages, snackbar)

    val context = LocalContext.current
    val exportPicker =
        rememberLauncherForActivityResult(
            ActivityResultContracts.CreateDocument("application/zip"),
        ) {
            transfer.exporter.save(it, context.contentResolver)
        }
    LaunchedEffect(transfer) { transfer.exporter.saveRequests.collect { exportPicker.launch(it) } }
    val importPicker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) {
            transfer.importDocuments(it, context.contentResolver)
        }

    val form = importState.form
    val current = settings
    if (form != null) {
        ImportScreen(
            form = form,
            state = importState,
            onPreview = transfer::preview,
            onCommit = transfer::commit,
            onEnableAtomic = transfer::enableAtomic,
            onCancel = transfer::cancel,
        )
        return
    }

    ScreenScaffold(
        title = current?.copy?.title ?: stringResource(R.string.menu_settings),
        onBack = onBack,
        snackbar = snackbar,
    ) { padding ->
        Box(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState()),
            contentAlignment = Alignment.TopCenter,
        ) {
            if (current == null) {
                Box(
                    modifier = Modifier.padding(24.dp),
                ) { Progress(stringResource(R.string.settings_loading)) }
            } else {
                Column(
                    modifier =
                        Modifier
                            .widthIn(max = CONTENT_MAX_WIDTH.dp)
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 8.dp)
                            .testTag("settings-screen"),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    SettingsContent(
                        state = current,
                        viewModel = viewModel,
                        data =
                            DataActions(
                                exporting = exportState == ExportState.Exporting,
                                exportFailed = exportState == ExportState.Failed,
                                importing = importing,
                                onExport = transfer.exporter::export,
                                onImport = { importPicker.launch(IMPORT_MIME_TYPES) },
                            ),
                        navigate = navigate,
                    )
                }
            }
        }
    }

    unsavedLogout?.let {
        LogoutUnsavedDialog(
            count = it.count,
            message = it.message,
            onLogOutAnyway = { viewModel.logOut(anyway = true) },
            onDismiss = viewModel::dismissUnsavedLogout,
        )
    }
    importState.directSetup?.let {
        ImportSetupDialog(
            setup = it,
            onEnable = transfer::enableAtomic,
            onDismiss = transfer::dismissDirectSetup,
        )
    }
}

private class DataActions(
    val exporting: Boolean,
    val exportFailed: Boolean,
    val importing: Boolean,
    val onExport: () -> Unit,
    val onImport: () -> Unit,
)

@Composable
private fun SettingsContent(
    state: SettingsState,
    viewModel: SettingsViewModel,
    data: DataActions,
    navigate: (MainRoute) -> Unit,
) {
    val copy = state.copy
    val view = state.view

    Text(copy.intro, style = MaterialTheme.typography.bodyMedium)
    SaveStatus(state, onRetry = viewModel::retry)

    AppearanceSection(copy, view, viewModel)

    SectionHeader(copy.sections.editor)
    TypeToStart(copy, view, viewModel)
    Text(
        copy.editorUnavailable,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.testTag("settings-editor-note"),
    )

    SectionHeader(copy.sections.notes)
    ChoiceGroup(
        copy.newNotePlacement,
        view.values.newNotePlacement,
        "settings-new-note-placement",
    ) {
        viewModel.change(SettingKeyView.NEW_NOTE_PLACEMENT, it)
    }
    ChoiceGroup(
        copy.newFolderPlacement,
        view.values.newFolderPlacement,
        "settings-new-folder-placement",
    ) {
        viewModel.change(SettingKeyView.NEW_FOLDER_PLACEMENT, it)
    }

    SectionHeader(copy.sections.thisDevice)
    DeviceName(copy, view, viewModel::setDeviceName)
    SwitchRow(
        label = copy.reopenLastView.label,
        supporting = null,
        checked = view.reopenLastView,
        tag = "settings-reopen-last-view",
        onCheckedChange = viewModel::setReopenLastView,
    )

    SectionHeader(stringResource(R.string.settings_data))
    DataSection(copy, view, data, navigate)

    SectionHeader(stringResource(R.string.settings_security))
    LinkRow(
        label = copy.data.changePassphraseLabel,
        enabled = view.canChangePassphrase,
        tag = "settings-change-passphrase",
        onClick = { navigate(ChangePassphrase) },
    )
    LinkRow(
        label = stringResource(R.string.menu_log_out),
        enabled = true,
        tag = "settings-log-out",
        onClick = { viewModel.logOut(anyway = false) },
    )

    SectionHeader(stringResource(R.string.settings_about))
    LinkRow(
        label = stringResource(R.string.about_title),
        enabled = true,
        tag = "settings-about",
        onClick = { navigate(About) },
    )
}

@Composable
private fun SectionHeader(text: String) {
    HorizontalDivider(modifier = Modifier.padding(top = 8.dp))
    Heading(
        text,
        MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(top = 8.dp),
    )
}

@Composable
private fun SaveStatus(
    state: SettingsState,
    onRetry: () -> Unit,
) {
    val save = state.save
    Column(modifier = Modifier.testTag("settings-save-status")) {
        Text(save.label, style = MaterialTheme.typography.bodyMedium)
        if (save.detail.isNotEmpty()) {
            val failed = save.state == SettingsSaveState.FAILED
            if (failed) {
                ErrorText(save.detail)
            } else {
                Text(
                    save.detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (save.canRetry) {
            TextButton(
                onClick = onRetry,
                modifier = Modifier.testTag("settings-retry"),
            ) { Text(state.copy.retryLabel) }
        }
    }
}

@Composable
private fun ScopeToggle(
    copy: SettingsCopy,
    title: String,
    key: ScopedSettingKey,
    scope: SettingScope,
    onScope: (ScopedSettingKey, SettingScope) -> Unit,
) {
    val label =
        if (scope == SettingScope.SYNCED) copy.scopeLabels.synced else copy.scopeLabels.device
    TextButton(
        onClick = {
            onScope(
                key,
                if (scope ==
                    SettingScope.SYNCED
                ) {
                    SettingScope.DEVICE
                } else {
                    SettingScope.SYNCED
                },
            )
        },
        modifier =
            Modifier
                .semantics { contentDescription = "$title, $label" }
                .testTag("settings-scope-${key.name.lowercase().replace('_', '-')}"),
    ) { Text(label) }
}

@Composable
private fun ScopedHeader(
    copy: SettingsCopy,
    title: String,
    key: ScopedSettingKey,
    scope: SettingScope,
    viewModel: SettingsViewModel,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
        ScopeToggle(copy, title, key, scope, viewModel::setScope)
    }
}

@Composable
private fun AppearanceSection(
    copy: SettingsCopy,
    view: SettingsView,
    viewModel: SettingsViewModel,
) {
    SectionHeader(copy.sections.appearance)
    ScopedHeader(
        copy,
        copy.colorMode.label,
        ScopedSettingKey.COLOR_MODE,
        view.scopes.colorMode,
        viewModel,
    )
    ChoiceGroup(copy.colorMode, view.values.colorMode, "settings-color-mode", showLabel = false) {
        viewModel.change(SettingKeyView.COLOR_MODE, it)
    }

    ScopedHeader(
        copy,
        copy.accentColor.label,
        ScopedSettingKey.ACCENT_COLOR,
        view.scopes.accentColor,
        viewModel,
    )
    AccentSwatches(copy.accentColor.options, view.values.accentColor) {
        viewModel.change(SettingKeyView.ACCENT_COLOR, it)
    }

    ScopedHeader(
        copy,
        copy.noteFont.label,
        ScopedSettingKey.NOTE_FONT,
        view.scopes.noteFont,
        viewModel,
    )
    NoteFontChoice(copy.noteFont, view.values.noteFont) {
        viewModel.change(SettingKeyView.NOTE_FONT, it)
    }
}

@Composable
private fun TypeToStart(
    copy: SettingsCopy,
    view: SettingsView,
    viewModel: SettingsViewModel,
) {
    ScopedHeader(
        copy,
        copy.typeToStart.label,
        ScopedSettingKey.TYPE_TO_START,
        view.scopes.typeToStart,
        viewModel,
    )
    SwitchRow(
        label = copy.typeToStart.label,
        supporting = copy.typeToStart.hint,
        checked = view.values.typeToStart,
        tag = "settings-type-to-start",
        onCheckedChange = { viewModel.change(SettingKeyView.TYPE_TO_START, it.toString()) },
    )
}

@Composable
private fun ChoiceGroup(
    choice: SettingChoiceCopy,
    selected: String,
    tag: String,
    showLabel: Boolean = true,
    onSelect: (String) -> Unit,
) {
    Column(modifier = Modifier.selectableGroup().testTag(tag)) {
        if (showLabel) Text(choice.label, style = MaterialTheme.typography.titleSmall)
        choice.options.forEach { option ->
            RadioRow(
                option.label,
                option.id == selected,
                "$tag-${option.id}",
            ) { onSelect(option.id) }
        }
    }
}

@Composable
private fun RadioRow(
    label: String,
    selected: Boolean,
    tag: String,
    supporting: String? = null,
    labelStyle: androidx.compose.ui.text.TextStyle = MaterialTheme.typography.bodyLarge,
    onClick: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
                .testTag(tag),
    ) {
        RadioButton(selected = selected, onClick = null)
        Column(modifier = Modifier.padding(start = 12.dp)) {
            Text(label, style = labelStyle)
            supporting?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AccentSwatches(
    options: List<AccentOptionView>,
    selected: String,
    onSelect: (String) -> Unit,
) {
    val dark = LocalDarkTheme.current
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier.selectableGroup().testTag("settings-accent"),
    ) {
        options.forEach { option ->
            val isSelected = option.id == selected
            val color = swatchColor(option, dark)
            Box(
                contentAlignment = Alignment.Center,
                modifier =
                    Modifier
                        .size(48.dp)
                        .selectable(
                            selected = isSelected,
                            role = Role.RadioButton,
                        ) { onSelect(option.id) }
                        .semantics { contentDescription = option.label }
                        .testTag("settings-accent-${option.id}"),
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier =
                        Modifier
                            .size(32.dp)
                            .clip(CircleShape)
                            .background(color)
                            .border(
                                width = if (isSelected) 3.dp else 1.dp,
                                color =
                                    MaterialTheme.colorScheme.onSurface.copy(
                                        alpha = if (isSelected) 1f else 0.2f,
                                    ),
                                shape = CircleShape,
                            ),
                ) {
                    if (isSelected) {
                        Icon(
                            Icons.Filled.Check,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(16.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun swatchColor(
    option: AccentOptionView,
    dark: Boolean,
): Color {
    val palette = Palette.accents[option.id]?.resolve(dark)
    return palette ?: MaterialTheme.colorScheme.primary
}

@Composable
private fun NoteFontChoice(
    copy: SettingsCopy.NoteFontCopy,
    selected: String,
    onSelect: (String) -> Unit,
) {
    val assets = LocalContext.current.assets
    var picking by rememberSaveable { mutableStateOf(false) }
    val family = remember(selected, assets) { NoteFonts.family(selected, assets) }
    val label = copy.options.firstOrNull { it.id == selected }?.label ?: selected

    Text(
        label,
        style = MaterialTheme.typography.bodyLarge.copy(fontFamily = family),
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .clickable(role = Role.Button) { picking = true }
                .padding(vertical = 12.dp)
                .testTag("settings-note-font"),
    )
    FontPreview(copy, family)

    if (picking) {
        ChoiceDialog(title = copy.label, onDismiss = { picking = false }) {
            Column(modifier = Modifier.selectableGroup()) {
                copy.options.forEach { option ->
                    FontOption(option, option.id == selected, assets) {
                        picking = false
                        onSelect(option.id)
                    }
                }
            }
        }
    }
}

@Composable
private fun FontOption(
    option: SettingOptionView,
    selected: Boolean,
    assets: android.content.res.AssetManager,
    onClick: () -> Unit,
) {
    val family = remember(option.id, assets) { NoteFonts.family(option.id, assets) }
    RadioRow(
        label = option.label,
        selected = selected,
        tag = "settings-font-${option.id}",
        supporting = option.description,
        labelStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = family),
        onClick = onClick,
    )
}

@Composable
private fun FontPreview(
    copy: SettingsCopy.NoteFontCopy,
    family: FontFamily,
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier.fillMaxWidth().testTag("settings-font-preview"),
    ) {
        Text(
            copy.previewHeading,
            style =
                MaterialTheme.typography.titleLarge.copy(
                    fontFamily = family,
                    fontWeight = FontWeight.SemiBold,
                ),
        )
        Text(
            copy.previewBody,
            style = MaterialTheme.typography.bodyMedium.copy(fontFamily = family),
        )
        Text(
            copy.previewCode,
            style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
        )
    }
}

@Composable
private fun DeviceName(
    copy: SettingsCopy,
    view: SettingsView,
    onCommit: (String) -> Unit,
) {
    var name by rememberSaveable(view.deviceName) { mutableStateOf(view.deviceName) }
    val commit = {
        val trimmed = name.trim()
        if (trimmed != view.deviceName) onCommit(trimmed)
    }
    OutlinedTextField(
        value = name,
        onValueChange = { name = it.take(copy.deviceName.maxLength) },
        label = { Text(copy.deviceName.label) },
        placeholder = { Text(view.automaticDeviceName) },
        supportingText = { Text(copy.deviceName.hint) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { commit() }),
        modifier =
            Modifier
                .fillMaxWidth()
                .onFocusChanged { if (!it.isFocused) commit() }
                .testTag("settings-device-name"),
    )
}

@Composable
private fun DataSection(
    copy: SettingsCopy,
    view: SettingsView,
    data: DataActions,
    navigate: (MainRoute) -> Unit,
) {
    LinkRow(
        label = if (data.exporting) copy.data.exportingLabel else copy.data.exportLabel,
        enabled = view.canExport && !data.exporting,
        tag = "settings-export",
        onClick = data.onExport,
    )
    if (data.exportFailed) {
        ErrorText(
            copy.data.exportFailed,
            Modifier.testTag("settings-export-error"),
        )
    }
    LinkRow(
        label = if (data.importing) copy.data.importingLabel else copy.data.importLabel,
        enabled = view.canImport && !data.importing,
        tag = "settings-import",
        onClick = data.onImport,
    )
    LinkRow(
        label = stringResource(R.string.shared_links_title),
        enabled = true,
        tag = "settings-shared-links",
        onClick = { navigate(SharedLinks) },
    )
    LinkRow(
        label = stringResource(R.string.trash_title),
        enabled = true,
        tag = "settings-trash",
        onClick = { navigate(Trash) },
    )
}

@Composable
private fun LinkRow(
    label: String,
    enabled: Boolean,
    tag: String,
    onClick: () -> Unit,
) {
    Text(
        label,
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 1f else 0.38f),
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
                .padding(vertical = 12.dp)
                .testTag(tag),
    )
}
