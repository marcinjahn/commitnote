package io.github.marcinjahn.commitnote.note

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import io.github.marcinjahn.commitnote.R
import io.github.marcinjahn.commitnote.app.AppSession
import io.github.marcinjahn.commitnote.editor.ImageBitmaps
import io.github.marcinjahn.commitnote.ui.CommitnoteTopBar

private sealed interface ViewerImage {
    data object Loading : ViewerImage

    data object Unavailable : ViewerImage

    class Loaded(
        val bitmap: Bitmap,
    ) : ViewerImage
}

/** One image of a note, full screen, zoomed and panned with two fingers. */
@Composable
fun ImageViewerScreen(
    session: AppSession,
    imageId: String,
    onBack: () -> Unit,
) {
    val maxEdge =
        LocalResources.current.displayMetrics.let {
            maxOf(
                it.widthPixels,
                it.heightPixels,
            )
        } *
            2
    val image by produceState<ViewerImage>(ViewerImage.Loading, imageId) {
        val bitmap = session.editor.image(imageId)?.let { ImageBitmaps.decode(it, maxEdge) }
        value = if (bitmap == null) ViewerImage.Unavailable else ViewerImage.Loaded(bitmap)
    }
    Scaffold(
        topBar = {
            CommitnoteTopBar(
                title = stringResource(R.string.image_viewer_title),
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            stringResource(R.string.action_back),
                        )
                    }
                },
            )
        },
    ) { padding ->
        Box(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentAlignment = Alignment.Center,
        ) {
            when (val current = image) {
                ViewerImage.Loading -> CircularProgressIndicator()
                ViewerImage.Unavailable -> Text(stringResource(R.string.image_unavailable))
                is ViewerImage.Loaded -> ZoomableImage(current.bitmap)
            }
        }
    }
}

@Composable
private fun ZoomableImage(bitmap: Bitmap) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    val transform =
        rememberTransformableState { _, zoom, pan, _ ->
            scale = (scale * zoom).coerceIn(MIN_SCALE, MAX_SCALE)
            offset = if (scale == MIN_SCALE) Offset.Zero else offset + pan
        }
    val imageBitmap = remember(bitmap) { bitmap.asImageBitmap() }
    Image(
        bitmap = imageBitmap,
        contentDescription = stringResource(R.string.editor_image),
        modifier =
            Modifier
                .fillMaxSize()
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    translationX = offset.x
                    translationY = offset.y
                }.transformable(transform)
                .testTag("image-viewer"),
    )
}

private const val MIN_SCALE = 1f
private const val MAX_SCALE = 6f
