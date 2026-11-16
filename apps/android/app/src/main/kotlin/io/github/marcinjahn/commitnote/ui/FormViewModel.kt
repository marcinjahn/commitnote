package io.github.marcinjahn.commitnote.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.marcinjahn.commitnote.core.runtime.CoreException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class FormState(
    val busy: Boolean = false,
    val error: UiText? = null,
)

/** A screen with one action at a time, whose failure is shown next to the form. */
abstract class FormViewModel : ViewModel() {
    private val mutableForm = MutableStateFlow(FormState())
    val form: StateFlow<FormState> = mutableForm.asStateFlow()

    /**
     * Runs [action] unless one is running or [invalid] is set. The action returns the error to
     * show, or null when it succeeded; a [CoreException] shows the core's message.
     */
    protected fun submit(
        invalid: UiText? = null,
        action: suspend () -> UiText?,
    ) {
        if (form.value.busy) return
        if (invalid != null) {
            mutableForm.value = FormState(error = invalid)
            return
        }
        mutableForm.value = FormState(busy = true)
        viewModelScope.launch {
            val error =
                try {
                    action()
                } catch (failure: CoreException) {
                    UiText.Plain(failure.error.message)
                }
            mutableForm.value = FormState(error = error)
        }
    }
}
