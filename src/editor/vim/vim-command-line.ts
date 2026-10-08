import { Vim, getCM } from "@replit/codemirror-vim";
import type { EditorView } from "@codemirror/view";
import type { CommandLineKind, VimStatusUpdate } from "./vim-status";

type VimAdapter = NonNullable<ReturnType<typeof getCM>>;

type CloseDialog = (newVal?: string) => void;

interface DialogOptions {
  readonly value?: string;
  readonly closeOnEnter?: boolean;
  readonly onKeyDown?: (
    event: KeyboardEvent,
    value: string,
    close: CloseDialog,
  ) => boolean | void;
  readonly onKeyUp?: (
    event: KeyboardEvent,
    value: string,
    close: CloseDialog,
  ) => void;
  readonly onInput?: (event: Event, value: string, close: CloseDialog) => void;
  readonly onClose?: (dialog: Element) => void;
}

interface NotificationOptions {
  readonly duration?: number;
}

interface Prompt {
  readonly kind: CommandLineKind;
  readonly callback: ((value: string) => void) | undefined;
  readonly options: DialogOptions;
  readonly close: CloseDialog;
  value: string;
  closed: boolean;
}

const KINDS: readonly CommandLineKind[] = [":", "/", "?"];

// The plugin paints every notification red; listings (duration 0) and short
// confirmations such as "3 lines yanked" are informational.
const ERROR_MIN_DURATION = 5000;

let lastMessageId = 0;

function messageText(node: Node): string {
  if (!(node instanceof Element)) return node.textContent ?? "";
  const nodes = Array.from(node.childNodes);
  return nodes.some(
    (child) => child instanceof Element && child.tagName === "DIV",
  )
    ? nodes.map(messageText).join("\n")
    : (node.textContent ?? "");
}

function isError(template: Node, options: NotificationOptions): boolean {
  const duration = options.duration ?? ERROR_MIN_DURATION;
  return (
    template instanceof HTMLElement &&
    template.style.color === "red" &&
    duration >= ERROR_MIN_DURATION
  );
}

class CommandLineController {
  private prompt: Prompt | null = null;
  private messageId: number | null = null;
  private messageJustShown = false;
  private detached = false;
  private readonly onKeypress = () => {
    if (!this.messageJustShown) this.dismissMessage();
  };

  constructor(
    private readonly view: EditorView,
    private readonly cm: VimAdapter,
    private readonly publish: (update: VimStatusUpdate) => void,
  ) {
    cm.openDialog = (template, callback, options) =>
      this.openDialog(template, callback, options ?? {});
    cm.openNotification = (template, options) =>
      this.openNotification(template, options ?? {});
    cm.on("vim-keypress", this.onKeypress);
  }

  private update(update: VimStatusUpdate): void {
    if (!this.detached) this.publish(update);
  }

  private openDialog(
    template: Element,
    callback: Function | undefined,
    options: DialogOptions,
  ): CloseDialog {
    this.dismissMessage();
    if (!template.querySelector("input")) {
      let closed = false;
      return (newVal) => {
        if (closed || typeof newVal === "string") return;
        closed = true;
        options.onClose?.(template);
      };
    }
    if (this.prompt) this.prompt.closed = true;
    const text = (template.textContent ?? "").trim();
    const kind = KINDS.find((candidate) => text.startsWith(candidate));
    const prompt: Prompt = {
      kind: kind ?? ":",
      callback: callback as Prompt["callback"],
      options,
      value: options.value ?? "",
      closed: false,
      close: (newVal) => {
        if (typeof newVal === "string") {
          if (prompt.closed || this.prompt !== prompt) return;
          prompt.value = newVal;
          this.update({ commandLine: { kind: prompt.kind, value: newVal } });
          return;
        }
        if (prompt.closed) return;
        prompt.closed = true;
        if (this.prompt === prompt) {
          this.prompt = null;
          this.update({ commandLine: null });
          if (!this.detached) this.view.focus();
        }
        options.onClose?.(template);
      },
    };
    this.prompt = prompt;
    this.update({ commandLine: { kind: prompt.kind, value: prompt.value } });
    if (!kind) this.showMessage(text, false);
    return prompt.close;
  }

