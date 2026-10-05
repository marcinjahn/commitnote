export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function describeMinutes(retryAfterMs: number): string {
  return plural(Math.max(1, Math.ceil(retryAfterMs / 60_000)), "minute", "minutes");
}
