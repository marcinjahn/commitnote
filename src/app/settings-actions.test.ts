import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_DEVICE_SETTINGS,
  type DeviceSettingsRecord,
} from "../settings/setting-scope";
import {
  changeSettingScope,
  changeSettings,
  effectiveSettingsOf,
  shouldApplyColorMode,
  syncedRawSettings,
  type SettingsActionsDeps,
} from "./settings-actions";

function stubDeps() {
  const change = vi.fn();
  const writeValues = vi.fn();
  const setScope = vi.fn();
  const deps: SettingsActionsDeps = {
    saver: { change },
    deviceStore: { writeValues, setScope },
  };
  return { deps, change, writeValues, setScope };
}

const DEVICE_COLOR_MODE: DeviceSettingsRecord = {
  scopes: { colorMode: "device" },
  values: { colorMode: "light" },
};

describe("effective settings", () => {
  it("overlays pending edits on the engine settings", () => {
    expect(syncedRawSettings({ colorMode: "light" }, { colorMode: "dark" })).toEqual({
      colorMode: "dark",
    });
    const effective = effectiveSettingsOf(
      { colorMode: "light" },
      { colorMode: "dark" },
      EMPTY_DEVICE_SETTINGS,
    );
    expect(effective.settings.colorMode).toBe("dark");
  });
});

describe("changeSettings", () => {
  it("routes a mixed edit to the device store and the saver", () => {
    const { deps, change, writeValues } = stubDeps();
    const { scopes } = effectiveSettingsOf({}, {}, DEVICE_COLOR_MODE);
    changeSettings(deps, { colorMode: "dark", noteFont: "serif" }, scopes);
    expect(writeValues).toHaveBeenCalledWith({ colorMode: "dark" });
    expect(change).toHaveBeenCalledWith({ noteFont: "serif" });
  });

  it("passes exactly the edited key to the saver for synced scopes", () => {
    const { deps, change, writeValues } = stubDeps();
    const { scopes } = effectiveSettingsOf({}, {}, EMPTY_DEVICE_SETTINGS);
    changeSettings(deps, { colorMode: "dark" }, scopes);
    expect(change).toHaveBeenCalledTimes(1);
    expect(change.mock.calls[0]?.[0]).toStrictEqual({ colorMode: "dark" });
    expect(writeValues).not.toHaveBeenCalled();
  });
});

describe("changeSettingScope", () => {
  it("copies the effective value to the device and writes no synced edit", () => {
    const { deps, change, setScope } = stubDeps();
    const effective = effectiveSettingsOf(
      { colorMode: "dark" },
      {},
      EMPTY_DEVICE_SETTINGS,
    );
    changeSettingScope(deps, "colorMode", "device", effective, { colorMode: "dark" });
    expect(change).not.toHaveBeenCalled();
    expect(setScope).toHaveBeenCalledWith("colorMode", "device", "dark");
  });

  it("writes a synced edit when the device value differs", () => {
    const { deps, change, setScope } = stubDeps();
    const effective = effectiveSettingsOf({ colorMode: "dark" }, {}, DEVICE_COLOR_MODE);
    changeSettingScope(deps, "colorMode", "synced", effective, { colorMode: "dark" });
    expect(change).toHaveBeenCalledWith({ colorMode: "light" });
    expect(setScope).toHaveBeenCalledWith("colorMode", "synced", undefined);
  });

  it("writes no synced edit when the value already matches", () => {
    const { deps, change, setScope } = stubDeps();
    const effective = effectiveSettingsOf({ colorMode: "light" }, {}, DEVICE_COLOR_MODE);
    changeSettingScope(deps, "colorMode", "synced", effective, { colorMode: "light" });
    expect(change).not.toHaveBeenCalled();
    expect(setScope).toHaveBeenCalledWith("colorMode", "synced", undefined);
  });
});

describe("shouldApplyColorMode", () => {
  const base = {
    settingsLoaded: false,
    colorModePending: false,
    colorModeScope: "synced",
  } as const;

  it("waits while nothing is loaded, pending or device-scoped", () => {
    expect(shouldApplyColorMode(base)).toBe(false);
  });

  it("applies once synced settings are loaded", () => {
    expect(shouldApplyColorMode({ ...base, settingsLoaded: true })).toBe(true);
  });

  it("applies when a color mode edit is pending", () => {
    expect(shouldApplyColorMode({ ...base, colorModePending: true })).toBe(true);
  });

  it("applies when the scope is device", () => {
    expect(shouldApplyColorMode({ ...base, colorModeScope: "device" })).toBe(true);
  });
});
