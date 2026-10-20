import { clearNoteFragment } from "./note-navigation";
import { requestPersistentStorage } from "./persistent-storage";
import { shareLinkBase } from "../share/share-link";

export interface ConnectivityPort {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

export interface VisibilityPort {
  isVisible(): boolean;
  subscribe(listener: (visible: boolean) => void): () => void;
}

export interface PersistentStoragePort {
  request(): Promise<void>;
}

export interface NavigationPort {
  shareLinkBase(): string;
  clearNoteFragment(): void;
}

export interface PlatformPorts {
  connectivity: ConnectivityPort;
  visibility: VisibilityPort;
  persistentStorage: PersistentStoragePort | null;
  navigation: NavigationPort;
}

export function createBrowserPlatformPorts(): PlatformPorts {
  return {
    connectivity: {
      isOnline: () => navigator.onLine,
      subscribe(listener) {
        const onOnline = (): void => listener(true);
        const onOffline = (): void => listener(false);
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        return () => {
          window.removeEventListener("online", onOnline);
          window.removeEventListener("offline", onOffline);
        };
      },
    },
    visibility: {
      isVisible: () => document.visibilityState === "visible",
      subscribe(listener) {
        const handler = (): void => listener(document.visibilityState === "visible");
        document.addEventListener("visibilitychange", handler);
        return () => document.removeEventListener("visibilitychange", handler);
      },
    },
    persistentStorage: {
      request: () => requestPersistentStorage(navigator.storage),
    },
    navigation: {
      shareLinkBase: () => shareLinkBase(location, __DESKTOP_SHELL__),
      clearNoteFragment: () => clearNoteFragment(window.history, window.location),
    },
  };
}
