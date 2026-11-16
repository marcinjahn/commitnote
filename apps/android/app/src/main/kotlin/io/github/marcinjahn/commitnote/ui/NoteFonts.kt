package io.github.marcinjahn.commitnote.ui

import android.content.res.AssetManager
import android.graphics.Typeface
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight

/** The bundled font families, by note font setting id. */
object NoteFonts {
    const val UI_FONT = "inter"

    const val CODE_FONT = "jetbrains-mono"

    private const val ASSET_FOLDER = "fonts"

    private val weights = listOf(FontWeight.Normal, FontWeight.SemiBold)

    private const val REGULAR_WEIGHT = 400
    private const val SEMI_BOLD_WEIGHT = 600

    private sealed interface Files {
        /** `<name>-Variable.ttf` and `<name>-VariableItalic.ttf`, at every weight. */
        data class Variable(
            val name: String,
        ) : Files

        data class Fixed(
            val regular: String,
            val italic: String,
            val semiBold: String,
            val semiBoldItalic: String,
        ) : Files
    }

    private val files: Map<String, Files> =
        mapOf(
            "inter" to Files.Variable("Inter"),
            "ibm-plex-sans" to Files.Variable("IBMPlexSans"),
            "atkinson-hyperlegible" to Files.Variable("AtkinsonHyperlegibleNext"),
            "nunito" to Files.Variable("Nunito"),
            "ia-writer-quattro" to
                Files.Fixed(
                    regular = "iAWriterQuattroS-Regular",
                    italic = "iAWriterQuattroS-Italic",
                    semiBold = "iAWriterQuattroS-Bold",
                    semiBoldItalic = "iAWriterQuattroS-BoldItalic",
                ),
            "literata" to Files.Variable("Literata"),
            "source-serif" to Files.Variable("SourceSerif4"),
            "lora" to Files.Variable("Lora"),
            "jetbrains-mono" to Files.Variable("JetBrainsMono"),
            "ibm-plex-mono" to
                Files.Fixed(
                    regular = "IBMPlexMono-Regular",
                    italic = "IBMPlexMono-Italic",
                    semiBold = "IBMPlexMono-SemiBold",
                    semiBoldItalic = "IBMPlexMono-SemiBoldItalic",
                ),
        )

    /** [FontFamily.Default] for `system` and for an id this app does not know. */
    fun family(
        id: String,
        assets: AssetManager,
    ): FontFamily =
        when (val entry = files[id]) {
            null -> FontFamily.Default
            is Files.Variable -> variableFamily(entry.name, assets)
            is Files.Fixed -> fixedFamily(entry, assets)
        }

    /** The platform typefaces of [id] for text views; the system font for an unknown id. */
    fun typefaces(
        id: String,
        assets: AssetManager,
    ): FontSet =
        when (val entry = files[id]) {
            null -> {
                FontSet(
                    regular = Typeface.DEFAULT,
                    italic = Typeface.create(Typeface.DEFAULT, REGULAR_WEIGHT, true),
                    semiBold = Typeface.create(Typeface.DEFAULT, SEMI_BOLD_WEIGHT, false),
                    semiBoldItalic = Typeface.create(Typeface.DEFAULT, SEMI_BOLD_WEIGHT, true),
                )
            }

            is Files.Variable -> {
                FontSet(
                    regular = variableTypeface("${entry.name}-Variable", assets, REGULAR_WEIGHT),
                    italic =
                        variableTypeface(
                            "${entry.name}-VariableItalic",
                            assets,
                            REGULAR_WEIGHT,
                        ),
                    semiBold =
                        variableTypeface(
                            "${entry.name}-Variable",
                            assets,
                            SEMI_BOLD_WEIGHT,
                        ),
                    semiBoldItalic =
                        variableTypeface(
                            "${entry.name}-VariableItalic",
                            assets,
                            SEMI_BOLD_WEIGHT,
                        ),
                )
            }

            is Files.Fixed -> {
                FontSet(
                    regular = fixedTypeface(entry.regular, assets),
                    italic = fixedTypeface(entry.italic, assets),
                    semiBold = fixedTypeface(entry.semiBold, assets),
                    semiBoldItalic = fixedTypeface(entry.semiBoldItalic, assets),
                )
            }
        }

    private fun variableTypeface(
        file: String,
        assets: AssetManager,
        weight: Int,
    ): Typeface =
        Typeface
            .Builder(assets, "$ASSET_FOLDER/$file.ttf")
            .setFontVariationSettings("'wght' $weight")
            .build()

    private fun fixedTypeface(
        file: String,
        assets: AssetManager,
    ): Typeface = Typeface.Builder(assets, "$ASSET_FOLDER/$file.ttf").build()

    private fun variableFamily(
        name: String,
        assets: AssetManager,
    ): FontFamily =
        FontFamily(
            weights.flatMap { weight ->
                listOf(
                    font("$name-Variable", assets, weight, FontStyle.Normal),
                    font("$name-VariableItalic", assets, weight, FontStyle.Italic),
                )
            },
        )

    private fun fixedFamily(
        files: Files.Fixed,
        assets: AssetManager,
    ): FontFamily =
        FontFamily(
            font(files.regular, assets, FontWeight.Normal, FontStyle.Normal),
            font(files.italic, assets, FontWeight.Normal, FontStyle.Italic),
            font(files.semiBold, assets, FontWeight.SemiBold, FontStyle.Normal),
            font(files.semiBoldItalic, assets, FontWeight.SemiBold, FontStyle.Italic),
        )

    private fun font(
        file: String,
        assets: AssetManager,
        weight: FontWeight,
        style: FontStyle,
    ): Font =
        Font(
            path = "$ASSET_FOLDER/$file.ttf",
            assetManager = assets,
            weight = weight,
            style = style,
            variationSettings = FontVariation.Settings(weight, style),
        )
}

/** One font's four faces as platform typefaces. */
class FontSet(
    val regular: Typeface,
    val italic: Typeface,
    val semiBold: Typeface,
    val semiBoldItalic: Typeface,
) {
    fun face(
        bold: Boolean,
        italic: Boolean,
    ): Typeface =
        when {
            bold && italic -> semiBoldItalic
            bold -> semiBold
            italic -> this.italic
            else -> regular
        }
}
