package io.github.marcinjahn.commitnote

import android.os.ParcelFileDescriptor
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.rules.ExternalResource

/**
 * Resizes the emulator display to the Clicks Communicator's 1080x1200 at 420 dpi for the test and
 * restores the original display afterwards, even when the test fails.
 */
class ClicksDisplayRule : ExternalResource() {
    override fun before() {
        shell("wm size 1080x1200")
        shell("wm density 420")
    }

    override fun after() {
        shell("wm size reset")
        shell("wm density reset")
    }

    private fun shell(command: String) {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val output =
            ParcelFileDescriptor.AutoCloseInputStream(
                automation.executeShellCommand(command),
            )
        output.use { it.readBytes() }
    }
}
