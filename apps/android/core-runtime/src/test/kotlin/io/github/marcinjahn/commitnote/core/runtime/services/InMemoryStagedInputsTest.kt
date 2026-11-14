package io.github.marcinjahn.commitnote.core.runtime.services

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class InMemoryStagedInputsTest {
    private val inputs = InMemoryStagedInputs()

    @Test
    fun `an input is taken once`() {
        inputs.stage("a", byteArrayOf(1, 2, 3), "image/png")

        val taken = checkNotNull(inputs.take("a"))

        assertArrayEquals(byteArrayOf(1, 2, 3), taken.bytes)
        assertEquals("image/png", taken.type)
        assertNull(inputs.take("a"))
    }

    @Test
    fun `an unknown id is null`() {
        inputs.stage("a", byteArrayOf(1), "")

        assertNull(inputs.take("b"))
        assertEquals("", checkNotNull(inputs.take("a")).type)
    }

    @Test
    fun `a staged id cannot be staged twice but can be reused after it was taken`() {
        inputs.stage("a", byteArrayOf(1), "")

        assertThrows(IllegalArgumentException::class.java) { inputs.stage("a", byteArrayOf(2), "") }
        assertArrayEquals(byteArrayOf(1), checkNotNull(inputs.take("a")).bytes)
        inputs.stage("a", byteArrayOf(3), "")
        assertArrayEquals(byteArrayOf(3), checkNotNull(inputs.take("a")).bytes)
    }
}
