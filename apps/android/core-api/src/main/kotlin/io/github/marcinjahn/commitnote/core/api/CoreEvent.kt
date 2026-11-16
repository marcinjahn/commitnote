package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.Serializable
import io.github.marcinjahn.commitnote.core.api.LaunchAction as LaunchActionKind

/** One typed subtype per event in the core API's event list. */
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
    data class TrashChanged(
        val entries: List<TrashEntryView>,
        val deleteConfirmation: TrashConfirmationText,
        val emptyConfirmation: TrashConfirmationText,
    ) : CoreEvent

    @Serializable
    data class SearchStatusChanged(
        val status: String?,
        val progress: Double?,
        val partial: Boolean,
    ) : CoreEvent

    @Serializable
    data class NoteChanged(
        val note: OpenNote?,
        val edits: List<RemoteTextEdit>?,
    ) : CoreEvent

    @Serializable
    data class NoteContentChangedRemotely(
        val change: RemoteChange,
        val message: String,
    ) : CoreEvent

    @Serializable
    data class SyncStateChanged(
        val online: Boolean,
        val refreshing: Boolean,
        val treeLoaded: Boolean,
        val lastRefreshError: CoreError?,
        val state: SyncState,
        val label: String,
        val status: String?,
        val unsavedCount: Int,
        val canRetry: Boolean,
        val unsavedMenu: List<SyncStatusMenuItem>,
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

    @Serializable
    data class KeyChanged(
        val unsavedCount: Int,
        val message: String,
        val detail: String,
        val exportLabel: String,
    ) : CoreEvent

    @Serializable
    data class SessionEnded(
        val reason: SessionEndReason,
    ) : CoreEvent

    @Serializable
    data class HistoryChanged(
        val history: HistoryView?,
    ) : CoreEvent

    @Serializable
    data class SharesChanged(
        val shares: List<ShareRowView>,
        val unreadable: String?,
        val updatingId: String?,
        val copy: ShareCopy,
    ) : CoreEvent

    @Serializable
    data class SettingsChanged(
        val view: SettingsView,
    ) : CoreEvent

    @Serializable
    data class SettingsSaveChanged(
        val save: SettingsSaveView,
    ) : CoreEvent

    @Serializable
    data class ImportStatusChanged(
        val importing: Boolean,
        val atomicBlocked: AtomicBlockedView?,
    ) : CoreEvent

    @Serializable
    data class PassphraseChangeProgress(
        val message: String,
        val done: Int?,
        val total: Int?,
    ) : CoreEvent

    @Serializable
    data class LaunchAction(
        val action: LaunchActionKind,
    ) : CoreEvent

    companion object {
        /** Keyed by wire name; must hold exactly the names in [CoreNames.events]. */
        internal val serializers: Map<String, DeserializationStrategy<CoreEvent>> =
            mapOf(
                "loadingProgress" to LoadingProgress.serializer(),
                "treeChanged" to TreeChanged.serializer(),
                "trashChanged" to TrashChanged.serializer(),
                "searchStatusChanged" to SearchStatusChanged.serializer(),
                "noteChanged" to NoteChanged.serializer(),
                "noteContentChangedRemotely" to NoteContentChangedRemotely.serializer(),
                "syncStateChanged" to SyncStateChanged.serializer(),
                "notice" to Notice.serializer(),
                "noticeCleared" to NoticeCleared.serializer(),
                "keyChanged" to KeyChanged.serializer(),
                "sessionEnded" to SessionEnded.serializer(),
                "historyChanged" to HistoryChanged.serializer(),
                "sharesChanged" to SharesChanged.serializer(),
                "settingsChanged" to SettingsChanged.serializer(),
                "settingsSaveChanged" to SettingsSaveChanged.serializer(),
                "importStatusChanged" to ImportStatusChanged.serializer(),
                "passphraseChangeProgress" to PassphraseChangeProgress.serializer(),
                "launchAction" to LaunchAction.serializer(),
            )

        /** Throws [CoreMessageException] for a name outside the core API's event list. */
        fun decode(raw: RawEvent): CoreEvent {
            val serializer =
                serializers[raw.name]
                    ?: throw CoreMessageException(CoreMessageException.Reason.UNKNOWN_EVENT)
            return CoreWire.decode(serializer, raw.payload)
        }
    }
}
