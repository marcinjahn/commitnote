const bootHref = location.href;

import { mount } from "svelte";
import App from "./App.svelte";
import { forgeRegistry } from "./forge/registry";
import type { ForgeRegistry } from "./forge/registry";
import { type Argon2idFunction, argon2idInWorker } from "./crypto/argon2";
import "./app.css";
import { createShareReaders } from "./forge/share-readers";
import type { ShareReaders } from "./forge/share-host";
import { isShareHash } from "./share/share-link";
import { startBrowserAppUpdates } from "./app/app-updates";
import { captureInstallEvents } from "./app/install-events";
import { createBrowserInstallController } from "./app/install-controller";
import { type LaunchQueueLike, startLaunchActions } from "./app/launch-action";
import { clearLaunchAction } from "./app/note-navigation";
import "./note-fonts.css";

const target = document.getElementById("app");
if (!target) {
  throw new Error("Missing #app element");
}

const installEvents = captureInstallEvents(window);

window.addEventListener("hashchange", (event) => {
  if (
    isShareHash(new URL(event.oldURL).hash) ||
    isShareHash(new URL(event.newURL).hash)
  ) {
    window.location.reload();
  }
});

async function mountViewer(target: HTMLElement): Promise<void> {
  let readers: ShareReaders;
  let testModeBanner: string | null = null;
  let argon2id: Argon2idFunction = argon2idInWorker;
  if (import.meta.env.MODE === "fake-forge") {
    const { FAKE_FORGE_BANNER } = await import(
      "./testing/fake-forge/fake-forge-factory"
    );
    const { FAKE_FORGE_OPTIONS_KEY, readFakeForgeOptions } = await import(
      "./testing/fake-forge/fake-forge-options"
    );
    const { createFakeShareStore, createFakeShareReaders } = await import(
      "./forge/fake/fake-share-store"
    );
    const options = readFakeForgeOptions(
      (window as unknown as Record<string, unknown>)[FAKE_FORGE_OPTIONS_KEY],
    );
    if (options.argon2Results !== null) {
      const { memoizedArgon2id } = await import(
        "./crypto/testing/memoized-argon2id"
      );
      argon2id = memoizedArgon2id(argon2idInWorker, {
        seed: options.argon2Results,
      });
    }
    readers = createFakeShareReaders(createFakeShareStore(localStorage));
    testModeBanner = FAKE_FORGE_BANNER;
  } else {
    readers = createShareReaders();
  }
  const { createViewerController } = await import("./viewer/viewer-state");
  const { default: SharedNoteViewer } = await import(
    "./viewer/SharedNoteViewer.svelte"
  );
  const controller = createViewerController({
    hash: location.hash,
    readers,
    argon2id,
    supported:
      window.isSecureContext && typeof crypto?.subtle?.importKey === "function",
  });
  mount(SharedNoteViewer, { target, props: { controller, testModeBanner } });
}

const appUpdates = import.meta.env.DEV ? null : startBrowserAppUpdates();

if (isShareHash(location.hash)) {
  await mountViewer(target);
} else {
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
    shareStorage: localStorage,
  });
  registry = fakeForge.registry;
  testModeBanner = fake.FAKE_FORGE_BANNER;
  testWindow[fake.FAKE_FORGE_CONTROLS_KEY] = fakeForge.controls;

  const { FAKE_FORGE_SESSION_PARAM, rememberFixtureSession } = await import(
    "./testing/fake-forge/remembered-session"
  );
  const url = new URL(window.location.href);
  const repoUrl = url.searchParams.get(FAKE_FORGE_SESSION_PARAM);
  if (repoUrl !== null) {
    url.searchParams.delete(FAKE_FORGE_SESSION_PARAM);
    window.history.replaceState(window.history.state, "", url);
    try {
      await rememberFixtureSession({
        registry: fakeForge.registry,
        repoUrl,
        argon2id,
      });
    } catch (error) {
      console.error(error);
    }
  }
}

  const install = createBrowserInstallController(installEvents);
  const launchActions = startLaunchActions({
    bootHref,
    launchQueue: (window as { launchQueue?: LaunchQueueLike }).launchQueue,
    clearUrl: () => clearLaunchAction(window.history, window.location),
  });
  mount(App, {
    target,
    props: {
      registry,
      testModeBanner,
      argon2id,
      appUpdates,
      install,
      launchActions,
    },
  });
}
