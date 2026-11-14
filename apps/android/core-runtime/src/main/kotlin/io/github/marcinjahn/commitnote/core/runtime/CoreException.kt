package io.github.marcinjahn.commitnote.core.runtime

import io.github.marcinjahn.commitnote.core.api.CoreError

/** The core answered a request with `ok:false`. */
class CoreException(
    val error: CoreError,
) : Exception("The core answered with ${error.kind.wireName}: ${error.message}")

/** The runtime stopped before the request was answered, or before it was sent. */
class CoreRuntimeStoppedException : IllegalStateException("The core runtime has stopped")

sealed class CoreStartException(
    message: String,
) : Exception(message) {
    class BundleInvalid : CoreStartException("The core bundle is invalid")

    class MarkerMismatch(
        val expected: String,
        val found: String?,
    ) : CoreStartException(
            if (found == null) {
                "The core bundle has no marker, expected \"$expected\""
            } else {
                "The core bundle has marker \"$found\", expected \"$expected\""
            },
        )

    class ApiVersionMismatch(
        val expected: Int,
        val found: Long,
    ) : CoreStartException("The core bundle has API version $found, expected $expected")

    class JavaScriptException(
        val thrownMessage: String,
    ) : CoreStartException("The core bundle threw an exception: $thrownMessage")
}
