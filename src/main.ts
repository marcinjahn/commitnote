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
  createAdapter = await fake.createFakeForgeFactory();
  testModeBanner = fake.FAKE_FORGE_BANNER;
}

const app = mount(App, { target, props: { createAdapter, testModeBanner } });

export default app;
