package io.github.marcinjahn.commitnote.host

import android.os.Process
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertNotEquals
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runners.MethodSorters
import java.io.File

/**
 * The two tests only prove persistence when they run in different processes, which the test
 * orchestrator does by starting each test in its own process.
 */
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class RememberedSessionRestartTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val pidFile = File(context.filesDir, "remembered-session-restart.pid")

    @Test
    fun a_savesAndRecordsPid() {
        val remembered = KeystoreRememberedSession(context)
        remembered.clear()
        remembered.save(sampleSession())
        pidFile.writeText(Process.myPid().toString())
    }

    @Test
    fun b_loadsInAnotherProcess() {
        val recordedPid = pidFile.readText().trim().toInt()
        assertNotEquals(recordedPid, Process.myPid())

        val remembered = KeystoreRememberedSession(context)
        try {
            assertSessionEquals(sampleSession(), remembered.load())
        } finally {
            remembered.clear()
            pidFile.delete()
        }
    }
}
