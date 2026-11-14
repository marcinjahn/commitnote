@file:OptIn(ExperimentalSerializationApi::class)

package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonContentPolymorphicSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

@Serializable
data class LoginListRepositoriesParams(
    val forge: ForgeKind,
    val accessToken: Secret,
)

@Serializable
data class LoginListRepositoriesResult(
    val repositories: List<RepositoryListing>,
)

@Serializable
data class LoginInspectRepositoryParams(
    val forge: ForgeKind,
    val accessToken: Secret,
    val repositoryUrl: String,
)

@Serializable
@JsonClassDiscriminator("kind")
sealed interface LoginInspectRepositoryResult {
    @Serializable
    @SerialName("notesRepo")
    data class NotesRepo(
        val repository: RepositoryView,
    ) : LoginInspectRepositoryResult

    @Serializable
    @SerialName("uninitialized")
    data class Uninitialized(
        val repository: RepositoryView,
        val setUpDescription: String,
    ) : LoginInspectRepositoryResult

    @Serializable
    @SerialName("unusable")
    data class Unusable(
        val repository: RepositoryView,
        val error: CoreError,
        val canCheckAgain: Boolean,
        val foreignHint: String?,
    ) : LoginInspectRepositoryResult
}

@Serializable
data class PassphraseParams(
    val passphrase: Secret,
)

@Serializable
@JsonClassDiscriminator("kind")
sealed interface SessionResumeResult {
    @Serializable
    @SerialName("none")
    data object None : SessionResumeResult

    @Serializable
    @SerialName("resumed")
    data object Resumed : SessionResumeResult

    @Serializable
    @SerialName("failed")
    data class Failed(
        val error: CoreError,
        val canRetry: Boolean,
    ) : SessionResumeResult
}

@Serializable
data class SessionLogoutParams(
    val anyway: Boolean,
)

@Serializable
data class SessionLogoutResult(
    val outcome: LogoutOutcome,
)

@Serializable
data class TreeGetResult(
    val tree: List<TreeNode>?,
)

@Serializable
data class NoteOpenParams(
    val path: List<String>?,
)

@Serializable
data class NoteOpenResult(
    val note: OpenNote?,
)

@Serializable
data class NoteEditParams(
    val path: List<String>,
    val text: String,
)

@Serializable
data class SyncFlushResult(
    val result: FlushOutcome,
)

@Serializable
data class LifecycleSetVisibleParams(
    val visible: Boolean,
)

@Serializable
data class LifecycleSetOnlineParams(
    val online: Boolean,
)

@Serializable
data class DeviceNameResult(
    val name: String,
)

@Serializable
data class FakeSaveNoteParams(
    val path: List<String>,
    val text: String,
)

@Serializable
data class FakeRemoteEditParams(
    val repo: String,
    val path: List<String>,
    val text: String,
    val device: String,
)

@Serializable
data class FakeExportRepoParams(
    val repoKey: String,
)

@Serializable
data class FakeExportRepoResult(
    val exported: String,
)

@Serializable
data class FakeSampleNote(
    val path: List<String>,
    val text: String,
)

@Serializable
data class FakeExpectedSampleNotesResult(
    val notes: List<FakeSampleNote>,
)

@Serializable
data class FakeCheckVectorsParams(
    val files: Map<String, JsonElement>,
)

@Serializable
data class FakeCheckVectorsResult(
    val checked: Int,
    val failures: List<String>,
)

@Serializable
data class FakeHttpRequestParams(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val bodyText: String,
)

@Serializable
data class FakeHttpRequestResult(
    val status: Int,
    val headers: Map<String, String>,
    val bodyText: String,
)

@Serializable
data class FakeTimerProbeParams(
    val delaysMs: List<Long>,
    val cancelIndex: Int?,
)

@Serializable
data class FakeTimerProbeResult(
    val fired: List<Int>,
)

@Serializable
enum class FakeImageProfile {
    @SerialName("note")
    NOTE,

    @SerialName("share")
    SHARE,
}

@Serializable
data class FakeProcessImageParams(
    val base64: String,
    @SerialName("type") val mimeType: String,
    val profile: FakeImageProfile,
)

@Serializable
data class FakeProcessImageResult(
    val result: FakeProcessedImage,
)

/** Discriminated by a boolean `ok` rather than a string kind. */
@Serializable(with = FakeProcessedImageSerializer::class)
sealed interface FakeProcessedImage {
    @Serializable
    data class Encoded(
        @SerialName("type") val mimeType: String,
        val width: Int,
        val height: Int,
        val base64: String,
    ) : FakeProcessedImage

    @Serializable
    data class Rejected(
        val rejection: String,
    ) : FakeProcessedImage
}

internal object FakeProcessedImageSerializer :
    JsonContentPolymorphicSerializer<FakeProcessedImage>(FakeProcessedImage::class) {
    override fun selectDeserializer(
        element: JsonElement,
    ): DeserializationStrategy<FakeProcessedImage> =
        if (element.jsonObject["ok"]?.jsonPrimitive?.booleanOrNull == true) {
            FakeProcessedImage.Encoded.serializer()
        } else {
            FakeProcessedImage.Rejected.serializer()
        }
}
