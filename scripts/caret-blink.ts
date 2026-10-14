import {
  CARET_BLINK_MS,
  CARET_HOLD_MS,
  CARET_SOFT_EDGE_MS,
} from "../src/editor/caret-style";

export interface CaretKeyframe {
  percent: number;
  opacity: 0 | 1;
}

export interface CaretBlinkTimeline {
  durationMs: number;
  delayMs: number;
  keyframes: readonly CaretKeyframe[];
}

const KEYFRAMES_NAME = "caret-blink";

function round(value: number): number {
  return Number(value.toFixed(3));
}

export function caretBlinkTimeline(): CaretBlinkTimeline {
  const durationMs = 2 * CARET_BLINK_MS;
  const edge = (CARET_SOFT_EDGE_MS / durationMs) * 100;
  const half = (CARET_BLINK_MS / durationMs) * 100;
  return {
    durationMs,
    delayMs: CARET_HOLD_MS,
    keyframes: [
      { percent: 0, opacity: 1 },
      { percent: round(edge), opacity: 0 },
      { percent: round(half), opacity: 0 },
      { percent: round(half + edge), opacity: 1 },
      { percent: 100, opacity: 1 },
    ],
  };
}

export function caretBlinkCss(selector: string): string[] {
  const { durationMs, delayMs, keyframes } = caretBlinkTimeline();
  const steps = keyframes
    .map(({ percent, opacity }) => `${String(percent)}% { opacity: ${opacity}; }`)
    .join(" ");
  return [
    `${selector} { animation: ${KEYFRAMES_NAME} ${durationMs}ms ease-in-out ${delayMs}ms infinite; }`,
    `@keyframes ${KEYFRAMES_NAME} { ${steps} }`,
    `@media (prefers-reduced-motion: reduce) { ${selector} { animation: none; } }`,
  ];
}
