package io.github.marcinjahn.commitnote.tree

import androidx.compose.foundation.focusable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.app.TreeState
import io.github.marcinjahn.commitnote.core.api.ColorTag
import io.github.marcinjahn.commitnote.core.api.CoreEvent
import io.github.marcinjahn.commitnote.core.api.TreeNode
import io.github.marcinjahn.commitnote.navigation.MainRoute
import io.github.marcinjahn.commitnote.navigation.Note
import io.github.marcinjahn.commitnote.navigation.Search
import io.github.marcinjahn.commitnote.navigation.Settings
import io.github.marcinjahn.commitnote.navigation.SharedLinks
import io.github.marcinjahn.commitnote.navigation.Trash
import io.github.marcinjahn.commitnote.ui.CommitnoteTopBar
import io.github.marcinjahn.commitnote.ui.ErrorText
import io.github.marcinjahn.commitnote.ui.Heading

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TreeScreen(
    session: AppSession,
    navigate: (MainRoute) -> Unit,
) {
    val viewModel: TreeViewModel =
        viewModel(factory = viewModelFactory { initializer { TreeViewModel(session) } })
    val tree by viewModel.tree.collectAsStateWithLifecycle()
    val rows by viewModel.rows.collectAsStateWithLifecycle()
    val sync by viewModel.sync.collectAsStateWithLifecycle()
    val dialog by viewModel.dialog.collectAsStateWithLifecycle()
    val typeToStart by viewModel.typeToStart.collectAsStateWithLifecycle()
    val tagLabel = rememberTagLabel(tree)
    val keyFocus = remember { FocusRequester() }
    val firstRowFocus = remember { FocusRequester() }
    var screenFocused by remember { mutableStateOf(false) }

    DisposableEffect(session) {
        session.setLaunchTarget(true)
        onDispose { session.setLaunchTarget(false) }
    }

    LaunchedEffect(keyFocus) { keyFocus.requestFocus() }

    Scaffold(
        modifier =
            Modifier
                .onPreviewKeyEvent { event ->
                    val typed = if (typeToStart) typedCharacter(event) else null
                    typed?.let { navigate(Note.new(typed = it)) }
                    typed != null
                }.onKeyEvent { event ->
                    // The screen itself holds the focus for type to start, and Compose does not move
                    // the focus down from a focused container into its children.
                    screenFocused &&
                        event.key == Key.DirectionDown &&
                        event.type == KeyEventType.KeyDown &&
                        firstRowFocus.requestFocus()
                }.onFocusChanged { screenFocused = it.isFocused }
                .focusRequester(keyFocus)
                .focusable(),
        topBar = {
            CommitnoteTopBar(
                title = stringResource(R.string.tree_title),
                actions = {
                    sync?.let { SyncStatus(it, onRetry = viewModel::retry) }
                    MainMenu(navigate, onLogOut = { viewModel.logOut(anyway = false) })
                },
            )
        },
        floatingActionButton = {
            NewMenu(onNewNote = { navigate(Note.new()) }, onNewFolder = viewModel::openNewFolder)
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            TagFilterRow(tree, tagLabel, onSelect = viewModel::setFilter)
            PullToRefreshBox(
                isRefreshing = sync?.refreshing == true,
                onRefresh = viewModel::refresh,
                modifier = Modifier.fillMaxSize(),
            ) {
                TreeContent(
                    tree = tree,
                    rows = rows,
                    sync = sync,
                    tagLabel = tagLabel,
                    onRetry = viewModel::refresh,
                    firstRowFocus = firstRowFocus,
                    onActivate = { node ->
                        when (node) {
                            is TreeNode.Folder -> viewModel.toggle(node.path)
                            is TreeNode.Note -> navigate(Note(node.path))
                        }
                    },
                    onAction = { node, action ->
                        when (action) {
                            NodeAction.Rename -> {
                                viewModel.openRename(node)
                            }

                            NodeAction.MoveTo -> {
                                viewModel.openMoveTo(node.path)
                            }

                            NodeAction.ColorTag -> {
                                (node as? TreeNode.Note)?.let(
                                    viewModel::openColorTag,
                                )
                            }

                            NodeAction.Trash -> {
                                viewModel.requestTrash(node.path)
                            }
                        }
                    },
                    onDrop = viewModel::move,
                )
            }
        }
    }
    dialog?.let { TreeDialogHost(it, viewModel, tagLabel) }
}

/** The text a hardware key types, when it types one without a modifier that makes it a shortcut. */
private fun typedCharacter(event: KeyEvent): String? {
    if (event.type != KeyEventType.KeyDown || event.isCtrlPressed || event.isAltPressed ||
        event.isMetaPressed
    ) {
        return null
    }
    val code = event.nativeKeyEvent.unicodeChar
    if (code == 0 || Character.isISOControl(code) || Character.isWhitespace(code)) return null
    return String(Character.toChars(code))
}

