import type { HostServices } from "../host-services";
import { installBareHostGlobals } from "./install-globals";
import { installCryptoShim } from "./crypto-shim";

let host: HostServices | null = null;

export function bindHost(services: HostServices): void {
  host = services;
}

export function getHost(): HostServices {
  if (host === null) throw new Error("Host services are not bound");
  return host;
}

const target = globalThis as unknown as Record<string, unknown>;
installBareHostGlobals(target, getHost);
installCryptoShim(target, () => host ?? undefined);
