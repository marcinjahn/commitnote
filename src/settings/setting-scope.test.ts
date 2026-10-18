import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTING_SCOPES,
  EMPTY_DEVICE_SETTINGS,
  isSwitchableSetting,
  resolveEffectiveSettings,
  routeSettingsEdits,
  switchSettingScope,
} from "./setting-scope";
import { resolveSettings, SETTINGS_SCHEMA } from "./settings";

describe("default setting scopes", () => {
  it("defaults appearance settings to synced and editor behavior to device", () => {
    expect(DEFAULT_SETTING_SCOPES).toEqual({
      colorMode: "synced",
      accentColor: "synced",
      noteFont: "synced",
      animatedCaret: "synced",
      vimMode: "device",
      typeToStart: "device",
    });
  });

  it("keeps placement settings synced-only", () => {
    expect(isSwitchableSetting("newNotePlacement")).toBe(false);
    expect(isSwitchableSetting("newFolderPlacement")).toBe(false);
    expect(isSwitchableSetting("vimMode")).toBe(true);
    const { scopes } = resolveEffectiveSettings({}, EMPTY_DEVICE_SETTINGS);
    expect(scopes.newNotePlacement).toBe("synced");
    expect(scopes.newFolderPlacement).toBe("synced");
  });
});

describe("resolveEffectiveSettings", () => {
  it("resolves a device-scoped key without a device value to the default", () => {
    const { settings } = resolveEffectiveSettings(
      { vimMode: true, typeToStart: false },
      EMPTY_DEVICE_SETTINGS,
    );
    expect(settings.vimMode).toBe(false);
    expect(settings.typeToStart).toBe(true);
  });

  it("uses a valid device value", () => {
    const { settings } = resolveEffectiveSettings(
      {},
      { scopes: {}, values: { vimMode: true } },
    );
    expect(settings.vimMode).toBe(true);
  });

  it("falls back to the default for an invalid device value", () => {
    const { settings } = resolveEffectiveSettings(
      { vimMode: true },
      { scopes: {}, values: { vimMode: "yes" as unknown as boolean } },
    );
    expect(settings.vimMode).toBe(false);
  });

  it("uses the device value for a synced-by-default key switched to device", () => {
    const { settings, scopes } = resolveEffectiveSettings(
      { accentColor: "blue" },
      { scopes: { accentColor: "device" }, values: { accentColor: "pink" } },
    );
    expect(scopes.accentColor).toBe("device");
    expect(settings.accentColor).toBe("pink");
  });

  it("does not seed a device-scoped key from the synced value", () => {
    const { settings } = resolveEffectiveSettings(
      { accentColor: "blue" },
      { scopes: { accentColor: "device" }, values: {} },
    );
    expect(settings.accentColor).toBe("system");
  });

  it("uses the synced value for a device-by-default key switched to synced", () => {
    const { settings, scopes } = resolveEffectiveSettings(
      { vimMode: true },
      { scopes: { vimMode: "synced" }, values: { vimMode: false } },
    );
    expect(scopes.vimMode).toBe("synced");
    expect(settings.vimMode).toBe(true);
  });

  it("ignores scope and value entries for synced-only keys", () => {
    const { settings, scopes } = resolveEffectiveSettings(
      { newNotePlacement: "end" },
      {
        scopes: { newNotePlacement: "device" } as never,
        values: { newNotePlacement: "beginning" },
      },
    );
    expect(scopes.newNotePlacement).toBe("synced");
    expect(settings.newNotePlacement).toBe("end");
  });
});

describe("routeSettingsEdits", () => {
  it("splits a mixed edit by scope", () => {
    const { scopes } = resolveEffectiveSettings({}, EMPTY_DEVICE_SETTINGS);
    expect(
      routeSettingsEdits(
        { vimMode: true, noteFont: "lora", newNotePlacement: "end" },
        scopes,
      ),
    ).toEqual({
      device: { vimMode: true },
      synced: { noteFont: "lora", newNotePlacement: "end" },
    });
  });

  it("skips undefined values", () => {
    const { scopes } = resolveEffectiveSettings({}, EMPTY_DEVICE_SETTINGS);
    expect(routeSettingsEdits({ vimMode: undefined }, scopes)).toEqual({
      device: {},
      synced: {},
    });
  });
});

describe("switchSettingScope", () => {
  const syncedResolved = resolveSettings(SETTINGS_SCHEMA, {
    accentColor: "blue",
  });

  it("returns the current value and no synced edit when switching to device", () => {
    expect(
      switchSettingScope(
        "accentColor",
        "device",
        { ...syncedResolved, accentColor: "pink" },
        syncedResolved,
      ),
    ).toEqual({ deviceValue: "pink", syncedEdits: {} });
  });

  it("writes the current value to synced when it differs", () => {
    expect(
      switchSettingScope(
        "vimMode",
        "synced",
        { ...syncedResolved, vimMode: true },
        syncedResolved,
      ),
    ).toEqual({ deviceValue: undefined, syncedEdits: { vimMode: true } });
  });

  it("writes no synced edit when the value equals the synced value", () => {
    expect(
      switchSettingScope(
        "accentColor",
        "synced",
        syncedResolved,
        syncedResolved,
      ),
    ).toEqual({ deviceValue: undefined, syncedEdits: {} });
  });

  it("writes no synced edit for a key absent from synced settings that equals its default", () => {
    const resolved = resolveSettings(SETTINGS_SCHEMA, {});
    expect(
      switchSettingScope("vimMode", "synced", resolved, resolved),
    ).toEqual({ deviceValue: undefined, syncedEdits: {} });
  });
});
