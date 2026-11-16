package io.github.marcinjahn.commitnote.core.runtime.services

import okhttp3.CookieJar
import okhttp3.Headers.Companion.toHeaders
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Speaks https only: [client] gets a network interceptor that refuses every non-https hop, so a
 * redirect to plain http fails like any other transport error.
 */
class OkHttpHttpService(
    client: OkHttpClient = defaultClient(),
) : HttpService {
    private val client = client.newBuilder().addNetworkInterceptor(::requireHttps).build()

    override fun request(request: HttpRequest): HttpResponse {
        val prepared = prepare(request)
        try {
            client.newCall(prepared).execute().use { response ->
                return HttpResponse(
                    status = response.code,
                    headers =
                        response.headers.toMultimap().mapValues { (_, values) ->
                            values.joinToString(", ")
                        },
                    body = response.body.bytes(),
                )
            }
        } catch (_: IOException) {
            throw HttpTransportException(FAILURE)
        }
    }

    private fun prepare(request: HttpRequest): Request {
        val url = request.url.toHttpUrlOrNull()
        if (url == null ||
            !url.isHttps
        ) {
            throw HttpTransportException("Refused a request that is not https")
        }
        try {
            val body =
                request.body?.toRequestBody()
                    ?: if (request.method.uppercase() in
                        METHODS_WITH_BODY
                    ) {
                        ByteArray(0).toRequestBody()
                    } else {
                        null
                    }
            return Request
                .Builder()
                .url(url)
                .headers(request.headers.toHeaders())
                .method(request.method, body)
                .build()
        } catch (_: IllegalArgumentException) {
            throw HttpTransportException("Refused a malformed request")
        }
    }

    private fun requireHttps(chain: Interceptor.Chain): Response {
        if (!chain.request().url.isHttps) {
            throw HttpTransportException(
                "Refused a redirect that is not https",
            )
        }
        return chain.proceed(chain.request())
    }

    companion object {
        private const val FAILURE = "Network request failed"
        private const val CALL_TIMEOUT_SECONDS = 60L
        private val METHODS_WITH_BODY = setOf("POST", "PUT", "PATCH")

        fun defaultClient(): OkHttpClient =
            OkHttpClient
                .Builder()
                .callTimeout(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                .cache(null)
                .cookieJar(CookieJar.NO_COOKIES)
                .build()
    }
}
