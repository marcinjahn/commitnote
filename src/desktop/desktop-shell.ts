import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { setExternalOpener } from "../app/external-open";
import type { LaunchActions } from "../app/launch-action";
import { createCloseGuard } from "./close-guard";
import { createDesktopDownload } from "./desktop-download";
import {
  DESKTOP_LAUNCH_ACTION_EVENT,
  forwardDesktopLaunchActions,
} from "./desktop-launch-actions";
import type { DesktopCloseGuardDeps, DesktopShell } from "./desktop-shell-types";
import { interceptExternalLinks } from "./external-links";

const QUIT_WITH_UNSAVED_MESSAGE =
  "commitnote has unsaved changes that could not be saved. Quit anyway?";

function openInBrowser(url: string): void {
  openUrl(url).catch((error: unknown) => console.error(error));
}

async function confirmQuit(): Promise<boolean> {
  try {
    return await ask(QUIT_WITH_UNSAVED_MESSAGE, {
      title: "commitnote",
      kind: "warning",
      okLabel: "Quit",
      cancelLabel: "Cancel",
    });
  } catch (error) {
    console.error(error);
    return false;
  }
}

function installCloseGuard(deps: DesktopCloseGuardDeps): () => void {
  const window = getCurrentWindow();
  const guard = createCloseGuard({
    ...deps,
    confirmQuit,
    destroy: () => {
      window.destroy().catch((error: unknown) => console.error(error));
    },
  });
  let disposed = false;
  let unlisten: (() => void) | null = null;
  window
    .onCloseRequested((event) => {
      event.preventDefault();
      guard.requestClose().catch((error: unknown) => console.error(error));
    })
    .then(
      (stop) => {
        if (disposed) stop();
        else unlisten = stop;
      },
      (error: unknown) => console.error(error),
    );
  return () => {
    if (disposed) return;
    disposed = true;
    guard.dispose();
    unlisten?.();
    unlisten = null;
  };
}

export async function startDesktopShell(options: {
  launchActions: LaunchActions | null;
}): Promise<DesktopShell> {
  setExternalOpener(openInBrowser);
  interceptExternalLinks(document, openInBrowser);
  if (options.launchActions !== null) {
    await forwardDesktopLaunchActions(
      (handler) =>
        listen<unknown>(DESKTOP_LAUNCH_ACTION_EVENT, (event) =>
          handler(event.payload),
        ),
      options.launchActions,
    );
  }
  return {
    download: createDesktopDownload({
      save: async (dialogOptions) => (await save(dialogOptions)) ?? null,
      writeFile: (path, bytes) => writeFile(path, bytes),
    }),
    installCloseGuard,
  };
}
