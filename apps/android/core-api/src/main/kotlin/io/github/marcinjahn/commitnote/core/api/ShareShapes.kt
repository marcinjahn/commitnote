@file:OptIn(ExperimentalSerializationApi::class)

package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

@Serializable
enum class ShareActionId {
    @SerialName("copy-link")
    COPY_LINK,

    @SerialName("copy-password")
    COPY_PASSWORD,

    @SerialName("update")
    UPDATE,

    @SerialName("view")
    VIEW,

    @SerialName("open")
    OPEN,

    @SerialName("rename")
    RENAME,

    @SerialName("revoke")
    REVOKE,
}

@Serializable
data class ShareActionView(
    val id: ShareActionId,
    val label: String,
    val disabled: Boolean,
    val destructive: Boolean,
)

@Serializable
data class ShareRowView(
    val id: String,
    val title: String,
    val label: String?,
    val date: String,
    val passwordProtected: Boolean,
    val link: String,
    val password: String?,
    val notePath: List<String>?,
    val menuLabel: String,
    val actions: List<ShareActionView>,
)

@Serializable
data class ShareCopy(
    val explanation: String,
    val labelField: String,
    val passwordField: String,
    val passwordHint: String,
    val create: String,
    val creating: String,
    val createAnother: String,
    val shareLink: String,
    val sharePassword: String,
    val sharedLinksTitle: String,
    val sharedLinksEmpty: String,
    val passwordProtected: String,
    val updating: String,
    val linkCopied: String,
    val passwordCopied: String,
    val revoke: ConfirmCopy,
    val rename: RenameCopy,
    val sharedVersionTitle: String,
    val loadingSharedVersion: String,
) {
    @Serializable
    data class ConfirmCopy(
        val title: String,
        val message: String,
        val confirmLabel: String,
    )

    @Serializable
    data class RenameCopy(
        val title: String,
        val fieldLabel: String,
        val confirmLabel: String,
    )
}

/** A piece of an error message; link parts carry the URL to open. */
@Serializable
@JsonClassDiscriminator("kind")
sealed interface MessagePart {
    @Serializable
    @SerialName("text")
    data class Text(
        val text: String,
    ) : MessagePart

    @Serializable
    @SerialName("link")
    data class Link(
        val text: String,
        val href: String,
    ) : MessagePart
}

@Serializable
@JsonClassDiscriminator("kind")
sealed interface ShareCreateOutcome {
    @Serializable
    @SerialName("created")
    data class Created(
        val link: String,
        val password: String?,
    ) : ShareCreateOutcome

    @Serializable
    @SerialName("error")
    data class Error(
        val parts: List<MessagePart>,
    ) : ShareCreateOutcome
}

@Serializable
@JsonClassDiscriminator("kind")
sealed interface ShareRenameOutcome {
    @Serializable
    @SerialName("ok")
    data object Ok : ShareRenameOutcome

    @Serializable
    @SerialName("error")
    data class Error(
        val message: String,
    ) : ShareRenameOutcome
}

@Serializable
@JsonClassDiscriminator("kind")
sealed interface SharedVersionOutcome {
    @Serializable
    @SerialName("readable")
    data class Readable(
        val name: String?,
        val content: String,
        val date: String,
    ) : SharedVersionOutcome

    @Serializable
    @SerialName("message")
    data class Message(
        val message: String,
    ) : SharedVersionOutcome

    @Serializable
    @SerialName("failed")
    data class Failed(
        val message: String,
    ) : SharedVersionOutcome
}

@Serializable
data class ShareFormResult(
    val title: String,
)

@Serializable
data class ShareCreateParams(
    val path: List<String>,
    val password: Secret,
    val label: String,
)

@Serializable
data class ShareCreateResult(
    val outcome: ShareCreateOutcome,
)

@Serializable
data class ShareIdParams(
    val id: String,
)

@Serializable
data class ShareRenameParams(
    val id: String,
    val label: String,
)

@Serializable
data class ShareRenameResult(
    val outcome: ShareRenameOutcome,
)

@Serializable
data class ShareSharedVersionResult(
    val outcome: SharedVersionOutcome,
)
