import {
  type ForgeLatency,
  GITHUB_LIKE_LATENCY,
  NO_LATENCY,
} from "./forge-latency";

export const FAKE_FORGE_OPTIONS_KEY = "__commitNoteFakeForgeOptions";

export interface FakeForgeOptions {
  readonly latency: ForgeLatency;
}

export function readFakeForgeOptions(source: unknown): FakeForgeOptions {
  const latency =
    typeof source === "object" &&
    source !== null &&
    (source as { latency?: unknown }).latency === "none"
      ? NO_LATENCY
      : GITHUB_LIKE_LATENCY;
  return { latency };
}
