package io.github.marcinjahn.commitnote.navigation

import android.content.Context
import android.view.KeyEvent
import android.view.KeyboardShortcutGroup
import android.view.KeyboardShortcutInfo
import io.github.marcinjahn.commitnote.R

/** App-wide actions a hardware keyboard reaches from any unlocked screen. */
enum class AppShortcut { NewNote, Search, Refresh }

private const val EXCLUSIVE_MODIFIERS =
    KeyEvent.META_SHIFT_ON or KeyEvent.META_ALT_ON or KeyEvent.META_META_ON

fun appShortcutOf(event: KeyEvent): AppShortcut? {
    if (!event.isCtrlPressed || event.metaState and EXCLUSIVE_MODIFIERS != 0) return null
    return when (event.keyCode) {
        KeyEvent.KEYCODE_N -> AppShortcut.NewNote
        KeyEvent.KEYCODE_F -> AppShortcut.Search
        KeyEvent.KEYCODE_R -> AppShortcut.Refresh
        else -> null
    }
}

/** The shortcuts listed in the system keyboard shortcuts helper (Meta+/). */
fun keyboardShortcutGroups(context: Context): List<KeyboardShortcutGroup> {
    fun shortcut(
        label: Int,
        keyCode: Int,
        modifiers: Int = KeyEvent.META_CTRL_ON,
    ) = KeyboardShortcutInfo(context.getString(label), keyCode, modifiers)

    return listOf(
        KeyboardShortcutGroup(
            context.getString(R.string.keyboard_shortcuts_app),
            listOf(
                shortcut(R.string.keyboard_shortcut_new_note, KeyEvent.KEYCODE_N),
                shortcut(R.string.keyboard_shortcut_search, KeyEvent.KEYCODE_F),
                shortcut(R.string.keyboard_shortcut_refresh, KeyEvent.KEYCODE_R),
                shortcut(R.string.keyboard_shortcut_back, KeyEvent.KEYCODE_ESCAPE, modifiers = 0),
            ),
        ),
        KeyboardShortcutGroup(
            context.getString(R.string.keyboard_shortcuts_editor),
            listOf(
                shortcut(R.string.keyboard_shortcut_bold, KeyEvent.KEYCODE_B),
                shortcut(R.string.keyboard_shortcut_italic, KeyEvent.KEYCODE_I),
                shortcut(
                    R.string.keyboard_shortcut_strikethrough,
                    KeyEvent.KEYCODE_X,
                    modifiers = KeyEvent.META_CTRL_ON or KeyEvent.META_SHIFT_ON,
                ),
                shortcut(R.string.keyboard_shortcut_link, KeyEvent.KEYCODE_K),
                shortcut(R.string.keyboard_shortcut_task, KeyEvent.KEYCODE_ENTER),
            ),
        ),
    )
}
