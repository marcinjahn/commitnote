package io.github.marcinjahn.commitnote.navigation

import android.content.Intent
import io.github.marcinjahn.commitnote.core.api.LaunchAction

private const val LAUNCH_SCHEME = "commitnote"

/** The launch action a `commitnote://` link or app shortcut asks for, if any. */
fun launchActionOf(intent: Intent): LaunchAction? {
    val uri = intent.data ?: return null
    if (intent.action != Intent.ACTION_VIEW || uri.scheme != LAUNCH_SCHEME) return null
    return when (uri.host) {
        "new-note" -> LaunchAction.NEW_NOTE
        "search" -> LaunchAction.SEARCH
        else -> null
    }
}
