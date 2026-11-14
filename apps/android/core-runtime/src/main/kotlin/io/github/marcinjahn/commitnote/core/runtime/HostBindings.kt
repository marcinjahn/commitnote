package io.github.marcinjahn.commitnote.core.runtime

import io.github.marcinjahn.commitnote.core.api.ForgeKind
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.core.runtime.engine.JsDeferred
import io.github.marcinjahn.commitnote.core.runtime.engine.JsEngine
import io.github.marcinjahn.commitnote.core.runtime.engine.JsException
import io.github.marcinjahn.commitnote.core.runtime.engine.JsFunction
import io.github.marcinjahn.commitnote.core.runtime.engine.JsHostError
import io.github.marcinjahn.commitnote.core.runtime.engine.JsValue
import io.github.marcinjahn.commitnote.core.runtime.engine.closeHandles
import io.github.marcinjahn.commitnote.core.runtime.services.Argon2idParameters
import io.github.marcinjahn.commitnote.core.runtime.services.BlobCacheEntry
import io.github.marcinjahn.commitnote.core.runtime.services.DigestAlgorithm
import io.github.marcinjahn.commitnote.core.runtime.services.HostServices
import io.github.marcinjahn.commitnote.core.runtime.services.HttpRequest
import io.github.marcinjahn.commitnote.core.runtime.services.HttpTransportException
import io.github.marcinjahn.commitnote.core.runtime.services.ImageHandle
import io.github.marcinjahn.commitnote.core.runtime.services.KeyAlgorithm
import io.github.marcinjahn.commitnote.core.runtime.services.KeyHandle
import io.github.marcinjahn.commitnote.core.runtime.services.LogLevel
import io.github.marcinjahn.commitnote.core.runtime.services.LogService
import io.github.marcinjahn.commitnote.core.runtime.services.RandomService
import io.github.marcinjahn.commitnote.core.runtime.services.RememberedKeys
import io.github.marcinjahn.commitnote.core.runtime.services.RememberedSession
import io.github.marcinjahn.commitnote.core.runtime.services.RepositoryCoordinates
import io.github.marcinjahn.commitnote.core.runtime.services.ServiceException
import java.time.Instant
import java.util.concurrent.ExecutorService
import java.util.concurrent.Future
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture

/**
 * The `host` object handed to the core bundle. Lives on the engine thread: every member is touched
 * only there, apart from the work submitted to [workers] and [storage].
 */
