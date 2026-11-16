package io.github.marcinjahn.commitnote.ui

import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.runtime.Composable
import androidx.window.core.layout.WindowSizeClass

/** True when the window is shorter than a medium-height window (480 dp). */
@Composable
fun isCompactHeight(): Boolean {
    val windowSizeClass = currentWindowAdaptiveInfoV2().windowSizeClass
    return !windowSizeClass.isHeightAtLeastBreakpoint(WindowSizeClass.HEIGHT_DP_MEDIUM_LOWER_BOUND)
}
