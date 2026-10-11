// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openExternal, resetExternalOpener } from "../app/external-open";
import { createLaunchActions, type LaunchAction } from "../app/launch-action";
import { DESKTOP_LAUNCH_ACTION_EVENT } from "./desktop-launch-actions";
import type { DesktopCloseGuardDeps } from "./desktop-shell-types";

const tauri = vi.hoisted(() => {
  type CloseHandler = (event: { preventDefault(): void }) => void;
  const state = {
    closeHandler: null as CloseHandler | null,
    eventHandlers: new Map<string, (event: { payload: unknown }) => void>(),
  };
  const unlistenClose = vi.fn();
  const window = {
    destroy: vi.fn(async () => {}),
    onCloseRequested: vi.fn(async (handler: CloseHandler) => {
      state.closeHandler = handler;
      return unlistenClose;
    }),
  };
  return {
    state,
    window,
    unlistenClose,
    listen: vi.fn(
      async (name: string, handler: (event: { payload: unknown }) => void) => {
        state.eventHandlers.set(name, handler);
        return () => state.eventHandlers.delete(name);
      },
    ),
    ask: vi.fn(async () => false),
    save: vi.fn(async (): Promise<string | null> => null),
    writeFile: vi.fn(async () => {}),
    openUrl: vi.fn(async () => {}),
    downloadDir: vi.fn(async () => "/home/me/Downloads"),
    homeDir: vi.fn(async () => "/home/me"),
    join: vi.fn(async (...parts: string[]) => parts.join("/")),
  };
});

vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));
vi.mock("@tauri-apps/api/path", () => ({
  downloadDir: tauri.downloadDir,
  homeDir: tauri.homeDir,
  join: tauri.join,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => tauri.window,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: tauri.ask,
  save: tauri.save,
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: tauri.writeFile }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: tauri.openUrl }));

const { startDesktopShell } = await import("./desktop-shell");

function guardDeps(
  overrides: Partial<DesktopCloseGuardDeps> = {},
): DesktopCloseGuardDeps {
  return {
    hasUnsaved: () => false,
    flush: vi.fn(),
    onUnsavedChange: () => () => {},
    hasSettledUnsaved: () => false,
    ...overrides,
  };
}

async function requestClose() {
  const preventDefault = vi.fn();
  tauri.state.closeHandler?.({ preventDefault });
  await vi.waitFor(() => expect(tauri.window.destroy).toHaveBeenCalled());
  return preventDefault;
}

beforeEach(() => {
  vi.clearAllMocks();
  tauri.state.closeHandler = null;
  tauri.state.eventHandlers.clear();
});

afterEach(() => {
  resetExternalOpener();
});

describe("startDesktopShell", () => {
  it("opens external URLs through the system opener", async () => {
    await startDesktopShell({ launchActions: null });

    openExternal("https://example.com/");

    expect(tauri.openUrl).toHaveBeenCalledWith("https://example.com/");
  });

  it("forwards desktop launch action events to the launch actions", async () => {
    const launchActions = createLaunchActions();
    const delivered: LaunchAction[] = [];
    launchActions.attach((action) => delivered.push(action));

    await startDesktopShell({ launchActions });
    tauri.state.eventHandlers.get(DESKTOP_LAUNCH_ACTION_EVENT)?.({
      payload: "search",
    });

    expect(delivered).toEqual(["search"]);
  });

  it("does not listen for launch actions without launch actions", async () => {
    await startDesktopShell({ launchActions: null });

    expect(tauri.listen).not.toHaveBeenCalled();
  });

  it("saves exports through the native save dialog", async () => {
    tauri.save.mockResolvedValueOnce("/home/me/notes.zip");
    const shell = await startDesktopShell({ launchActions: null });

    const result = await shell.download(
      new File([new Uint8Array([1, 2, 3])], "notes.zip"),
    );

    expect(result).toBe("downloaded");
    expect(tauri.save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "/home/me/Downloads/notes.zip" }),
    );
    expect(tauri.writeFile).toHaveBeenCalledWith(
      "/home/me/notes.zip",
      new Uint8Array([1, 2, 3]),
    );
  });

  it("suggests the home folder when there is no downloads folder", async () => {
    tauri.downloadDir.mockRejectedValueOnce(new Error("unknown path"));
    const shell = await startDesktopShell({ launchActions: null });

    await shell.download(new File([], "notes.zip"));

    expect(tauri.save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "/home/me/notes.zip" }),
    );
  });

  it("reports a cancelled save dialog", async () => {
    const shell = await startDesktopShell({ launchActions: null });

    const result = await shell.download(new File([], "notes.zip"));

    expect(result).toBe("cancelled");
    expect(tauri.writeFile).not.toHaveBeenCalled();
  });
});

describe("installCloseGuard", () => {
  it("prevents the default close and destroys a clean window", async () => {
    const shell = await startDesktopShell({ launchActions: null });
    shell.installCloseGuard(guardDeps());
    await vi.waitFor(() => expect(tauri.state.closeHandler).not.toBeNull());

    const preventDefault = await requestClose();

    expect(preventDefault).toHaveBeenCalled();
    expect(tauri.window.destroy).toHaveBeenCalledTimes(1);
  });

  it("asks before quitting with unsaved changes and keeps the window on cancel", async () => {
    const shell = await startDesktopShell({ launchActions: null });
    shell.installCloseGuard(
      guardDeps({ hasUnsaved: () => true, hasSettledUnsaved: () => true }),
    );
    await vi.waitFor(() => expect(tauri.state.closeHandler).not.toBeNull());

    tauri.state.closeHandler?.({ preventDefault: vi.fn() });

    await vi.waitFor(() => expect(tauri.ask).toHaveBeenCalled());
    expect(tauri.window.destroy).not.toHaveBeenCalled();
  });

  it("keeps the window when the quit dialog fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    tauri.ask.mockRejectedValueOnce(new Error("no dialog"));
    const shell = await startDesktopShell({ launchActions: null });
    shell.installCloseGuard(
      guardDeps({ hasUnsaved: () => true, hasSettledUnsaved: () => true }),
    );
    await vi.waitFor(() => expect(tauri.state.closeHandler).not.toBeNull());

    tauri.state.closeHandler?.({ preventDefault: vi.fn() });

    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(tauri.window.destroy).not.toHaveBeenCalled();
  });

  it("unlistens on disposal", async () => {
    const shell = await startDesktopShell({ launchActions: null });
    const dispose = shell.installCloseGuard(guardDeps());
    await vi.waitFor(() => expect(tauri.state.closeHandler).not.toBeNull());

    dispose();

    expect(tauri.unlistenClose).toHaveBeenCalledTimes(1);
  });

  it("unlistens when disposed before the listener is registered", async () => {
    const shell = await startDesktopShell({ launchActions: null });
    const dispose = shell.installCloseGuard(guardDeps());

    dispose();

    await vi.waitFor(() =>
      expect(tauri.unlistenClose).toHaveBeenCalledTimes(1),
    );
  });
});