internal class HostBindings(
    private val engine: JsEngine,
    private val engineThread: EngineThread,
    private val services: HostServices,
    private val logger: LogService,
    private val workers: ExecutorService,
    private val storage: ExecutorService,
    private val onPost: (String) -> Boolean,
) {
    private class Timer(
        val callback: JsFunction,
        var future: ScheduledFuture<*>? = null,
    )

    private class Task(
        val deferred: JsDeferred,
        var future: Future<*>? = null,
    )

    private var stopped = false
    private val timers = HashMap<Long, Timer>()
    private var nextTimerId = 1L
    private val tasks = LinkedHashSet<Task>()

    /** The caller closes the function handles inside once JS holds the object. */
    fun hostObject(): JsValue.Record =
        record(
            "crypto" to
                group(
                    "importKey" to ::importKey,
                    "aesGcmEncrypt" to ::aesGcmEncrypt,
                    "aesGcmDecrypt" to ::aesGcmDecrypt,
                    "hkdfSha256" to ::hkdfSha256,
                    "hmacSha256" to ::hmacSha256,
                    "digest" to ::digest,
                    "argon2id" to ::argon2id,
                ),
            "random" to group("randomBytes" to ::randomBytes),
            "http" to group("request" to ::httpRequest),
            "clock" to
                group(
                    "now" to { _ -> now() },
                    "setTimeout" to ::setTimeout,
                    "clearTimeout" to ::clearTimeout,
                ),
            "rememberedSession" to
                group(
                    "save" to ::saveRememberedSession,
                    "load" to { _ -> loadRememberedSession() },
                    "clear" to { _ -> clearRememberedSession() },
                ),
            "blobCache" to
                group(
                    "get" to ::blobGet,
                    "put" to ::blobPut,
                    "touch" to ::blobTouch,
                    "delete" to ::blobDelete,
                    "list" to ::blobList,
                    "listRepos" to { _ -> blobListRepos() },
                    "deleteRepo" to ::blobDeleteRepo,
                ),
            "deviceSettings" to
                group(
                    "getItem" to ::settingsGetItem,
                    "setItem" to ::settingsSetItem,
                    "removeItem" to ::settingsRemoveItem,
                ),
            "log" to group("log" to ::log),
            "stagedInputs" to group("take" to ::takeStagedInput),
            "imageCodec" to
                group(
                    "decode" to ::decodeImage,
                    "encodeWebp" to ::encodeWebp,
                    "release" to ::releaseImage,
                ),
            "post" to method("post", ::post),
        )

    /** Cancels timers and pending promises and drops every key handle. */
    fun stop() {
        if (stopped) return
        stopped = true
        timers.values.forEach { timer ->
            timer.future?.cancel(false)
            timer.callback.close()
        }
        timers.clear()
        tasks.forEach { task ->
            task.future?.cancel(false)
            task.deferred.close()
        }
        tasks.clear()
        services.crypto.clear()
    }

    private fun group(vararg methods: Pair<String, (List<JsValue>) -> JsValue>): JsValue.Record =
        JsValue.Record(methods.associate { (name, body) -> name to method(name, body) })

    private fun method(
        name: String,
        body: (List<JsValue>) -> JsValue,
    ): JsValue.Function =
        engine.function(name) { arguments ->
            if (stopped) throw JsHostError(STOPPED)
            try {
                body(arguments)
            } catch (error: JsHostError) {
                throw error
            } catch (error: Exception) {
                throw JsHostError(failureMessage(error))
            }
        }

    /** A service's own message is safe to show; anything else is logged by type only. */
    private fun failureMessage(error: Exception): String =
        when (error) {
            is ServiceException, is HttpTransportException -> {
                error.message ?: HOST_OPERATION_FAILED
            }

            else -> {
                logger.log(LogLevel.ERROR, "$HOST_OPERATION_FAILED: ${error.javaClass.simpleName}")
                HOST_OPERATION_FAILED
            }
        }

    /**
     * Runs [work] on [executor] and settles the returned promise on the engine thread. With
     * [failure], every rejection carries that message instead of the service's own.
     */
    private fun <T> promise(
        failure: String?,
        executor: ExecutorService,
        work: () -> T,
        settle: (T) -> JsValue,
    ): JsValue {
        val task = Task(engine.createDeferred())
        tasks.add(task)
        val promise = task.deferred.promise
        try {
            task.future =
                executor.submit {
                    val outcome = runCatching(work)
                    engineThread.execute { complete(task, outcome, failure, settle) }
                }
        } catch (_: RejectedExecutionException) {
            tasks.remove(task)
            task.deferred.close()
            throw JsHostError(STOPPED)
        }
        return promise
    }

    private fun <T> complete(
        task: Task,
        outcome: Result<T>,
        failure: String?,
        settle: (T) -> JsValue,
    ) {
        if (!tasks.remove(task) || stopped) return
        val settled =
            try {
                Result.success(settle(outcome.getOrThrow()))
            } catch (error: Exception) {
                Result.failure(error)
            }
        try {
            settled.fold(
                onSuccess = { task.deferred.resolve(it) },
                onFailure = { error ->
                    val message =
                        failure ?: when (error) {
                            is JsHostError -> error.message.orEmpty()
                            is Exception -> failureMessage(error)
                            else -> throw error
                        }
                    task.deferred.reject(JsValue.Error(message))
                },
            )
        } catch (error: JsException) {
            logger.log(
                LogLevel.WARN,
                "JavaScript exception during promise settlement: ${error.name}",
            )
        } finally {
            task.deferred.close()
        }
    }

    private fun <T> storageOperation(
        failure: String,
        work: () -> T,
        settle: (T) -> JsValue,
    ): JsValue = promise(failure, storage, work, settle)

    private fun importKey(arguments: List<JsValue>): JsValue {
        val raw = arguments.argument(0).asBytes()
        try {
            val algorithm = keyAlgorithm(arguments.argument(1).asString())
            return text(services.crypto.importKey(raw, algorithm).id)
        } finally {
            raw.fill(0)
        }
    }

    private fun aesGcmEncrypt(arguments: List<JsValue>): JsValue {
        val key = KeyHandle(arguments.argument(0).asString())
        val iv = arguments.argument(1).asBytes()
        val additionalData = arguments.argument(2).asBytes()
        val plaintext = arguments.argument(3).asBytes()
        try {
            return JsValue.Bytes(services.crypto.aesGcmEncrypt(key, iv, additionalData, plaintext))
        } finally {
            plaintext.fill(0)
        }
    }

    private fun aesGcmDecrypt(arguments: List<JsValue>): JsValue {
        val key = KeyHandle(arguments.argument(0).asString())
        val iv = arguments.argument(1).asBytes()
        val additionalData = arguments.argument(2).asBytes()
        val sealed = arguments.argument(3).asBytes()
        return services.crypto.aesGcmDecrypt(key, iv, additionalData, sealed)?.let(JsValue::Bytes)
            ?: JsValue.Null
    }

    private fun hkdfSha256(arguments: List<JsValue>): JsValue {
        val key = KeyHandle(arguments.argument(0).asString())
        val salt = arguments.argument(1).asBytes()
        val info = arguments.argument(2).asBytes()
        val length = arguments.argument(3).asInt(1, MAX_HKDF_LENGTH)
        return JsValue.Bytes(services.crypto.hkdfSha256(key, salt, info, length))
    }

    private fun hmacSha256(arguments: List<JsValue>): JsValue {
        val key = KeyHandle(arguments.argument(0).asString())
        val data = arguments.argument(1).asBytes()
        return JsValue.Bytes(services.crypto.hmacSha256(key, data))
    }

    private fun digest(arguments: List<JsValue>): JsValue {
        val algorithm =
            when (arguments.argument(0).asString()) {
                "SHA-1" -> DigestAlgorithm.SHA_1
                "SHA-256" -> DigestAlgorithm.SHA_256
                else -> throw JsHostError("Unsupported digest algorithm")
            }
        return JsValue.Bytes(services.crypto.digest(algorithm, arguments.argument(1).asBytes()))
    }

    private fun argon2id(arguments: List<JsValue>): JsValue {
        val input = arguments.argument(0).asRecord()
        val password = input.field("password").asBytes()
        try {
            val parameters =
                Argon2idParameters(
                    password = password,
                    salt = input.field("salt").asBytes(),
                    memoryKiB =
                        input
                            .field(
                                "memoryKiB",
                            ).asInt(MIN_ARGON2_MEMORY_KIB, Int.MAX_VALUE),
                    iterations = input.field("iterations").asInt(1, Int.MAX_VALUE),
                    parallelism = input.field("parallelism").asInt(1, MAX_ARGON2_PARALLELISM),
                    hashLength =
                        input
                            .field(
                                "hashLength",
                            ).asInt(MIN_ARGON2_HASH_LENGTH, MAX_ARGON2_HASH_LENGTH),
                )
            return promise(
                ARGON2_FAILED,
                workers,
                {
                    try {
                        services.crypto.argon2id(parameters)
                    } finally {
                        password.fill(0)
                    }
                },
                { JsValue.Bytes(it) },
            )
        } catch (error: Exception) {
            password.fill(0)
            throw error
        }
    }

    private fun randomBytes(arguments: List<JsValue>): JsValue {
        val length = arguments.argument(0).asInt(0, RandomService.MAX_LENGTH)
        return JsValue.Bytes(services.random.randomBytes(length))
    }

    private fun httpRequest(arguments: List<JsValue>): JsValue {
        val request = arguments.argument(0).asRecord()
        val method = request.field("method").asString()
        val url = request.field("url").asString()
        val headers =
            request.field("headers").asRecord().mapValues { (_, value) ->
                (value as? JsValue.Text)?.value ?: throw JsHostError("Expected string headers")
            }
        val body = request.field("body").let { if (it.isAbsent) null else it.asBytes() }
        return promise(
            null,
            workers,
            { services.http.request(HttpRequest(method, url, headers, body)) },
        ) { response ->
            val joined =
                response.headers.entries
                    .groupBy({ it.key.lowercase() }, { it.value })
                    .mapValues { (_, values) -> text(values.joinToString(", ")) }
            record(
                "status" to number(response.status),
                "headers" to JsValue.Record(joined),
                "body" to JsValue.Bytes(response.body),
            )
        }
    }

    private fun now(): JsValue {
        val instant = Instant.now()
        return JsValue.Number(
            instant.epochSecond * MILLIS_PER_SECOND + instant.nano / NANOS_PER_MILLI,
        )
    }

    private fun setTimeout(arguments: List<JsValue>): JsValue {
        val callback =
            (arguments.argument(0) as? JsValue.Function)?.function
                ?: throw JsHostError("The callback must be a function")
        val requested = (arguments.argument(1) as? JsValue.Number)?.value ?: 0.0
        val delay = if (requested.isFinite()) requested.coerceIn(0.0, MAX_TIMER_DELAY_MS) else 0.0
        val id = nextTimerId++
        val timer = Timer(callback.retain())
        timers[id] = timer
        timer.future = engineThread.schedule(delay.toLong()) { fireTimer(id) }
        return number(id)
    }

    private fun clearTimeout(arguments: List<JsValue>): JsValue {
        val id =
            try {
                arguments.argument(0).asInteger(1, Long.MAX_VALUE)
            } catch (_: JsHostError) {
                return JsValue.Undefined
            }
        timers.remove(id)?.let { timer ->
            timer.future?.cancel(false)
            timer.callback.close()
        }
        return JsValue.Undefined
    }

    private fun fireTimer(id: Long) {
        val timer = timers.remove(id) ?: return
        try {
            if (!stopped) timer.callback.call(emptyList()).closeHandles()
        } catch (error: JsException) {
            logger.log(LogLevel.WARN, "JavaScript exception during a timer callback: ${error.name}")
        } finally {
            timer.callback.close()
        }
    }

    private fun saveRememberedSession(arguments: List<JsValue>): JsValue {
        val input = arguments.argument(0).asRecord()
        val coordinates = input.field("coordinates").asRecord()
        val keys = input.field("keys").asRecord()
        val repoUrl = input.field("repoUrl").asString()
        val forge =
            when (coordinates.field("forge").asString()) {
                "github" -> ForgeKind.GITHUB
                "gitlab" -> ForgeKind.GITLAB
                else -> throw JsHostError("Unknown forge")
            }
        val owner = coordinates.field("owner").asString()
        val repo = coordinates.field("repo").asString()
        val accessToken = Secret(input.field("accessToken").asString())
        val handles =
            listOf("contentKey", "nameKey", "nameIvKey", "keyCheckKey").map {
                KeyHandle(keys.field(it).asString())
            }
        val raw = handles.map(services.crypto::rawKey)
        val session =
            RememberedSession(
                repoUrl = repoUrl,
                coordinates = RepositoryCoordinates(forge, owner, repo),
                accessToken = accessToken,
                keys = RememberedKeys(raw[0], raw[1], raw[2], raw[3]),
            )
        return storageOperation(
            SAVE_SESSION_FAILED,
            { services.rememberedSession.save(session) },
        ) { JsValue.Undefined }
    }

    private fun loadRememberedSession(): JsValue =
        storageOperation(LOAD_SESSION_FAILED, { services.rememberedSession.load() }) { session ->
            if (session == null) return@storageOperation JsValue.Null
            val crypto = services.crypto
            val handles =
                listOf(
                    crypto.importKey(session.keys.contentKey, KeyAlgorithm.AES_GCM),
                    crypto.importKey(session.keys.nameKey, KeyAlgorithm.AES_GCM),
                    crypto.importKey(session.keys.nameIvKey, KeyAlgorithm.HMAC_SHA_256),
                    crypto.importKey(session.keys.keyCheckKey, KeyAlgorithm.HMAC_SHA_256),
                ).map { text(it.id) }
            record(
                "repoUrl" to text(session.repoUrl),
                "coordinates" to
                    record(
                        "forge" to text(forgeName(session.coordinates.forge)),
                        "owner" to text(session.coordinates.owner),
                        "repo" to text(session.coordinates.repo),
                    ),
                "accessToken" to text(session.accessToken.expose()),
                "keys" to
                    record(
                        "contentKey" to handles[0],
                        "nameKey" to handles[1],
                        "nameIvKey" to handles[2],
                        "keyCheckKey" to handles[3],
                    ),
            )
        }

    private fun clearRememberedSession(): JsValue =
        storageOperation(
            CLEAR_SESSION_FAILED,
            { services.rememberedSession.clear() },
        ) { JsValue.Undefined }

    private fun blobGet(arguments: List<JsValue>): JsValue {
        val repoKey = arguments.argument(0).asString()
        val blobSha = arguments.argument(1).asString()
        return storageOperation(
            BLOB_READ_FAILED,
            { services.blobCache.get(repoKey, blobSha) },
        ) { entry ->
            if (entry == null) {
                JsValue.Null
            } else {
                record(
                    "bytes" to JsValue.Bytes(entry.bytes),
                    "text" to JsValue.Bool(entry.text),
                    "lastUsedAt" to number(entry.lastUsedAt),
                )
            }
        }
    }

    private fun blobPut(arguments: List<JsValue>): JsValue {
        val repoKey = arguments.argument(0).asString()
        val blobSha = arguments.argument(1).asString()
        val input = arguments.argument(2).asRecord()
        val entry =
            BlobCacheEntry(
                bytes = input.field("bytes").asBytes(),
                text = input.field("text").asBoolean(),
                lastUsedAt = input.field("lastUsedAt").asFiniteNumber().toLong(),
            )
        return storageOperation(
            BLOB_WRITE_FAILED,
            { services.blobCache.put(repoKey, blobSha, entry) },
        ) {
            JsValue.Undefined
        }
    }

    private fun blobTouch(arguments: List<JsValue>): JsValue {
        val repoKey = arguments.argument(0).asString()
        val blobSha = arguments.argument(1).asString()
        val lastUsedAt = arguments.argument(2).asFiniteNumber().toLong()
        return storageOperation(BLOB_WRITE_FAILED, {
            services.blobCache.touch(repoKey, blobSha, lastUsedAt)
        }) {
            JsValue.Undefined
        }
    }

    private fun blobDelete(arguments: List<JsValue>): JsValue {
        val repoKey = arguments.argument(0).asString()
        val blobSha = arguments.argument(1).asString()
        return storageOperation(
            BLOB_WRITE_FAILED,
            { services.blobCache.delete(repoKey, blobSha) },
        ) {
            JsValue.Undefined
        }
    }

    private fun blobList(arguments: List<JsValue>): JsValue {
        val repoKey = arguments.argument(0).asString()
        return storageOperation(
            BLOB_READ_FAILED,
            { services.blobCache.list(repoKey) },
        ) { listings ->
            JsValue.Array(
                listings.map {
                    record(
                        "blobSha" to text(it.blobSha),
                        "size" to number(it.size),
                        "lastUsedAt" to number(it.lastUsedAt),
                    )
                },
            )
        }
    }

    private fun blobListRepos(): JsValue =
        storageOperation(BLOB_READ_FAILED, { services.blobCache.listRepos() }) { repos ->
            JsValue.Array(repos.map(::text))
        }

    private fun blobDeleteRepo(arguments: List<JsValue>): JsValue {
        val repoKey = arguments.argument(0).asString()
        return storageOperation(BLOB_WRITE_FAILED, { services.blobCache.deleteRepo(repoKey) }) {
            JsValue.Undefined
        }
    }

    private fun settingsGetItem(arguments: List<JsValue>): JsValue =
        services.deviceSettings.getItem(arguments.argument(0).asString())?.let(::text)
            ?: JsValue.Null

    private fun settingsSetItem(arguments: List<JsValue>): JsValue {
        val key = arguments.argument(0).asString()
        val value = arguments.argument(1).asString()
        services.deviceSettings.setItem(key, value)
        return JsValue.Undefined
    }

    private fun settingsRemoveItem(arguments: List<JsValue>): JsValue {
        services.deviceSettings.removeItem(arguments.argument(0).asString())
        return JsValue.Undefined
    }

    private fun log(arguments: List<JsValue>): JsValue {
        val level =
            when (arguments.argument(0).asString()) {
                "debug" -> LogLevel.DEBUG
                "info" -> LogLevel.INFO
                "warn" -> LogLevel.WARN
                else -> LogLevel.ERROR
            }
        logger.log(level, arguments.argument(1).asString())
        return JsValue.Undefined
    }

    private fun takeStagedInput(arguments: List<JsValue>): JsValue {
        val input =
            services.stagedInputs.take(arguments.argument(0).asString()) ?: return JsValue.Null
        return record("bytes" to JsValue.Bytes(input.bytes), "type" to text(input.type))
    }

    private fun decodeImage(arguments: List<JsValue>): JsValue {
        val bytes = arguments.argument(0).asBytes()
        return promise(null, workers, { services.imageCodec.decode(bytes) }) { image ->
            record(
                "handle" to text(image.handle.id),
                "width" to number(image.width),
                "height" to number(image.height),
            )
        }
    }

    private fun encodeWebp(arguments: List<JsValue>): JsValue {
        val handle = ImageHandle(arguments.argument(0).asString())
        val width = arguments.argument(1).asInt(1, MAX_IMAGE_DIMENSION)
        val height = arguments.argument(2).asInt(1, MAX_IMAGE_DIMENSION)
        val quality = arguments.argument(3).asFiniteNumber().toFloat()
        return promise(
            null,
            workers,
            { services.imageCodec.encodeWebp(handle, width, height, quality) },
        ) {
            JsValue.Bytes(it)
        }
    }

    private fun releaseImage(arguments: List<JsValue>): JsValue {
        services.imageCodec.release(ImageHandle(arguments.argument(0).asString()))
        return JsValue.Undefined
    }

    private fun post(arguments: List<JsValue>): JsValue {
        if (onPost(arguments.argument(0).asString())) services.crypto.clear()
        return JsValue.Undefined
    }

    private companion object {
        const val STOPPED = "The core runtime has stopped"
        const val HOST_OPERATION_FAILED = "Host operation failed"
        const val ARGON2_FAILED = "Argon2id failed"
        const val SAVE_SESSION_FAILED = "Could not save the remembered session"
        const val LOAD_SESSION_FAILED = "Could not load the remembered session"
        const val CLEAR_SESSION_FAILED = "Could not clear the remembered session"
        const val BLOB_READ_FAILED = "Blob cache read failed"
        const val BLOB_WRITE_FAILED = "Blob cache write failed"
        const val MAX_HKDF_LENGTH = 255 * 32
        const val MAX_ARGON2_PARALLELISM = 16_777_215
        const val MIN_ARGON2_MEMORY_KIB = 8
        const val MIN_ARGON2_HASH_LENGTH = 4
        const val MAX_ARGON2_HASH_LENGTH = 1024
        const val MAX_IMAGE_DIMENSION = 16_383
        const val MAX_TIMER_DELAY_MS = 2_147_483_647.0
        const val MILLIS_PER_SECOND = 1000.0
        const val NANOS_PER_MILLI = 1_000_000.0

        fun keyAlgorithm(name: String): KeyAlgorithm =
            when (name) {
                "AES-GCM" -> KeyAlgorithm.AES_GCM
                "HMAC-SHA-256" -> KeyAlgorithm.HMAC_SHA_256
                "HKDF" -> KeyAlgorithm.HKDF
                else -> throw JsHostError("Unsupported key algorithm")
            }

        fun forgeName(forge: ForgeKind): String =
            when (forge) {
                ForgeKind.GITHUB -> "github"
                ForgeKind.GITLAB -> "gitlab"
            }
    }
}
