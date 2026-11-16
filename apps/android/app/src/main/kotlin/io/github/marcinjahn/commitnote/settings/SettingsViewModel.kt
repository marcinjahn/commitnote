package io.github.marcinjahn.commitnote.settings

import androidx.lifecycle.viewModelScope
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.app.SettingsState
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.DeviceSetNameParams
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.LogoutOutcome
import io.github.marcinjahn.commitnote.core.api.ScopedSettingKey
import io.github.marcinjahn.commitnote.core.api.SettingKeyView
import io.github.marcinjahn.commitnote.core.api.SettingScope
import io.github.marcinjahn.commitnote.core.api.SettingsChangeParams
import io.github.marcinjahn.commitnote.core.api.SettingsSetScopeParams
import io.github.marcinjahn.commitnote.ui.ActionViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Logging out would lose [count] changes that are not saved yet. */
data class UnsavedLogout(
    val count: Int,
    val message: String,
)

/** The settings the core holds, and the actions the settings screen takes on them. */
class SettingsViewModel(
    private val session: AppSession,
) : ActionViewModel() {
    val settings: StateFlow<SettingsState?> = session.screens.settings

    private val mutableUnsavedLogout = MutableStateFlow<UnsavedLogout?>(null)
    val unsavedLogout: StateFlow<UnsavedLogout?> = mutableUnsavedLogout.asStateFlow()

    fun change(
        key: SettingKeyView,
        value: String,
    ) = launchAction { session.send(CoreCommands.settingsChange, SettingsChangeParams(key, value)) }

    fun setScope(
        key: ScopedSettingKey,
        scope: SettingScope,
    ) = launchAction {
        session.send(
            CoreCommands.settingsSetScope,
            SettingsSetScopeParams(key, scope),
        )
    }

    fun retry() = launchAction { session.send(CoreCommands.settingsRetry, Empty) }

    /** An empty [name] goes back to the automatic device name. */
    fun setDeviceName(name: String) =
        launchAction {
            session.send(CoreCommands.deviceSetName, DeviceSetNameParams(name.ifEmpty { null }))
        }

    fun setReopenLastView(enabled: Boolean) = launchAction { session.lastView.setEnabled(enabled) }

    fun logOut(anyway: Boolean) {
        mutableUnsavedLogout.value = null
        viewModelScope.launch {
            reporting {
                session.editor.flush()
                session.send(CoreCommands.settingsFlush, Empty)
                val outcome = session.logOut(anyway)
                if (outcome is LogoutOutcome.Unsaved) {
                    mutableUnsavedLogout.value = UnsavedLogout(outcome.count, outcome.message)
                }
            }
        }
    }

    fun dismissUnsavedLogout() {
        mutableUnsavedLogout.value = null
    }

    override fun onCleared() {
        session.launchInSession { session.send(CoreCommands.settingsFlush, Empty) }
    }
}
