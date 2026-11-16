package io.github.marcinjahn.commitnote.runtime

import android.util.Log
import io.github.marcinjahn.commitnote.core.runtime.services.LogLevel
import io.github.marcinjahn.commitnote.core.runtime.services.LogService

/** Forwards messages to Android's log unchanged; debug messages only when [debugEnabled]. */
class AndroidLogService(
    private val debugEnabled: Boolean,
) : LogService {
    override fun log(
        level: LogLevel,
        message: String,
    ) {
        val priority =
            when (level) {
                LogLevel.DEBUG -> Log.DEBUG
                LogLevel.INFO -> Log.INFO
                LogLevel.WARN -> Log.WARN
                LogLevel.ERROR -> Log.ERROR
            }
        if (priority == Log.DEBUG && !debugEnabled) return
        Log.println(priority, TAG, message)
    }

    private companion object {
        const val TAG = "Commitnote"
    }
}
