package io.github.marcinjahn.commitnote.transfer

import android.content.ContentResolver
import android.net.Uri
import androidx.lifecycle.viewModelScope
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.app.StagedFile
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.DroppedFile
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.ImportArchiveOutcome
import io.github.marcinjahn.commitnote.core.api.ImportCommitParams
import io.github.marcinjahn.commitnote.core.api.ImportDestinationView
import io.github.marcinjahn.commitnote.core.api.ImportDropFilesParams
import io.github.marcinjahn.commitnote.core.api.ImportForm
import io.github.marcinjahn.commitnote.core.api.ImportOutcomeView
import io.github.marcinjahn.commitnote.core.api.ImportPolicy
import io.github.marcinjahn.commitnote.core.api.ImportPreviewParams
import io.github.marcinjahn.commitnote.core.api.ImportReadArchiveParams
import io.github.marcinjahn.commitnote.core.api.ImportSource
import io.github.marcinjahn.commitnote.core.runtime.CoreException
import io.github.marcinjahn.commitnote.ui.ActionViewModel
import io.github.marcinjahn.commitnote.ui.UiText
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** What the core says must be set up before it can import, and how to do it. */
data class ImportSetup(
    val canConfigure: Boolean,
    val message: String,
    val actionLabel: String,
)

/** The import the user is in the middle of. */
data class ImportUiState(
    val form: ImportForm? = null,
    val preview: String? = null,
    val busy: Boolean = false,
    val message: String? = null,
    val offersRename: Boolean = false,
    val setup: ImportSetup? = null,
    val directSetup: ImportSetup? = null,
)

private const val PREVIEW_DELAY_MS = 150L

/** Exporting the notes to a document and importing documents into them. */
class TransferViewModel(
    private val session: AppSession,
) : ActionViewModel() {
    val exporter = NotesExporter(session, includeImages = true, scope = viewModelScope)

    val importing: StateFlow<Boolean> =
        session.screens.importStatus
            .map { it?.importing == true }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), false)

    private val mutableImport = MutableStateFlow(ImportUiState())
    val importState: StateFlow<ImportUiState> = mutableImport.asStateFlow()

    private var previewJob: Job? = null
    private var retry: Pair<ImportDestinationView, ImportPolicy>? = null

    /** Reads the picked [uris] and hands them to the core: an archive opens the import form. */
    fun importDocuments(
        uris: List<Uri>,
        resolver: ContentResolver,
    ) {
        if (uris.isEmpty()) return
        viewModelScope.launch {
            val documents = resolver.readDocuments(uris)
            if (documents == null) {
                showMessage(UiText.Resource(R.string.import_read_failed))
                return@launch
            }
            reporting {
                session.editor.flush()
                sendDocuments(documents)
            }
        }
    }

    fun preview(destination: ImportDestinationView) {
        previewJob?.cancel()
        previewJob =
            viewModelScope.launch {
                delay(PREVIEW_DELAY_MS)
                reporting {
                    val text =
                        session
                            .send(
                                CoreCommands.importPreview,
                                ImportPreviewParams(destination),
                            ).text
                    mutableImport.update { if (it.form != null) it.copy(preview = text) else it }
                }
            }
    }

    fun commit(
        destination: ImportDestinationView,
        policy: ImportPolicy,
    ) {
        if (mutableImport.value.busy) return
        mutableImport.update { it.copy(busy = true) }
        viewModelScope.launch {
            try {
                commitNow(destination, policy)
            } finally {
                mutableImport.update { it.copy(busy = false) }
            }
        }
    }

    fun enableAtomic() {
        if (mutableImport.value.busy) return
        val formOpen = mutableImport.value.form != null
        mutableImport.update { it.copy(busy = true, directSetup = null) }
        viewModelScope.launch {
            try {
                val result = session.send(CoreCommands.importEnableAtomic, Empty)
                val outcome = result.outcome
                val pending = retry
                when {
                    result.error != null -> reportFailure(result.error!!)
                    outcome != null -> applyOutcome(outcome)
                    formOpen && pending != null -> commitNow(pending.first, pending.second)
                }
            } catch (failure: CoreException) {
                reportFailure(failure.error.message)
            } finally {
                mutableImport.update { it.copy(busy = false) }
            }
        }
    }

    fun cancel() {
        previewJob?.cancel()
        retry = null
        mutableImport.value = ImportUiState()
        launchAction { session.send(CoreCommands.importCancel, Empty) }
    }

    fun dismissDirectSetup() = mutableImport.update { it.copy(directSetup = null) }

    private suspend fun sendDocuments(documents: List<PickedDocument>) {
        val files = documents.map { StagedFile(it.bytes, it.mimeType) }
        session.withStagedFiles(files) { ids ->
            val single = documents.singleOrNull()
            if (single != null && single.isArchive) {
                readArchive(ids.single(), single.name)
            } else {
                val dropped =
                    documents.mapIndexed {
                        index,
                        document,
                        ->
                        DroppedFile(ids[index], document.name)
                    }
                val params =
                    ImportDropFilesParams(dropped, parent = null, source = ImportSource.PICKER)
                applyOutcome(session.send(CoreCommands.importDropFiles, params).outcome)
            }
        }
    }

    private suspend fun readArchive(
        input: String,
        name: String,
    ) {
        when (
            val outcome =
                session.send(
                    CoreCommands.importReadArchive,
                    ImportReadArchiveParams(input, name),
                )
        ) {
            is ImportArchiveOutcome.Ready -> {
                retry = null
                mutableImport.value = ImportUiState(form = outcome.form)
            }

            is ImportArchiveOutcome.Error -> {
                showMessage(UiText.Plain(outcome.message))
            }
        }
    }

    private suspend fun commitNow(
        destination: ImportDestinationView,
        policy: ImportPolicy,
    ) {
        mutableImport.update { it.copy(message = null, offersRename = false, setup = null) }
        val outcome =
            try {
                session
                    .send(
                        CoreCommands.importCommit,
                        ImportCommitParams(destination, policy),
                    ).outcome
            } catch (failure: CoreException) {
                reportFailure(failure.error.message)
                return
            }
        if (mutableImport.value.form == null) return
        when (outcome) {
            is ImportOutcomeView.Queued -> {
                finish()
            }

            is ImportOutcomeView.Conflicts -> {
                mutableImport.update { it.copy(message = outcome.message, offersRename = true) }
            }

            is ImportOutcomeView.NeedsSetup -> {
                retry = destination to policy
                mutableImport.update { it.copy(setup = outcome.toSetup()) }
            }

            is ImportOutcomeView.Error -> {
                mutableImport.update { it.copy(message = outcome.message) }
            }
        }
    }

    private fun applyOutcome(outcome: ImportOutcomeView) {
        when (outcome) {
            is ImportOutcomeView.Queued -> {
                finish()
            }

            is ImportOutcomeView.NeedsSetup -> {
                mutableImport.update { it.copy(directSetup = outcome.toSetup()) }
            }

            is ImportOutcomeView.Conflicts -> {
                showMessage(UiText.Plain(outcome.message))
            }

            is ImportOutcomeView.Error -> {
                showMessage(UiText.Plain(outcome.message))
            }
        }
    }

    private fun reportFailure(message: String) {
        if (mutableImport.value.form != null) {
            mutableImport.update { it.copy(message = message) }
        } else {
            showMessage(UiText.Plain(message))
        }
    }

    private fun finish() {
        previewJob?.cancel()
        retry = null
        mutableImport.value = ImportUiState()
    }

    private fun ImportOutcomeView.NeedsSetup.toSetup() =
        ImportSetup(canConfigure, message, actionLabel)

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
