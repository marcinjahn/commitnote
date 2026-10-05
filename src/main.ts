import { mount } from "svelte";
import App from "./App.svelte";
import { forgeRegistry } from "./forge/registry";
import type { ForgeRegistry } from "./forge/registry";
import { type Argon2idFunction, argon2idInWorker } from "./crypto/argon2";
import "./app.css";
import "./note-fonts.css";

const target = document.getElementById("app");
if (!target) {
  throw new Error("Missing #app element");
}

let registry: ForgeRegistry = forgeRegistry;
let testModeBanner: string | null = null;
let argon2id: Argon2idFunction | undefined;
if (import.meta.env.MODE === "fake-forge") {
  const fake = await import("./testing/fake-forge/fake-forge-factory");
  const {
    FAKE_FORGE_ARGON2_BINDING,
    FAKE_FORGE_OPTIONS_KEY,
    readFakeForgeOptions,
  } = await import("./testing/fake-forge/fake-forge-options");
  const testWindow = window as unknown as Record<string, unknown>;
  const options = readFakeForgeOptions(testWindow[FAKE_FORGE_OPTIONS_KEY]);
  if (options.argon2Results !== null) {
    const { memoizedArgon2id } = await import(
      "./crypto/testing/memoized-argon2id"
    );
    argon2id = memoizedArgon2id(argon2idInWorker, {
      seed: options.argon2Results,
      onDerived: (key, hash) => {
        const report = testWindow[FAKE_FORGE_ARGON2_BINDING];
        if (typeof report === "function") report(key, hash);
      },
    });
  }
  const fakeForge = await fake.createFakeForge({
    latency: options.latency,
    argon2id,
  });
  registry = fakeForge.registry;
  testModeBanner = fake.FAKE_FORGE_BANNER;
  testWindow[fake.FAKE_FORGE_CONTROLS_KEY] = fakeForge.controls;
}

const app = mount(App, { target, props: { registry, testModeBanner, argon2id } });

export default app;
