package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

sealed interface CoreEvent {
    @Serializable
    data class LoadingProgress(
        val step: LoadingStep,
        val message: String,
    ) : CoreEvent

    @Serializable
    data class TreeChanged(
        val tree: List<TreeNode>?,
        val tagFilter: ColorTag?,
        val usedTags: List<ColorTag>,
        val tagsWritable: Boolean,
        val tagOptions: List<TagOptionView>,
    ) : CoreEvent

    @Serializable
    data class SessionEnded(
        val reason: SessionEndReason,
    ) : CoreEvent

    @Serializable
    data class Notice(
        val id: String,
        val tone: NoticeTone,
        val message: String,
        val persistent: Boolean,
        val action: NoticeAction?,
    ) : CoreEvent

    @Serializable
    data class NoticeCleared(
        val id: String,
    ) : CoreEvent

    /** An event the core API defines but this module has no typed payload for yet. */
    class Unmodelled(
        val name: String,
        val payload: JsonObject,
    ) : CoreEvent {
        override fun equals(other: Any?): Boolean =
            other is Unmodelled && other.name == name && other.payload == payload

        override fun hashCode(): Int = 31 * name.hashCode() + payload.hashCode()

        override fun toString(): String = "Unmodelled($name)"
    }

    companion object {
        private val modelled: Map<String, DeserializationStrategy<CoreEvent>> =
            mapOf(
                "loadingProgress" to LoadingProgress.serializer(),
                "treeChanged" to TreeChanged.serializer(),
                "sessionEnded" to SessionEnded.serializer(),
                "notice" to Notice.serializer(),
                "noticeCleared" to NoticeCleared.serializer(),
            )

        /** Throws [CoreMessageException] for a name outside the core API's event list. */
        fun decode(raw: RawEvent): CoreEvent {
            val serializer = modelled[raw.name]
            return when {
                serializer != null -> CoreWire.decode(serializer, raw.payload)
                raw.name in CoreNames.events -> Unmodelled(raw.name, raw.payload)
                else -> throw CoreMessageException(CoreMessageException.Reason.UNKNOWN_EVENT)
            }
        }
    }
}