@Composable
private fun TreeContent(
    tree: TreeState,
    rows: List<TreeRow>,
    sync: CoreEvent.SyncStateChanged?,
    tagLabel: (ColorTag) -> String,
    onRetry: () -> Unit,
    firstRowFocus: FocusRequester,
    onActivate: (TreeNode) -> Unit,
    onAction: (TreeNode, NodeAction) -> Unit,
    onDrop: (List<String>, List<String>) -> Unit,
) {
    val nodes = tree.nodes
    val refreshError = sync?.lastRefreshError
    when {
        nodes == null && refreshError != null -> {
            CenteredState {
                ErrorText(refreshError.message, Modifier.testTag("tree-load-error"))
                Button(onClick = onRetry) { Text(stringResource(R.string.action_retry)) }
            }
        }

        nodes == null -> {
            CenteredState {
                CircularProgressIndicator()
                Text(
                    stringResource(R.string.tree_loading),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }

        nodes.isEmpty() -> {
            CenteredState {
                Heading(stringResource(R.string.tree_empty), MaterialTheme.typography.titleMedium)
            }
        }

        else -> {
            LazyColumn(
                modifier = Modifier.fillMaxSize().testTag("tree-list"),
                contentPadding = PaddingValues(bottom = 88.dp),
            ) {
                itemsIndexed(rows, key = { _, row -> row.node.key() }) { index, row ->
                    TreeNodeRow(
                        row = row,
                        tagLabel = tagLabel,
                        canTag = tree.tagsWritable,
                        onActivate = { onActivate(row.node) },
                        onAction = { onAction(row.node, it) },
                        onDrop = onDrop,
                        modifier =
                            if (index ==
                                0
                            ) {
                                Modifier.focusRequester(firstRowFocus)
                            } else {
                                Modifier
                            },
                    )
                }
            }
        }
    }
}

private fun TreeNode.key(): String =
    (if (this is TreeNode.Folder) "folder:" else "note:") + path.joinToString("/")

/** A scrolling column, so pull to refresh also works on the loading, empty and error states. */
@Composable
private fun CenteredState(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        content()
    }
}

@Composable
private fun TagFilterRow(
    tree: TreeState,
    tagLabel: (ColorTag) -> String,
    onSelect: (ColorTag?) -> Unit,
) {
    val tags = ColorTag.entries.filter { it in tree.usedTags || it == tree.tagFilter }
    if (tags.isEmpty()) return
    val filterLabel = stringResource(R.string.tag_filter)
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier =
            Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .semantics { contentDescription = filterLabel },
    ) {
        tags.forEach { tag ->
            val selected = tree.tagFilter == tag
            FilterChip(
                selected = selected,
                onClick = { onSelect(if (selected) null else tag) },
                label = { Text(tagLabel(tag)) },
                leadingIcon = { TagDot(tag) },
                modifier = Modifier.testTag("tag-filter-${tag.name.lowercase()}"),
            )
        }
    }
}

@Composable
private fun MainMenu(
    navigate: (MainRoute) -> Unit,
    onLogOut: () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }, modifier = Modifier.testTag("main-menu")) {
            Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.main_menu))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            listOf(
                Triple(R.string.menu_search, "menu-search", Search),
                Triple(R.string.menu_trash, "menu-trash", Trash),
                Triple(R.string.menu_shared_links, "menu-shared-links", SharedLinks),
                Triple(R.string.menu_settings, "menu-settings", Settings),
            ).forEach { (label, tag, route) ->
                DropdownMenuItem(
                    text = { Text(stringResource(label)) },
                    onClick = {
                        open = false
                        navigate(route)
                    },
                    modifier = Modifier.testTag(tag),
                )
            }
            DropdownMenuItem(
                text = { Text(stringResource(R.string.menu_log_out)) },
                onClick = {
                    open = false
                    onLogOut()
                },
                modifier = Modifier.testTag("menu-log-out"),
            )
        }
    }
}

@Composable
private fun NewMenu(
    onNewNote: () -> Unit,
    onNewFolder: () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        FloatingActionButton(onClick = { open = true }, modifier = Modifier.testTag("new-menu")) {
            Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.new_menu))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.new_note)) },
                onClick = {
                    open = false
                    onNewNote()
                },
                modifier = Modifier.testTag("new-note"),
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.new_folder)) },
                onClick = {
                    open = false
                    onNewFolder()
                },
                modifier = Modifier.testTag("new-folder"),
            )
        }
    }
}

/** The core's label for a tag, or the app's own name for it when the core gave none. */
@Composable
fun rememberTagLabel(tree: TreeState): (ColorTag) -> String {
    val fallback = ColorTag.entries.associateWith { stringResource(it.nameRes()) }
    return remember(tree.tagOptions, fallback) {
        val labels = tree.tagOptions.associate { it.tag to it.label }
        val label: (ColorTag) -> String = { tag -> labels[tag] ?: fallback.getValue(tag) }
        label
    }
}

private fun ColorTag.nameRes(): Int =
    when (this) {
        ColorTag.RED -> R.string.tag_red
        ColorTag.ORANGE -> R.string.tag_orange
        ColorTag.YELLOW -> R.string.tag_yellow
        ColorTag.GREEN -> R.string.tag_green
        ColorTag.BLUE -> R.string.tag_blue
        ColorTag.PURPLE -> R.string.tag_purple
    }
