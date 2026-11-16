package io.github.marcinjahn.commitnote

import android.app.Application
import android.content.res.Configuration
import android.net.ConnectivityManager
import android.os.Build
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.app.ConnectivityMonitor
import io.github.marcinjahn.commitnote.core.runtime.CoreRuntime
import io.github.marcinjahn.commitnote.core.runtime.LaunchVisit
import io.github.marcinjahn.commitnote.core.runtime.services.FileBlobCacheService
import io.github.marcinjahn.commitnote.core.runtime.services.InMemoryStagedInputs
import io.github.marcinjahn.commitnote.core.runtime.services.OkHttpVisitSender
import io.github.marcinjahn.commitnote.core.runtime.services.StagedInputsService
import io.github.marcinjahn.commitnote.host.KeystoreRememberedSession
import io.github.marcinjahn.commitnote.host.PersistableRememberedSession
import io.github.marcinjahn.commitnote.runtime.AndroidLogService
import io.github.marcinjahn.commitnote.runtime.androidHostServices
import io.github.marcinjahn.commitnote.runtime.createAndroidCoreRuntime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File

open class CommitnoteApplication : Application() {
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val stagedInputs: StagedInputsService = InMemoryStagedInputs()

    // The directories of a Context are only available once the application is attached.
    private val blobCache by lazy {
        FileBlobCacheService(File(noBackupFilesDir, "blob-cache").toPath())
    }

    open val rememberedSession: PersistableRememberedSession by lazy {
        KeystoreRememberedSession(
            this,
        )
    }

    val session: AppSession by lazy {
        AppSession(
            createRuntime = ::createCoreRuntime,
            rememberedSession = rememberedSession,
            deviceModel = Build.MODEL,
            stagedInputs = stagedInputs,
            launchVisit = createLaunchVisit(),
            scope = MainScope(),
            beforeResume = ::beforeResume,
        )
    }

    /** Creates the core runtime without starting it; called once, off the main thread. */
    protected open fun createCoreRuntime(): CoreRuntime =
        createAndroidCoreRuntime(
            this,
            androidHostServices(this, blobCache, stagedInputs, rememberedSession),
        )

    /** Runs once the core has started, before the remembered session resumes. */
    protected open suspend fun beforeResume(runtime: CoreRuntime) = Unit

    protected open fun createLaunchVisit(): LaunchVisit {
        val logger = AndroidLogService(debugEnabled = BuildConfig.DEBUG)
        return LaunchVisit(OkHttpVisitSender(logger), logger, screenWidthDp())
    }

    /** The narrower side of the app's window in dp, close to Chrome's portrait `screen.width`. */
    private fun screenWidthDp(): Int? =
        resources.configuration.smallestScreenWidthDp
            .takeUnless { it == Configuration.SMALLEST_SCREEN_WIDTH_DP_UNDEFINED }

    override fun onCreate() {
        super.onCreate()
        ProcessLifecycleOwner.get().lifecycle.addObserver(
            object : DefaultLifecycleObserver {
                override fun onStart(owner: LifecycleOwner) {
                    session.setVisible(true)
                }

                override fun onStop(owner: LifecycleOwner) {
                    session.setVisible(false)
                    flushBlobCache()
                }
            },
        )
        ConnectivityMonitor(
            getSystemService(ConnectivityManager::class.java),
            session::setOnline,
        ).start()
    }

    private fun flushBlobCache() {
        ioScope.launch { blobCache.flush() }
    }
}
