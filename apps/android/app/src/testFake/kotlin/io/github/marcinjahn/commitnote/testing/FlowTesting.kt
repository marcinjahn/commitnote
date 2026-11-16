package io.github.marcinjahn.commitnote.testing

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.printToString
import androidx.test.core.app.ApplicationProvider
import io.github.marcinjahn.commitnote.CommitnoteApplication
import io.github.marcinjahn.commitnote.app.AppSession
import kotlinx.coroutines.runBlocking
import org.robolectric.Shadows.shadowOf

private const val WAIT_MILLIS = 60_000L

val session: AppSession get() =
    ApplicationProvider
        .getApplicationContext<CommitnoteApplication>()
        .session

fun <T> core(block: suspend AppSession.() -> T): T = runBlocking { session.block() }

fun ComposeTestRule.awaitTag(tag: String): SemanticsNodeInteraction {
    awaitScreen(
        "tag $tag to appear",
    ) { onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty() }
    return onNodeWithTag(tag)
}

fun ComposeTestRule.awaitText(text: String): SemanticsNodeInteraction {
    awaitScreen(
        "text $text to appear",
    ) { onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }
    return onNodeWithText(text)
}

fun ComposeTestRule.awaitNoTag(tag: String) {
    awaitScreen(
        "tag $tag to disappear",
    ) { onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isEmpty() }
}

/**
 * Waits for [condition] on app state, running the work the app posted to the main looper meanwhile.
 * A bare waitUntil does not idle Robolectric's paused looper, so a core response resumed there
 * would never land.
 */
fun ComposeTestRule.awaitApp(
    expectation: String,
    timeoutMillis: Long = WAIT_MILLIS,
    condition: () -> Boolean,
) {
    awaitScreen(expectation, timeoutMillis) { runOnIdle(condition) }
}

private fun ComposeTestRule.awaitScreen(
    expectation: String,
    timeoutMillis: Long = WAIT_MILLIS,
    condition: () -> Boolean,
) {
    try {
        waitUntil(timeoutMillis, condition)
    } catch (timeout: ComposeTimeoutException) {
        throw AssertionError(
            "Timed out waiting for $expectation. Screen:\n${onAllNodes(
                isRoot(),
            ).printToString(maxDepth = Int.MAX_VALUE)}",
            timeout,
        )
    }
}

fun ComposeTestRule.tap(tag: String) {
    awaitTagInView(tag).performClick()
}

fun ComposeTestRule.longPress(tag: String) {
    awaitTagInView(tag).performSemanticsAction(SemanticsActions.OnLongClick)
}

fun ComposeTestRule.openFromMainMenu(tag: String) {
    tap("main-menu")
    tap(tag)
}

fun ComposeTestRule.openFromSettings(tag: String) {
    openFromMainMenu("menu-settings")
    tap(tag)
}

/** Answers the document picker the app started with [document], as the system picker would. */
fun AppComposeRule.answerDocumentPicker(document: Uri): Intent {
    awaitApp("the document picker to start") {
        shadowOf(activity).peekNextStartedActivityForResult() != null
    }
    val started = shadowOf(activity).nextStartedActivityForResult
    runOnUiThread {
        shadowOf(activity).receiveResult(
            started.intent,
            Activity.RESULT_OK,
            Intent().setData(document),
        )
    }
    return started.intent
}

fun AppComposeRule.pressBack() {
    runOnUiThread { activity.onBackPressedDispatcher.onBackPressed() }
}

fun ComposeTestRule.tapFirst(tag: String) {
    awaitTag(tag)
    onAllNodes(hasTestTag(tag))[0].performScrollTo().performClick()
}

fun ComposeTestRule.tapNth(
    tag: String,
    index: Int,
) {
    awaitTag(tag)
    onAllNodes(hasTestTag(tag))[index].performScrollTo().performClick()
}

private fun ComposeTestRule.awaitTagInView(tag: String): SemanticsNodeInteraction {
    val node = awaitTag(tag)
    if (onAllNodes(
            hasTestTag(tag) and hasAnyAncestor(hasScrollAction()),
        ).fetchSemanticsNodes().isNotEmpty()
    ) {
        node.performScrollTo()
    }
    return node
}

fun ComposeTestRule.logInToRepository(repository: String) {
    awaitTag("token-field").performTextInput(FAKE_ACCESS_TOKEN)
    tap("continue-button")
    tap("repo-$repository")
}

fun ComposeTestRule.logInToSampleTree() {
    logInToRepository(SAMPLE_REPOSITORY)
    awaitTag("passphrase-field").performTextInput(SAMPLE_PASSPHRASE)
    tap("unlock-button")
    awaitTag("tree-list")
    awaitTag("tree-node-Welcome")
}
