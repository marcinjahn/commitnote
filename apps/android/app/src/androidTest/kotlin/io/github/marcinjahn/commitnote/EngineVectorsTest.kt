package io.github.marcinjahn.commitnote

import androidx.test.platform.app.InstrumentationRegistry
import io.github.marcinjahn.commitnote.core.api.FakeCheckVectorsParams
import io.github.marcinjahn.commitnote.core.api.FakeCoreCommands
import io.github.marcinjahn.commitnote.core.runtime.testing.FakeImageCodecService
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Duration.Companion.minutes

class EngineVectorsTest {
    @Test
    fun everyTestVectorPassesOnTheDeviceEngine() =
        runBlocking {
            val assets = InstrumentationRegistry.getInstrumentation().context.assets
            val files =
                assets
                    .list("")
                    .orEmpty()
                    .filter { it.endsWith(".json") }
                    .sorted()
                    .associateWith { name ->
                        Json.parseToJsonElement(
                            assets.open(name).use { it.readBytes().decodeToString() },
                        )
                    }
            assertTrue("no vector files in the test assets", files.isNotEmpty())
            val expected = files.values.sumOf(::expectedChecks)

            val runtime = startTestRuntime(FakeImageCodecService())
            try {
                val result =
                    withTimeout(5.minutes) {
                        runtime.send(FakeCoreCommands.checkVectors, FakeCheckVectorsParams(files))
                    }

                assertEquals(emptyList<String>(), result.failures)
                assertEquals(expected, result.checked)
            } finally {
                runtime.stop()
            }
        }

    private fun expectedChecks(file: JsonElement): Int =
        1 + file.jsonObject.values.sumOf { (it as? JsonArray)?.size ?: 0 }
}
