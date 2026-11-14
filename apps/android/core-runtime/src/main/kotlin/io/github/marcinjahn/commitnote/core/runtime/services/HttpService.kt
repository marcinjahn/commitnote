package io.github.marcinjahn.commitnote.core.runtime.services

class HttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val body: ByteArray?,
)

/** Header names are lower-case. */
class HttpResponse(
    val status: Int,
    val headers: Map<String, String>,
    val body: ByteArray,
)

interface HttpService {
    /**
     * Resolves for every HTTP status.
     *
     * @throws HttpTransportException when no response could be obtained or the request is refused.
     */
    fun request(request: HttpRequest): HttpResponse
}
