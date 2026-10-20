import { createBrowserPlatformPorts, type PlatformPorts } from "../app/platform-ports";

export interface IndexerEnvironment {
  isHidden(): boolean;
  isOnline(): boolean;
  subscribe(listener: () => void): () => void;
}

export function createIndexerEnvironment(
  ports: Pick<PlatformPorts, "connectivity" | "visibility">,
): IndexerEnvironment {
  return {
    isHidden: () => !ports.visibility.isVisible(),
    isOnline: () => ports.connectivity.isOnline(),
    subscribe(listener: () => void): () => void {
      const unsubscribeVisibility = ports.visibility.subscribe(() => listener());
      const unsubscribeConnectivity = ports.connectivity.subscribe(() => listener());
      return () => {
        unsubscribeVisibility();
        unsubscribeConnectivity();
      };
    },
  };
}

export function createBrowserIndexerEnvironment(): IndexerEnvironment {
  return createIndexerEnvironment(createBrowserPlatformPorts());
}
