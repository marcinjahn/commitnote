package io.github.marcinjahn.commitnote.core.runtime.services

interface DeviceSettingsService {
    fun getItem(key: String): String?

    fun setItem(
        key: String,
        value: String,
    )

    fun removeItem(key: String)
}
