package io.github.marcinjahn.commitnote.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.marcinjahn.commitnote.core.runtime.CoreException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch

/** A screen whose actions report a failure as a message to show, such as in a snackbar. */
abstract class ActionViewModel : ViewModel() {
    private val messageChannel = Channel<UiText>(Channel.BUFFERED)
    val messages: Flow<UiText> = messageChannel.receiveAsFlow()

    protected fun showMessage(message: UiText) {
        messageChannel.trySend(message)
    }

    /** Runs [block] in the screen's scope; see [reporting]. */
    protected fun launchAction(block: suspend () -> Unit) =
        viewModelScope.launch { reporting(block) }

    /** Runs [block]; a [CoreException] becomes a message with the core's text. */
    protected suspend fun reporting(block: suspend () -> Unit) {
        try {
            block()
        } catch (error: CancellationException) {
            throw error
        } catch (failure: CoreException) {
            showMessage(UiText.Plain(failure.error.message))
        }
    }
}
