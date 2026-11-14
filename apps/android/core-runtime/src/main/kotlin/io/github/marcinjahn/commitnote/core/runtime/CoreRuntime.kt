package io.github.marcinjahn.commitnote.core.runtime

import io.github.marcinjahn.commitnote.core.api.CoreCommand
import io.github.marcinjahn.commitnote.core.api.CoreError
import io.github.marcinjahn.commitnote.core.api.CoreErrorKind
import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.CoreWire
import io.github.marcinjahn.commitnote.core.api.NativeCoreApi
import io.github.marcinjahn.commitnote.core.api.NativePlatform
import io.github.marcinjahn.commitnote.core.runtime.engine.JsEngine
import io.github.marcinjahn.commitnote.core.runtime.engine.JsException
import io.github.marcinjahn.commitnote.core.runtime.engine.JsFunction
import io.github.marcinjahn.commitnote.core.runtime.engine.JsValue
import io.github.marcinjahn.commitnote.core.runtime.engine.closeHandles
import io.github.marcinjahn.commitnote.core.runtime.engine.javet.JavetJsEngine
import io.github.marcinjahn.commitnote.core.runtime.services.HostServices
import io.github.marcinjahn.commitnote.core.runtime.services.LogLevel
import io.github.marcinjahn.commitnote.core.runtime.services.LogService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Path
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Runs the core bundle on its own engine thread. [logger] receives the runtime's diagnostics and
 * the core's own log lines unchanged.
 */
