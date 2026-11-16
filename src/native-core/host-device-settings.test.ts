import { describe, expect, it } from "vitest";
import { DEVICE_NAME_KEY } from "../settings/device-settings-store";
import {
  createHostDeviceSettingsStore,
  nativeDeviceName,
} from "./host-device-settings";
import { createNodeHostServices } from "./testing/node-host-services";

describe("host device settings", () => {
  it("falls back to the device model when no override is stored", () => {
    const store = createHostDeviceSettingsStore(createNodeHostServices());
    expect(nativeDeviceName(store, "iPhone")).toBe("iPhone");
  });

  it("uses the normalised override and persists it through the host", () => {
    const host = createNodeHostServices();
    const store = createHostDeviceSettingsStore(host);
    store.writeDeviceName("  My   phone\n");

    expect(nativeDeviceName(store, "iPhone")).toBe("My phone");
    expect(host.deviceSettings.getItem(DEVICE_NAME_KEY)).toBe("My phone");
    expect(
      nativeDeviceName(createHostDeviceSettingsStore(host), "iPhone"),
    ).toBe("My phone");

    store.writeDeviceName(null);
    expect(nativeDeviceName(store, "iPhone")).toBe("iPhone");
  });

  it("persists device settings values", () => {
    const host = createNodeHostServices();
    const first = createHostDeviceSettingsStore(host);
    first.setScope("colorMode", "device", "dark");
    expect(createHostDeviceSettingsStore(host).read().scopes.colorMode).toBe(
      "device",
    );
  });
});
