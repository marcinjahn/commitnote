package io.github.marcinjahn.commitnote.editor

import android.app.Activity
import android.app.Application
import android.graphics.Bitmap
import android.graphics.Color
import android.os.SystemClock
import android.view.KeyCharacterMap
import android.view.KeyEvent
import io.github.marcinjahn.commitnote.ui.NoteFonts
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowUiAutomation

/**
 * Runs on native graphics, since legacy graphics measure no text and put every caret move at the
 * line's start. The editor stands alone here: the app's core loads its native library into one
 * Robolectric sandbox only, and native graphics need a sandbox of their own.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [Config.NEWEST_SDK])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NoteEditTextKeyboardTest {
    private lateinit var editor: NoteEditText

    @Before
    fun setUp() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        editor = NoteEditText(activity)
        editor.configure(appearance(activity), NoImages)
        activity.setContentView(editor)
        editor.requestFocus()
        idle()
    }

    @Test
    fun shiftArrowsExtendTheSelectionAcrossRestyles() {
        type("**Bold** typed with keys")

        pressHoldingShift(KeyEvent.KEYCODE_DPAD_LEFT, times = 4)
        assertEquals("keys", selectedText())

        pressHoldingShift(KeyEvent.KEYCODE_DPAD_RIGHT, times = 2)
        assertEquals("ys", selectedText())
    }

    /**
     * Types through key events, as a hardware keyboard does. The platform creates the selection
     * controller at the first selection change after layout and then swaps the ends of a backward
     * selection, so text set without typing would make the first Shift+Left select the wrong range.
     */
    private fun type(text: String) {
        val keys = KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD)
        checkNotNull(keys.getEvents(text.toCharArray())).forEach(::inject)
        assertEquals(text, editor.text.toString())
    }

    private fun pressHoldingShift(
        keyCode: Int,
        times: Int,
    ) {
        send(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_SHIFT_LEFT, SHIFT)
        repeat(times) {
            send(KeyEvent.ACTION_DOWN, keyCode, SHIFT)
            send(KeyEvent.ACTION_UP, keyCode, SHIFT)
        }
        send(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_SHIFT_LEFT, 0)
    }

    private fun send(
        action: Int,
        keyCode: Int,
        meta: Int,
    ) {
        val time = SystemClock.uptimeMillis()
        inject(KeyEvent(time, time, action, keyCode, 0, meta))
    }

    private fun inject(event: KeyEvent) {
        ShadowUiAutomation.injectInputEvent(event)
        idle()
    }

    /** Runs the restyle each selection change schedules for the next frame. */
    private fun idle() {
        shadowOf(editor.handler.looper).idle()
        editor.restyleNow()
    }

    private fun selectedText(): String {
        val start = editor.selectionStart
        val end = editor.selectionEnd
        return editor.text.substring(minOf(start, end), maxOf(start, end))
    }

    private fun appearance(activity: Activity): EditorAppearance {
        val fonts = NoteFonts.typefaces("system", activity.assets)
        val ink = Color.BLACK
        val paper = Color.WHITE
        return EditorAppearance(
            fonts = EditorFonts(text = fonts, code = fonts),
            colors =
                EditorColors(
                    text = ink,
                    muted = ink,
                    link = ink,
                    accent = ink,
                    onAccent = paper,
                    codeBackground = paper,
                    quoteBar = ink,
                    rule = ink,
                    tableLine = ink,
                    tableHeader = paper,
                    imagePlaceholder = paper,
                ),
            textSizeSp = 17f,
        )
    }

    private object NoImages : ImageSource {
        override fun bitmap(imageId: String): Bitmap? = null
    }

    private companion object {
        const val SHIFT = KeyEvent.META_SHIFT_ON or KeyEvent.META_SHIFT_LEFT_ON
    }
}
