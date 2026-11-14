package io.github.marcinjahn.commitnote.core.runtime.engine

import io.github.marcinjahn.commitnote.core.runtime.services.LogService
import java.nio.file.Path

/**
 * A JavaScript engine confined to one thread: every call, including closing handles, must happen
 * on the thread that owns the engine.
 */
interface JsEngine : AutoCloseable {
    /** @throws JsException when the script throws. */
    fun evaluate(
        source: String,
        resourceName: String,
    )

    /**
     * The global's value, copied into host values. Functions in it stay valid until closed or until
     * the engine closes.
     */
    fun global(name: String): JsValue

    fun deleteGlobal(name: String)

    /** A JS function that runs [body] whenever it is called. */
    fun function(
        name: String,
        body: HostFunction,
    ): JsValue.Function

    fun createDeferred(): JsDeferred

    fun pumpMicrotasks()

    /** Releases every handle the engine still tracks. */
    override fun close()

    fun interface Factory {
        fun create(
            icuDataPath: Path,
            logger: LogService,
        ): JsEngine
    }
}

/**
 * A copy of a JS value. Byte arrays are `Uint8Array`s on the JS side; numbers are doubles. Values
 * that have no host representation, such as symbols or class instances, arrive as [Unsupported].
 */
sealed interface JsValue {
    data object Undefined : JsValue

    data object Null : JsValue

    data class Bool(
        val value: Boolean,
    ) : JsValue

    data class Number(
        val value: Double,
    ) : JsValue

    class Text(
        val value: String,
    ) : JsValue {
        override fun equals(other: Any?): Boolean = other is Text && other.value == value

        override fun hashCode(): Int = value.hashCode()

        override fun toString(): String = "Text(<${value.length} chars>)"
    }

    class Bytes(
        val value: ByteArray,
    ) : JsValue {
        override fun toString(): String = "Bytes(${value.size})"
    }

    data class Array(
        val items: List<JsValue>,
    ) : JsValue

    data class Record(
        val fields: Map<String, JsValue>,
    ) : JsValue

    /** Becomes a new `Error`; only the host creates it. */
    data class Error(
        val message: String,
    ) : JsValue

    class Function(
        val function: JsFunction,
    ) : JsValue

    /** A value the host passes back to JS without looking inside, such as a promise. */
    class Opaque(
        val handle: JsHandle,
    ) : JsValue

    data object Unsupported : JsValue
}

/** Closes every handle inside this value. */
fun JsValue.closeHandles() {
    when (this) {
        is JsValue.Function -> function.close()
        is JsValue.Opaque -> handle.close()
        is JsValue.Array -> items.forEach { it.closeHandles() }
        is JsValue.Record -> fields.values.forEach { it.closeHandles() }
        else -> Unit
    }
}

interface JsHandle : AutoCloseable {
    /** Releases the handle; the JS value itself lives on while JS references it. */
    override fun close()
}

interface JsFunction : JsHandle {
    /** @throws JsException when the function throws. */
    fun call(arguments: List<JsValue>): JsValue

    /**
     * A handle that stays valid after the call that passed this function in returns; the caller
     * closes it.
     */
    fun retain(): JsFunction
}

/** A pending promise; settling it a second time has no effect. */
interface JsDeferred : AutoCloseable {
    val promise: JsValue

    fun resolve(value: JsValue)

    fun reject(value: JsValue)

    override fun close()
}

/**
 * Runs on the engine thread. Arguments are valid only during the call; retain a function to keep
 * it. Throw [JsHostError] to make the JS call throw an `Error` with that message.
 */
fun interface HostFunction {
    fun invoke(arguments: List<JsValue>): JsValue
}

class JsHostError(
    message: String,
) : Exception(message)

/** [name] is the error's constructor name, or "unknown" when JS threw something else. */
class JsException(
    val name: String,
    message: String,
) : Exception(message)
