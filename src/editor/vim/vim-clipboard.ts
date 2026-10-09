import { Vim, getCM } from "@replit/codemirror-vim";
import { ViewPlugin, type EditorView } from "@codemirror/view";

type RegisterController = ReturnType<typeof Vim.getRegisterController>;
type Register = RegisterController["unnamedRegister"];
type ActionFn = Parameters<typeof Vim.defineAction>[1];
type ActionCm = Parameters<ActionFn>[0];
type ActionArgs = Parameters<ActionFn>[1];
type VimState = Parameters<ActionFn>[2];

interface VimActions {
  continuePaste(
    cm: ActionCm,
    args: ActionArgs,
    vim: VimState,
    text: string,
    register: Register,
  ): void;
}

interface ClipboardEntry {
  readonly text: string;
  readonly linewise: boolean;
  readonly blockwise: boolean;
}

const CLIPBOARD_ALIASES = new Set(["+", "*"]);
const DENIED_MESSAGE = "Clipboard access denied, pasting from the Vim register";

interface ClipboardSync {
  known: ClipboardEntry | null;
  knownSince: number;
  readsDenied: boolean;
}

let pendingPastes = 0;
let pasteQueue: Promise<void> = Promise.resolve();
let windowLeaves = 0;
const syncs = new WeakMap<RegisterController, ClipboardSync>();

const systemClipboard = (): Clipboard | undefined =>
  typeof navigator === "undefined" ? undefined : navigator.clipboard;

const unalias = (name: string | null | undefined) =>
  name && CLIPBOARD_ALIASES.has(name) ? undefined : name;

const normalize = (text: string): string => text.replace(/\r\n?/g, "\n");

function remember(sync: ClipboardSync, entry: ClipboardEntry): void {
  sync.known = entry;
  sync.knownSince = windowLeaves;
}

function rememberText(sync: ClipboardSync, text: string): ClipboardEntry {
  const known = sync.known?.text === text ? sync.known : null;
  const entry = known ?? {
    text,
    linewise: text.endsWith("\n"),
    blockwise: false,
  };
  remember(sync, entry);
  return entry;
}

const knownClipboard = (sync: ClipboardSync): ClipboardEntry | null =>
  sync.knownSince === windowLeaves ? sync.known : null;

function writeClipboard(sync: ClipboardSync, register: Register): void {
  const text = register.toString();
  remember(sync, {
    text,
    linewise: register.linewise,
    blockwise: register.blockwise,
  });
  systemClipboard()
    ?.writeText?.(text)
    .catch(() => {});
}

function isClipboardBound(
  controller: RegisterController,
  name: string | null | undefined,
  operator: string,
): boolean {
  if (!name || name === '"') return true;
  if (name === "0") return operator === "yank";
  return name !== "_" && !controller.isValidRegister(name);
}

function syncOf(controller: RegisterController): ClipboardSync {
  const existing = syncs.get(controller);
  if (existing) return existing;
  const sync: ClipboardSync = {
    known: null,
    knownSince: -1,
    readsDenied: false,
  };
  syncs.set(controller, sync);
  controller.registers["+"] = controller.unnamedRegister;
  const pushText = controller.pushText.bind(controller);
  controller.pushText = (name, operator, text, linewise, blockwise) => {
    const target = unalias(name);
    pushText(target, operator, text, linewise, blockwise);
    if (isClipboardBound(controller, target, operator))
      writeClipboard(sync, controller.unnamedRegister);
  };
  return sync;
}

function notifyDenied(cm: ActionCm): void {
  const notify = (
    cm as { openNotification?: (template: Node, options: object) => void }
  ).openNotification;
  notify?.call(cm, document.createTextNode(DENIED_MESSAGE), {});
}

async function readClipboard(
  sync: ClipboardSync,
  cm: ActionCm,
): Promise<string | null> {
  const clipboard = systemClipboard();
  if (
    sync.readsDenied ||
    typeof clipboard?.readText !== "function"
  )
    return null;
  try {
    return normalize(await clipboard.readText());
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "NotAllowedError" &&
      document.hasFocus()
    ) {
      sync.readsDenied = true;
      notifyDenied(cm);
    }
    return null;
  }
}

