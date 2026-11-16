package io.github.marcinjahn.commitnote

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.KeyboardShortcutGroup
import android.view.Menu
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import io.github.marcinjahn.commitnote.navigation.AppShortcut
import io.github.marcinjahn.commitnote.navigation.CommitnoteApp
import io.github.marcinjahn.commitnote.navigation.appShortcutOf
import io.github.marcinjahn.commitnote.navigation.keyboardShortcutGroups
import io.github.marcinjahn.commitnote.navigation.launchActionOf
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow

class MainActivity : ComponentActivity() {
    private val session get() = (application as CommitnoteApplication).session
    private val shortcuts =
        MutableSharedFlow<AppShortcut>(
            extraBufferCapacity = 1,
            onBufferOverflow = BufferOverflow.DROP_OLDEST,
        )

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) deliver(intent)
        setContent {
            CommitnoteApp(session, shortcuts, onClose = ::finish)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        deliver(intent)
    }

    /**
     * Receives the keys the focused content left unhandled. Escape is always consumed: left alone,
     * the platform turns it into Back, which would finish the activity at the root instead of
     * doing nothing.
     */
    override fun onKeyDown(
        keyCode: Int,
        event: KeyEvent,
    ): Boolean {
        if (keyCode == KeyEvent.KEYCODE_ESCAPE) return true
        val shortcut = appShortcutOf(event) ?: return super.onKeyDown(keyCode, event)
        if (event.repeatCount == 0) shortcuts.tryEmit(shortcut)
        return true
    }

    override fun onKeyUp(
        keyCode: Int,
        event: KeyEvent,
    ): Boolean {
        if (keyCode != KeyEvent.KEYCODE_ESCAPE) return super.onKeyUp(keyCode, event)
        if (onBackPressedDispatcher.hasEnabledCallbacks()) onBackPressedDispatcher.onBackPressed()
        return true
    }

    override fun onProvideKeyboardShortcuts(
        data: MutableList<KeyboardShortcutGroup>,
        menu: Menu?,
        deviceId: Int,
    ) {
        super.onProvideKeyboardShortcuts(data, menu, deviceId)
        data.addAll(keyboardShortcutGroups(this))
    }

    private fun deliver(intent: Intent) {
        launchActionOf(intent)?.let(session::deliverLaunch)
    }
}
