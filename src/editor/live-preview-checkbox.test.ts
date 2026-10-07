// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  createMarkdownEditor,
  type MarkdownEditor,
} from "./create-markdown-editor";
import { livePreview } from "./live-preview";

interface Setup {
  readonly editor: MarkdownEditor;
  readonly parent: HTMLElement;
  readonly changes: string[];
}

let current: Setup | null = null;

function setup(readOnly: boolean, text: string = "- [ ] task"): Setup {
  const changes: string[] = [];
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const editor = createMarkdownEditor({
    parent,
    text,
    readOnly,
    onChange: (next) => changes.push(next),
    extensions: [livePreview()],
  });
  editor.view.dispatch({ selection: { anchor: text.length } });
  current = { editor, parent, changes };
  return current;
}

function checkbox(parent: HTMLElement): HTMLInputElement {
  const input = parent.querySelector<HTMLInputElement>(
    ".cm-task-checkbox input",
  );
  if (!input) throw new Error("checkbox not rendered");
  return input;
}

function mousedown(target: HTMLElement, button: number = 0): Event {
  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button,
  });
  target.dispatchEvent(event);
  return event;
}

function touchstart(target: HTMLElement): Event {
  const event =
    typeof TouchEvent === "function"
      ? new TouchEvent("touchstart", { bubbles: true, cancelable: true })
      : new Event("touchstart", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  current?.editor.destroy();
  current?.parent.remove();
  current = null;
});

describe("livePreview task checkbox", () => {
  it("toggles the task marker on mousedown, and back, without moving the selection", () => {
    const { editor, parent, changes } = setup(false);
    const selectionBefore = editor.view.state.selection.main;

    const first = mousedown(checkbox(parent));
    expect(first.defaultPrevented).toBe(true);
    expect(editor.view.state.doc.toString()).toBe("- [x] task");
    expect(changes).toEqual(["- [x] task"]);
    expect(checkbox(parent).checked).toBe(true);

    mousedown(checkbox(parent));
    expect(editor.view.state.doc.toString()).toBe("- [ ] task");
    expect(changes).toEqual(["- [x] task", "- [ ] task"]);
    expect(editor.view.state.selection.main.eq(selectionBefore)).toBe(true);
  });

  it("toggles the task marker on touchstart without moving the selection", () => {
    const { editor, parent, changes } = setup(false);
    const selectionBefore = editor.view.state.selection.main;

    const event = touchstart(checkbox(parent));

    expect(event.defaultPrevented).toBe(true);
    expect(editor.view.state.doc.toString()).toBe("- [x] task");
    expect(changes).toEqual(["- [x] task"]);
    expect(editor.view.state.selection.main.eq(selectionBefore)).toBe(true);
  });

  it("does not toggle a second time on the click that follows a mousedown", () => {
    const { editor, parent, changes } = setup(false);
    const input = checkbox(parent);

    mousedown(input);
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      detail: 1,
    });
    input.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(editor.view.state.doc.toString()).toBe("- [x] task");
    expect(changes).toEqual(["- [x] task"]);
  });

  it("leaves the document unchanged when the editor is read-only", () => {
    const { editor, parent, changes } = setup(true);

    mousedown(checkbox(parent));
    touchstart(checkbox(parent));

    expect(editor.view.state.doc.toString()).toBe("- [ ] task");
    expect(changes).toEqual([]);
  });

  it("does not toggle on a non-primary mouse button", () => {
    const { editor, parent, changes } = setup(false);
    const selectionBefore = editor.view.state.selection.main;

    const event = mousedown(checkbox(parent), 2);

    expect(event.defaultPrevented).toBe(false);
    expect(editor.view.state.doc.toString()).toBe("- [ ] task");
    expect(changes).toEqual([]);
    expect(editor.view.state.selection.main.eq(selectionBefore)).toBe(true);
    expect(checkbox(parent).checked).toBe(false);
  });

  it("toggles once on a keyboard-originated click", () => {
    const { editor, parent, changes } = setup(false);

    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      detail: 0,
    });
    checkbox(parent).dispatchEvent(click);

    expect(editor.view.state.doc.toString()).toBe("- [x] task");
    expect(changes).toEqual(["- [x] task"]);
  });

  it("names the checkbox after the task text", () => {
    const { parent } = setup(false, "- [ ]   Buy milk  ");
    expect(checkbox(parent).getAttribute("aria-label")).toBe("Task: Buy milk");
  });

  it("names the checkbox plainly when the task has no text", () => {
    const { parent } = setup(false, "- [ ] ");
    expect(checkbox(parent).getAttribute("aria-label")).toBe("Task");
  });

  it("disables the checkbox when read-only, including after reconfiguring", () => {
    const { editor, parent } = setup(true);
    expect(checkbox(parent).disabled).toBe(true);

    editor.setReadOnly(false);
    expect(checkbox(parent).disabled).toBe(false);

    editor.setReadOnly(true);
    expect(checkbox(parent).disabled).toBe(true);
  });

  it("keeps the same input element across a toggle", () => {
    const { parent } = setup(false);
    const input = checkbox(parent);

    mousedown(input);

    expect(checkbox(parent)).toBe(input);
    expect(input.checked).toBe(true);
    expect(input.getAttribute("aria-label")).toBe("Task: task");
  });
});
