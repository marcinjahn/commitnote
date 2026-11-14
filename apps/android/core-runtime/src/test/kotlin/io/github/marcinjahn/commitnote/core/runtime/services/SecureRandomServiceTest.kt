package io.github.marcinjahn.commitnote.core.runtime.services

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class SecureRandomServiceTest {
    private val random = SecureRandomService()

    @Test
    fun `returns the requested number of bytes within the bounds`() {
        assertEquals(0, random.randomBytes(0).size)
        assertEquals(1, random.randomBytes(1).size)
        assertEquals(65_536, random.randomBytes(65_536).size)
    }

    @Test
    fun `rejects lengths outside the bounds`() {
        for (length in listOf(-1, 65_537)) {
            val error = assertThrows(ServiceException::class.java) { random.randomBytes(length) }
            assertEquals("Invalid random length", error.message)
        }
    }

    @Test
    fun `successive results differ`() {
        assertFalse(random.randomBytes(32).contentEquals(random.randomBytes(32)))
    }
}
