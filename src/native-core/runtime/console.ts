import type { HostLogLevel, HostServices } from "../host-services";

const METHOD_LEVELS = {
  debug: "debug",
  log: "info",
  info: "info",
  warn: "warn",
  error: "error",
} as const satisfies Record<string, HostLogLevel>;

type Method = keyof typeof METHOD_LEVELS;

export type BareHostConsole = Record<Method, (...args: unknown[]) => void>;

const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function errorName(value: unknown): string | null {
  if (Object.prototype.toString.call(value) !== "[object Error]") return null;
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && SAFE_ERROR_NAME.test(name)
    ? name
    : "Error";
}

export function createConsole(getHost: () => HostServices): BareHostConsole {
  const forward = (method: Method) => (...args: unknown[]) => {
    const name = errorName(args[0]);
    const message = name === null ? method : `${method} ${name}`;
    try {
      getHost().log.log(METHOD_LEVELS[method], message);
    } catch {
      // Dropped while no host is bound, and logging must never throw.
    }
  };
  return {
    debug: forward("debug"),
    log: forward("log"),
    info: forward("info"),
    warn: forward("warn"),
    error: forward("error"),
  };
}
