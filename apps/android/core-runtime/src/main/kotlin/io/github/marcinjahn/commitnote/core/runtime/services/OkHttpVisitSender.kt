package io.github.marcinjahn.commitnote.core.runtime.services

import okhttp3.Call
import okhttp3.Callback
import okhttp3.CookieJar
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Sends the visit as one https GET on OkHttp's own threads, with no cookies, no cache and no user
 * agent of ours. Failures are logged without the URL, which carries the query.
 */
class OkHttpVisitSender(
    private val logger: LogService,
    client: OkHttpClient = defaultClient(),
) : VisitSender {
    private val client =
        client
            .newBuilder()
            .addNetworkInterceptor(::requireHttpsWithoutUserAgent)
            .build()

    override fun send(url: String) {
        val target = url.toHttpUrlOrNull()
        if (target == null || !target.isHttps) {
            logger.log(LogLevel.WARN, "Refused a visit request that is not https")
            return
        }
        client
            .newCall(
                Request
                    .Builder()
                    .url(target)
                    .get()
                    .build(),
            ).enqueue(
                object : Callback {
                    override fun onFailure(
                        call: Call,
                        e: IOException,
                    ) {
                        logger.log(
                            LogLevel.WARN,
                            "The visit request failed: ${e.javaClass.simpleName}",
                        )
                    }

                    override fun onResponse(
                        call: Call,
                        response: Response,
                    ) {
                        response.close()
                    }
                },
            )
    }

    private fun requireHttpsWithoutUserAgent(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (!request.url.isHttps) throw IOException("Refused a redirect that is not https")
        return chain.proceed(request.newBuilder().removeHeader("User-Agent").build())
    }

    companion object {
        private const val CALL_TIMEOUT_SECONDS = 30L

        fun defaultClient(): OkHttpClient =
            OkHttpClient
                .Builder()
                .callTimeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .cache(null)
                .cookieJar(CookieJar.NO_COOKIES)
                .build()
    }
}
