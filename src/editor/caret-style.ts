export const CARET_HOLD_MS = 650;
export const CARET_BLINK_MS = 800;
export const CARET_SOFT_EDGE_MS = 160;
export const CARET_SOFT_EDGE = `${CARET_SOFT_EDGE_MS}ms ease-in-out`;
export const CARET_WIDTH_PX = 2;
export const CARET_TAIL_LENGTH = 3;

export function caretTailStops(length: number): number[] {
  return Array.from({ length: length + 1 }, (_, i) => i / length);
}
