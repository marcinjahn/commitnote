import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRepoConfig } from "../crypto/repo-config";
import { REPO_CONFIG_PATH, TRAILER } from "../format/v1";
import type { NativeCoreHandle, SettingsSaveView, SettingsView } from "./api";
import type { AppSession, NativeRunningApp } from "./app-session";
import { REOPEN_LAST_VIEW_OFF_KEY } from "./reopen-last-view";
import {
  createCoreTestContext,
  type CoreTestContext,
} from "./testing/core-test-harness";

const REPO = "sample/notes";
const WELCOME = ["Welcome"];

let ctx: CoreTestContext;
let app: AppSession;

afterEach(() => {
  ctx.dispose();
});

async function started(): Promise<NativeCoreHandle> {
  ctx = await createCoreTestContext({
    analyticsEndpoint: "https://a.invalid/c",
  });
  const core = ctx.startCore(undefined, (session) => {
    app = session;
    return {};
  });
  await ctx.logIn(core);
  return core;
}

function current(): NativeRunningApp {
  const running = app.current();
  if (running === null) throw new Error("expected a running app");
  return running;
}

async function storedSettings(): Promise<Record<string, unknown>> {
  const adapter = current().sourceAdapter;
  const file = await adapter.readFileAt(
    await adapter.getHead(),
    REPO_CONFIG_PATH,
  );
  const parsed = parseRepoConfig(file?.text ?? "");
  if (parsed.kind !== "valid") throw new Error("expected a valid config");
  return parsed.config.settings as Record<string, unknown>;
}

function settingsTrailers(message: string): string[] {
  return message
    .split("\n")
    .filter((line) => line.startsWith(`${TRAILER.settings}: `));
}

function lastView(): SettingsView {
  const views = ctx.events("settingsChanged") as { view: SettingsView }[];
  return views[views.length - 1]!.view;
}

function lastSave(): SettingsSaveView {
  const saves = ctx.events("settingsSaveChanged") as {
    save: SettingsSaveView;
  }[];
  return saves[saves.length - 1]!.save;
}

async function waitForSave(state: SettingsSaveView["state"]) {
  await vi.waitFor(() => expect(lastSave().state).toBe(state), {
    timeout: 5_000,
    interval: 2,
  });
}

describe("settings.change", () => {
  it("commits only the changed key and keeps every other stored setting", async () => {
    const core = await started();
    const seeded = {
      vimMode: true,
      animatedCaret: false,
      futureSetting: { nested: ["kept", 1] },
    };
    current().engine.changeSettings(seeded);
    expect(await current().engine.flush()).toEqual({ kind: "saved" });
    const before = await storedSettings();
    expect(before).toMatchObject(seeded);
    const commitsBefore = ctx.controls.commitMessages(REPO).length;
    const changeSettings = vi.spyOn(current().engine, "changeSettings");

    await ctx.call(core, "settings.change", {
      key: "colorMode",
      value: "dark",
    });
    await ctx.call(core, "settings.flush");
    await waitForSave("synced");

    expect(changeSettings.mock.calls).toEqual([[{ colorMode: "dark" }]]);
    const messages = ctx.controls.commitMessages(REPO);
    expect(messages).toHaveLength(commitsBefore + 1);
    expect(settingsTrailers(messages[0]!)).toEqual([
      `${TRAILER.settings}: colorMode`,
    ]);
    const after = await storedSettings();
    expect(after).toEqual({ ...before, colorMode: "dark" });
    for (const key of ["vimMode", "animatedCaret", "futureSetting"]) {
      expect(JSON.stringify(after[key])).toBe(JSON.stringify(before[key]));
    }
  });

  it.each([
    { key: "vimMode", value: "true" },
    { key: "animatedCaret", value: "false" },
    { key: "typeToStart", value: "true" },
    { key: "colorMode", value: "sepia" },
    { key: "noteFont", value: "comic-sans" },
  ])("rejects $key = $value", async ({ key, value }) => {
    const core = await started();
    const response = await ctx.send(core, "settings.change", { key, value });
    expect(response).toMatchObject({
      ok: false,
      error: { kind: "invalidParams" },
    });
    expect(current().settingsSaver.hasPending).toBe(false);
  });
});

