@file:OptIn(ExperimentalSerializationApi::class)

package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

@Serializable
data class HistoryVersionView(
    val sha: String,
    val time: String,
    val dateTime: String,
    val current: Boolean,
    val shared: Boolean,
    val events: List<String>,
    val name: String?,
)

@Serializable
@JsonClassDiscriminator("kind")
sealed interface HistoryRow {
    @Serializable
    @SerialName("single")
    data class Single(
        val version: HistoryVersionView,
    ) : HistoryRow

    @Serializable
    @SerialName("session")
    data class Session(
        val title: String,
        val shared: Boolean,
        val versions: List<HistoryVersionView>,
    ) : HistoryRow
}

@Serializable
data class HistorySection(
    val title: String,
    val rows: List<HistoryRow>,
)

@Serializable
enum class HistoryPhase {
    @SerialName("saving")
    SAVING,

    @SerialName("unsaved")
    UNSAVED,

    @SerialName("ready")
    READY,
}

@Serializable
data class HistoryView(
    val path: List<String>,
    val phase: HistoryPhase,
    val message: String?,
    val sections: List<HistorySection>,
    val loading: Boolean,
    val error: String?,
    val end: String?,
    val canLoadMore: Boolean,
)

@Serializable
data class DiffSegment(
    val text: String,
    val changed: Boolean,
)

@Serializable
@JsonClassDiscriminator("kind")
sealed interface DiffLineView {
    @Serializable
    @SerialName("same")
    data class Same(
        val text: String,
    ) : DiffLineView

    @Serializable
    @SerialName("added")
    data class Added(
        val segments: List<DiffSegment>,
    ) : DiffLineView

    @Serializable
    @SerialName("removed")
    data class Removed(
        val segments: List<DiffSegment>,
    ) : DiffLineView
}

@Serializable
@JsonClassDiscriminator("kind")
sealed interface DiffItemView {
    @Serializable
    @SerialName("line")
    data class Line(
        val line: DiffLineView,
    ) : DiffItemView

    @Serializable
    @SerialName("fold")
    data class Fold(
        val label: String,
        val lines: List<DiffLineView>,
    ) : DiffItemView
}

@Serializable
@JsonClassDiscriminator("kind")
sealed interface PreviewBody {
    @Serializable
    @SerialName("tooLarge")
    data class TooLarge(
        val message: String,
    ) : PreviewBody

    @Serializable
    @SerialName("unchanged")
    data class Unchanged(
        val message: String,
    ) : PreviewBody

    @Serializable
    @SerialName("diff")
    data class Diff(
        val items: List<DiffItemView>,
        val finalNewline: String?,
    ) : PreviewBody
}

@Serializable
data class RestoreAction(
    val label: String,
    val enabled: Boolean,
    val reason: String?,
)

@Serializable
@JsonClassDiscriminator("kind")
sealed interface VersionPreview {
    @Serializable
    @SerialName("failed")
    data class Failed(
        val message: String,
    ) : VersionPreview

    @Serializable
    @SerialName("undecryptable")
    data class Undecryptable(
        val message: String,
    ) : VersionPreview

    @Serializable
    @SerialName("closed")
    data class Closed(
        val message: String,
    ) : VersionPreview

    @Serializable
    @SerialName("version")
    data class Version(
        val titleChange: String?,
        val body: PreviewBody,
        val restoreTitle: String?,
        val restore: RestoreAction,
    ) : VersionPreview
}

@Serializable
@JsonClassDiscriminator("kind")
sealed interface RestoreVersionOutcome {
    @Serializable
    @SerialName("restored")
    data object Restored : RestoreVersionOutcome

    @Serializable
    @SerialName("blocked")
    data class Blocked(
        val message: String,
    ) : RestoreVersionOutcome

    @Serializable
    @SerialName("error")
    data class Error(
        val message: String,
    ) : RestoreVersionOutcome

    @Serializable
    @SerialName("closed")
    data object Closed : RestoreVersionOutcome
}

/** The params of `history.preview` and `history.restore`. */
@Serializable
data class HistoryVersionParams(
    val sha: String,
    val restoreTitle: Boolean,
)

@Serializable
data class HistoryPreviewResult(
    val preview: VersionPreview,
)

@Serializable
data class HistoryRestoreResult(
    val outcome: RestoreVersionOutcome,
)