function adoptClipboard(controller: RegisterController, entry: ClipboardEntry) {
  controller.unnamedRegister.setText(entry.text, entry.linewise, entry.blockwise);
}

function runPaste(
  actions: VimActions,
  cm: ActionCm,
  args: ActionArgs,
  vim: VimState,
  register: Register,
): void {
  const controller = Vim.getRegisterController();
  const before = controller.unnamedRegister.toString();
  cm.operation(() => {
    if (cm.curOp) cm.curOp.isVimOp = true;
    actions.continuePaste(cm, args, vim, register.toString(), register);
  });
  if (
    register === controller.unnamedRegister &&
    controller.unnamedRegister.toString() !== before
  )
    writeClipboard(syncOf(controller), controller.unnamedRegister);
}

function stillAttached(cm: ActionCm): boolean {
  const view: EditorView | undefined = cm.cm6;
  return Boolean(view && getCM(view) === cm && cm.state.vim);
}

function paste(
  this: VimActions,
  cm: ActionCm,
  args: ActionArgs,
  vim: VimState,
): void {
  const controller = Vim.getRegisterController();
  const sync = syncOf(controller);
  const name = args.registerName;
  const fromClipboard = isClipboardBound(controller, unalias(name), "paste");
  const known = fromClipboard ? knownClipboard(sync) : null;
  if ((!fromClipboard || known) && pendingPastes === 0) {
    if (known) adoptClipboard(controller, known);
    runPaste(this, cm, args, vim, controller.getRegister(name));
    return;
  }
  pendingPastes++;
  pasteQueue = pasteQueue
    .then(async () => {
      const current = Vim.getRegisterController();
      const currentSync = syncOf(current);
      let entry = fromClipboard ? knownClipboard(currentSync) : null;
      if (fromClipboard && !entry) {
        const text = await readClipboard(currentSync, cm);
        if (text !== null) entry = rememberText(currentSync, text);
      }
      if (!stillAttached(cm)) return;
      if (entry) adoptClipboard(current, entry);
      runPaste(
        this,
        cm,
        args,
        cm.state.vim ?? vim,
        current.getRegister(name),
      );
    })
    .catch(() => {})
    .finally(() => {
      pendingPastes--;
    });
}

function clipboardEventText(event: ClipboardEvent): string {
  const data = event.clipboardData?.getData("text/plain") ?? "";
  if (data || event.type === "paste") return normalize(data);
  if (event.defaultPrevented) return "";
  return normalize(document.getSelection()?.toString() ?? "");
}

function onClipboardEvent(event: ClipboardEvent): void {
  const text = clipboardEventText(event);
  if (text || event.type === "paste")
    rememberText(syncOf(Vim.getRegisterController()), text);
}

function onWindowLeave(): void {
  windowLeaves++;
}

function onVisibilityChange(): void {
  if (document.visibilityState === "hidden") onWindowLeave();
}

let installed = false;

export function useSystemClipboard(): void {
  syncOf(Vim.getRegisterController());
  if (installed) return;
  installed = true;
  Vim.defineAction("paste", paste);
  if (typeof window === "undefined") return;
  window.addEventListener("blur", onWindowLeave);
  document.addEventListener("visibilitychange", onVisibilityChange);
  document.addEventListener("copy", onClipboardEvent);
  document.addEventListener("cut", onClipboardEvent);
  document.addEventListener("paste", onClipboardEvent, true);
}

export const nativePaste = ViewPlugin.define((view) => {
  const onPaste = (event: ClipboardEvent) => {
    const cm = getCM(view);
    if (!cm?.state.vim || cm.state.vim.insertMode) return;
    event.preventDefault();
    event.stopPropagation();
    Vim.handleKey(cm, "p", "user");
  };
  view.dom.addEventListener("paste", onPaste, true);
  return {
    destroy: () => view.dom.removeEventListener("paste", onPaste, true),
  };
});
