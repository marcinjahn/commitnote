import { bindHost, getHost } from "./runtime/bootstrap";
import { createGitHubProvider } from "../forge/github/github-provider";
import { createGitLabProvider } from "../forge/gitlab/gitlab-provider";
import {
  NATIVE_CORE_API_VERSION,
  NATIVE_CORE_MARKER,
  type NativeCoreGlobal,
} from "./api";
import { createNativeCore } from "./native-core";
import { bindHostArgon2 } from "./runtime/host-argon2";
import { createHostFetch } from "./runtime/fetch";

const nativeCore: NativeCoreGlobal = {
  apiVersion: NATIVE_CORE_API_VERSION,
  marker: NATIVE_CORE_MARKER,
  start(host, options) {
    bindHost(host);
    bindHostArgon2(host.crypto);
    const fetch = createHostFetch(getHost);
    return createNativeCore({
      host,
      deviceModel: options.deviceModel,
      analyticsEndpoint: __ANALYTICS_ENDPOINT__,
      registry: async () => ({
        github: createGitHubProvider({ fetch }),
        gitlab: createGitLabProvider({ fetch }),
      }),
    });
  },
};

(globalThis as unknown as { CommitnoteNativeCore: NativeCoreGlobal }).CommitnoteNativeCore =
  nativeCore;
