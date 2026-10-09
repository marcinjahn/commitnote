import type { StorageLike } from "../session/session-store";
import { isStandalone } from "./display-mode";
import {
  readInstallBarDismissed,
  writeInstallBarDismissed,
} from "./install-bar-dismissal";
import type { InstallEvents } from "./install-events";
import {
  installOffer,
  isIosDevice,
  type InstallBarVariant,
  type InstallPath,
} from "./install-offer";

export interface InstallEnvironment {
  coarsePointer: boolean;
  browserDisplayMode: boolean;
  standalone: boolean;
  ios: boolean;
}

export interface InstallState {
  bar: InstallBarVariant;
  command: InstallPath | null;
  howToOpen: boolean;
}

export interface InstallController {
  getState(): InstallState;
  subscribe(listener: (state: InstallState) => void): () => void;
  install(): Promise<void>;
  dismiss(): void;
  closeHowTo(): void;
}

export interface InstallControllerDeps {
  environment: InstallEnvironment;
  events: Pick<
    InstallEvents,
    "deferredPrompt" | "installed" | "takePrompt" | "subscribe"
  >;
  storage?: StorageLike | null;
}

export function createInstallController(
  deps: InstallControllerDeps,
): InstallController {
  const { environment, events, storage } = deps;
  const listeners = new Set<(state: InstallState) => void>();
  let dismissed = readInstallBarDismissed(storage);
  let howToOpen = false;

  function getState(): InstallState {
    return {
      ...installOffer({
        ...environment,
        deferredPrompt: events.deferredPrompt() !== null,
        dismissed,
        installed: events.installed(),
      }),
      howToOpen,
    };
  }

  function notify(): void {
    const state = getState();
    for (const listener of [...listeners]) listener(state);
  }

  function dismiss(): void {
    writeInstallBarDismissed(storage);
    if (dismissed) return;
    dismissed = true;
    notify();
  }

  async function promptInstall(): Promise<void> {
    const prompt = events.takePrompt();
    if (!prompt) return;
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "dismissed") dismiss();
    } catch {
      return;
    }
  }

  return {
    getState,
    subscribe(listener) {
      listeners.add(listener);
      const unsubscribeEvents = events.subscribe(notify);
      return () => {
        listeners.delete(listener);
        unsubscribeEvents();
      };
    },
    async install() {
      const { command } = getState();
      if (command === "prompt") {
        await promptInstall();
      } else if (command === "ios") {
        howToOpen = true;
        notify();
      }
    },
    dismiss,
    closeHowTo() {
      if (!howToOpen) return;
      howToOpen = false;
      notify();
    },
  };
}

export function createBrowserInstallController(
  events: InstallEvents,
): InstallController {
  return createInstallController({
    environment: {
      coarsePointer: matchMedia("(pointer: coarse)").matches,
      browserDisplayMode: matchMedia("(display-mode: browser)").matches,
      standalone: isStandalone({
        matchMedia: (query) => window.matchMedia(query),
        navigator: navigator as { standalone?: boolean },
      }),
      ios: isIosDevice({
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
      }),
    },
    events,
    storage: undefined,
  });
}