class CoreRuntime(
    private val services: HostServices,
    private val bundleSource: String,
    private val icuDataPath: Path,
    private val logger: LogService,
    private val engineFactory: JsEngine.Factory = JavetJsEngine,
) {
    private class Core(
        val engine: JsEngine,
        val bindings: HostBindings,
        val send: JsFunction,
        val stop: JsFunction,
    )

    private val router = CoreRouter(logger)
    private val started = AtomicBoolean(false)
    private val engineThread = EngineThread(logger) { core?.engine?.pumpMicrotasks() }
    private val workers: ExecutorService =
        Executors.newCachedThreadPool(
            daemonThreads("commitnote-host"),
        )
    private val storage: ExecutorService =
        Executors.newSingleThreadExecutor(
            daemonThreads("commitnote-storage"),
        )

    /** Touched only on the engine thread. */
    private var core: Core? = null

    /** Every event emitted after collection starts; nothing is emitted once [stop] runs. */
    val events: SharedFlow<CoreEvent> = router.events

    /**
     * Evaluates the bundle and starts the core. Call it once.
     *
     * @throws CoreStartException when the bundle is invalid, does not match this API, or throws.
     */
    suspend fun start(
        platform: NativePlatform,
        deviceModel: String,
    ) {
        check(started.compareAndSet(false, true)) { "The core runtime was already started" }
        if (router.isStopped) throw CoreRuntimeStoppedException()
        try {
            engineThread.call { core = boot(platform, deviceModel) }
        } catch (error: Throwable) {
            stop()
            throw error
        }
    }

    /**
     * @throws CoreException when the core answers with an error.
     * @throws CoreRuntimeStoppedException when the runtime stops first.
     */
    suspend fun <P, R> send(
        command: CoreCommand<P, R>,
        params: P,
    ): R {
        val (id, response) = router.register()
        val request =
            try {
                command.encodeRequest(id, params)
            } catch (error: Exception) {
                router.forget(id)
                throw error
            }
        engineThread.execute { deliver(id, request) }
        val result =
            try {
                response.await()
            } catch (error: CancellationException) {
                router.forget(id)
                throw error
            }
        return command.decodeResult(result)
    }

    /** Fails pending requests, stops the core, cancels its timers and closes the engine. */
    suspend fun stop() {
        if (!router.stop()) return
        try {
            engineThread.call { shutDownCore() }
        } catch (_: CoreRuntimeStoppedException) {
            // The engine thread was already gone.
        } finally {
            engineThread.shutdown()
            workers.shutdown()
            storage.shutdown()
        }
    }

    private fun boot(
        platform: NativePlatform,
        deviceModel: String,
    ): Core {
        val engine = engineFactory.create(icuDataPath, logger)
        val bindings =
            HostBindings(engine, engineThread, services, logger, workers, storage, router::receive)
        val handles = mutableListOf<JsValue>()
        try {
            engine.deleteGlobal("WebAssembly")
            startFailure { engine.evaluate(bundleSource, BUNDLE_NAME) }
            val global = engine.global(GLOBAL_NAME).also(handles::add)
            val api =
                (global as? JsValue.Record)?.fields ?: throw CoreStartException.BundleInvalid()
            checkCompatible(api)
            val start =
                (api["start"] as? JsValue.Function)?.function
                    ?: throw CoreStartException.BundleInvalid()
            val host = bindings.hostObject().also(handles::add)
            val options =
                JsValue.Record(
                    mapOf(
                        "deviceModel" to JsValue.Text(deviceModel),
                        "platform" to JsValue.Text(platform.wireName()),
                    ),
                )
            val handle = startFailure { start.call(listOf(host, options)) }.also(handles::add)
            val fields =
                (handle as? JsValue.Record)?.fields ?: throw CoreStartException.BundleInvalid()
            val send =
                (fields["send"] as? JsValue.Function)?.function
                    ?: throw CoreStartException.BundleInvalid()
            val stop =
                (fields["stop"] as? JsValue.Function)?.function
                    ?: throw CoreStartException.BundleInvalid()
            val core = Core(engine, bindings, send.retain(), stop.retain())
            handles.forEach { it.closeHandles() }
            return core
        } catch (error: Throwable) {
            bindings.stop()
            handles.forEach { it.closeHandles() }
            engine.close()
            throw error
        }
    }

    private fun checkCompatible(api: Map<String, JsValue>) {
        val marker = (api["marker"] as? JsValue.Text)?.value
        if (marker != NativeCoreApi.MARKER) {
            throw CoreStartException.MarkerMismatch(NativeCoreApi.MARKER, marker)
        }
        val version = (api["apiVersion"] as? JsValue.Number)?.value
        if (version == null || !version.isFinite() || version % 1.0 != 0.0) {
            throw CoreStartException.BundleInvalid()
        }
        if (version != NativeCoreApi.VERSION.toDouble()) {
            throw CoreStartException.ApiVersionMismatch(NativeCoreApi.VERSION, version.toLong())
        }
    }

    private inline fun <T> startFailure(block: () -> T): T =
        try {
            block()
        } catch (error: JsException) {
            throw CoreStartException.JavaScriptException(error.message.orEmpty())
        }

    private fun deliver(
        id: Long,
        request: String,
    ) {
        if (router.isStopped) return
        val core = core
        if (core == null) {
            router.fail(id, IllegalStateException("The core runtime has not started"))
            return
        }
        val failure =
            try {
                core.send.call(listOf(JsValue.Text(request))).closeHandles()
                return
            } catch (error: JsException) {
                error.name
            } catch (error: Exception) {
                error.javaClass.simpleName
            }
        logger.log(LogLevel.ERROR, "The core threw $failure while handling request $id")
        router.fail(
            id,
            CoreException(CoreError(CoreErrorKind.INTERNAL, "The core threw an exception", false)),
        )
    }

    private fun shutDownCore() {
        val core = core ?: return
        this.core = null
        try {
            core.stop.call(emptyList()).closeHandles()
        } catch (error: JsException) {
            logger.log(LogLevel.WARN, "JavaScript exception during stop: ${error.name}")
        }
        core.bindings.stop()
        core.send.close()
        core.stop.close()
        core.engine.close()
    }

    private companion object {
        const val GLOBAL_NAME = "CommitnoteNativeCore"
        const val BUNDLE_NAME = "commitnote-core.js"

        fun NativePlatform.wireName(): String =
            CoreWire.json
                .encodeToJsonElement(
                    NativePlatform.serializer(),
                    this,
                ).jsonPrimitive.content

        fun daemonThreads(name: String) =
            ThreadFactory { task -> Thread(task, name).apply { isDaemon = true } }
    }
}
