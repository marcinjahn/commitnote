export function isSaveShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): boolean {
  return (
    (event.key === "s" || event.key === "S") &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

export function installSaveShortcut(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  onSave: () => void,
): () => void {
  function handleKeyDown(event: KeyboardEvent): void {
    if (!isSaveShortcut(event)) return;
    event.preventDefault();
    if (!event.repeat) onSave();
  }

  target.addEventListener("keydown", handleKeyDown, true);
  return () => {
    target.removeEventListener("keydown", handleKeyDown, true);
  };
}
