package io.github.marcinjahn.commitnote.core.runtime.engine.javet

import com.caoccao.javet.enums.V8ValueErrorType
import com.caoccao.javet.enums.V8ValueType
import com.caoccao.javet.exceptions.BaseJavetScriptingException
import com.caoccao.javet.exceptions.JavetException
import com.caoccao.javet.exceptions.JavetScriptingError
import com.caoccao.javet.interfaces.IJavetEntityError
import com.caoccao.javet.interop.V8Host
import com.caoccao.javet.interop.V8Runtime
import com.caoccao.javet.interop.callback.IJavetDirectCallable
import com.caoccao.javet.interop.callback.IJavetPromiseRejectCallback
import com.caoccao.javet.interop.callback.JavetCallbackContext
import com.caoccao.javet.interop.callback.JavetCallbackType
import com.caoccao.javet.interop.options.V8RuntimeOptions
import com.caoccao.javet.values.V8Value
import com.caoccao.javet.values.primitive.V8ValueBoolean
import com.caoccao.javet.values.primitive.V8ValueDouble
import com.caoccao.javet.values.primitive.V8ValueInteger
import com.caoccao.javet.values.primitive.V8ValueNull
import com.caoccao.javet.values.primitive.V8ValueString
import com.caoccao.javet.values.primitive.V8ValueUndefined
import com.caoccao.javet.values.reference.V8ValueArray
import com.caoccao.javet.values.reference.V8ValueFunction
import com.caoccao.javet.values.reference.V8ValueObject
import com.caoccao.javet.values.reference.V8ValuePromise
import com.caoccao.javet.values.reference.V8ValueReference
import com.caoccao.javet.values.reference.V8ValueTypedArray
import io.github.marcinjahn.commitnote.core.runtime.engine.HostFunction
import io.github.marcinjahn.commitnote.core.runtime.engine.JsDeferred
import io.github.marcinjahn.commitnote.core.runtime.engine.JsEngine
import io.github.marcinjahn.commitnote.core.runtime.engine.JsException
import io.github.marcinjahn.commitnote.core.runtime.engine.JsFunction
import io.github.marcinjahn.commitnote.core.runtime.engine.JsHandle
import io.github.marcinjahn.commitnote.core.runtime.engine.JsHostError
import io.github.marcinjahn.commitnote.core.runtime.engine.JsValue
import io.github.marcinjahn.commitnote.core.runtime.services.LogService
import java.nio.file.Path

