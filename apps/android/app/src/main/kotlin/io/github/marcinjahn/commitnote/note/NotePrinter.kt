package io.github.marcinjahn.commitnote.note

import android.content.Context
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Prints rendered notes through an off-screen web view. The view is kept until the next print or
 * [release], because the print framework reads it after [print] returns.
 */
class NotePrinter(
    private val context: Context,
) {
    private var webView: WebView? = null

    fun print(job: PrintJob) {
        release()
        val view = WebView(context)
        view.webViewClient =
            object : WebViewClient() {
                private var printed = false

                override fun onPageFinished(
                    view: WebView,
                    url: String?,
                ) {
                    if (printed) return
                    printed = true
                    val manager = context.getSystemService(PrintManager::class.java) ?: return
                    manager.print(job.name, view.createPrintDocumentAdapter(job.name), null)
                }
            }
        view.loadDataWithBaseURL(null, job.html, "text/html", "UTF-8", null)
        webView = view
    }

    fun release() {
        webView?.destroy()
        webView = null
    }
}
