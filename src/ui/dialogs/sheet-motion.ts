export const FALLBACK_SHEET_EXIT_MS = 200;

const CSS_DURATION_PATTERN = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/;

export type SheetExitInputs = {
  narrowLayout: boolean;
  reducedMotion: boolean;
  swiped: boolean;
  tokenDurationMs: number;
};

export function sheetExitDuration(inputs: SheetExitInputs): number {
  const { narrowLayout, reducedMotion, swiped, tokenDurationMs } = inputs;
  if (!narrowLayout || reducedMotion || swiped) return 0;
  if (!Number.isFinite(tokenDurationMs) || tokenDurationMs < 0) return 0;
  return tokenDurationMs;
}

export function parseCssDuration(value: string): number | null {
  const match = CSS_DURATION_PATTERN.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === "s" ? Math.round(amount * 1000 * 1e6) / 1e6 : amount;
}

export function sheetExitTokenMs(value: string): number {
  return parseCssDuration(value) ?? FALLBACK_SHEET_EXIT_MS;
}
