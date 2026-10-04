import { mount } from "svelte";
import App from "./App.svelte";
import { forgeRegistry } from "./forge/registry";
import type { ForgeRegistry } from "./forge/registry";
import "./app.css";
import "./note-fonts.css";

const target = document.getElementById("app");
if (!target) {
  throw new Error("Missing #app element");
}

let registry: ForgeRegistry = forgeRegistry;
let testModeBanner: string | null = null;
if (import.meta.env.MODE === "fake-forge") {
  const fake = await import("./testing/fake-forge/fake-forge-factory");
  const { GITHUB_LIKE_LATENCY } = await import(
    "./testing/fake-forge/forge-latency"
  );
  const fakeForge = await fake.createFakeForge({
    latency: GITHUB_LIKE_LATENCY,
  });
  registry = fakeForge.registry;
  testModeBanner = fake.FAKE_FORGE_BANNER;
  (window as unknown as Record<string, unknown>)[fake.FAKE_FORGE_CONTROLS_KEY] =
    fakeForge.controls;
}

const app = mount(App, { target, props: { registry, testModeBanner } });

export default app;
