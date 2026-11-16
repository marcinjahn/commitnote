package io.github.marcinjahn.commitnote.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import io.github.marcinjahn.commitnote.core.api.ColorTag

/** One colour per theme mode. */
data class ModeColor(
    val light: Color,
    val dark: Color,
) {
    fun resolve(dark: Boolean): Color = if (dark) this.dark else light
}

/** The four colour roles that carry the accent. */
data class AccentRoles(
    val primary: Color,
    val onPrimary: Color,
    val primaryContainer: Color,
    val onPrimaryContainer: Color,
)

private class Surfaces(
    val background: Color,
    val surface: Color,
    val raised: Color,
    val text: Color,
    val muted: Color,
    val border: Color,
    val danger: Color,
    val selected: Color,
)

object Palette {
    private val light =
        Surfaces(
            background = Color(0xFFFAFAFA),
            surface = Color(0xFFF2F2F2),
            raised = Color(0xFFFFFFFF),
            text = Color(0xFF0A0A0A),
            muted = Color(0xFF575757),
            border = Color(0xFFE5E5E5),
            danger = Color(0xFFB3261E),
            selected = Color(0xFFDBDBDB),
        )

    private val dark =
        Surfaces(
            background = Color(0xFF0B0B0B),
            surface = Color(0xFF141414),
            raised = Color(0xFF1A1A1A),
            text = Color(0xFFEDEDED),
            muted = Color(0xFFB0B0B0),
            border = Color(0xFF262626),
            danger = Color(0xFFFF7A70),
            selected = Color(0xFF333333),
        )

    const val DEFAULT_ACCENT = "blue"

    /** The accent palette by setting id. */
    val accents: Map<String, ModeColor> =
        mapOf(
            "blue" to ModeColor(Color(0xFF3358D4), Color(0xFF86A4FF)),
            "violet" to ModeColor(Color(0xFF8A46B8), Color(0xFFD59CFF)),
            "pink" to ModeColor(Color(0xFFC4277D), Color(0xFFFF90C0)),
            "red" to ModeColor(Color(0xFFCE2C31), Color(0xFFFF9592)),
            "orange" to ModeColor(Color(0xFFCC4E00), Color(0xFFFFA057)),
            "amber" to ModeColor(Color(0xFF9A6700), Color(0xFFFFC53D)),
            "green" to ModeColor(Color(0xFF218358), Color(0xFF3DD68C)),
            "teal" to ModeColor(Color(0xFF008573), Color(0xFF0BD8B6)),
            "slate" to ModeColor(Color(0xFF5E6C7D), Color(0xFFA5B3C4)),
        )

    private val tagAccents =
        mapOf(
            ColorTag.RED to "red",
            ColorTag.ORANGE to "orange",
            ColorTag.YELLOW to "amber",
            ColorTag.GREEN to "green",
            ColorTag.BLUE to "blue",
            ColorTag.PURPLE to "violet",
        )

    fun tagColor(
        tag: ColorTag,
        dark: Boolean,
    ): Color = accents.getValue(tagAccents.getValue(tag)).resolve(dark)

    fun accentRoles(
        accent: Color,
        dark: Boolean,
    ): AccentRoles {
        val surfaces = surfaces(dark)
        return AccentRoles(
            primary = accent,
            onPrimary = if (dark) surfaces.background else surfaces.raised,
            primaryContainer = lerp(surfaces.background, accent, CONTAINER_TINT),
            onPrimaryContainer = surfaces.text,
        )
    }

    fun colorScheme(
        dark: Boolean,
        accent: AccentRoles,
    ): ColorScheme {
        val s = surfaces(dark)
        val base = if (dark) darkColorScheme() else lightColorScheme()
        return base.copy(
            primary = accent.primary,
            onPrimary = accent.onPrimary,
            primaryContainer = accent.primaryContainer,
            onPrimaryContainer = accent.onPrimaryContainer,
            inversePrimary = accent.primary,
            secondary = s.muted,
            onSecondary = s.raised,
            secondaryContainer = s.selected,
            onSecondaryContainer = s.text,
            tertiary = s.muted,
            onTertiary = s.raised,
            tertiaryContainer = s.selected,
            onTertiaryContainer = s.text,
            background = s.background,
            onBackground = s.text,
            surface = s.background,
            onSurface = s.text,
            surfaceVariant = s.surface,
            onSurfaceVariant = s.muted,
            surfaceTint = Color.Transparent,
            inverseSurface = s.text,
            inverseOnSurface = s.background,
            error = s.danger,
            onError = s.raised,
            errorContainer = lerp(s.background, s.danger, CONTAINER_TINT),
            onErrorContainer = s.text,
            outline = s.muted,
            outlineVariant = s.border,
            scrim = Color.Black,
            surfaceBright = s.raised,
            surfaceDim = s.surface,
            surfaceContainerLowest = s.background,
            surfaceContainerLow = s.surface,
            surfaceContainer = s.surface,
            surfaceContainerHigh = s.raised,
            surfaceContainerHighest = s.raised,
        )
    }

    private fun surfaces(dark: Boolean) = if (dark) this.dark else light

    private const val CONTAINER_TINT = 0.18f
}