  private openNotification(
    template: Node,
    options: NotificationOptions,
  ): () => void {
    const id = this.showMessage(
      messageText(template),
      isError(template, options),
    );
    return () => {
      if (this.messageId === id) this.dismissMessage();
    };
  }

  showMessage(text: string, error: boolean): number {
    const id = ++lastMessageId;
    this.messageId = id;
    this.messageJustShown = true;
    queueMicrotask(() => {
      this.messageJustShown = false;
    });
    this.update({ message: { text, error, id } });
    return id;
  }

  private dismissMessage(): void {
    if (this.messageId === null) return;
    this.messageId = null;
    this.update({ message: null });
  }

  keyDown(event: KeyboardEvent, value: string): void {
    const prompt = this.prompt;
    if (!prompt || event.isComposing) return;
    if (prompt.options.onKeyDown?.(event, value, prompt.close)) return;
    const enter = event.key === "Enter";
    if (enter) prompt.callback?.(value);
    if (
      event.key === "Escape" ||
      (enter && prompt.options.closeOnEnter !== false)
    ) {
      event.preventDefault();
      event.stopPropagation();
      prompt.close();
    }
  }

  keyUp(event: KeyboardEvent, value: string): void {
    const prompt = this.prompt;
    if (prompt) prompt.options.onKeyUp?.(event, value, prompt.close);
  }

  input(event: Event, value: string): void {
    const prompt = this.prompt;
    if (!prompt) return;
    if (prompt.value !== value) {
      prompt.value = value;
      this.update({ commandLine: { kind: prompt.kind, value } });
    }
    prompt.options.onInput?.(event, value, prompt.close);
  }

  cancel(): void {
    this.prompt?.close();
  }

  isOpen(): boolean {
    return this.prompt !== null;
  }

  discard(): void {
    if (this.prompt) this.prompt.closed = true;
    this.prompt = null;
    this.messageId = null;
  }

  detach(): void {
    this.detached = true;
    this.discard();
    this.cm.off("vim-keypress", this.onKeypress);
    const instance = this.cm as Partial<
      Pick<VimAdapter, "openDialog" | "openNotification">
    >;
    delete instance.openDialog;
    delete instance.openNotification;
  }
}

const controllers = new WeakMap<EditorView, CommandLineController>();

export function adoptVimDialogs(
  view: EditorView,
  cm: VimAdapter,
  publish: (update: VimStatusUpdate) => void,
): () => void {
  const controller = new CommandLineController(view, cm, publish);
  controllers.set(view, controller);
  return () => {
    controller.detach();
    if (controllers.get(view) === controller) controllers.delete(view);
  };
}

export function discardCommandLine(view: EditorView): void {
  controllers.get(view)?.discard();
}

export function showVimMessage(
  view: EditorView,
  text: string,
  error: boolean,
): void {
  controllers.get(view)?.showMessage(text, error);
}

export function openCommandLine(view: EditorView, kind: CommandLineKind): void {
  const cm = getCM(view);
  const controller = controllers.get(view);
  if (!cm || !controller) return;
  if (controller.isOpen()) controller.cancel();
  const vim = cm.state.vim;
  if (!vim) return;
  const { inputState } = vim;
  if (
    vim.insertMode ||
    (!vim.visualMode && (inputState.operator || inputState.keyBuffer.length))
  )
    Vim.handleKey(cm, "<Esc>", "user");
  Vim.handleKey(cm, kind, "user");
}

export function commandLineKeyDown(
  view: EditorView,
  event: KeyboardEvent,
  value: string,
): void {
  controllers.get(view)?.keyDown(event, value);
}

export function commandLineKeyUp(
  view: EditorView,
  event: KeyboardEvent,
  value: string,
): void {
  controllers.get(view)?.keyUp(event, value);
}

export function commandLineInput(
  view: EditorView,
  event: Event,
  value: string,
): void {
  controllers.get(view)?.input(event, value);
}

export function closeCommandLine(view: EditorView): void {
  controllers.get(view)?.cancel();
}
