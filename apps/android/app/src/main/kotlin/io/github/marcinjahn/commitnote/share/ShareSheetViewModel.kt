package io.github.marcinjahn.commitnote.share

import androidx.lifecycle.viewModelScope
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.MessagePart
import io.github.marcinjahn.commitnote.core.api.PathParams
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.core.api.ShareCreateOutcome
import io.github.marcinjahn.commitnote.core.api.ShareCreateParams
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** How creating a share ended. */
sealed interface ShareResult {
    data class Created(
        val link: String,
        val password: String?,
    ) : ShareResult

    data class Failed(
        val parts: List<MessagePart>,
    ) : ShareResult
}

data class ShareForm(
    val title: String? = null,
    val label: String = "",
    val password: String = "",
    val creating: Boolean = false,
    val result: ShareResult? = null,
)

/** The share sheet of the note at [path]: a form to share it, and the links it already has. */
class ShareSheetViewModel(
    session: AppSession,
    private val path: List<String>,
) : SharesViewModel(session) {
    private val mutableForm = MutableStateFlow(ShareForm())
    val form: StateFlow<ShareForm> = mutableForm.asStateFlow()

    init {
        launchAction {
            val title = session.send(CoreCommands.shareForm, PathParams(path)).title
            mutableForm.update { it.copy(title = title) }
        }
    }

    fun setLabel(label: String) = mutableForm.update { it.copy(label = label, result = null) }

    fun setPassword(password: String) =
        mutableForm.update {
            it.copy(password = password, result = null)
        }

    fun create() {
        val current = mutableForm.value
        if (current.creating) return
        mutableForm.update { it.copy(creating = true) }
        viewModelScope.launch {
            reporting {
                session.editor.flush()
                val params = ShareCreateParams(path, Secret(current.password), current.label)
                val result =
                    when (val outcome = session.send(CoreCommands.shareCreate, params).outcome) {
                        is ShareCreateOutcome.Created -> {
                            ShareResult.Created(
                                outcome.link,
                                outcome.password,
                            )
                        }

                        is ShareCreateOutcome.Error -> {
                            ShareResult.Failed(outcome.parts)
                        }
                    }
                mutableForm.update { it.copy(result = result) }
            }
            mutableForm.update { it.copy(creating = false) }
        }
    }

    fun createAnother() = mutableForm.update { it.copy(label = "", password = "", result = null) }

    /** Clears the form for the next time the sheet opens. */
    fun reset() = mutableForm.update { ShareForm(title = it.title) }
}
