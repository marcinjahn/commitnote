import {
  createDeviceSettingsStore,
  type DeviceSettingsStore,
} from "../settings/device-settings-store";
import type { HostServices } from "./host-services";

export function createHostDeviceSettingsStore(
  host: HostServices,
): DeviceSettingsStore {
  return createDeviceSettingsStore({
    storage: host.deviceSettings,
    events: null,
  });
}

export function nativeDeviceName(
  store: DeviceSettingsStore,
  deviceModel: string,
): string {
  return store.readDeviceName() ?? deviceModel;
}
