export interface TypingSchedule {
  keystrokes: number[];
  blinkStart: number;
  caretToggles: number[];
  end: number;
}

export const TYPING_LEAD_IN_MS = 120;
export const CARET_HOLD_MS = 650;
export const CARET_BLINK_MS = 800;
export const CARET_SOFT_EDGE_MS = 160;

const BASE_INTERVAL_MS = 95;
const INTERVAL_JITTER = 0.35;
const BEAT_EXTRA_MS = 80;
const MIN_SPAN_MS = 800;
const MAX_SPAN_MS = 1400;
const CARET_TOGGLE_COUNT = 5;

export function createTypingSchedule(
  text: string,
  beatBeforeIndex: number,
  random: () => number = Math.random,
): TypingSchedule {
  const length = [...text].length;
  if (length === 0) {
    throw new Error("Typing schedule needs at least one letter");
  }

  const intervals: number[] = [];
  for (let i = 1; i < length; i++) {
    const jitter = 1 + INTERVAL_JITTER * (2 * random() - 1);
    const beat = i === beatBeforeIndex ? BEAT_EXTRA_MS : 0;
    intervals.push(BASE_INTERVAL_MS * jitter + beat);
  }

  const span = intervals.reduce((sum, interval) => sum + interval, 0);
  const boundedSpan = Math.min(Math.max(span, MIN_SPAN_MS), MAX_SPAN_MS);
  const scale = span > 0 ? boundedSpan / span : 1;

  const keystrokes = [TYPING_LEAD_IN_MS];
  let time = TYPING_LEAD_IN_MS;
  for (const interval of intervals) {
    time += interval * scale;
    keystrokes.push(Math.round(time));
  }

  if (length > 1) {
    const lastIndex = length - 1;
    keystrokes[lastIndex] = Math.min(
      Math.max(keystrokes[lastIndex], TYPING_LEAD_IN_MS + MIN_SPAN_MS),
      TYPING_LEAD_IN_MS + MAX_SPAN_MS,
    );
  }

  const last = keystrokes[keystrokes.length - 1];
  const caretToggles = Array.from(
    { length: CARET_TOGGLE_COUNT },
    (_, i) => last + CARET_HOLD_MS + i * CARET_BLINK_MS,
  );

  return {
    keystrokes,
    blinkStart: last,
    caretToggles,
    end: caretToggles[CARET_TOGGLE_COUNT - 1] + CARET_SOFT_EDGE_MS,
  };
}
