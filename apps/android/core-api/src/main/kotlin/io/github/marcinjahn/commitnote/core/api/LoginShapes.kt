package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.Serializable

@Serializable
data class ForgeView(
    val id: ForgeKind,
    val name: String,
    val accessTokenHint: String,
    val accessTokenCreationUrl: String,
    val repositoryCreationUrl: String,
)

@Serializable
data class ForgesListResult(
    val forges: List<ForgeView>,
)

@Serializable
data class LoginLastRepositoryResult(
    val repoUrl: String?,
    val forge: ForgeKind?,
)

@Serializable
data class PassphraseStrengthParams(
    val passphrase: Secret,
    val repositoryLabel: String,
)

@Serializable
data class PassphraseStrengthResult(
    val score: Int,
    val label: String,
    val filledSegments: Int,
    val weak: Boolean,
    val warning: String,
)
