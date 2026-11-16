package io.github.marcinjahn.commitnote.core.runtime.testing

import io.github.marcinjahn.commitnote.core.runtime.services.DeviceSettingsService
import java.util.concurrent.ConcurrentHashMap

class InMemoryDeviceSettingsService : DeviceSettingsService {
    private val items = ConcurrentHashMap<String, String>()

    override fun getItem(key: String): String? = items[key]

    override fun setItem(
        key: String,
        value: String,
    ) {
        items[key] = value
    }

    override fun removeItem(key: String) {
        items.remove(key)
    }
}
