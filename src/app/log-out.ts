import type { FlushResult, SyncEngine } from "../sync/sync-engine";

export async function flushBeforeLogOut(running: {
  readonly settingsSaver: { flush(): void };
  readonly engine: Pick<SyncEngine, "flush">;
}): Promise<FlushResult> {
  running.settingsSaver.flush();
  return await running.engine.flush();
}
