package io.github.marcinjahn.commitnote.editor

import android.net.Uri
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.ContentInfoCompat
import androidx.core.view.OnReceiveContentListener
import androidx.core.view.ViewCompat
import io.github.marcinjahn.commitnote.core.api.NoteImage
import io.github.marcinjahn.commitnote.ui.NoteFonts
import io.github.marcinjahn.commitnote.ui.openUrl

/** Lets the screen around the editor move the focus into it and see whether it has the focus. */
class NoteEditorHandle {
    private val mutableFocused = mutableStateOf(false)
    val focused: State<Boolean> = mutableFocused

    internal var view: NoteEditText? = null
        set(value) {
            field = value
            if (value == null) mutableFocused.value = false
        }

    /** Moves the input focus to the end of the text. */
    fun focus() {
        view?.let { it.focusText(TextSelection.caret(it.length())) }
    }

    internal fun onFocusChanged(focused: Boolean) {
        mutableFocused.value = focused
    }
}

/**
 * The markdown editor of [controller]'s text. [onReceiveImages] gets images pasted or sent by the
 * keyboard; [loadImage] reads the bitmaps of the note's image references.
 */
@Composable
fun NoteEditor(
    controller: NoteEditorController,
    handle: NoteEditorHandle,
    noteFont: String,
    loadImage: suspend (imageId: String) -> NoteImage?,
    onReceiveImages: (List<Uri>) -> Unit,
    onOpenImage: (imageId: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val resources = LocalResources.current
    val scheme = MaterialTheme.colorScheme
    val currentLoadImage by rememberUpdatedState(loadImage)
    val currentReceiveImages by rememberUpdatedState(onReceiveImages)
    val currentOpenImage by rememberUpdatedState(onOpenImage)
    val scope = rememberCoroutineScope()

    val appearance =
        remember(noteFont, scheme) {
            EditorAppearance(
                fonts =
                    EditorFonts(
                        text = NoteFonts.typefaces(noteFont, context.assets),
                        code = NoteFonts.typefaces(NoteFonts.CODE_FONT, context.assets),
                    ),
                colors =
                    EditorColors(
                        text = scheme.onSurface.toArgb(),
                        muted = scheme.onSurfaceVariant.toArgb(),
                        link = scheme.primary.toArgb(),
                        accent = scheme.primary.toArgb(),
                        onAccent = scheme.onPrimary.toArgb(),
                        codeBackground = scheme.surfaceContainerHigh.toArgb(),
                        quoteBar = scheme.outlineVariant.toArgb(),
                        rule = scheme.outlineVariant.toArgb(),
                        tableLine = scheme.outlineVariant.toArgb(),
                        tableHeader = scheme.surfaceContainer.toArgb(),
                        imagePlaceholder = scheme.surfaceContainerHighest.toArgb(),
                    ),
                textSizeSp = TEXT_SIZE_SP,
            )
        }
    val images =
        remember(scope, resources) {
            EditorImages(
                scope = scope,
                maxEdge =
                    resources.displayMetrics.let {
                        maxOf(
                            it.widthPixels,
                            it.heightPixels,
                        )
                    },
                load = { currentLoadImage(it) },
                onLoaded = { handle.view?.refreshImage(it) },
            )
        }

    AndroidView(
        factory = { viewContext ->
            NoteEditText(viewContext).apply {
                configure(appearance, images)
                listener =
                    object : NoteEditText.Listener {
                        override fun onTextChanged(text: String) = controller.onTextChanged(text)

                        override fun onSelectionChanged(selection: TextSelection) =
                            controller.onSelectionChanged(selection)

                        override fun onOpenLink(url: String) = viewContext.openUrl(url)

                        override fun onOpenImage(imageId: String) = currentOpenImage(imageId)
                    }
                setOnFocusChangeListener { _, focused -> handle.onFocusChanged(focused) }
                ViewCompat.setOnReceiveContentListener(
                    this,
                    IMAGE_TYPES,
                    ImageReceiver {
                        currentReceiveImages(it)
                    },
                )
                handle.view = this
                controller.attach(this)
            }
        },
        update = { view -> view.configure(appearance, images) },
        onRelease = { view ->
            controller.detach(view)
            view.listener = null
            if (handle.view === view) handle.view = null
        },
        modifier = modifier.testTag("note-editor"),
    )
}

/** Takes the images of pasted or keyboard content and leaves the rest to the editor. */
private class ImageReceiver(
    private val onImages: (List<Uri>) -> Unit,
) : OnReceiveContentListener {
    override fun onReceiveContent(
        view: android.view.View,
        payload: ContentInfoCompat,
    ): ContentInfoCompat? {
        val split =
            payload.partition { item ->
                item.uri != null &&
                    view.context.contentResolver
                        .getType(item.uri)
                        ?.startsWith("image/") == true
            }
        val images = split.first ?: return split.second
        val clip = images.clip
        val uris = (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
        if (uris.isNotEmpty()) onImages(uris)
        return split.second
    }
}

private val IMAGE_TYPES = arrayOf("image/*")
private const val TEXT_SIZE_SP = 17f
