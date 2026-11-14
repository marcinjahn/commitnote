package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.Serializable

/** Wraps the wire name so a kind added by a newer core survives a round trip unchanged. */
@Serializable
@JvmInline
value class CoreErrorKind(
    val wireName: String,
) {
    companion object {
        val UNAUTHORIZED = CoreErrorKind("unauthorized")
        val NO_ACCESS = CoreErrorKind("noAccess")
        val FORBIDDEN = CoreErrorKind("forbidden")
        val NOT_FOUND = CoreErrorKind("notFound")
        val RATE_LIMITED = CoreErrorKind("rateLimited")
        val NETWORK = CoreErrorKind("network")
        val SERVER = CoreErrorKind("server")
        val READ_ONLY = CoreErrorKind("readOnly")
        val FOREIGN = CoreErrorKind("foreign")
        val NO_MAIN_BRANCH = CoreErrorKind("noMainBranch")
        val NEWER_FORMAT = CoreErrorKind("newerFormat")
        val WRONG_PASSPHRASE = CoreErrorKind("wrongPassphrase")
        val INITIALIZATION_RACED = CoreErrorKind("initializationRaced")
        val REPOSITORY_CHANGED = CoreErrorKind("repositoryChanged")
        val TREE_TRUNCATED = CoreErrorKind("treeTruncated")
        val UNDECRYPTABLE = CoreErrorKind("undecryptable")
        val KEY_CHANGED = CoreErrorKind("keyChanged")
        val UNKNOWN_COMMAND = CoreErrorKind("unknownCommand")
        val INVALID_PARAMS = CoreErrorKind("invalidParams")
        val NOT_READY = CoreErrorKind("notReady")
        val INTERNAL = CoreErrorKind("internal")

        val known: List<CoreErrorKind> =
            listOf(
                UNAUTHORIZED,
                NO_ACCESS,
                FORBIDDEN,
                NOT_FOUND,
                RATE_LIMITED,
                NETWORK,
                SERVER,
                READ_ONLY,
                FOREIGN,
                NO_MAIN_BRANCH,
                NEWER_FORMAT,
                WRONG_PASSPHRASE,
                INITIALIZATION_RACED,
                REPOSITORY_CHANGED,
                TREE_TRUNCATED,
                UNDECRYPTABLE,
                KEY_CHANGED,
                UNKNOWN_COMMAND,
                INVALID_PARAMS,
                NOT_READY,
                INTERNAL,
            )
    }
}

@Serializable
data class CoreError(
    val kind: CoreErrorKind,
    val message: String,
    val transient: Boolean,
    val retryAfterMs: Long? = null,
    val formatVersion: Int? = null,
)
