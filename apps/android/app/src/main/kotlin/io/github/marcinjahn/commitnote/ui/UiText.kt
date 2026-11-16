package io.github.marcinjahn.commitnote.ui

import android.content.Context
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.res.stringResource

/** Text for the UI that is either written by the core or one of the app's string resources. */
sealed interface UiText {
    data class Plain(
        val text: String,
    ) : UiText

    data class Resource(
        @param:StringRes val id: Int,
        val args: List<Any> = emptyList(),
    ) : UiText

    @Composable
    @ReadOnlyComposable
    fun resolve(): String =
        when (this) {
            is Plain -> text
            is Resource -> stringResource(id, *args.toTypedArray())
        }

    fun resolve(context: Context): String =
        when (this) {
            is Plain -> text
            is Resource -> context.getString(id, *args.toTypedArray())
        }
}
