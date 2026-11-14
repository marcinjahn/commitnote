package io.github.marcinjahn.commitnote.core.runtime.services

import java.security.SecureRandom

class SecureRandomService(
    private val random: SecureRandom = SecureRandom(),
) : RandomService {
    override fun randomBytes(length: Int): ByteArray {
        if (length !in 0..RandomService.MAX_LENGTH) throw ServiceException("Invalid random length")
        return ByteArray(length).also(random::nextBytes)
    }
}
