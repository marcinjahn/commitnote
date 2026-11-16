package io.github.marcinjahn.commitnote.app

import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.HistoryView
import io.github.marcinjahn.commitnote.core.api.SettingsCopy
import io.github.marcinjahn.commitnote.core.api.SettingsOpenResult
import io.github.marcinjahn.commitnote.core.api.SettingsSaveView
import io.github.marcinjahn.commitnote.core.api.SettingsView
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** The settings the core holds: its copy, which only `settings.open` returns, and the live view. */
data class SettingsState(
    val copy: SettingsCopy,
    val view: SettingsView,
    val save: SettingsSaveView,
)

/**
 * What the core reports to the secondary screens (history, trash, search, shares, settings, import
 * and passphrase change), one state flow per area. Call it from the main thread.
 */
class ScreenStates {
    private val mutableTrash = MutableStateFlow<CoreEvent.TrashChanged?>(null)
    val trash: StateFlow<CoreEvent.TrashChanged?> = mutableTrash.asStateFlow()

    private val mutableSearchStatus = MutableStateFlow<CoreEvent.SearchStatusChanged?>(null)
    val searchStatus: StateFlow<CoreEvent.SearchStatusChanged?> = mutableSearchStatus.asStateFlow()

    private val mutableHistory = MutableStateFlow<HistoryView?>(null)
    val history: StateFlow<HistoryView?> = mutableHistory.asStateFlow()

    private val mutableShares = MutableStateFlow<CoreEvent.SharesChanged?>(null)
    val shares: StateFlow<CoreEvent.SharesChanged?> = mutableShares.asStateFlow()

    private val mutableSettings = MutableStateFlow<SettingsState?>(null)
    val settings: StateFlow<SettingsState?> = mutableSettings.asStateFlow()

    private val mutableImportStatus = MutableStateFlow<CoreEvent.ImportStatusChanged?>(null)
    val importStatus: StateFlow<CoreEvent.ImportStatusChanged?> = mutableImportStatus.asStateFlow()

    private val mutablePassphraseProgress =
        MutableStateFlow<CoreEvent.PassphraseChangeProgress?>(null)
    val passphraseProgress: StateFlow<CoreEvent.PassphraseChangeProgress?> =
        mutablePassphraseProgress.asStateFlow()

    fun openSettings(result: SettingsOpenResult) {
        mutableSettings.value = SettingsState(result.copy, result.view, result.save)
    }

    fun clearPassphraseProgress() {
        mutablePassphraseProgress.value = null
    }

    /** Applies [event] when it belongs to these areas; returns whether it did. */
    fun reduce(event: CoreEvent): Boolean {
        when (event) {
            is CoreEvent.TrashChanged -> {
                mutableTrash.value = event
            }

            is CoreEvent.SearchStatusChanged -> {
                mutableSearchStatus.value = event
            }

            is CoreEvent.HistoryChanged -> {
                mutableHistory.value = event.history
            }

            is CoreEvent.SharesChanged -> {
                mutableShares.value = event
            }

            is CoreEvent.SettingsChanged -> {
                mutableSettings.update { it?.copy(view = event.view) }
            }

            is CoreEvent.SettingsSaveChanged -> {
                mutableSettings.update {
                    it?.copy(
                        save = event.save,
                    )
                }
            }

            is CoreEvent.ImportStatusChanged -> {
                mutableImportStatus.value = event
            }

            is CoreEvent.PassphraseChangeProgress -> {
                mutablePassphraseProgress.value = event
            }

            else -> {
                return false
            }
        }
        return true
    }

    fun reset() {
        mutableTrash.value = null
        mutableSearchStatus.value = null
        mutableHistory.value = null
        mutableShares.value = null
        mutableSettings.value = null
        mutableImportStatus.value = null
        mutablePassphraseProgress.value = null
    }
}
