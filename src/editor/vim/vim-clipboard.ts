import { Vim, getCM } from "@replit/codemirror-vim";
import type { EditorView } from "@codemirror/view";

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
  failed: boolean;
}

const CLIPBOARD_ALIASES = new Set(["+", "*"]);
const DENIED_MESSAGE = "Clipboard access denied, pasting from the Vim register";

interface ClipboardSync {
  lastWritten: ClipboardEntry | null;
  readsDenied: boolean;
}

let pendingPastes = 0;
let pasteQueue: Promise<void> = Promise.resolve();
const syncs = new WeakMap<RegisterController, ClipboardSync>();

const systemClipboard = (): Clipboard | undefined =>
  typeof navigator === "undefined" ? undefined : navigator.clipboard;

const unalias = (name: string | null | undefined) =>
  name && CLIPBOARD_ALIASES.has(name) ? undefined : name;

const normalize = (text: string): string => text.replace(/\r\n?/g, "\n");

function writeClipboard(sync: ClipboardSync, register: Register): void {
  const entry: ClipboardEntry = {
    text: register.toString(),
    linewise: register.linewise,
    blockwise: register.blockwise,
    failed: false,
  };
  sync.lastWritten = entry;
  const clipboard = systemClipboard();
  if (typeof clipboard?.writeText !== "function") {
    entry.failed = true;
    return;
  }
  clipboard.writeText(entry.text).catch(() => {
    entry.failed = true;
  });
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
  const sync: ClipboardSync = { lastWritten: null, readsDenied: false };
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
    sync.lastWritten?.failed ||
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

function adoptClipboardText(controller: RegisterController, text: string) {
  const sync = syncOf(controller);
  const known = sync.lastWritten?.text === text ? sync.lastWritten : null;
  const linewise = known ? known.linewise : text.endsWith("\n");
  const blockwise = known ? known.blockwise : false;
  controller.unnamedRegister.setText(text, linewise, blockwise);
  if (!known) sync.lastWritten = { text, linewise, blockwise, failed: false };
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
  if (!fromClipboard && pendingPastes === 0) {
    runPaste(this, cm, args, vim, controller.getRegister(name));
    return;
  }
  pendingPastes++;
  pasteQueue = pasteQueue
    .then(async () => {
      const text = fromClipboard ? await readClipboard(sync, cm) : null;
      if (!stillAttached(cm)) return;
      const current = Vim.getRegisterController();
      if (text !== null) adoptClipboardText(current, text);
      runPaste(
        this,
        cm,
        args,
        cm.state.vim ?? vim,
        fromClipboard ? current.unnamedRegister : current.getRegister(name),
      );
    })
    .catch(() => {})
    .finally(() => {
      pendingPastes--;
    });
}

let pasteDefined = false;

export function useSystemClipboard(): void {
  syncOf(Vim.getRegisterController());
  if (pasteDefined) return;
  pasteDefined = true;
  Vim.defineAction("paste", paste);
}
