import { validateName } from "../../tree/note-names";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function autoName(now: Date, siblingNames: readonly string[]): string {
  const base = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  if (validateName(base, siblingNames).ok) {
    return base;
  }
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base} (${suffix})`;
    if (validateName(candidate, siblingNames).ok) {
      return candidate;
    }
  }
}
