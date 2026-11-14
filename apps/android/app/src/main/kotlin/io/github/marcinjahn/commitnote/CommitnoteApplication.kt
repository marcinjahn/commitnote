package io.github.marcinjahn.commitnote

import android.app.Application
import android.os.Build
import io.github.marcinjahn.commitnote.core.api.NativePlatform
import io.github.marcinjahn.commitnote.core.runtime.CoreRuntime
import io.github.marcinjahn.commitnote.core.runtime.services.FileBlobCacheService
import io.github.marcinjahn.commitnote.core.runtime.services.InMemoryStagedInputs
import io.github.marcinjahn.commitnote.core.runtime.services.StagedInputsService
import io.github.marcinjahn.commitnote.runtime.androidHostServices
import io.github.marcinjahn.commitnote.runtime.createAndroidCoreRuntime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import java.io.File

class CommitnoteApplication : Application() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val stagedInputs: StagedInputsService = InMemoryStagedInputs()

    // The directories of a Context are only available once the application is attached.
    private val blobCache by lazy {
        FileBlobCacheService(File(noBackupFilesDir, "blob-cache").toPath())
    }

    private val runtime =
        scope.async(start = CoroutineStart.LAZY) {
            val services = androidHostServices(this@CommitnoteApplication, blobCache, stagedInputs)
            createAndroidCoreRuntime(this@CommitnoteApplication, services).also {
                it.start(NativePlatform.ANDROID, deviceModel = Build.MODEL)
            }
        }

    /** Starts the one core runtime of this process on first use; a failed start reaches every caller. */
    suspend fun coreRuntime(): CoreRuntime = runtime.await()

    fun flushBlobCache() {
        scope.launch { blobCache.flush() }
    }
}
