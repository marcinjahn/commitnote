package io.github.marcinjahn.commitnote

import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import io.github.marcinjahn.commitnote.core.api.NativePlatform
import io.github.marcinjahn.commitnote.core.runtime.CoreRuntime
import io.github.marcinjahn.commitnote.core.runtime.services.FileBlobCacheService
import io.github.marcinjahn.commitnote.core.runtime.services.ImageCodecService
import io.github.marcinjahn.commitnote.core.runtime.services.InMemoryStagedInputs
import io.github.marcinjahn.commitnote.host.KeystoreRememberedSession
import io.github.marcinjahn.commitnote.host.PlatformImageCodec
import io.github.marcinjahn.commitnote.runtime.androidHostServices
import io.github.marcinjahn.commitnote.runtime.createAndroidCoreRuntime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.nio.file.Files
import kotlin.time.Duration
import kotlin.time.TimeSource

const val FAKE_ACCESS_TOKEN = "fake-access-token"
const val SAMPLE_REPOSITORY = "sample/notes"
const val SAMPLE_PASSPHRASE = "sample notes repo passphrase"

const val LOG_TAG = "Commitnote"

/** A runtime over the fake core bundle with the real Android services, separate from the application's. */
suspend fun startTestRuntime(imageCodec: ImageCodecService = PlatformImageCodec()): CoreRuntime {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val blobCache =
        FileBlobCacheService(Files.createTempDirectory(context.cacheDir.toPath(), "blob-cache"))
    val services =
        androidHostServices(context, blobCache, InMemoryStagedInputs(), imageCodec)
    return withContext(Dispatchers.IO) {
        createAndroidCoreRuntime(context, services).also {
            it.start(NativePlatform.ANDROID, deviceModel = "Instrumented test")
        }
    }
}

fun clearRememberedSession() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    KeystoreRememberedSession(context).clear()
}

/**
 * Runs [block] and logs when it starts and how long it took. A step that exceeds [limit] logs the
 * stacks of all threads before failing, which shows whether the core is busy or waiting for a host call.
 */
suspend fun <T> loggedStep(
    name: String,
    limit: Duration,
    block: suspend () -> T,
): T {
    Log.i(LOG_TAG, "$name started")
    val started = TimeSource.Monotonic.markNow()
    try {
        return withTimeout(limit) { block() }.also {
            Log.i(LOG_TAG, "$name finished in ${started.elapsedNow().inWholeMilliseconds} ms")
        }
    } catch (error: TimeoutCancellationException) {
        Log.e(LOG_TAG, "$name did not finish within $limit")
        logThreadStacks()
        throw error
    }
}

private fun logThreadStacks() {
    Thread
        .getAllStackTraces()
        .entries
        .filter { it.value.isNotEmpty() }
        .sortedWith(compareBy({ !it.key.name.startsWith("commitnote") }, { it.key.name }))
        .forEach { (thread, frames) ->
            Log.e(
                LOG_TAG,
                "thread ${thread.name} (${thread.state})\n" +
                    frames.take(MAX_LOGGED_FRAMES).joinToString("\n") { "    at $it" },
            )
        }
}

private const val MAX_LOGGED_FRAMES = 30
