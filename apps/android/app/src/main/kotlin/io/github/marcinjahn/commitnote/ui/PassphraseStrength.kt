package io.github.marcinjahn.commitnote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.CoreSender
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.PassphraseStrengthParams
import io.github.marcinjahn.commitnote.core.api.PassphraseStrengthResult
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.core.runtime.CoreException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private const val STRENGTH_DEBOUNCE_MILLIS = 250L
private const val STRENGTH_SEGMENTS = 4

/** Rates the passphrase being typed, once the typing pauses. */
class PassphraseStrengthTracker(
    private val core: CoreSender,
    private val scope: CoroutineScope,
) {
    private val mutableStrength = MutableStateFlow<PassphraseStrengthResult?>(null)
    val strength: StateFlow<PassphraseStrengthResult?> = mutableStrength.asStateFlow()
    private var job: Job? = null

    fun passphraseChanged(
        passphrase: String,
        repositoryLabel: String,
    ) {
        job?.cancel()
        if (passphrase.isEmpty()) {
            mutableStrength.value = null
            return
        }
        job =
            scope.launch {
                delay(STRENGTH_DEBOUNCE_MILLIS)
                mutableStrength.value =
                    try {
                        core.send(
                            CoreCommands.passphraseStrength,
                            PassphraseStrengthParams(Secret(passphrase), repositoryLabel),
                        )
                    } catch (_: CoreException) {
                        null
                    }
            }
    }
}

@Composable
fun StrengthMeter(strength: PassphraseStrengthResult) {
    val colors = MaterialTheme.colorScheme
    val filled = if (strength.weak) colors.error else colors.primary
    val description =
        listOf(stringResource(R.string.passphrase_strength, strength.label), strength.warning)
            .filter { it.isNotBlank() }
            .joinToString(" ")
    Column(
        verticalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier.testTag("strength-meter"),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier.clearAndSetSemantics { },
        ) {
            repeat(STRENGTH_SEGMENTS) { index ->
                Box(
                    modifier =
                        Modifier
                            .weight(1f)
                            .height(4.dp)
                            .background(
                                if (index <
                                    strength.filledSegments
                                ) {
                                    filled
                                } else {
                                    colors.surfaceVariant
                                },
                            ),
                )
            }
        }
        Text(
            description,
            style = MaterialTheme.typography.bodySmall,
            color = if (strength.weak) colors.error else colors.onSurfaceVariant,
        )
    }
}
