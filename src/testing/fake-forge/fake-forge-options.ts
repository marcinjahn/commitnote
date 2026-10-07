import { parseCornerStyle, type CornerStyle } from "../../settings/corner-style";
import {
  type ForgeLatency,
  GITHUB_LIKE_LATENCY,
  NO_LATENCY,
} from "./forge-latency";

export const FAKE_FORGE_OPTIONS_KEY = "__commitNoteFakeForgeOptions";
export const FAKE_FORGE_ARGON2_BINDING = "__commitNoteFakeForgeArgon2Derived";

export const FAKE_CORNERS_PARAM = "fake-corners";

export interface FakeForgeOptions {
  readonly latency: ForgeLatency;
  readonly cornerStyle: CornerStyle | null;
  readonly argon2Results: ReadonlyArray<readonly [string, string]> | null;
}

function isResultEntry(entry: unknown): entry is readonly [string, string] {
  return (
    Array.isArray(entry) &&
    entry.length === 2 &&
    typeof entry[0] === "string" &&
    typeof entry[1] === "string"
  );
}

export function readFakeForgeOptions(source: unknown): FakeForgeOptions {
  const fields =
    typeof source === "object" && source !== null
      ? (source as {
          latency?: unknown;
          argon2Results?: unknown;
          cornerStyle?: unknown;
        })
      : {};
  const latency = fields.latency === "none" ? NO_LATENCY : GITHUB_LIKE_LATENCY;
  const argon2Results = Array.isArray(fields.argon2Results)
    ? fields.argon2Results.filter(isResultEntry)
    : null;
  const cornerStyle = parseCornerStyle(fields.cornerStyle) ?? null;
  return { latency, cornerStyle, argon2Results };
}

export function resolveCornerStyleOverride(
  search: string,
  options: FakeForgeOptions,
): CornerStyle | null {
  const fromUrl = parseCornerStyle(
    new URLSearchParams(search).get(FAKE_CORNERS_PARAM),
  );
  return fromUrl ?? options.cornerStyle;
}
