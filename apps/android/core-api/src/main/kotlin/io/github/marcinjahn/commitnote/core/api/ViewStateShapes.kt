package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class LaunchAction {
    @SerialName("new-note")
    NEW_NOTE,

    @SerialName("search")
    SEARCH,
}

@Serializable
data class LaunchDeliverParams(
    val action: LaunchAction,
)

@Serializable
data class LaunchAttachParams(
    val accepts: List<LaunchAction>,
)

/** The note and expanded folders to reopen; also the params of `lastView.save`. */
@Serializable
data class LastViewState(
    val note: List<String>?,
    val folders: List<List<String>>,
)

@Serializable
data class LastViewLoadResult(
    val view: LastViewState?,
)

@Serializable
data class LastViewSetEnabledParams(
    val enabled: Boolean,
    val view: LastViewState,
)

@Serializable
data class DeviceSetNameParams(
    val name: String?,
)

/** [screenWidth] is the device's screen width in dp, or null when the host can't tell. */
@Serializable
data class AnalyticsVisitParams(
    val screenWidth: Int?,
)

/** The anonymous launch count request to send, or null when the build counts nothing. */
@Serializable
data class AnalyticsVisitResult(
    val url: String?,
)
