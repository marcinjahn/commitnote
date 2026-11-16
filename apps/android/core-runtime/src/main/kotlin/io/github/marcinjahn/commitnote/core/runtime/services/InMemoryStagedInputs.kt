package io.github.marcinjahn.commitnote.core.runtime.services

import java.util.concurrent.ConcurrentHashMap

class InMemoryStagedInputs : StagedInputsService {
    private val inputs = ConcurrentHashMap<String, StagedInput>()

    override fun stage(
        id: String,
        bytes: ByteArray,
        type: String,
    ) {
        require(
            inputs.putIfAbsent(id, StagedInput(bytes, type)) == null,
        ) { "Input id already staged" }
    }

    override fun take(id: String): StagedInput? = inputs.remove(id)
}
