package io.github.marcinjahn.commitnote.core.runtime.services

class StagedInput(
    val bytes: ByteArray,
    val type: String,
)

/** Bytes the app stages for the core to consume, such as picked photos or files. */
interface StagedInputsService {
    /** [type] is the MIME type, or an empty string when unknown. */
    fun stage(
        id: String,
        bytes: ByteArray,
        type: String,
    )

    /** Each id can be taken once; null when unknown or already taken. */
    fun take(id: String): StagedInput?
}
