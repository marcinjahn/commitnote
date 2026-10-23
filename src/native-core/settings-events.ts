import type { AppSession, StartedApp } from "./app-session";
import type { EmitCoreEvent } from "./commands/command-context";
import type { HostServices } from "./host-services";
import { settingsSaveViewOf, settingsViewOf } from "./settings-view";

export interface SettingsEvents {
  refresh(): void;
  dispose(): void;
}

export function createSettingsEvents(options: {
  readonly host: HostServices;
  readonly app: AppSession;
  readonly emit: EmitCoreEvent;
}): SettingsEvents {
  const { host, app, emit } = options;
  let active: StartedApp | null = null;
  let viewKey: string | null = null;
  let saveKey: string | null = null;

  function refresh(): void {
    const running = active;
    if (running === null || running.engine.getState().synced === null) return;
    const view = settingsViewOf(running, { host, app });
    const nextViewKey = JSON.stringify(view);
    if (nextViewKey !== viewKey) {
      viewKey = nextViewKey;
      emit("settingsChanged", { view });
    }
    const save = settingsSaveViewOf(running);
    const nextSaveKey = JSON.stringify(save);
    if (nextSaveKey !== saveKey) {
      saveKey = nextSaveKey;
      emit("settingsSaveChanged", { save });
    }
  }

  const stopStarts = app.onAppStarted((started) => {
    active = started;
    viewKey = null;
    saveKey = null;
    const stopEngine = started.engine.subscribe(refresh);
    const stopSaver = started.settingsSaver.subscribe(refresh);
    return () => {
      stopEngine();
      stopSaver();
      if (active !== started) return;
      active = null;
      viewKey = null;
      saveKey = null;
    };
  });
  const stopDevice = app.deviceSettings.subscribe(refresh);

  return {
    refresh,
    dispose() {
      stopStarts();
      stopDevice();
      active = null;
    },
  };
}