/** [JsEngine] on V8 through Javet's i18n build. */
class JavetJsEngine private constructor(
    private val runtime: V8Runtime,
) : JsEngine {
    private val handles = LinkedHashSet<JavetReference>()
    private var closed = false

    override fun evaluate(
        source: String,
        resourceName: String,
    ) = engineCall {
        runtime.getExecutor(source).setResourceName(resourceName).executeVoid()
    }

    override fun global(name: String): JsValue =
        engineCall {
            runtime.globalObject.get<V8Value>(name).use { read(it, scope = null, depth = 0) }
        }

    override fun deleteGlobal(name: String) {
        engineCall { runtime.globalObject.delete(name) }
    }

    override fun function(
        name: String,
        body: HostFunction,
    ): JsValue.Function {
        val callable =
            IJavetDirectCallable.NoThisAndResult<Exception> { arguments ->
                invoke(body, arguments)
            }
        val context =
            JavetCallbackContext(name, JavetCallbackType.DirectCallNoThisAndResult, callable)
        val function = engineCall { runtime.createV8ValueFunction(context) }
        return JsValue.Function(track(JavetFunction(function)))
    }

    override fun createDeferred(): JsDeferred =
        engineCall {
            val resolver = runtime.createV8ValuePromise()
            val promise = track(JavetReference(resolver.promise))
            JavetDeferred(resolver, promise)
        }

    override fun pumpMicrotasks() {
        runtime.performMicrotaskCheckpoint()
    }

    override fun close() {
        if (closed) return
        closed = true
        handles.toList().forEach { it.close() }
        runtime.close()
    }

    private fun invoke(
        body: HostFunction,
        arguments: Array<out V8Value>?,
    ): V8Value {
        val scope = ArrayList<JavetFunction>()
        return try {
            val values = arguments.orEmpty().map { read(it, scope, depth = 0) }
            write(body.invoke(values))
        } catch (error: JsHostError) {
            throwError(error.message.orEmpty())
        } catch (_: Exception) {
            throwError(HOST_FUNCTION_FAILED)
        } finally {
            scope.forEach { it.close() }
        }
    }

    /** The callback's return value is ignored once an error is thrown. */
    private fun throwError(message: String): V8Value {
        runtime.throwError(V8ValueErrorType.Error, message)
        return runtime.createV8ValueUndefined()
    }

    /**
     * Copies [value] without closing it. Functions become new handles: tracked by the engine, and
     * also added to [scope] when they only live for the current callback.
     */
    private fun read(
        value: V8Value,
        scope: MutableList<JavetFunction>?,
        depth: Int,
    ): JsValue =
        when (value) {
            is V8ValueUndefined -> {
                JsValue.Undefined
            }

            is V8ValueNull -> {
                JsValue.Null
            }

            is V8ValueBoolean -> {
                JsValue.Bool(value.value)
            }

            is V8ValueInteger -> {
                JsValue.Number(value.value.toDouble())
            }

            is V8ValueDouble -> {
                JsValue.Number(value.value)
            }

            is V8ValueString -> {
                JsValue.Text(value.value)
            }

            is V8ValueFunction -> {
                val function = track(JavetFunction(value.toClone()))
                scope?.add(function)
                JsValue.Function(function)
            }

            is V8ValueTypedArray -> {
                if (value.type ==
                    V8ValueType.Uint8Array
                ) {
                    JsValue.Bytes(value.copyBytes())
                } else {
                    JsValue.Unsupported
                }
            }

            is V8ValueArray -> {
                if (depth >= MAX_DEPTH) {
                    JsValue.Unsupported
                } else {
                    JsValue.Array(
                        (0 until value.length).map { index ->
                            value.get<V8Value>(index).use { read(it, scope, depth + 1) }
                        },
                    )
                }
            }

            else -> {
                if (value.javaClass == V8ValueObject::class.java && depth < MAX_DEPTH) {
                    readRecord(value as V8ValueObject, scope, depth)
                } else {
                    JsValue.Unsupported
                }
            }
        }

    private fun readRecord(
        value: V8ValueObject,
        scope: MutableList<JavetFunction>?,
        depth: Int,
    ): JsValue.Record {
        val names =
            value.ownPropertyNames.use { names ->
                (0 until names.length).map { index ->
                    names.get<V8Value>(index).use { it.toString() }
                }
            }
        return JsValue.Record(
            names.associateWith { name ->
                value.get<V8Value>(name).use { read(it, scope, depth + 1) }
            },
        )
    }

    private fun V8ValueTypedArray.copyBytes(): ByteArray {
        val length = byteLength
        val bytes = ByteArray(length)
        if (length == 0) return bytes
        // The backing buffer can be larger than this view, so the view's own offset applies.
        buffer.use { backing ->
            val source = backing.byteBuffer.duplicate()
            source.position(byteOffset)
            source.get(bytes)
        }
        return bytes
    }

    /** A new V8 value that the caller owns. */
    private fun write(value: JsValue): V8Value =
        when (value) {
            JsValue.Undefined, JsValue.Unsupported -> {
                runtime.createV8ValueUndefined()
            }

            JsValue.Null -> {
                runtime.createV8ValueNull()
            }

            is JsValue.Bool -> {
                runtime.createV8ValueBoolean(value.value)
            }

            is JsValue.Number -> {
                writeNumber(value.value)
            }

            is JsValue.Text -> {
                runtime.createV8ValueString(value.value)
            }

            is JsValue.Bytes -> {
                building(
                    runtime.createV8ValueTypedArray(V8ValueType.Uint8Array, value.value.size),
                ) { array ->
                    if (value.value.isNotEmpty()) array.fromBytes(value.value)
                }
            }

            is JsValue.Array -> {
                building(runtime.createV8ValueArray()) { array ->
                    value.items.forEach { item -> write(item).use { array.push(it) } }
                }
            }

            is JsValue.Record -> {
                building(runtime.createV8ValueObject()) { record ->
                    value.fields.forEach { (name, field) ->
                        write(field).use { record.set(name, it) }
                    }
                }
            }

            is JsValue.Error -> {
                runtime.createV8ValueError(V8ValueErrorType.Error, value.message)
            }

            is JsValue.Function -> {
                reference(value.function).value.toClone()
            }

            is JsValue.Opaque -> {
                reference(value.handle).value.toClone()
            }
        }

    private fun writeNumber(number: Double): V8Value {
        val integral =
            number % 1.0 == 0.0 &&
                number >= Int.MIN_VALUE &&
                number <= Int.MAX_VALUE &&
                !(number == 0.0 && 1.0 / number < 0)
        return if (integral) {
            runtime.createV8ValueInteger(
                number.toInt(),
            )
        } else {
            runtime.createV8ValueDouble(number)
        }
    }

    private inline fun <T : V8Value> building(
        value: T,
        fill: (T) -> Unit,
    ): T =
        try {
            fill(value)
            value
        } catch (error: Throwable) {
            value.close()
            throw error
        }

    private fun reference(handle: JsHandle): JavetReference {
        require(handle is JavetReference && handle.owner === this) {
            "The handle belongs to another engine"
        }
        return handle
    }

    private fun <T : JavetReference> track(reference: T): T {
        handles.add(reference)
        return reference
    }

    private open inner class JavetReference(
        value: V8ValueReference,
    ) : JsHandle {
        private var current: V8ValueReference? = value

        val owner: JavetJsEngine get() = this@JavetJsEngine

        val value: V8ValueReference get() = checkNotNull(current) { "The handle is closed" }

        override fun close() {
            val value = current ?: return
            current = null
            handles.remove(this)
            value.close()
        }
    }

    private inner class JavetFunction(
        value: V8ValueFunction,
    ) : JavetReference(value),
        JsFunction {
        override fun call(arguments: List<JsValue>): JsValue {
            val function = value as V8ValueFunction
            val values = ArrayList<V8Value>(arguments.size)
            try {
                arguments.mapTo(values) { write(it) }
                return engineCall {
                    function
                        .callExtended<V8Value>(
                            runtime.createV8ValueUndefined(),
                            true,
                            *values.toTypedArray(),
                        ).use { read(it, scope = null, depth = 0) }
                }
            } finally {
                values.forEach { it.close() }
            }
        }

        override fun retain(): JsFunction = track(JavetFunction(value.toClone()))
    }

    private inner class JavetDeferred(
        resolver: V8ValuePromise,
        private val handle: JavetReference,
    ) : JsDeferred {
        private var resolver: V8ValuePromise? = resolver

        override val promise: JsValue = JsValue.Opaque(handle)

        override fun resolve(value: JsValue) =
            settle(value) { resolver, settled -> resolver.resolve(settled) }

        override fun reject(value: JsValue) =
            settle(value) { resolver, settled -> resolver.reject(settled) }

        private inline fun settle(
            value: JsValue,
            action: (V8ValuePromise, V8Value) -> Unit,
        ) {
            val resolver = resolver ?: return
            try {
                engineCall { write(value).use { action(resolver, it) } }
            } finally {
                close()
            }
        }

        override fun close() {
            val resolver = resolver ?: return
            this.resolver = null
            resolver.close()
            handle.close()
        }
    }

    companion object : JsEngine.Factory {
        private const val MAX_DEPTH = 16
        private const val HOST_FUNCTION_FAILED = "Host function failed"

        private var icuDataFile: String? = null

        override fun create(
            icuDataPath: Path,
            logger: LogService,
        ): JsEngine {
            JavetLogRouting.route(logger)
            configureIcuData(icuDataPath)
            val runtime = V8Host.getV8I18nInstance().createV8Runtime<V8Runtime>()
            runtime.logger = JavetLogger(logger)
            runtime.setPromiseRejectCallback(IJavetPromiseRejectCallback { _, _, _ -> })
            return JavetJsEngine(runtime)
        }

        /** The i18n build fails to load its native library unless ICU data is set before that. */
        @Synchronized
        private fun configureIcuData(icuDataPath: Path) {
            val file = icuDataPath.toAbsolutePath().toString()
            val configured = icuDataFile
            if (configured == null) {
                V8RuntimeOptions.V8_FLAGS.setIcuDataFile(file)
                icuDataFile = file
            } else {
                check(configured == file) { "ICU data is already loaded from another file" }
            }
        }

        private inline fun <T> engineCall(block: () -> T): T =
            try {
                block()
            } catch (error: BaseJavetScriptingException) {
                val scriptingError = error.scriptingError
                throw JsException(errorName(scriptingError), scriptingError.message.orEmpty())
            } catch (error: JavetException) {
                throw IllegalStateException("The JavaScript engine failed", error)
            }

        private fun errorName(error: JavetScriptingError): String =
            (error.context as? IJavetEntityError)?.type?.getName() ?: "unknown"
    }
}
