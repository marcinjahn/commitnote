@file:OptIn(ExperimentalSerializationApi::class)

package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

@Serializable
enum class ForgeKind {
    @SerialName("github")
    GITHUB,

    @SerialName("gitlab")
    GITLAB,
}

@Serializable
enum class ColorTag {
    @SerialName("red")
    RED,

    @SerialName("orange")
    ORANGE,

    @SerialName("yellow")
    YELLOW,

    @SerialName("green")
    GREEN,

    @SerialName("blue")
    BLUE,

    @SerialName("purple")
    PURPLE,
}

@Serializable
@JsonClassDiscriminator("kind")
sealed interface TreeNode {
    @Serializable
    @SerialName("folder")
    data class Folder(
        val name: String,
        val path: List<String>,
        val noteCount: Int,
        val children: List<TreeNode>,
    ) : TreeNode

    @Serializable
    @SerialName("note")
    data class Note(
        val name: String,
        val path: List<String>,
        val colorTag: ColorTag?,
        val shared: Boolean,
    ) : TreeNode
}

@Serializable
@JsonClassDiscriminator("state")
sealed interface OpenNote {
    @Serializable
    @SerialName("loading")
    data class Loading(
        val path: List<String>,
    ) : OpenNote

    @Serializable
    @SerialName("loaded")
    data class Loaded(
        val path: List<String>,
        val content: String,
        val conflict: OpenNoteConflict?,
        val colorTag: ColorTag?,
        val shared: Boolean,
    ) : OpenNote

    @Serializable
    @SerialName("missing")
    data class Missing(
        val path: List<String>,
        val message: String,
    ) : OpenNote

    @Serializable
    @SerialName("trashed")
    data class Trashed(
        val path: List<String>,
        val message: String,
    ) : OpenNote

    @Serializable
    @SerialName("failed")
    data class Failed(
        val path: List<String>,
        val message: String,
        val error: CoreError,
    ) : OpenNote
}

@Serializable
data class OpenNoteConflict(
    val otherDevice: String?,
    val heading: String,
    val text: String,
    val keepThisLabel: String,
    val keepOtherLabel: String,
    val editMergedLabel: String,
    val editHint: String,
    val merged: String,
    val editing: Boolean,
)

@Serializable
data class RepositoryView(
    val label: String,
    val url: String,
    val private: Boolean,
    val publicWarning: String?,
)

@Serializable
data class RepositoryListing(
    val url: String,
    val label: String,
    val private: Boolean,
)

@Serializable
@JsonClassDiscriminator("kind")
sealed interface LoggedIn {
    @Serializable
    @SerialName("loggedIn")
    data object Done : LoggedIn
}

@Serializable
@JsonClassDiscriminator("kind")
sealed interface LogoutOutcome {
    @Serializable
    @SerialName("loggedOut")
    data object LoggedOut : LogoutOutcome

    @Serializable
    @SerialName("unsaved")
    data class Unsaved(
        val count: Int,
        val message: String,
    ) : LogoutOutcome
}

@Serializable
@JsonClassDiscriminator("kind")
sealed interface FlushOutcome {
    @Serializable
    @SerialName("saved")
    data object Saved : FlushOutcome

    @Serializable
    @SerialName("unsaved")
    data class Unsaved(
        val count: Int,
    ) : FlushOutcome
}

@Serializable
enum class LoadingStep {
    @SerialName("listingRepositories")
    LISTING_REPOSITORIES,

    @SerialName("checkingRepository")
    CHECKING_REPOSITORY,

    @SerialName("derivingKeys")
    DERIVING_KEYS,

    @SerialName("initializing")
    INITIALIZING,
}

@Serializable
data class TagOptionView(
    val tag: ColorTag,
    val label: String,
)

@Serializable
enum class NoticeTone {
    @SerialName("info")
    INFO,

    @SerialName("warning")
    WARNING,

    @SerialName("error")
    ERROR,

    @SerialName("success")
    SUCCESS,
}

@Serializable
@JsonClassDiscriminator("kind")
sealed interface NoticeAction {
    @Serializable
    @SerialName("openNote")
    data class OpenNote(
        val label: String,
        val path: List<String>,
    ) : NoticeAction

    @Serializable
    @SerialName("undo")
    data class Undo(
        val label: String,
    ) : NoticeAction
}

@Serializable
enum class SessionEndReason {
    @SerialName("loggedOut")
    LOGGED_OUT,
}
