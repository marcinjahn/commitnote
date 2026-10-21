export interface DeviceNameOption {
  readonly deviceName: string | null;
  readonly automaticDeviceName: string;
  readonly onDeviceNameChange: (raw: string) => void;
}

export const DEVICE_NAME_LABEL = "Device name";

export const DEVICE_NAME_HINT =
  "Shown when you resolve a conflict between your devices. Stored encrypted in your notes repository.";
