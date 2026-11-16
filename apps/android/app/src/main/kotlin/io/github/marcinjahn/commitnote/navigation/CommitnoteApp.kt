package io.github.marcinjahn.commitnote.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigation3.rememberListDetailSceneStrategy
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.about.AboutScreen
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.app.SessionPhase
import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.LaunchAction
import io.github.marcinjahn.commitnote.history.HistoryScreen
import io.github.marcinjahn.commitnote.login.GettingInDisplay
import io.github.marcinjahn.commitnote.note.ImageViewerScreen
import io.github.marcinjahn.commitnote.note.NoteNavigation
import io.github.marcinjahn.commitnote.note.NoteScreen
import io.github.marcinjahn.commitnote.passphrase.ChangePassphraseScreen
import io.github.marcinjahn.commitnote.search.SearchScreen
import io.github.marcinjahn.commitnote.settings.SettingsScreen
import io.github.marcinjahn.commitnote.share.SharedLinksScreen
import io.github.marcinjahn.commitnote.transfer.AtomicBlockedDialog
import io.github.marcinjahn.commitnote.trash.TrashScreen
import io.github.marcinjahn.commitnote.tree.TreeScreen
import io.github.marcinjahn.commitnote.ui.CommitnoteTheme
import io.github.marcinjahn.commitnote.ui.SelectNote
import kotlinx.coroutines.flow.Flow

/**
 * The root of the UI. The main back stack is saved across process death and kept while the
 * session starts again, so a resumed session reopens where it was; any other outcome resets it.
 */
@Composable
fun CommitnoteApp(
    session: AppSession,
    shortcuts: Flow<AppShortcut>,
    onClose: () -> Unit,
) {
    val appearance by session.appearance.collectAsStateWithLifecycle()
    val phase by session.phase.collectAsStateWithLifecycle()
    val mainStack = rememberNavBackStack(Tree)

    LaunchedEffect(phase) {
        val leftSession =
            phase is SessionPhase.GettingIn || phase is SessionPhase.KeyChanged ||
                phase is SessionPhase.StartupFailed
        if (leftSession && mainStack.toList() != listOf(Tree)) {
            mainStack.clear()
            mainStack.add(Tree)
        }
    }

    CommitnoteTheme(appearance) {
        Surface(modifier = Modifier.fillMaxSize()) {
            if (phase == SessionPhase.Unlocked) {
                LaunchedEffect(session) {
                    session.restoreNote.collect { path ->
                        if (mainStack.none { it is Note }) mainStack.openNote(Note(path))
                    }
                }
                LaunchedEffect(session) {
                    session.launchNavigation.collect { action ->
                        when (action) {
                            LaunchAction.NEW_NOTE -> mainStack.openNote(Note.new())
                            LaunchAction.SEARCH -> mainStack.open(Search)
                        }
                    }
                }
                LaunchedEffect(session, shortcuts) {
                    shortcuts.collect { shortcut ->
                        when (shortcut) {
                            AppShortcut.NewNote -> {
                                mainStack.openNote(Note.new())
                            }

                            AppShortcut.Search -> {
                                mainStack.open(Search)
                            }

                            AppShortcut.Refresh -> {
                                session.launchInSession {
                                    session.send(
                                        CoreCommands.syncRefresh,
                                        Empty,
                                    )
                                }
                            }
                        }
                    }
                }
                Box(modifier = Modifier.fillMaxSize()) {
                    MainDisplay(session, mainStack)
                    AtomicBlockedDialog(session)
                    NoticeHost(
                        session = session,
                        onOpenNote = { mainStack.openNote(Note(it)) },
                        modifier = Modifier.align(Alignment.BottomCenter).safeDrawingPadding(),
                    )
                }
            } else {
                GettingInDisplay(session, phase, onClose)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3AdaptiveApi::class)
@Composable
private fun MainDisplay(
    session: AppSession,
    stack: NavBackStack<NavKey>,
) {
    val back = { if (stack.size > 1) stack.removeAt(stack.lastIndex) }
    NavDisplay(
        backStack = stack,
        onBack = { back() },
        sceneStrategies = listOf(rememberListDetailSceneStrategy<NavKey>()),
        entryDecorators =
            listOf(
                rememberSaveableStateHolderNavEntryDecorator<NavKey>(),
                rememberViewModelStoreNavEntryDecorator<NavKey>(),
            ),
        entryProvider =
            entryProvider<NavKey> {
                entry<Tree>(
                    metadata =
                        ListDetailSceneStrategy.listPane(
                            detailPlaceholder = { SelectNote() },
                        ),
                ) {
                    TreeScreen(session, navigate = { route ->
                        if (route is Note) stack.openNote(route) else stack.open(route)
                    })
                }
                entry<Note>(metadata = ListDetailSceneStrategy.detailPane()) { note ->
                    NoteScreen(
                        session = session,
                        path = note.path,
                        typed = note.typed,
                        match = note.match,
                        navigation =
                            NoteNavigation(
                                onBack = { back() },
                                onOpenImage = { stack.open(ImageViewer(it)) },
                                onHistory = { note.path?.let { stack.open(NoteHistory(it)) } },
                            ),
                    )
                }
                entry<ImageViewer> { viewer ->
                    ImageViewerScreen(session, viewer.imageId, onBack = { back() })
                }
                entry<NoteHistory>(metadata = ListDetailSceneStrategy.detailPane()) { history ->
                    HistoryScreen(session, history.path, onBack = { back() })
                }
                entry<Search> {
                    SearchScreen(
                        session,
                        onBack = { back() },
                        onOpen = { path, match -> stack.openNote(Note(path, match = match)) },
                    )
                }
                entry<Trash> {
                    TrashScreen(session, onBack = { back() })
                }
                entry<SharedLinks>(metadata = ListDetailSceneStrategy.detailPane()) {
                    SharedLinksScreen(
                        session,
                        onBack = { back() },
                        onOpenNote = { stack.openNote(Note(it)) },
                    )
                }
                entry<Settings> {
                    SettingsScreen(session, onBack = { back() }, navigate = { stack.open(it) })
                }
                entry<About> {
                    AboutScreen(onBack = { back() })
                }
                entry<ChangePassphrase> {
                    ChangePassphraseScreen(session, onBack = { back() })
                }
            },
    )
}

private fun NavBackStack<NavKey>.open(route: MainRoute) {
    if (lastOrNull() != route) add(route)
}

/** Opens [note] in place of the note already open, so back from a note returns to the tree. */
private fun NavBackStack<NavKey>.openNote(note: Note) {
    while (lastOrNull() is Note) removeAt(lastIndex)
    add(note)
}
