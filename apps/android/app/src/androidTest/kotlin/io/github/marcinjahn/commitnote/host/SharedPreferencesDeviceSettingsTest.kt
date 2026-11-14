package io.github.marcinjahn.commitnote.host

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class SharedPreferencesDeviceSettingsTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var settings: SharedPreferencesDeviceSettings

    @Before
    fun setUp() {
        settings = SharedPreferencesDeviceSettings(context)
        settings.removeItem(KEY)
    }

    @After
    fun tearDown() {
        settings.removeItem(KEY)
    }

    @Test
    fun missingItemIsNull() {
        assertNull(settings.getItem(KEY))
    }

    @Test
    fun setItemRoundTrips() {
        settings.setItem(KEY, "value")

        assertEquals("value", settings.getItem(KEY))
        assertEquals("value", SharedPreferencesDeviceSettings(context).getItem(KEY))
    }

    @Test
    fun setItemOverwrites() {
        settings.setItem(KEY, "first")
        settings.setItem(KEY, "second")

        assertEquals("second", settings.getItem(KEY))
    }

    @Test
    fun removeItemDeletesTheValue() {
        settings.setItem(KEY, "value")

        settings.removeItem(KEY)

        assertNull(settings.getItem(KEY))
    }

    private companion object {
        const val KEY = "commitnote.test.item"
    }
}
