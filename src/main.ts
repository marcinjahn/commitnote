import { mount } from "svelte";
import App from "./App.svelte";
import { createForgeAdapter } from "./forge/registry";
import type { ForgeAdapterFactory } from "./forge/registry";
import "./app.css";

const target = document.getElementById("app");
if (!target) {
  throw new Error("Missing #app element");
}

let createAdapter: ForgeAdapterFactory = createForgeAdapter;
let testModeBanner: string | null = null;
if (import.meta.env.MODE === "fake-forge") {
  const fake = await import("./testing/fake-forge/fake-forge-factory");
  const { factory, controls } = await fake.createFakeForge();
  createAdapter = factory;
  testModeBanner = fake.FAKE_FORGE_BANNER;
  (window as unknown as Record<string, unknown>)[fake.FAKE_FORGE_CONTROLS_KEY] =
    controls;
}

const app = mount(App, { target, props: { createAdapter, testModeBanner } });

export default app;
