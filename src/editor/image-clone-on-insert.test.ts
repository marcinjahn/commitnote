// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { undo } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import {
  createMarkdownEditor,
  type MarkdownEditor,
} from "./create-markdown-editor";
import {
  type ImageCloning,
  imageCloneExempt,
  imageCloneOnInsert,
  imageCloning,
} from "./image-clone-on-insert";
import type { ImageId } from "../images/image-id";

const FOREIGN = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const OWNED = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const CLONE = "cccccccccccccccccccccccccc";

function ref(imageId: ImageId): string {
  return `![](image:${imageId}#800x600)`;
}

interface Deferred {
  resolve(value: ImageId | null): void;
}

let mounted: MarkdownEditor | null = null;

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.body.innerHTML = "";
});

function setup(
  text: string,
  options: {
    owned?: ImageId[];
    result?: ImageId | null;
    readOnly?: boolean;
  } = {},
) {
  const owned = new Set(options.owned ?? []);
  const pending: Deferred[] = [];
  const clone = vi.fn(
    (_imageId: ImageId) =>
      new Promise<ImageId | null>((resolve) => {
        pending.push({ resolve });
      }),
  );
  const cloning: ImageCloning = {
    owns: (imageId) => owned.has(imageId),
    clone,
  };
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const editor = createMarkdownEditor({
    parent,
    text,
    readOnly: options.readOnly ?? false,
    onChange: () => {},
    extensions: [imageCloneOnInsert(), imageCloning.of(cloning)],
  });
  mounted = editor;
  const view = editor.view;
  return {
    editor,
    view,
    clone,
    text: () => view.state.doc.toString(),
    insert(
      insert: string,
      at = view.state.doc.length,
      userEvent: string | null = "input.paste",
    ) {
      view.dispatch({
        changes: { from: at, insert },
        annotations:
          userEvent === null ? [] : Transaction.userEvent.of(userEvent),
      });
    },
    async resolveAll(
      value: ImageId | null = options.result === undefined
        ? CLONE
        : options.result,
    ) {
      for (const deferred of pending.splice(0)) deferred.resolve(value);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe("imageCloneOnInsert", () => {
  it("rewrites a pasted foreign reference to its clone", async () => {
    const editor = setup("Note\n");
    editor.insert(ref(FOREIGN));
    expect(editor.clone).toHaveBeenCalledTimes(1);
    expect(editor.clone).toHaveBeenCalledWith(FOREIGN);
    await editor.resolveAll();
    expect(editor.text()).toBe(`Note\n${ref(CLONE)}`);
  });

  it("leaves references the note owns untouched", async () => {
    const editor = setup("Note\n", { owned: [OWNED] });
    editor.insert(ref(OWNED));
    await editor.resolveAll();
    expect(editor.clone).not.toHaveBeenCalled();
    expect(editor.text()).toBe(`Note\n${ref(OWNED)}`);
  });

  it("leaves a reference duplicated within the note untouched", async () => {
    const editor = setup(`${ref(FOREIGN)}\n`);
    editor.insert(ref(FOREIGN));
    await editor.resolveAll();
    expect(editor.clone).not.toHaveBeenCalled();
    expect(editor.text()).toBe(`${ref(FOREIGN)}\n${ref(FOREIGN)}`);
  });

  it("leaves a reference restored by undo untouched", async () => {
    const editor = setup(`Note ${ref(FOREIGN)}`);
    editor.view.dispatch({
      changes: { from: 5, to: editor.view.state.doc.length },
      annotations: Transaction.userEvent.of("delete"),
    });
    expect(editor.text()).toBe("Note ");
    undo(editor.view);
    await editor.resolveAll();
    expect(editor.clone).not.toHaveBeenCalled();
    expect(editor.text()).toBe(`Note ${ref(FOREIGN)}`);
  });

  it("ignores programmatic set transactions", async () => {
    const editor = setup("Note");
    editor.insert(ref(FOREIGN), 4, "set");
    editor.view.dispatch({
      changes: { from: 0, to: editor.view.state.doc.length, insert: "" },
      annotations: Transaction.userEvent.of("set"),
    });
    await editor.resolveAll();
    expect(editor.clone).not.toHaveBeenCalled();
  });

  it("ignores setText and updateText", async () => {
    const harness = setup("Note");
    harness.editor.setText(ref(FOREIGN));
    harness.editor.updateText(`${ref(FOREIGN)}\n${ref(OWNED)}`);
    await harness.resolveAll();
    expect(harness.clone).not.toHaveBeenCalled();
    expect(harness.text()).toBe(`${ref(FOREIGN)}\n${ref(OWNED)}`);
  });

  it("does nothing in a read-only editor", async () => {
    const editor = setup("Note", { readOnly: true });
    editor.insert(ref(FOREIGN));
    await editor.resolveAll();
    expect(editor.clone).not.toHaveBeenCalled();
    expect(editor.text()).toBe(`Note${ref(FOREIGN)}`);
  });

  it("ignores exempt transactions", async () => {
    const editor = setup("Note");
    editor.view.dispatch({
      changes: { from: 4, insert: ref(FOREIGN) },
      annotations: [
        Transaction.userEvent.of("input.paste"),
        imageCloneExempt.of(true),
      ],
    });
    await editor.resolveAll();
    expect(editor.clone).not.toHaveBeenCalled();
    expect(editor.text()).toBe(`Note${ref(FOREIGN)}`);
  });

  it("clones a repeated foreign id once and rewrites every copy", async () => {
    const editor = setup("");
    editor.insert(`${ref(FOREIGN)}\n${ref(FOREIGN)}`);
    expect(editor.clone).toHaveBeenCalledTimes(1);
    await editor.resolveAll();
    expect(editor.text()).toBe(`${ref(CLONE)}\n${ref(CLONE)}`);
  });

  it("skips a reference removed before the clone resolves", async () => {
    const editor = setup("Note\n");
    editor.insert(ref(FOREIGN));
    editor.view.dispatch({
      changes: { from: 5, to: editor.view.state.doc.length, insert: "gone" },
      annotations: Transaction.userEvent.of("input.type"),
    });
    await editor.resolveAll();
    expect(editor.text()).toBe("Note\ngone");
  });

  it("follows the reference through edits made before the clone resolves", async () => {
    const editor = setup("Note\n");
    editor.insert(ref(FOREIGN));
    editor.insert("Title ", 0, "input.type");
    await editor.resolveAll();
    expect(editor.text()).toBe(`Title Note\n${ref(CLONE)}`);
    undo(editor.view);
    expect(editor.text()).toBe(`Note\n${ref(CLONE)}`);
  });

  it("leaves the reference unchanged when the clone fails", async () => {
    const editor = setup("Note\n", { result: null });
    editor.insert(ref(FOREIGN));
    await editor.resolveAll();
    expect(editor.text()).toBe(`Note\n${ref(FOREIGN)}`);
  });

  it("does not add the rewrite as its own undo step", async () => {
    const editor = setup("Note\n");
    editor.insert(ref(FOREIGN));
    await editor.resolveAll();
    expect(editor.text()).toBe(`Note\n${ref(CLONE)}`);
    undo(editor.view);
    expect(editor.text()).toBe("Note\n");
  });

  it("handles the userEvent Vim put dispatches", async () => {
    const editor = setup("Note\n");
    editor.insert(ref(FOREIGN), 5, "input.type.compose");
    await editor.resolveAll();
    expect(editor.text()).toBe(`Note\n${ref(CLONE)}`);
  });

  it("handles transactions without a userEvent", async () => {
    const editor = setup("Note\n");
    editor.insert(ref(FOREIGN), 5, null);
    await editor.resolveAll();
    expect(editor.text()).toBe(`Note\n${ref(CLONE)}`);
  });

  it("clones a reference completed by typing", async () => {
    const editor = setup(`![](image:${FOREIGN}#800x600`);
    editor.insert(")", undefined, "input.type");
    expect(editor.clone).toHaveBeenCalledTimes(1);
    await editor.resolveAll();
    expect(editor.text()).toBe(ref(CLONE));
  });
});
