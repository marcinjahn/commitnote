package io.github.marcinjahn.commitnote.navigation

import androidx.navigation3.runtime.NavKey
import io.github.marcinjahn.commitnote.editor.NoteMatch
import kotlinx.serialization.Serializable
import java.util.UUID

/** The routes of an unlocked session. */
@Serializable
sealed interface MainRoute : NavKey

@Serializable
data object Tree : MainRoute

/**
 * [path] is null for a note that is not created yet, which [draftId] tells apart from other new
 * notes; [typed] is text typed before the note showed; [match] is a search match to reveal.
 */
@Serializable
data class Note(
    val path: List<String>?,
    val typed: String? = null,
    val draftId: String? = null,
    val match: NoteMatch? = null,
) : MainRoute {
    companion object {
        fun new(typed: String? = null) =
            Note(path = null, typed = typed, draftId = UUID.randomUUID().toString())
    }
}

@Serializable
data class ImageViewer(
    val imageId: String,
) : MainRoute

@Serializable
data class NoteHistory(
    val path: List<String>,
) : MainRoute

@Serializable
data object Search : MainRoute

@Serializable
data object Trash : MainRoute

@Serializable
data object SharedLinks : MainRoute

@Serializable
data object Settings : MainRoute

@Serializable
data object About : MainRoute

@Serializable
data object ChangePassphrase : MainRoute

/** The routes of getting into a session; their stack is derived from the session phase. */
@Serializable
sealed interface GettingInRoute : NavKey

@Serializable
data object Startup : GettingInRoute

@Serializable
data object Login : GettingInRoute

@Serializable
data object RepositoryPicker : GettingInRoute

@Serializable
data object Unlock : GettingInRoute

@Serializable
data object Initialize : GettingInRoute

@Serializable
data object UnusableRepository : GettingInRoute

@Serializable
data object KeyChanged : GettingInRoute

@Serializable
data object StartupFailed : GettingInRoute
