import { effectiveSettingsOf } from "../app/settings-actions";
import { readAnalyticsOptOut } from "../analytics/analytics";
import { settingsSaveState } from "../settings/settings-save-state";
import {
  describeSettingsSaveState,
  describeSettingsSaveStateInDetail,
} from "../ui/settings/settings-save-messages";
import type { SettingsSaveView, SettingsView } from "./api";
import type { AppSession, StartedApp } from "./app-session";
import type { HostServices } from "./host-services";
import { isReopenLastViewOff } from "./reopen-last-view";

export interface SettingsViewDeps {
  readonly host: HostServices;
  readonly app: Pick<AppSession, "deviceSettings" | "deviceModel">;
}

export function settingsViewOf(
  running: StartedApp,
  deps: SettingsViewDeps,
): SettingsView {
  const { host, app } = deps;
  const state = running.engine.getState();
  const { settings, scopes } = effectiveSettingsOf(
    state.rawSettings,
    running.settingsSaver.pending,
    app.deviceSettings.read(),
  );
  const ready = state.workingTree !== null && state.stopped === null;
  const canImport = ready && !state.importing;
  return {
    values: {
      colorMode: settings.colorMode,
      accentColor: settings.accentColor,
      noteFont: settings.noteFont,
      newNotePlacement: settings.newNotePlacement,
      newFolderPlacement: settings.newFolderPlacement,
    },
    scopes: {
      colorMode: scopes.colorMode,
      accentColor: scopes.accentColor,
      noteFont: scopes.noteFont,
    },
    deviceName: app.deviceSettings.readDeviceName() ?? "",
    automaticDeviceName: app.deviceModel,
    reopenLastView: !isReopenLastViewOff(host.deviceSettings),
    analyticsCounted: !readAnalyticsOptOut(host.deviceSettings),
    canExport: ready,
    canImport,
    canChangePassphrase: canImport,
  };
}

export function settingsSaveViewOf(running: StartedApp): SettingsSaveView {
  const state = running.engine.getState();
  const save = settingsSaveState({
    engine: state.syncStates.settings,
    stored: state.rawSettings,
    heldEdits: running.settingsSaver.pending,
  });
  const kind =
    save.kind !== "out-of-sync"
      ? save.kind
      : save.reason === "pending"
        ? "pending"
        : "failed";
  return {
    state: kind,
    label: describeSettingsSaveState(save),
    detail: describeSettingsSaveStateInDetail(save),
    canRetry: kind === "failed",
  };
}
