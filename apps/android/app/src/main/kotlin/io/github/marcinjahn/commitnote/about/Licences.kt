package io.github.marcinjahn.commitnote.about

import android.content.Context
import androidx.annotation.RawRes
import io.github.marcinjahn.commitnote.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Where the full text of a licence is bundled. */
sealed interface LicenceText {
    /** A file under the `fonts/Licenses` assets folder. */
    data class Asset(
        val file: String,
    ) : LicenceText

    data class Raw(
        @RawRes val id: Int,
    ) : LicenceText
}

/** A bundled component and the licence it comes under. */
data class Licence(
    val component: String,
    val licence: String,
    val url: String,
    val notice: String?,
    val text: LicenceText,
) {
    suspend fun read(context: Context): String =
        withContext(Dispatchers.IO) {
            val body =
                when (text) {
                    is LicenceText.Asset -> {
                        context.assets
                            .open(
                                "$FONT_LICENCES/${text.file}",
                            ).bufferedReader()
                            .use { it.readText() }
                    }

                    is LicenceText.Raw -> {
                        context.resources
                            .openRawResource(
                                text.id,
                            ).bufferedReader()
                            .use { it.readText() }
                    }
                }
            listOfNotNull(notice, body).joinToString("\n\n")
        }
}

private const val FONT_LICENCES = "fonts/Licenses"
private const val OFL = "SIL Open Font License 1.1"
private const val APACHE = "Apache License 2.0"

private fun font(
    family: String,
    file: String,
    url: String,
) = Licence(family, OFL, url, notice = null, text = LicenceText.Asset(file))

private fun apache(
    component: String,
    url: String,
) = Licence(component, APACHE, url, notice = null, text = LicenceText.Raw(R.raw.license_apache_2_0))

/** One entry for each font family and library the app bundles. */
val licences: List<Licence> =
    listOf(
        font(
            "Atkinson Hyperlegible Next",
            "AtkinsonHyperlegibleNext-OFL.txt",
            "https://github.com/googlefonts/atkinson-hyperlegible-next",
        ),
        font("IBM Plex Mono", "IBMPlexMono-OFL.txt", "https://github.com/IBM/plex"),
        font("IBM Plex Sans", "IBMPlexSans-OFL.txt", "https://github.com/IBM/plex"),
        font("Inter", "Inter-OFL.txt", "https://github.com/rsms/inter"),
        font(
            "JetBrains Mono",
            "JetBrainsMono-OFL.txt",
            "https://github.com/JetBrains/JetBrainsMono",
        ),
        font("Literata", "Literata-OFL.txt", "https://github.com/googlefonts/literata"),
        font("Lora", "Lora-OFL.txt", "https://github.com/cyrealtype/Lora-Cyrillic"),
        font("Nunito", "Nunito-OFL.txt", "https://github.com/googlefonts/nunito"),
        font(
            "Source Serif 4",
            "SourceSerif4-OFL.txt",
            "https://github.com/adobe-fonts/source-serif",
        ),
        font(
            "iA Writer Quattro",
            "iAWriterQuattro-LICENSE.md",
            "https://github.com/iaolo/iA-Fonts",
        ),
        apache("Javet", "https://github.com/caoccao/Javet"),
        Licence(
            "V8",
            "BSD 3-Clause License",
            "https://v8.dev/",
            notice = "Copyright 2006-2011, the V8 project authors. All rights reserved.",
            text = LicenceText.Raw(R.raw.license_bsd_3_clause),
        ),
        Licence(
            "ICU data",
            "Unicode License v3",
            "https://icu.unicode.org/",
            notice = "Copyright © 2016-2024 Unicode, Inc.",
            text = LicenceText.Raw(R.raw.license_unicode_3_0),
        ),
        Licence(
            "Bouncy Castle",
            "MIT License",
            "https://www.bouncycastle.org/",
            notice = "Copyright (c) 2000 The Legion of the Bouncy Castle Inc.",
            text = LicenceText.Raw(R.raw.license_mit),
        ),
        apache("OkHttp", "https://square.github.io/okhttp/"),
        Licence(
            "commonmark-java",
            "BSD 2-Clause License",
            "https://github.com/commonmark/commonmark-java",
            notice = "Copyright (c) 2015, Robin Stocker\nCopyright (c) 2015, Atlassian Pty Ltd",
            text = LicenceText.Raw(R.raw.license_bsd_2_clause),
        ),
        apache("Kotlin and kotlinx libraries", "https://github.com/Kotlin/kotlinx.coroutines"),
        apache("AndroidX and Jetpack Compose", "https://developer.android.com/jetpack"),
    )
