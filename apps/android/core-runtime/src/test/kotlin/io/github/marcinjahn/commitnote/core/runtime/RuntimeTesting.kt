package io.github.marcinjahn.commitnote.core.runtime

import io.github.marcinjahn.commitnote.core.api.CoreCommands
import io.github.marcinjahn.commitnote.core.api.Empty
import io.github.marcinjahn.commitnote.core.api.ForgeKind
import io.github.marcinjahn.commitnote.core.api.LoginInspectRepositoryParams
import io.github.marcinjahn.commitnote.core.api.LoginInspectRepositoryResult
import io.github.marcinjahn.commitnote.core.api.LoginListRepositoriesParams
import io.github.marcinjahn.commitnote.core.api.PassphraseParams
import io.github.marcinjahn.commitnote.core.api.Secret
import io.github.marcinjahn.commitnote.core.api.TreeNode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

const val FAKE_ACCESS_TOKEN = "fake-access-token"
const val SAMPLE_REPO = "sample/notes"
const val SAMPLE_PASSPHRASE = "sample notes repo passphrase"

fun <T> blocking(
    timeout: Duration = 60.seconds,
    block: suspend CoroutineScope.() -> T,
): T = runBlocking { withTimeout(timeout) { block() } }

suspend fun <T : Any> poll(attempt: suspend () -> T?): T {
    while (true) {
        attempt()?.let { return it }
        delay(50.milliseconds)
    }
}

suspend fun CoreRuntime.inspect(repo: String): LoginInspectRepositoryResult {
    val accessToken = Secret(FAKE_ACCESS_TOKEN)
    val listing =
        send(
            CoreCommands.loginListRepositories,
            LoginListRepositoriesParams(ForgeKind.GITHUB, accessToken),
        )
    val repository =
        listing.repositories.single { it.url.lowercase().endsWith("/$repo") }
    return send(
        CoreCommands.loginInspectRepository,
        LoginInspectRepositoryParams(ForgeKind.GITHUB, accessToken, repository.url),
    )
}

suspend fun CoreRuntime.waitForTree(): List<TreeNode> =
    poll {
        send(CoreCommands.treeGet, Empty).tree
    }

fun notePaths(tree: List<TreeNode>): List<List<String>> =
    tree.flatMap { node ->
        when (node) {
            is TreeNode.Note -> listOf(node.path)
            is TreeNode.Folder -> notePaths(node.children)
        }
    }

suspend fun CoreRuntime.logIn(
    repo: String,
    passphrase: String,
): List<TreeNode> {
    check(inspect(repo) is LoginInspectRepositoryResult.NotesRepo) { "$repo is not a notes repo" }
    send(CoreCommands.loginUnlock, PassphraseParams(Secret(passphrase)))
    return waitForTree()
}
