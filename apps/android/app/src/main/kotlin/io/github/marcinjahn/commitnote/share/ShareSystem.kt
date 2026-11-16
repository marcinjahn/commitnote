package io.github.marcinjahn.commitnote.share

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.PersistableBundle

/** Puts [text] on the clipboard; a [sensitive] text is kept out of the clipboard previews. */
fun Context.copyToClipboard(
    text: String,
    sensitive: Boolean,
) {
    val clip = ClipData.newPlainText("", text)
    if (sensitive) {
        clip.description.extras =
            PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
    }
    getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
}

/** Offers [text] to the apps that take plain text. */
fun Context.shareText(text: String) {
    val send =
        Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }
    startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
