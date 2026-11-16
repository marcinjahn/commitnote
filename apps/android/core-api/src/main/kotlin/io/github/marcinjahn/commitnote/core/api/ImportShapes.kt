@file:OptIn(ExperimentalSerializationApi::class)

package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

@Serializable
enum class ImportPolicy {
    @SerialName("stop")
    STOP,

    @SerialName("rename")
    RENAME,
}

@Serializable
enum class ImportSource {
    @SerialName("picker")
    PICKER,

    @SerialName("tree")
    TREE,
}

@Serializable
@JsonClassDiscriminator("kind")
sealed interface ImportDestinationView {
    @Serializable
    @SerialName("root")
    data object Root : ImportDestinationView

    @Serializable
    @SerialName("folder")
    data class Folder(
        val path: List<String>,
    ) : ImportDestinationView

    @Serializable
    @SerialName("newFolder")
    data class NewFolder(
        val parent: List<String>,
        val name: String,
    ) : ImportDestinationView
}

@Serializable
data class ImportTargetView(
    val path: List<String>,
    val label: String,
    val depth: Int,
)

@Serializable
data class ImportFormCopy(
    val title: String,
    val conflictsTitle: String,
    val setupTitle: String,
    val intoLabel: String,
    val newFolderLabel: String,
    val folderNameLabel: String,
    val existingFolderLabel: String,
    val rootLabel: String,
    val emptyText: String,
    val importLabel: String,
    val importingLabel: String,
    val renameLabel: String,
    val enableAtomicLabel: String,
    val cancelLabel: String,
)

@Serializable
data class ImportForm(
    val fileName: String,
    val defaultFolderName: String,
    val skipped: String?,
    val empty: Boolean,
    val targets: List<ImportTargetView>,
    val copy: ImportFormCopy,
)

@Serializable
@JsonClassDiscriminator("kind")
sealed interface ImportArchiveOutcome {
    @Serializable
    @SerialName("ready")
    data class Ready(
        val form: ImportForm,
    ) : ImportArchiveOutcome

    @Serializable
    @SerialName("error")
    data class Error(
        val message: String,
    ) : ImportArchiveOutcome
}

@Serializable
@JsonClassDiscriminator("kind")
sealed interface ImportOutcomeView {
    @Serializable
    @SerialName("queued")
    data class Queued(
        val expand: List<String>?,
    ) : ImportOutcomeView

    @Serializable
    @SerialName("conflicts")
    data class Conflicts(
        val count: Int,
        val message: String,
    ) : ImportOutcomeView

    @Serializable
    @SerialName("needsSetup")
    data class NeedsSetup(
        val canConfigure: Boolean,
        val message: String,
        val actionLabel: String,
    ) : ImportOutcomeView

    @Serializable
    @SerialName("error")
    data class Error(
        val message: String,
    ) : ImportOutcomeView
}

@Serializable
data class AtomicBlockedView(
    val title: String,
    val message: String,
    val enableLabel: String,
    val saveWithoutLabel: String,
    val canConfigure: Boolean,
)

@Serializable
data class ImportReadArchiveParams(
    val input: String,
    val fileName: String,
)

@Serializable
data class ImportPreviewParams(
    val destination: ImportDestinationView,
)

@Serializable
data class ImportPreviewResult(
    val text: String?,
)

@Serializable
data class ImportCommitParams(
    val destination: ImportDestinationView,
    val policy: ImportPolicy,
)

@Serializable
data class DroppedFile(
    val input: String,
    val name: String,
)

@Serializable
data class ImportDropFilesParams(
    val files: List<DroppedFile>,
    val parent: List<String>?,
    val source: ImportSource,
)

/** The result of `import.commit` and `import.dropFiles`. */
@Serializable
data class ImportOutcomeResult(
    val outcome: ImportOutcomeView,
)

@Serializable
data class ImportEnableAtomicResult(
    val error: String?,
    val outcome: ImportOutcomeView?,
)
