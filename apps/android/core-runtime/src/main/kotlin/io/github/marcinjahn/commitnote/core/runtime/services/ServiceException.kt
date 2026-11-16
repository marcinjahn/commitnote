package io.github.marcinjahn.commitnote.core.runtime.services

import java.io.IOException

/** Messages never carry note contents, names, paths, URLs or credentials. */
open class ServiceException(
    message: String,
) : RuntimeException(message)

class HttpTransportException(
    message: String,
) : IOException(message)
