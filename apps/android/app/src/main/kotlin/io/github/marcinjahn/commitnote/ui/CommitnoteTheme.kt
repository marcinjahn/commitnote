package io.github.marcinjahn.commitnote.ui

import android.app.Activity
import android.content.Context
import android.os.Build
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.CornerBasedShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import io.github.marcinjahn.commitnote.app.Appearance

/** Whether the resolved theme mode is dark, for colours outside the Material scheme. */
val LocalDarkTheme = staticCompositionLocalOf { false }

/** The family of the note font setting, for screens that show note text. */
val LocalNoteFontFamily = staticCompositionLocalOf<FontFamily> { FontFamily.Default }

private val squareCorner: CornerBasedShape = RoundedCornerShape(0.dp)

private val squaredShapes =
    Shapes(
        extraSmall = squareCorner,
        small = squareCorner,
        medium = squareCorner,
        large = squareCorner,
        extraLarge = squareCorner,
    )

@Composable
fun CommitnoteTheme(
    appearance: Appearance,
    content: @Composable () -> Unit,
) {
    val dark =
        when (appearance.colorMode) {
            "light" -> false
            "dark" -> true
            else -> isSystemInDarkTheme()
        }
    val context = LocalContext.current
    val accent = accentRoles(context, appearance.accentColor, dark)
    val colors = remember(dark, accent) { Palette.colorScheme(dark, accent) }
    val assets = context.assets
    val uiFont = remember(assets) { NoteFonts.family(NoteFonts.UI_FONT, assets) }
    val noteFont =
        remember(assets, appearance.noteFont) { NoteFonts.family(appearance.noteFont, assets) }
    val typography = remember(uiFont) { Typography().withFamily(uiFont) }

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        }
    }

    CompositionLocalProvider(
        LocalDarkTheme provides dark,
        LocalNoteFontFamily provides noteFont,
    ) {
        MaterialTheme(
            colorScheme = colors,
            shapes = squaredShapes,
            typography = typography,
        ) {
            CompositionLocalProvider(
                LocalIndication provides rememberFocusIndication(MaterialTheme.colorScheme.primary),
                content = content,
            )
        }
    }
}

private fun accentRoles(
    context: Context,
    accentColor: String,
    dark: Boolean,
): AccentRoles {
    Palette.accents[accentColor]?.let { return Palette.accentRoles(it.resolve(dark), dark) }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val dynamic =
            if (dark) {
                dynamicDarkColorScheme(
                    context,
                )
            } else {
                dynamicLightColorScheme(context)
            }
        return AccentRoles(
            dynamic.primary,
            dynamic.onPrimary,
            dynamic.primaryContainer,
            dynamic.onPrimaryContainer,
        )
    }
    return Palette.accentRoles(Palette.accents.getValue(Palette.DEFAULT_ACCENT).resolve(dark), dark)
}

private fun Typography.withFamily(family: FontFamily): Typography {
    fun TextStyle.withFamily() = copy(fontFamily = family)
    return Typography(
        displayLarge = displayLarge.withFamily(),
        displayMedium = displayMedium.withFamily(),
        displaySmall = displaySmall.withFamily(),
        headlineLarge = headlineLarge.withFamily(),
        headlineMedium = headlineMedium.withFamily(),
        headlineSmall = headlineSmall.withFamily(),
        titleLarge = titleLarge.withFamily(),
        titleMedium = titleMedium.withFamily(),
        titleSmall = titleSmall.withFamily(),
        bodyLarge = bodyLarge.withFamily(),
        bodyMedium = bodyMedium.withFamily(),
        bodySmall = bodySmall.withFamily(),
        labelLarge = labelLarge.withFamily(),
        labelMedium = labelMedium.withFamily(),
        labelSmall = labelSmall.withFamily(),
    )
}
