package io.github.marcinjahn.commitnote.ui

import androidx.compose.foundation.layout.RowScope
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

private val CompactBarHeight = 48.dp

/** A top app bar that shrinks to 48 dp in a compact-height window. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CommitnoteTopBar(
    modifier: Modifier = Modifier,
    navigationIcon: @Composable () -> Unit = {},
    actions: @Composable RowScope.() -> Unit = {},
    title: @Composable () -> Unit,
) {
    TopAppBar(
        title = title,
        modifier = modifier,
        navigationIcon = navigationIcon,
        actions = actions,
        expandedHeight =
            if (isCompactHeight()) CompactBarHeight else TopAppBarDefaults.TopAppBarExpandedHeight,
    )
}

/** A top app bar whose [title] stays on one line, ellipsized when it does not fit. */
@Composable
fun CommitnoteTopBar(
    title: String,
    modifier: Modifier = Modifier,
    navigationIcon: @Composable () -> Unit = {},
    actions: @Composable RowScope.() -> Unit = {},
) {
    CommitnoteTopBar(modifier, navigationIcon, actions) {
        Heading(title, MaterialTheme.typography.titleLarge, maxLines = 1)
    }
}
