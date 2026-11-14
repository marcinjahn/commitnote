package io.github.marcinjahn.commitnote

import android.os.Bundle
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.ForgeKind
import io.github.marcinjahn.commitnote.core.api.LoginInspectRepositoryParams
import io.github.marcinjahn.commitnote.core.api.LoginInspectRepositoryResult
import io.github.marcinjahn.commitnote.core.api.LoginListRepositoriesParams
import io.github.marcinjahn.commitnote.core.api.PassphraseParams
import io.github.marcinjahn.commitnote.core.api.Secret
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Duration.Companion.minutes
import kotlin.time.measureTime

/** Records how long unlocking the sample notes repository takes on this device; the time is not asserted. */
class UnlockMeasurementTest {
    @After
    fun tearDown() = clearRememberedSession()

    @Test
    fun recordsUnlockTime() =
        runBlocking {
            val runtime = startTestRuntime()
            try {
                withTimeout(10.minutes) {
                    val accessToken = Secret(FAKE_ACCESS_TOKEN)
                    val repository =
                        runtime
                            .send(
                                CoreCommands.loginListRepositories,
                                LoginListRepositoriesParams(ForgeKind.GITHUB, accessToken),
                            ).repositories
                            .single { it.label == SAMPLE_REPOSITORY }
                    val inspected =
                        runtime.send(
                            CoreCommands.loginInspectRepository,
                            LoginInspectRepositoryParams(
                                ForgeKind.GITHUB,
                                accessToken,
                                repository.url,
                            ),
                        )
                    assertTrue(inspected is LoginInspectRepositoryResult.NotesRepo)

                    val elapsed =
                        measureTime {
                            runtime.send(
                                CoreCommands.loginUnlock,
                                PassphraseParams(Secret(SAMPLE_PASSPHRASE)),
                            )
                        }
                    report(elapsed.inWholeMilliseconds)
                }
            } finally {
                runtime.stop()
            }
        }

    private fun report(milliseconds: Long) {
        Log.i(TAG, "login.unlock on the sample notes repository took $milliseconds ms")
        InstrumentationRegistry.getInstrumentation().sendStatus(
            0,
            Bundle().apply { putLong(STATUS_KEY, milliseconds) },
        )
    }

    private companion object {
        const val TAG = "Commitnote"
        const val STATUS_KEY = "unlockMilliseconds"
    }
}
