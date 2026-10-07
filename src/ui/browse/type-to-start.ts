export interface TypeToStartKey {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  readonly defaultPrevented: boolean;
  readonly target: EventTarget | null;
}

export interface TypeToStartScene {
  readonly placeholderVisible: boolean;
  readonly engineStopped: boolean;
  readonly dialogOpen: boolean;
  readonly menuOpen: boolean;
  readonly body: Element;
  readonly notePane: Element | null;
}

const INTERACTIVE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="treeitem"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="separator"]',
  '[role="dialog"]',
].join(", ");

function isSingleCodePoint(key: string): boolean {
  return [...key].length === 1;
}

function hasCommandModifier(event: TypeToStartKey): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}

function isValidTarget(target: EventTarget | null, scene: TypeToStartScene): boolean {
  if (target === scene.body) return true;
  if (!(target instanceof Element) || scene.notePane === null) return false;
  return scene.notePane.contains(target) && target.closest(INTERACTIVE_SELECTOR) === null;
}

export function isTypeToStartKey(event: TypeToStartKey, scene: TypeToStartScene): boolean {
  if (
    !scene.placeholderVisible ||
    scene.engineStopped ||
    scene.dialogOpen ||
    scene.menuOpen
  ) {
    return false;
  }
  if (!isValidTarget(event.target, scene)) return false;
  if (hasCommandModifier(event) || event.repeat || event.isComposing || event.defaultPrevented) {
    return false;
  }
  return isSingleCodePoint(event.key) && event.key.trim() !== "";
}

export interface TypeToStartOptions {
  scene(): TypeToStartScene;
  start(): void;
}

export interface TypeToStart {
  drain(): string;
  dispose(): void;
}

export function installTypeToStart(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  options: TypeToStartOptions,
): TypeToStart {
  let buffer: string[] | null = null;

  function handleCapture(rawEvent: Event): void {
    if (buffer === null) return;
    const event = rawEvent as KeyboardEvent;
    if (hasCommandModifier(event) || event.isComposing) return;
    if (isSingleCodePoint(event.key)) {
      buffer.push(event.key);
    } else if (event.key === "Enter") {
      buffer.push("\n");
    } else if (event.key === "Backspace") {
      buffer.pop();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function handleBubble(rawEvent: Event): void {
    const event = rawEvent as KeyboardEvent;
    if (!isTypeToStartKey(event, options.scene())) return;
    event.preventDefault();
    buffer = [event.key];
    options.start();
  }

  target.addEventListener("keydown", handleCapture, true);
  target.addEventListener("keydown", handleBubble);

  return {
    drain() {
      const text = buffer?.join("") ?? "";
      buffer = null;
      return text;
    },
    dispose() {
      target.removeEventListener("keydown", handleCapture, true);
      target.removeEventListener("keydown", handleBubble);
      buffer = null;
    },
  };
}