describe("settings.setScope", () => {
  it("keeps device-scoped changes out of the repo and writes back only a differing value", async () => {
    const core = await started();
    const commitsBefore = ctx.controls.commitMessages(REPO).length;

    await ctx.call(core, "settings.setScope", {
      key: "noteFont",
      scope: "device",
    });
    expect(app.deviceSettings.read()).toEqual({
      scopes: { noteFont: "device" },
      values: { noteFont: "inter" },
    });
    await ctx.call(core, "settings.change", { key: "noteFont", value: "lora" });
    expect(app.deviceSettings.read().values.noteFont).toBe("lora");
    expect(current().settingsSaver.hasPending).toBe(false);
    expect(lastView()).toMatchObject({
      values: { noteFont: "lora" },
      scopes: { noteFont: "device" },
    });

    await ctx.call(core, "settings.setScope", {
      key: "noteFont",
      scope: "synced",
    });
    expect(current().settingsSaver.pending).toEqual({ noteFont: "lora" });
    await ctx.call(core, "settings.flush");
    await waitForSave("synced");
    expect(ctx.controls.commitMessages(REPO)).toHaveLength(commitsBefore + 1);
    expect((await storedSettings()).noteFont).toBe("lora");

    await ctx.call(core, "settings.setScope", {
      key: "noteFont",
      scope: "device",
    });
    await ctx.call(core, "settings.setScope", {
      key: "noteFont",
      scope: "synced",
    });
    expect(current().settingsSaver.hasPending).toBe(false);
  });
});

describe("settings save view", () => {
  it("goes pending, synced, failed with retry, then synced after settings.retry", async () => {
    const core = await started();
    expect((await ctx.call(core, "settings.open")).save).toEqual({
      state: "synced",
      label: "Saved",
      detail: "Settings saved",
      canRetry: false,
    });

    await ctx.call(core, "settings.change", {
      key: "accentColor",
      value: "teal",
    });
    expect(lastSave()).toEqual({
      state: "pending",
      label: "Waiting to save",
      detail: "Settings waiting to save",
      canRetry: false,
    });
    await ctx.call(core, "settings.flush");
    await waitForSave("synced");

    ctx.controls.failNext(REPO, "commit", "Network");
    await ctx.call(core, "settings.change", {
      key: "accentColor",
      value: "red",
    });
    await ctx.call(core, "settings.flush");
    await waitForSave("failed");
    expect(lastSave()).toEqual({
      state: "failed",
      label: "Saving failed",
      detail: "Saving settings failed, will retry",
      canRetry: true,
    });

    await ctx.call(core, "settings.retry");
    await waitForSave("synced");
    expect((await storedSettings()).accentColor).toBe("red");
  });
});

describe("settings.open", () => {
  it("needs a running app", async () => {
    ctx = await createCoreTestContext();
    const core = ctx.startCore();
    expect(await ctx.send(core, "settings.open")).toMatchObject({
      ok: false,
      error: { kind: "notReady" },
    });
  });

  it("returns the copy and the current view", async () => {
    const core = await started();
    const { copy, view } = await ctx.call(core, "settings.open");
    expect(copy.accentColor.options[0]).toEqual({
      id: "system",
      label: "System",
      light: null,
      dark: null,
    });
    expect(copy.accentColor.options[1]).toEqual({
      id: "blue",
      label: "Blue",
      light: "#3358d4",
      dark: "#86a4ff",
    });
    expect(copy.noteFont.options).toHaveLength(11);
    expect(copy.deviceName.maxLength).toBe(40);
    expect(view).toEqual(lastView());
    expect(view).toMatchObject({
      deviceName: "",
      automaticDeviceName: "iPhone",
      reopenLastView: true,
      analyticsCounted: true,
      canExport: true,
      canImport: true,
      canChangePassphrase: true,
    });
  });

  it("emits settingsChanged after login and after each change", async () => {
    const core = await started();
    const afterLogin = ctx.events("settingsChanged").length;
    expect(afterLogin).toBeGreaterThan(0);

    await ctx.call(core, "settings.change", {
      key: "newFolderPlacement",
      value: "afterLastFolder",
    });
    expect(ctx.events("settingsChanged")).toHaveLength(afterLogin + 1);
    expect(lastView().values.newFolderPlacement).toBe("afterLastFolder");

    await ctx.call(core, "device.setName", { name: "Pad" });
    expect(ctx.events("settingsChanged")).toHaveLength(afterLogin + 2);
    await ctx.call(core, "analytics.setCounted", { counted: false });
    expect(ctx.events("settingsChanged")).toHaveLength(afterLogin + 3);
    await ctx.call(core, "lastView.setEnabled", {
      enabled: false,
      view: { note: null, folders: [] },
    });
    expect(ctx.events("settingsChanged")).toHaveLength(afterLogin + 4);
    expect(lastView()).toMatchObject({
      deviceName: "Pad",
      analyticsCounted: false,
      reopenLastView: false,
    });
  });
});

