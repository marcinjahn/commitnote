@file:OptIn(ExperimentalSerializationApi::class)

package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

@Serializable
enum class OutOfSyncReason {
    @SerialName("pending")
    PENDING,

    @SerialName("failed")
    FAILED,

    @SerialName("conflict")
    CONFLICT,
}

@Serializable
@JsonClassDiscriminator("kind")
sealed interface SyncState {
    @Serializable
    @SerialName("synced")
    data object Synced : SyncState

    @Serializable
    @SerialName("syncing")
    data object Syncing : SyncState

    @Serializable
    @SerialName("out-of-sync")
    data class OutOfSync(
        val reason: OutOfSyncReason,
    ) : SyncState
}

@Serializable
data class SyncStatusMenuItem(
    val id: String,
    val label: String,
    val path: List<String>?,
)
