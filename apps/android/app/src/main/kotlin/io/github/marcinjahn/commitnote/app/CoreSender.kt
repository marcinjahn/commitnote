package io.github.marcinjahn.commitnote.app

import io.github.marcinjahn.commitnote.core.api.CoreCommand

interface CoreSender {
    suspend fun <P, R> send(
        command: CoreCommand<P, R>,
        params: P,
    ): R
}
