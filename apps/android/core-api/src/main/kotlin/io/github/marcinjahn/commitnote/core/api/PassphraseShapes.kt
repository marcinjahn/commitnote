@file:OptIn(ExperimentalSerializationApi::class)

package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator

@Serializable
data class PassphraseChangeCopy(
    val title: String,
    val intro: String,
    val currentLabel: String,
    val newLabel: String,
    val repeatLabel: String,
    val newHint: String,
    val removeHistoryLabel: String,
    val removeHistoryDescription: String,
    val historyWarning: String,
    val otherDevicesWarning: String,
    val versionHistoryNotice: String,
    val continueLabel: String,
    val confirmLabel: String,
    val cancelLabel: String,
    val checkAgainLabel: String,
    val checkingLabel: String,
    val logOutLabel: String,
    val startingLabel: String,
    val enableAtomicLabel: String,
    val passphrasesDiffer: String,
    val enterCurrentPassphrase: String,
)

@Serializable
@JsonClassDiscriminator("kind")
sealed interface PassphraseChangeOutcome {
    @Serializable
    @SerialName("review")
    data class Review(
        val summary: String,
        val carriedOver: List<String>,
        val historyWarning: String?,
    ) : PassphraseChangeOutcome

    @Serializable
    @SerialName("changed")
    data object Changed : PassphraseChangeOutcome

    @Serializable
    @SerialName("failed")
    data class Failed(
        val message: String,
        val clearCurrent: Boolean,
    ) : PassphraseChangeOutcome

    @Serializable
    @SerialName("needsSetup")
    data class NeedsSetup(
        val canConfigure: Boolean,
        val message: String,
        val actionLabel: String,
    ) : PassphraseChangeOutcome

    @Serializable
    @SerialName("unsettled")
    data class Unsettled(
        val message: String,
    ) : PassphraseChangeOutcome
}

@Serializable
data class PassphraseChangeFormResult(
    val copy: PassphraseChangeCopy,
    val canRemoveHistory: Boolean,
    val repositoryLabel: String,
)

@Serializable
data class PassphraseChangePrepareParams(
    val current: Secret,
    val next: Secret,
    val removeHistory: Boolean,
)

/** The result of `passphrase.prepareChange`, `passphrase.commitChange` and `passphrase.settle`. */
@Serializable
data class PassphraseChangeOutcomeResult(
    val outcome: PassphraseChangeOutcome,
)

@Serializable
data class PassphraseEnableAtomicResult(
    val error: String?,
)
