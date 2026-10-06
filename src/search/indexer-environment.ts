export interface IndexerEnvironment {
  isHidden(): boolean;
  isOnline(): boolean;
  subscribe(listener: () => void): () => void;
}

export function createBrowserIndexerEnvironment(): IndexerEnvironment {
  return {
    isHidden: () => document.visibilityState === "hidden",
    isOnline: () => navigator.onLine,
    subscribe(listener: () => void): () => void {
      const handler = (): void => listener();
      document.addEventListener("visibilitychange", handler);
      window.addEventListener("online", handler);
      window.addEventListener("offline", handler);
      return () => {
        document.removeEventListener("visibilitychange", handler);
        window.removeEventListener("online", handler);
        window.removeEventListener("offline", handler);
      };
    },
  };
}
