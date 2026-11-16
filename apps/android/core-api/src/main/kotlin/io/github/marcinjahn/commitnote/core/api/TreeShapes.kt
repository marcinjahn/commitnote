@file:OptIn(ExperimentalSerializationApi::class)

package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

@Serializable
data class PathParams(
    val path: List<String>,
)

@Serializable
@JsonClassDiscriminator("kind")
sealed interface StructureOutcome {
    @Serializable
    @SerialName("ok")
    data class Ok(
        val path: List<String>,
    ) : StructureOutcome

    @Serializable
    @SerialName("error")
    data class Error(
        val message: String,
    ) : StructureOutcome
}

@Serializable
data class StructureOutcomeResult(
    val outcome: StructureOutcome,
)

@Serializable
@JsonClassDiscriminator("kind")
sealed interface MoveSiblingOutcome {
    @Serializable
    @SerialName("ok")
    data class Ok(
        val path: List<String>,
    ) : MoveSiblingOutcome

    @Serializable
    @SerialName("error")
    data class Error(
        val message: String,
    ) : MoveSiblingOutcome

    @Serializable
    @SerialName("none")
    data object None : MoveSiblingOutcome
}

@Serializable
data class NodeMoveSiblingResult(
    val outcome: MoveSiblingOutcome,
)

@Serializable
@JsonClassDiscriminator("kind")
sealed interface FolderCreateOutcome {
    @Serializable
    @SerialName("created")
    data class Created(
        val path: List<String>,
    ) : FolderCreateOutcome

    @Serializable
    @SerialName("error")
    data class Error(
        val message: String,
    ) : FolderCreateOutcome
}

@Serializable
data class FolderCreateParams(
    val parent: List<String>,
    val name: String,
)

@Serializable
data class FolderCreateResult(
    val outcome: FolderCreateOutcome,
)

@Serializable
data class NodeRenameParams(
    val path: List<String>,
    val name: String,
)

@Serializable
data class NodeMoveParams(
    val path: List<String>,
    val parent: List<String>,
)

@Serializable
data class NodePlaceParams(
    val path: List<String>,
    val parent: List<String>,
    val before: String?,
)

@Serializable
enum class SiblingDirection {
    @SerialName("up")
    UP,

    @SerialName("down")
    DOWN,
}

@Serializable
data class NodeMoveSiblingParams(
    val path: List<String>,
    val direction: SiblingDirection,
)

@Serializable
data class NodeSetColorTagParams(
    val path: List<String>,
    val tag: ColorTag?,
)

@Serializable
data class MoveTargetView(
    val path: List<String>,
    val label: String,
    val depth: Int,
    val disabled: Boolean,
)

@Serializable
data class MoveTargetsResult(
    val targets: List<MoveTargetView>,
)

@Serializable
data class TrashPreview(
    val title: String,
    val message: String,
    val confirmLabel: String,
    val itemCount: Int,
    val shareCount: Int,
)

@Serializable
data class NodeTrashPreviewResult(
    val preview: TrashPreview,
)

@Serializable
data class NodeTrashParams(
    val path: List<String>,
    val shareCount: Int,
)

@Serializable
@JsonClassDiscriminator("kind")
sealed interface TrashOutcome {
    @Serializable
    @SerialName("trashed")
    data class Trashed(
        val entryId: String,
    ) : TrashOutcome

    @Serializable
    @SerialName("deleted")
    data object Deleted : TrashOutcome

    @Serializable
    @SerialName("confirm")
    data class Confirm(
        val preview: TrashPreview,
    ) : TrashOutcome

    @Serializable
    @SerialName("error")
    data class Error(
        val message: String,
    ) : TrashOutcome
}

@Serializable
data class NodeTrashResult(
    val outcome: TrashOutcome,
)

@Serializable
enum class TrashItemKind {
    @SerialName("note")
    NOTE,

    @SerialName("folder")
    FOLDER,
}

@Serializable
data class TrashItemView(
    val kind: TrashItemKind,
    val name: String,
    val subPath: List<String>,
    val children: List<TrashItemView>,
)

@Serializable
data class TrashEntryView(
    val id: String,
    val kind: TrashItemKind,
    val name: String,
    val originalFolder: String,
    val daysLeft: String,
    val colorTag: ColorTag?,
    val children: List<TrashItemView>,
)

@Serializable
data class TrashConfirmationText(
    val title: String,
    val message: String,
)

@Serializable
data class TrashRestoreTargetsParams(
    val entryId: String,
    val subPath: List<String>,
)

@Serializable
data class TrashRestoreParams(
    val entryId: String,
    val subPath: List<String>,
    val parent: List<String>,
)

@Serializable
data class TrashEntryParams(
    val entryId: String,
)

@Serializable
data class TagsSetFilterParams(
    val tag: ColorTag?,
)
