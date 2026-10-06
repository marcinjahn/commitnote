export interface ShortcutKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
}

export interface ShortcutContext {
  readonly apple: boolean;
  readonly paletteOpen: boolean;
  readonly otherDialogOpen: boolean;
  readonly editableTarget: boolean;
}

export type ShortcutAction = "open" | "close" | null;

export const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], .cm-editor';

export function classifySearchShortcut(
  event: ShortcutKeyEvent,
  context: ShortcutContext,
): ShortcutAction {
  if (event.isComposing) return null;

  const modifier = context.apple ? event.metaKey : event.ctrlKey;
  const otherModifier = context.apple ? event.ctrlKey : event.metaKey;

  if (event.key === "k" || event.key === "K") {
    if (!modifier || otherModifier || event.altKey || event.shiftKey) return null;
    if (context.paletteOpen) return "close";
    return context.otherDialogOpen ? null : "open";
  }

  if (event.key === "/") {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
    if (context.paletteOpen || context.otherDialogOpen || context.editableTarget) return null;
    return "open";
  }

  return null;
}

export function isApplePlatform(userAgent: string): boolean {
  return /Mac|iPhone|iPad|iPod/.test(userAgent);
}

export function searchShortcutHint(apple: boolean): string {
  return apple ? "⌘K" : "Ctrl K";
}

export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null;
}
