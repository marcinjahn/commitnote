import type { HostServices } from "../host-services";
import { atob, btoa } from "./base64-globals";
import { Blob } from "./blob";
import { createConsole } from "./console";
import { Headers, Response, createHostFetch } from "./fetch";
import { TextDecoder, TextEncoder } from "./text-codec";
import { createTimers } from "./timers";
import { URL, URLSearchParams } from "./url";

export function installBareHostGlobals(
  target: Record<string, unknown>,
  getHost: () => HostServices,
): void {
  const timers = createTimers(getHost);
  Object.assign(target, {
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    queueMicrotask: timers.queueMicrotask,
    URL,
    URLSearchParams,
    Headers,
    Response,
    fetch: createHostFetch(getHost),
    console: createConsole(getHost),
  });
  if (target.Blob === undefined) target.Blob = Blob;
  if (target.globalThis === undefined) target.globalThis = target;
}
