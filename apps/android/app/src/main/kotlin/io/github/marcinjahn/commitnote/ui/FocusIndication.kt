package io.github.marcinjahn.commitnote.ui

import androidx.compose.foundation.IndicationNodeFactory
import androidx.compose.foundation.interaction.FocusInteraction
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.ContentDrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.node.DelegatableNode
import androidx.compose.ui.node.DelegatingNode
import androidx.compose.ui.node.DrawModifierNode
import androidx.compose.ui.node.invalidateDraw
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * The material ripple plus a visible outline around whatever holds keyboard focus, which the
 * ripple's faint focus tint alone does not make clear enough.
 */
class FocusIndication(
    private val ripple: IndicationNodeFactory,
    private val outline: Color,
) : IndicationNodeFactory {
    override fun create(interactionSource: InteractionSource): DelegatableNode =
        FocusOutlineNode(interactionSource, ripple, outline)

    override fun equals(other: Any?): Boolean =
        other is FocusIndication && other.ripple == ripple && other.outline == outline

    override fun hashCode(): Int = 31 * ripple.hashCode() + outline.hashCode()
}

@Composable
fun rememberFocusIndication(outline: Color): FocusIndication {
    val ripple = ripple()
    return remember(ripple, outline) { FocusIndication(ripple, outline) }
}

private class FocusOutlineNode(
    private val interactionSource: InteractionSource,
    ripple: IndicationNodeFactory,
    private val outline: Color,
) : DelegatingNode(),
    DrawModifierNode {
    private var focused = false

    init {
        delegate(ripple.create(interactionSource))
    }

    override fun onAttach() {
        coroutineScope.launch {
            var focusCount = 0
            interactionSource.interactions.collect { interaction ->
                when (interaction) {
                    is FocusInteraction.Focus -> focusCount++
                    is FocusInteraction.Unfocus -> focusCount--
                }
                val nowFocused = focusCount > 0
                if (nowFocused != focused) {
                    focused = nowFocused
                    invalidateDraw()
                }
            }
        }
    }

    override fun ContentDrawScope.draw() {
        drawContent()
        if (focused) {
            val width = OUTLINE_WIDTH.toPx()
            drawRect(outline, style = Stroke(width))
        }
    }

    private companion object {
        val OUTLINE_WIDTH = 2.dp
    }
}
