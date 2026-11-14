package io.github.marcinjahn.commitnote

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
import kotlinx.coroutines.withContext
import java.nio.file.Files

const val FAKE_ACCESS_TOKEN = "fake-access-token"
const val SAMPLE_REPOSITORY = "sample/notes"
const val SAMPLE_PASSPHRASE = "sample notes repo passphrase"

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