describe("device.setName", () => {
  it("normalises, clears and reaches the commit device name at once", async () => {
    const core = await started();
    expect(
      await ctx.call(core, "device.setName", { name: "  My\n\tPad\u0007  " }),
    ).toEqual({ name: "My Pad" });
    expect(lastView()).toMatchObject({
      deviceName: "My Pad",
      automaticDeviceName: "iPhone",
    });

    expect(await ctx.call(core, "device.setName", { name: "   " })).toEqual({
      name: "iPhone",
    });
    expect(lastView().deviceName).toBe("");
    await ctx.call(core, "device.setName", { name: "Pad" });
    await ctx.call(core, "device.setName", { name: null });
    expect(app.deviceName()).toBe("iPhone");

    await ctx.call(core, "device.setName", { name: "Pad" });
    expect(app.deviceName()).toBe("Pad");
  });
});

describe("lastView.setEnabled", () => {
  const VIEW = { note: WELCOME, folders: [] };

  it("is on by default and stays off across load, save and a new login", async () => {
    const core = await started();
    expect((await ctx.call(core, "settings.open")).view.reopenLastView).toBe(
      true,
    );
    await ctx.call(core, "lastView.save", VIEW);
    ctx.clock.advance(1_000);
    await vi.waitFor(async () =>
      expect((await ctx.call(core, "lastView.load")).view).toEqual(VIEW),
    );

    await ctx.call(core, "lastView.setEnabled", { enabled: false, view: VIEW });
    expect(ctx.host.deviceSettings.getItem(REOPEN_LAST_VIEW_OFF_KEY)).toBe("1");
    expect(await ctx.call(core, "lastView.load")).toEqual({ view: null });
    await ctx.call(core, "lastView.save", VIEW);
    ctx.clock.advance(1_000);
    expect(await ctx.call(core, "lastView.load")).toEqual({ view: null });

    await ctx.call(core, "session.logout", { anyway: true });
    await ctx.logIn(core);
    expect(await ctx.call(core, "lastView.load")).toEqual({ view: null });
    expect((await ctx.call(core, "settings.open")).view.reopenLastView).toBe(
      false,
    );

    await ctx.call(core, "lastView.setEnabled", { enabled: true, view: VIEW });
    expect(
      ctx.host.deviceSettings.getItem(REOPEN_LAST_VIEW_OFF_KEY),
    ).toBeNull();
    await vi.waitFor(async () =>
      expect((await ctx.call(core, "lastView.load")).view).toEqual(VIEW),
    );
    expect(lastView().reopenLastView).toBe(true);
  });
});

describe("analytics.setCounted", () => {
  it("stores the opt-out so analytics.visit returns no URL", async () => {
    ctx = await createCoreTestContext({
      analyticsEndpoint: "https://a.invalid/c",
    });
    const core = ctx.startCore();
    await ctx.call(core, "analytics.setCounted", { counted: false });
    expect(ctx.host.deviceSettings.getItem("commitnote.analyticsOptOut")).toBe(
      "1",
    );
    expect(await ctx.call(core, "analytics.visit")).toEqual({ url: null });

    await ctx.call(core, "analytics.setCounted", { counted: true });
    expect(
      ctx.host.deviceSettings.getItem("commitnote.analyticsOptOut"),
    ).toBeNull();
    expect((await ctx.call(core, "analytics.visit")).url).not.toBeNull();
  });
});
