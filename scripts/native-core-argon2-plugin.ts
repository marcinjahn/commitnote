import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_ARGON2 = resolve(rootDir, "src/crypto/argon2.ts");
const HOST_ARGON2 = resolve(rootDir, "src/native-core/runtime/host-argon2.ts");

export function nativeCoreArgon2Redirect(): Plugin {
  return {
    name: "commitnote-native-core-argon2-redirect",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (importer === undefined || !/argon2/.test(source)) {
        return null;
      }
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved !== null && resolve(resolved.id) === WEB_ARGON2 ? HOST_ARGON2 : null;
    },
  };
}
