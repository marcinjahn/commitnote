package io.github.marcinjahn.commitnote.host

import android.content.Context
import io.github.marcinjahn.commitnote.core.runtime.services.DeviceSettingsService

class SharedPreferencesDeviceSettings(
    context: Context,
) : DeviceSettingsService {
    private val preferences =
        context.getSharedPreferences(PREFERENCES_FILE, Context.MODE_PRIVATE)

    override fun getItem(key: String): String? = preferences.getString(key, null)

    override fun setItem(
        key: String,
        value: String,
    ) {
        preferences.edit().putString(key, value).apply()
    }

    override fun removeItem(key: String) {
        preferences.edit().remove(key).apply()
    }

    internal companion object {
        const val PREFERENCES_FILE = "device_settings"
    }
}
