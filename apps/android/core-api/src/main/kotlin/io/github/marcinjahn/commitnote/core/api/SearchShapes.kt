package io.github.marcinjahn.commitnote.core.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

/** A highlighted span of a search row's name, as a half-open range of UTF-16 offsets. */
@Serializable(with = NameRangeSerializer::class)
data class NameRange(
    val start: Int,
    val end: Int,
)

/** The core sends a range as the two-element array `[start, end]`. */
internal object NameRangeSerializer : KSerializer<NameRange> {
    private val offsets = ListSerializer(Int.serializer())

    override val descriptor: SerialDescriptor = offsets.descriptor

    override fun serialize(
        encoder: Encoder,
        value: NameRange,
    ) = encoder.encodeSerializableValue(offsets, listOf(value.start, value.end))

    override fun deserialize(decoder: Decoder): NameRange {
        val values = decoder.decodeSerializableValue(offsets)
        if (values.size != 2) throw SerializationException("a name range has two offsets")
        return NameRange(values[0], values[1])
    }
}

@Serializable
data class SnippetPart(
    val text: String,
    val match: Boolean,
)

@Serializable
data class SearchRow(
    val path: List<String>,
    val name: String,
    val folder: String?,
    val nameRanges: List<NameRange>,
    val snippet: List<SnippetPart>?,
    val colorTag: ColorTag?,
)

@Serializable
data class SearchCopy(
    val recentHeading: String,
    val namesHeading: String,
    val contentsHeading: String,
    val noMatches: String,
    val stillReading: String,
    val hint: String,
)

@Serializable
data class SearchResults(
    val recent: List<SearchRow>,
    val names: List<SearchRow>,
    val contents: List<SearchRow>,
    val countText: String?,
    val namesMore: String?,
    val contentsMore: String?,
    val copy: SearchCopy,
)

@Serializable
data class SearchQueryParams(
    val query: String,
)

@Serializable
data class SearchQueryResult(
    val results: SearchResults,
)
