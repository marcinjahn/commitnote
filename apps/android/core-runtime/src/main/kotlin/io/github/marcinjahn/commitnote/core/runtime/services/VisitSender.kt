package io.github.marcinjahn.commitnote.core.runtime.services

/** Delivers the anonymous launch count request. Implementations never report a result. */
fun interface VisitSender {
    fun send(url: String)
}
