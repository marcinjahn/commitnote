package io.github.marcinjahn.commitnote.core.runtime.testing

import io.github.marcinjahn.commitnote.core.runtime.services.VisitSender
import java.util.concurrent.CopyOnWriteArrayList

/** Keeps the visit URLs instead of requesting them, so tests never reach the network. */
class RecordingVisitSender : VisitSender {
    private val recorded = CopyOnWriteArrayList<String>()

    val urls: List<String> get() = recorded.toList()

    override fun send(url: String) {
        recorded.add(url)
    }
}
