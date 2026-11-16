package io.github.marcinjahn.commitnote.note

import android.content.ActivityNotFoundException
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.app.DraftFocus
import io.github.marcinjahn.commitnote.app.EditorState
import io.github.marcinjahn.commitnote.core.api.ConflictResolution
import io.github.marcinjahn.commitnote.core.api.OpenNote
import io.github.marcinjahn.commitnote.core.api.OpenNoteConflict
import io.github.marcinjahn.commitnote.editor.NoteEditor
import io.github.marcinjahn.commitnote.editor.NoteEditorHandle
import io.github.marcinjahn.commitnote.editor.NoteMatch
import io.github.marcinjahn.commitnote.share.ShareSheet
import io.github.marcinjahn.commitnote.tree.SyncStatus
import io.github.marcinjahn.commitnote.ui.CommitnoteTopBar
import io.github.marcinjahn.commitnote.ui.ConfirmDialog
import io.github.marcinjahn.commitnote.ui.ErrorText
import io.github.marcinjahn.commitnote.ui.NameDialog
import io.github.marcinjahn.commitnote.ui.isCompactHeight

/** Where the note screen leads. */
class NoteNavigation(
    val onBack: () -> Unit,
    val onOpenImage: (imageId: String) -> Unit,
    val onHistory: () -> Unit,
)

/** A note, or a new note when [path] is null; [typed] is text typed before the screen showed. */
@Composable
fun NoteScreen(
    session: AppSession,
    path: List<String>?,
    typed: String?,
    match: NoteMatch?,
    navigation: NoteNavigation,
) {
    val context = LocalContext.current
    val viewModel: NoteViewModel =
        viewModel(
            factory =
                viewModelFactory {
                    initializer {
                        NoteViewModel(
                            session,
                            path,
                            typed,
                            match,
                            createSavedStateHandle(),
                            NoteImageFiles(context),
                        )
                    }
                },
        )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val sync by viewModel.sync.collectAsStateWithLifecycle()
    val appearance by viewModel.appearance.collectAsStateWithLifecycle()
    val dialog by viewModel.dialog.collectAsStateWithLifecycle()
    var sharing by rememberSaveable { mutableStateOf(false) }
    val handle = remember { NoteEditorHandle() }
    val snackbar = remember { SnackbarHostState() }
    val printer = remember(context) { NotePrinter(context) }
    val failedMessage = stringResource(R.string.note_action_failed)

    DisposableEffect(printer) { onDispose { printer.release() } }
    LaunchedEffect(viewModel) {
        viewModel.messages.collect { message -> snackbar.showSnackbar(message.resolve(context)) }
    }
    LaunchedEffect(viewModel) { viewModel.printJobs.collect(printer::print) }
    LaunchedEffect(viewModel) { viewModel.closeRequests.collect { navigation.onBack() } }
    LaunchedEffect(state.lineage) {
        if (state.target.isDraft && state.draftFocus == DraftFocus.Body) handle.focus()
    }

    val images = rememberImageInput(viewModel, onFailure = { snackbar.showSnackbar(failedMessage) })
    val focused by handle.focused
    val showsEditor = state.target.isDraft || state.targetNote is OpenNote.Loaded

    Scaffold(
        topBar = {
            NoteTopBar(
                state = state,
                viewModel = viewModel,
                onBack = navigation.onBack,
                onSubmitName = handle::focus,
                actions = {
                    sync?.let { SyncStatus(it, onRetry = viewModel::retrySync) }
                    if (showsEditor) {
                        InsertImageAction(
                            onPhotoLibrary = images.pick,
                            onTakePhoto = images.takePhoto,
                        )
                    }
                    NoteMenu(
                        isNote = state.target.notePath != null,
                        onHistory = navigation.onHistory,
                        onShare = { sharing = true },
                        onPrint = viewModel::print,
                        onDelete = viewModel::requestDelete,
                    )
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding).imePadding()) {
            state.nameError?.let { ErrorText(it, modifier = Modifier.padding(horizontal = 16.dp)) }
            val note = state.targetNote
            if (note is OpenNote.Loaded) {
                note.conflict?.let { ConflictBanner(it, viewModel::resolveConflict) }
            }
            Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                if (showsEditor) {
                    NoteEditor(
                        controller = viewModel.controller,
                        handle = handle,
                        noteFont = appearance.noteFont,
                        loadImage = viewModel::loadImage,
                        onReceiveImages = { viewModel.insertImages(it) },
                        onOpenImage = navigation.onOpenImage,
                        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                    )
                } else {
                    NoteStatus(note, onBack = navigation.onBack, onRetry = viewModel::retryOpen)
                }
            }
            if (showsEditor) {
                HorizontalDivider()
                val hideWordCount = focused && isCompactHeight()
                state.words?.takeUnless { hideWordCount }?.let { words ->
                    Text(
                        stringResource(R.string.note_word_count, words.value, words.label),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier =
                            Modifier
                                .padding(
                                    horizontal = 16.dp,
                                    vertical = 6.dp,
                                ).testTag("word-count"),
                    )
                }
            }
        }
    }

    val sharedPath = state.target.notePath
    if (sharing && sharedPath != null) {
        ShareSheet(session, sharedPath, onDismiss = { sharing = false })
    }

    when (val current = dialog) {
        null -> {}

        is NoteDialog.Rename -> {
            NameDialog(
                title = stringResource(R.string.note_rename_title),
                label = stringResource(R.string.note_name_label),
                initial = current.name,
                error = current.error,
                confirmLabel = stringResource(R.string.action_ok),
                onConfirm = viewModel::rename,
                onDismiss = viewModel::dismissDialog,
            )
        }

        is NoteDialog.Delete -> {
            ConfirmDialog(
                title = current.preview.title,
                message = current.preview.message,
                confirmLabel = current.preview.confirmLabel,
                confirmTag = "confirm-delete",
                onConfirm = { viewModel.confirmDelete(current) },
                onDismiss = viewModel::dismissDialog,
            )
        }
    }
}

