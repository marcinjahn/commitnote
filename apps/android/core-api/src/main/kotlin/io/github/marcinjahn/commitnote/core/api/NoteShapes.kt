@file:OptIn(ExperimentalSerializationApi::class)

package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

@Serializable
enum class ConflictResolution {
    @SerialName("keepMine")
    KEEP_MINE,

    @SerialName("keepTheirs")
    KEEP_THEIRS,

    @SerialName("editMerged")
    EDIT_MERGED,
}

@Serializable
data class ConflictResolveParams(
    val path: List<String>,
    val resolution: ConflictResolution,
)

@Serializable
data class ExportNotesParams(
    val includeImages: Boolean,
)

/** The zip archive of every note, as base64. */
@Serializable
data class ExportedArchive(
    val fileName: String,
    val mimeType: String,
    val base64: String,
)

@Serializable
data class DraftCommitNameParams(
    val name: String,
)

@Serializable
@JsonClassDiscriminator("kind")
sealed interface NameCommitOutcome {
    @Serializable
    @SerialName("none")
    data object None : NameCommitOutcome

    @Serializable
    @SerialName("restore")
    data object Restore : NameCommitOutcome

    @Serializable
    @SerialName("error")
    data class Error(
        val message: String,
    ) : NameCommitOutcome

    @Serializable
    @SerialName("ok")
    data class Ok(
        val path: List<String>,
    ) : NameCommitOutcome
}

@Serializable
data class NoteRenameParams(
    val path: List<String>,
    val name: String,
)

@Serializable
data class NoteRenameResult(
    val outcome: NameCommitOutcome,
)

@Serializable
data class DetailItemText(
    val label: String,
    val value: String,
)

@Serializable
data class NoteStatsResult(
    val words: DetailItemText,
    val tasks: DetailItemText?,
)

@Serializable
data class NoteDatesResult(
    val notSaved: Boolean,
    val created: DetailItemText?,
    val updated: DetailItemText?,
)

@Serializable
enum class ImageMimeType {
    @SerialName("image/webp")
    WEBP,

    @SerialName("image/gif")
    GIF,
}

@Serializable
data class ImageReadParams(
    val imageId: String,
)

@Serializable
data class NoteImage(
    @SerialName("type") val mimeType: ImageMimeType,
    val base64: String,
)

@Serializable
data class ImageReadResult(
    val image: NoteImage?,
)

@Serializable
data class ImageInsertParams(
    val inputs: List<String>,
)

@Serializable
data class ImageInsertResult(
    val references: List<String>,
)

@Serializable
data class ImageClonePastedParams(
    val path: List<String>?,
    val current: String,
    val pasted: String,
)

@Serializable
data class ImageClonePastedResult(
    val text: String,
)

@Serializable
data class EarlyDraftHandOffParams(
    val name: String,
    val body: String,
    val nameConfirmed: Boolean,
)

@Serializable
@JsonClassDiscriminator("kind")
sealed interface EarlyDraftOutcome {
    @Serializable
    @SerialName("none")
    data object None : EarlyDraftOutcome

    @Serializable
    @SerialName("draft")
    data class Draft(
        val name: String,
        val error: String?,
    ) : EarlyDraftOutcome

    @Serializable
    @SerialName("created")
    data class Created(
        val path: List<String>,
        val fieldError: String?,
    ) : EarlyDraftOutcome
}

@Serializable
data class EarlyDraftHandOffResult(
    val outcome: EarlyDraftOutcome,
)

@Serializable
data class PrintRenderParams(
    val name: String,
    val text: String,
)

@Serializable
data class PrintRenderResult(
    val html: String,
)

@Serializable
data class NoticeIdParams(
    val id: String,
)

/** A change to a note's text made on another device, as a replacement of `[from, to)`. */
@Serializable
data class RemoteTextEdit(
    val from: Int,
    val to: Int,
    val insert: String,
)

@Serializable
enum class RemoteChange {
    @SerialName("updated")
    UPDATED,

    @SerialName("relocated")
    RELOCATED,

    @SerialName("trashed")
    TRASHED,
}
