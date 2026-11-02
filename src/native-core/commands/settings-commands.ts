import { writeAnalyticsOptOut } from "../../analytics/analytics";
import {
  changeSettings,
  changeSettingScope,
  effectiveSettingsOf,
  syncedRawSettings,
  type SettingsActionsDeps,
} from "../../app/settings-actions";
import { SETTINGS_SCHEMA } from "../../settings/settings";
import type { ActionNotices } from "../action-notices";
import type { CoreCommands, ScopedSettingKey, SettingKeyView } from "../api";
import type { AppSession, NativeRunningApp } from "../app-session";
import type { EngineEvents } from "../engine-events";
import { nativeDeviceName } from "../host-device-settings";
import type { HostServices } from "../host-services";
import { writeReopenLastViewOff } from "../reopen-last-view";
import { buildSettingsCopy } from "../settings-copy";
import type { SettingsEvents } from "../settings-events";
import { settingsSaveViewOf, settingsViewOf } from "../settings-view";
import {
  booleanParam,
  invalidParams,
  notReady,
  stringParam,
  type CommandHandler,
  type CommandParams,
} from "./command-context";
import { lastViewParam } from "./session-view-commands";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

const SETTING_KEYS: readonly SettingKeyView[] = [
  "colorMode",
  "accentColor",
  "noteFont",
  "newNotePlacement",
  "newFolderPlacement",
  "typeToStart",
];

const SCOPED_SETTING_KEYS: readonly ScopedSettingKey[] = [
  "colorMode",
  "accentColor",
  "noteFont",
  "typeToStart",
];

function oneOf<T extends string>(
  params: CommandParams,
  name: string,
  allowed: readonly T[],
): T {
  const value = stringParam(params, name);
  if (!(allowed as readonly string[]).includes(value)) throw invalidParams();
  return value as T;
}

function booleanString(raw: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw invalidParams();
}

function isRecord(value: unknown): value is CommandParams {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createSettingsCommands(context: {
  readonly host: HostServices;
  readonly app: AppSession;
  readonly events: EngineEvents;
  readonly notices: ActionNotices;
  readonly settings: SettingsEvents;
}): Record<string, CommandHandler> {
  const { host, app, events, settings } = context;

  function running(): NativeRunningApp {
    const current = app.current();
    if (current === null) throw notReady();
    events.attach(current);
    return current;
  }

  function actionsDeps(current: NativeRunningApp): SettingsActionsDeps {
    return { saver: current.settingsSaver, deviceStore: app.deviceSettings };
  }

  function effective(current: NativeRunningApp) {
    return effectiveSettingsOf(
      current.engine.getState().rawSettings,
      current.settingsSaver.pending,
      app.deviceSettings.read(),
    );
  }

  return {
    async "settings.open"(): Promise<Result<"settings.open">> {
      const current = running();
      return {
        copy: buildSettingsCopy(),
        view: settingsViewOf(current, { host, app }),
        save: settingsSaveViewOf(current),
      };
    },

    async "settings.change"(params): Promise<Result<"settings.change">> {
      const key = oneOf(params, "key", SETTING_KEYS);
      const raw = stringParam(params, "value");
      const value = SETTINGS_SCHEMA[key].parse(
        key === "typeToStart" ? booleanString(raw) : raw,
      );
      if (value === undefined) throw invalidParams();
      const current = running();
      changeSettings(
        actionsDeps(current),
        { [key]: value },
        effective(current).scopes,
      );
      settings.refresh();
      return {};
    },

    async "settings.setScope"(params): Promise<Result<"settings.setScope">> {
      const key = oneOf(params, "key", SCOPED_SETTING_KEYS);
      const scope = oneOf(params, "scope", ["synced", "device"] as const);
      const current = running();
      changeSettingScope(
        actionsDeps(current),
        key,
        scope,
        effective(current),
        syncedRawSettings(
          current.engine.getState().rawSettings,
          current.settingsSaver.pending,
        ),
      );
      settings.refresh();
      return {};
    },

    async "settings.retry"(): Promise<Result<"settings.retry">> {
      running().engine.retryNow();
      return {};
    },

    async "settings.flush"(): Promise<Result<"settings.flush">> {
      running().settingsSaver.flush();
      return {};
    },

    async "device.setName"(params): Promise<Result<"device.setName">> {
      const name = params.name === null ? null : stringParam(params, "name");
      app.deviceSettings.writeDeviceName(name);
      settings.refresh();
      return { name: nativeDeviceName(app.deviceSettings, app.deviceModel) };
    },

    async "lastView.setEnabled"(
      params,
    ): Promise<Result<"lastView.setEnabled">> {
      const enabled = booleanParam(params, "enabled");
      if (!isRecord(params.view)) throw invalidParams();
      const view = lastViewParam(params.view);
      writeReopenLastViewOff(!enabled, host.deviceSettings);
      app.lastView()?.setEnabled(enabled, view);
      settings.refresh();
      return {};
    },

    async "analytics.setCounted"(
      params,
    ): Promise<Result<"analytics.setCounted">> {
      const counted = booleanParam(params, "counted");
      writeAnalyticsOptOut(!counted, host.deviceSettings);
      settings.refresh();
      return {};
    },
  };
}