private class ImageInputLaunchers(
    val pick: () -> Unit,
    val takePhoto: (() -> Unit)?,
)

/** The photo picker and the camera; [ImageInputLaunchers.takePhoto] is null without a camera. */
@Composable
private fun rememberImageInput(
    viewModel: NoteViewModel,
    onFailure: suspend () -> Unit,
): ImageInputLaunchers {
    val context = LocalContext.current
    var pendingPhoto by rememberSaveable { mutableStateOf<Uri?>(null) }
    var launchFailed by remember { mutableStateOf(false) }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri != null) viewModel.insertImages(listOf(uri))
        }
    val camera =
        rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
            val photo = pendingPhoto
            pendingPhoto = null
            if (saved &&
                photo != null
            ) {
                viewModel.insertImages(listOf(photo), fromCamera = true)
            } else {
                viewModel.discardPhotos()
            }
        }
    LaunchedEffect(launchFailed) {
        if (!launchFailed) return@LaunchedEffect
        onFailure()
        launchFailed = false
    }
    val hasCamera =
        remember(
            context,
        ) { context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) }
    return ImageInputLaunchers(
        pick = {
            try {
                picker.launch(
                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                )
            } catch (_: ActivityNotFoundException) {
                launchFailed = true
            }
        },
        takePhoto =
            if (!hasCamera) {
                null
            } else {
                {
                    val photo = viewModel.newPhoto()
                    pendingPhoto = photo
                    try {
                        camera.launch(photo)
                    } catch (_: ActivityNotFoundException) {
                        pendingPhoto = null
                        viewModel.discardPhotos()
                        launchFailed = true
                    }
                }
            },
    )
}

@Composable
private fun NoteTopBar(
    state: EditorState,
    viewModel: NoteViewModel,
    onBack: () -> Unit,
    onSubmitName: () -> Unit,
    actions: @Composable () -> Unit,
) {
    CommitnoteTopBar(
        title = {
            val path = state.target.notePath
            if (state.target.isDraft) {
                DraftNameField(
                    name = state.draftName,
                    focus = state.draftFocus == DraftFocus.Name,
                    lineage = state.lineage,
                    onChange = viewModel::setDraftName,
                    onSubmit = {
                        viewModel.commitDraftName()
                        onSubmitName()
                    },
                )
            } else if (path != null) {
                val name = viewModel.noteName(path)
                Text(
                    name,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.titleLarge,
                    modifier =
                        Modifier
                            .clickable(
                                onClickLabel = stringResource(R.string.note_rename_hint, name),
                                onClick = viewModel::openRename,
                            ).testTag("note-title"),
                )
            }
        },
        navigationIcon = {
            IconButton(onClick = onBack, modifier = Modifier.testTag("note-back")) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.action_back))
            }
        },
        actions = { actions() },
    )
}

