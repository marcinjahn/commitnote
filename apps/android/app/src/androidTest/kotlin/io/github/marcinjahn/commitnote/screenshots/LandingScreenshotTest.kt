package io.github.marcinjahn.commitnote.screenshots

import android.os.ParcelFileDescriptor
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import io.github.marcinjahn.commitnote.MainActivity
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.awaitEditorText
import io.github.marcinjahn.commitnote.awaitTag
import io.github.marcinjahn.commitnote.clearAppState
import io.github.marcinjahn.commitnote.logInTo
import io.github.marcinjahn.commitnote.tap
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/**
 * Captures the showcase repository for the landing page, in light and dark. `just android
 * landing-screenshots` runs only this package and pulls the captures from [CAPTURE_DIR]; the
 * regular instrumented run leaves it out.
 */
class LandingScreenshotTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    @Before
    fun setUp() {
        shell("mkdir -p $CAPTURE_DIR")
        shell("settings put global sysui_demo_allowed 1")
    }

    @After
    fun tearDown() {
        demo("exit")
        shell("cmd uimode night no")
        clearAppState()
    }

    // One test per appearance: the orchestrator gives each test a fresh app process, and the
    // application's core keeps its session in memory.
    @Test
    fun light() = captureTheTreeAndANote("light")

    @Test
    fun dark() = captureTheTreeAndANote("dark")

    private fun captureTheTreeAndANote(appearance: String) {
        shell("cmd uimode night ${if (appearance == "dark") "yes" else "no"}")
        clearAppState()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            compose.logInTo(SHOWCASE_REPOSITORY, firstNode = "Journal")
            expandFolder("Projects")
            expandFolder("Travel")
            compose.awaitTag("tree-node-Packing list")
            capture("tree", appearance)

            compose.tap("tree-node-Weather station")
            compose.awaitEditorText(scenario) { it.startsWith("# Weather station") }
            compose.awaitTag("word-count")
            capture("note", appearance)
        }
    }

    private fun expandFolder(name: String) {
        val tag = "tree-node-$name"
        compose.awaitTag(tag)
        val state =
            compose
                .onNodeWithTag(tag)
                .fetchSemanticsNode()
                .config
                .getOrNull(SemanticsProperties.StateDescription)
        val collapsed =
            InstrumentationRegistry
                .getInstrumentation()
                .targetContext
                .getString(R.string.node_collapsed)
        if (state == collapsed) compose.tap(tag)
    }

    private fun capture(
        view: String,
        appearance: String,
    ) {
        showTidyStatusBar()
        compose.waitForIdle()
        // The editor is a View, so Compose's idling doesn't cover its last layout and draw passes.
        Thread.sleep(SETTLE_MILLIS)
        shell("screencap -p $CAPTURE_DIR/android-$view-$appearance.png")
    }

    /**
     * A fixed status bar, as on the iOS screenshots. It is set right before each capture, after the
     * appearance change, so nothing in between can reset it.
     */
    private fun showTidyStatusBar() {
        demo("enter")
        demo("clock", "hhmm" to "0941")
        demo("battery", "level" to "100", "plugged" to "false")
        demo("network", "wifi" to "show", "level" to "4", "fully" to "true")
        demo("network", "mobile" to "hide")
        demo("notifications", "visible" to "false")
    }

    private fun demo(
        command: String,
        vararg extras: Pair<String, String>,
    ) {
        val arguments = extras.joinToString("") { (key, value) -> " -e $key $value" }
        shell("am broadcast -a com.android.systemui.demo -e command $command$arguments")
    }

    /** Runs [command] as the shell user and waits for it to finish. */
    private fun shell(command: String) {
        InstrumentationRegistry
            .getInstrumentation()
            .uiAutomation
            .executeShellCommand(command)
            .let { descriptor ->
                ParcelFileDescriptor
                    .AutoCloseInputStream(descriptor)
                    .use { it.readBytes() }
            }
    }

    private companion object {
        const val SHOWCASE_REPOSITORY = "sample/showcase"
        const val CAPTURE_DIR = "/data/local/tmp/commitnote-landing-screenshots"
        const val SETTLE_MILLIS = 1_000L
    }
}
