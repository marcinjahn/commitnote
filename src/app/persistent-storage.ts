export async function requestPersistentStorage(
  storage: Pick<StorageManager, "persist" | "persisted"> | undefined,
): Promise<void> {
  if (storage === undefined || typeof storage.persist !== "function") return;
  try {
    if (typeof storage.persisted === "function" && (await storage.persisted())) {
      return;
    }
    await storage.persist();
  } catch {
    return;
  }
}