@Composable
private fun DraftNameField(
    name: String,
    focus: Boolean,
    lineage: Int,
    onChange: (String) -> Unit,
    onSubmit: () -> Unit,
) {
    val focusRequester = remember { FocusRequester() }
    val textStyle =
        MaterialTheme.typography.titleLarge.copy(
            color = MaterialTheme.colorScheme.onSurface,
        )
    val label = stringResource(R.string.note_name_label)
    LaunchedEffect(lineage) { if (focus) focusRequester.requestFocus() }
    BasicTextField(
        value = name,
        onValueChange = onChange,
        singleLine = true,
        textStyle = textStyle,
        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        keyboardOptions =
            KeyboardOptions(
                capitalization = KeyboardCapitalization.Sentences,
                imeAction = ImeAction.Next,
            ),
        keyboardActions = KeyboardActions(onNext = { onSubmit() }, onDone = { onSubmit() }),
        decorationBox = { field ->
            Box {
                if (name.isEmpty()) {
                    Text(
                        stringResource(R.string.note_name_placeholder),
                        style = textStyle,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                field()
            }
        },
        modifier =
            Modifier
                .fillMaxWidth()
                .focusRequester(focusRequester)
                .semantics { contentDescription = label }
                .testTag("draft-name"),
    )
}

@Composable
private fun InsertImageAction(
    onPhotoLibrary: () -> Unit,
    onTakePhoto: (() -> Unit)?,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }, modifier = Modifier.testTag("insert-image")) {
            Icon(Icons.Filled.AddPhotoAlternate, stringResource(R.string.insert_image))
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.insert_photo_library)) },
                onClick = {
                    expanded = false
                    onPhotoLibrary()
                },
                modifier = Modifier.testTag("insert-photo-library"),
            )
            if (onTakePhoto != null) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.insert_take_photo)) },
                    onClick = {
                        expanded = false
                        onTakePhoto()
                    },
                    modifier = Modifier.testTag("insert-take-photo"),
                )
            }
        }
    }
}

@Composable
private fun NoteMenu(
    isNote: Boolean,
    onHistory: () -> Unit,
    onShare: () -> Unit,
    onPrint: () -> Unit,
    onDelete: () -> Unit,
) {
    if (!isNote) return
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }, modifier = Modifier.testTag("note-menu")) {
            Icon(Icons.Filled.MoreVert, stringResource(R.string.note_menu))
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            listOf(
                Triple(R.string.note_history, "note-menu-history", onHistory),
                Triple(R.string.note_share, "note-menu-share", onShare),
                Triple(R.string.note_print, "note-menu-print", onPrint),
                Triple(R.string.note_delete, "note-menu-delete", onDelete),
            ).forEach { (label, tag, action) ->
                DropdownMenuItem(
                    text = { Text(stringResource(label)) },
                    onClick = {
                        expanded = false
                        action()
                    },
                    modifier = Modifier.testTag(tag),
                )
            }
        }
    }
}

@Composable
private fun NoteStatus(
    note: OpenNote?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        when (note) {
            is OpenNote.Missing, is OpenNote.Trashed -> {
                val message =
                    when (note) {
                        is OpenNote.Missing -> note.message
                        else -> (note as OpenNote.Trashed).message
                    }
                Text(
                    message,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.testTag("note-gone"),
                )
                Button(onClick = onBack) { Text(stringResource(R.string.action_back)) }
            }

            is OpenNote.Failed -> {
                ErrorText(note.message, modifier = Modifier.testTag("note-failed"))
                Button(onClick = onRetry) { Text(stringResource(R.string.action_retry)) }
            }

            else -> {
                CircularProgressIndicator(
                    modifier = Modifier.testTag("note-loading"),
                )
                Text(
                    stringResource(R.string.note_loading),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

@Composable
private fun ConflictBanner(
    conflict: OpenNoteConflict,
    onResolve: (ConflictResolution) -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        modifier = Modifier.fillMaxWidth().testTag("conflict-banner"),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(conflict.heading, style = MaterialTheme.typography.titleSmall)
            Text(
                if (conflict.editing) conflict.editHint else conflict.text,
                style = MaterialTheme.typography.bodyMedium,
            )
            if (!conflict.editing) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        onResolve(ConflictResolution.KEEP_MINE)
                    }) { Text(conflict.keepThisLabel) }
                    OutlinedButton(onClick = {
                        onResolve(ConflictResolution.KEEP_THEIRS)
                    }) { Text(conflict.keepOtherLabel) }
                    TextButton(onClick = {
                        onResolve(ConflictResolution.EDIT_MERGED)
                    }) { Text(conflict.editMergedLabel) }
                }
            }
        }
    }
}
