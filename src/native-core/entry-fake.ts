import { bindHost } from "./runtime/bootstrap";
import { createFakeForge } from "../testing/fake-forge/fake-forge-factory";
import {
  NATIVE_CORE_API_VERSION,
  NATIVE_CORE_MARKER,
  type NativeCoreGlobal,
} from "./api";
import { createNativeCore } from "./native-core";
import { bindHostArgon2, hostArgon2id } from "./runtime/host-argon2";
import { createFakeCommands } from "./testing/fake-commands";

const nativeCore: NativeCoreGlobal = {
  apiVersion: NATIVE_CORE_API_VERSION,
  marker: NATIVE_CORE_MARKER,
  start(host, options) {
    bindHost(host);
    bindHostArgon2(host.crypto);
    const shareStorage = new Map<string, string>();
    const fakeForge = createFakeForge({
      argon2id: hostArgon2id(host.crypto),
      shareStorage: {
        getItem: (key) => shareStorage.get(key) ?? null,
        setItem: (key, value) => {
          shareStorage.set(key, value);
        },
      },
    });
    return createNativeCore({
      host,
      deviceModel: options.deviceModel,
      analyticsEndpoint: __ANALYTICS_ENDPOINT__,
      registry: async () => (await fakeForge).registry,
      extraCommands: (app) =>
        createFakeCommands({
          getApp: () => app,
          controls: async () => (await fakeForge).controls,
          host,
        }),
    });
  },
};

(globalThis as unknown as { CommitnoteNativeCore: NativeCoreGlobal }).CommitnoteNativeCore =
  nativeCore;
