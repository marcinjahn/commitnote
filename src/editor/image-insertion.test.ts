// @vitest-environment jsdom
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import { undo } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  type Extension,
  Prec,
  type Transaction,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Vim, getCM } from "@replit/codemirror-vim";
import {
  createMarkdownEditor,
  markdownEditorExtensions,
  type MarkdownEditor,
} from "./create-markdown-editor";
import { imageCloneExempt } from "./image-clone-on-insert";
import {
  cancelImageInsertions,
  type ImageInsertionConfig,
  imageFileHandlers,
  imageInsertion,
  insertImageFiles,
} from "./image-insertion";
import { vimExtension } from "./vim/vim-extension";
import type { PendingImage } from "../images/pending-image";
import type { PrepareImagesOutcome } from "../images/prepare-images";

const ID_A = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const ID_B = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const REF_A = `![](image:${ID_A}#800x600)`;
const REF_B = `![](image:${ID_B}#40x30)`;

function pending(imageId: string, width: number, height: number): PendingImage {
  return {
    imageId,
    envelope: new Uint8Array([1]),
    blobSha: "0".repeat(40),
    type: "image/webp",
    width,
    height,
  };
}

const IMAGE_A = pending(ID_A, 800, 600);
const IMAGE_B = pending(ID_B, 40, 30);

function prepared(images: PendingImage[], total = images.length) {
  return {
    kind: "prepared",
    images,
    rejections: [],
    total,
  } satisfies PrepareImagesOutcome;
}

interface Fake {
  readonly config: ImageInsertionConfig;
  readonly prepare: Mock<ImageInsertionConfig["prepare"]>;
  readonly register: Mock<ImageInsertionConfig["register"]>;
  readonly onBusy: Mock<ImageInsertionConfig["onBusy"]>;
  readonly onOutcome: Mock<ImageInsertionConfig["onOutcome"]>;
  enabled: boolean;
  resolve(outcome: PrepareImagesOutcome, index?: number): Promise<void>;
  reject(index?: number): Promise<void>;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function fakeConfig(): Fake {
  const settlers: {
    resolve: (outcome: PrepareImagesOutcome) => void;
    reject: (error: Error) => void;
  }[] = [];
  const prepare = vi.fn<ImageInsertionConfig["prepare"]>(
    () =>
      new Promise<PrepareImagesOutcome>((resolve, reject) => {
        settlers.push({ resolve, reject });
      }),
  );
  const fake: Fake = {
    prepare,
    register: vi.fn<ImageInsertionConfig["register"]>(),
    onBusy: vi.fn<ImageInsertionConfig["onBusy"]>(),
    onOutcome: vi.fn<ImageInsertionConfig["onOutcome"]>(),
    enabled: true,
    config: {
      prepare,
      register: (image) => fake.register(image),
      enabled: () => fake.enabled,
      onBusy: (busy, count) => fake.onBusy(busy, count),
      onOutcome: (outcome) => fake.onOutcome(outcome),
    },
    async resolve(outcome, index = settlers.length - 1) {
      settlers[index]?.resolve(outcome);
      await flush();
    },
    async reject(index = settlers.length - 1) {
      settlers[index]?.reject(new Error("chunk failed"));
      await flush();
    },
  };
  return fake;
}

const editors: MarkdownEditor[] = [];
const views: EditorView[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.view.dom.parentElement?.remove();
    editor.destroy();
  }
  for (const view of views.splice(0)) {
    view.dom.parentElement?.remove();
    view.destroy();
  }
  vi.useRealTimers();
});

function setup(
  text: string,
  options: {
    caret?: number;
    readOnly?: boolean;
    withFacet?: boolean;
    extensions?: Extension[];
  } = {},
): { editor: MarkdownEditor; view: EditorView; fake: Fake } {
  const fake = fakeConfig();
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const editor = createMarkdownEditor({
    parent,
    text,
    readOnly: options.readOnly ?? false,
    onChange: () => {},
    extensions: [
      imageFileHandlers(),
      options.withFacet === false ? [] : imageInsertion.of(fake.config),
      ...(options.extensions ?? []),
    ],
  });
  editors.push(editor);
  const caret = options.caret ?? text.length;
  editor.view.dispatch({ selection: EditorSelection.cursor(caret) });
  return { editor, view: editor.view, fake };
}

function imageFile(name = "a.png", type = "image/png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function clipboard(
  data: { files?: File[]; text?: string; html?: string } = {},
): DataTransfer {
  const types = [
    ...(data.text ? ["text/plain"] : []),
    ...(data.html ? ["text/html"] : []),
    ...(data.files?.length ? ["Files"] : []),
  ];
  return {
    files: data.files ?? [],
    types,
    getData: (type: string) =>
      type === "text/plain" || type === "Text"
        ? (data.text ?? "")
        : type === "text/html"
          ? (data.html ?? "")
          : "",
  } as unknown as DataTransfer;
}

function paste(
  view: EditorView,
  data: { files?: File[]; text?: string; html?: string },
): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: clipboard(data) });
  view.contentDOM.dispatchEvent(event);
  return event;
}

function dragEvent(
  view: EditorView,
  type: "drop" | "dragover",
  transfer: DataTransfer,
  coords = { x: 10, y: 20 },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  Object.defineProperty(event, "clientX", { value: coords.x });
  Object.defineProperty(event, "clientY", { value: coords.y });
  view.contentDOM.dispatchEvent(event);
  return event;
}

const docOf = (view: EditorView) => view.state.doc.toString();

describe("image paste", () => {
  it("prepares all pasted files and inserts the references at the caret", async () => {
    const { view, fake } = setup("intro\n");
    const files = [imageFile(), imageFile("notes.txt", "text/plain")];

    const event = paste(view, { files });
    expect(event.defaultPrevented).toBe(true);
    expect(fake.prepare).toHaveBeenCalledWith(files);

    const outcome = prepared([IMAGE_A], 2);
    await fake.resolve(outcome);

    expect(docOf(view)).toBe(`intro\n${REF_A}\n`);
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    expect(fake.onOutcome).toHaveBeenCalledWith(outcome);
  });

  it("keeps the insertion position mapped through edits made meanwhile", async () => {
    const { view, fake } = setup("hello\n");
    paste(view, { files: [imageFile()] });

    view.dispatch({ changes: { from: 0, insert: "abc " } });
    await fake.resolve(prepared([IMAGE_A]));

    expect(docOf(view)).toBe(`abc hello\n${REF_A}\n`);
  });

  it("splits the line when inserting mid-line and puts the caret after the insert", async () => {
    const { view, fake } = setup("abcd", { caret: 2 });
    paste(view, { files: [imageFile()] });
    await fake.resolve(prepared([IMAGE_A]));

    expect(docOf(view)).toBe(`ab\n${REF_A}\ncd`);
    expect(view.state.selection.main.head).toBe(`ab\n${REF_A}\n`.length);
  });

  it("puts the caret on a new empty line after a reference inserted at the end of a line", async () => {
    const { view, fake } = setup("ab\nnext", { caret: 2 });
    paste(view, { files: [imageFile()] });
    await fake.resolve(prepared([IMAGE_A]));

    expect(docOf(view)).toBe(`ab\n${REF_A}\n\nnext`);
    expect(view.state.selection.main.head).toBe(`ab\n${REF_A}\n`.length);

    view.dispatch({
      ...view.state.replaceSelection("x"),
      userEvent: "input.type",
    });
    expect(docOf(view)).toBe(`ab\n${REF_A}\nx\nnext`);

    undo(view);
    undo(view);
    expect(docOf(view)).toBe("ab\nnext");
  });

  it("puts the caret on a new empty line after a reference inserted on an empty line", async () => {
    const { view, fake } = setup("ab\n\ncd", { caret: 3 });
    paste(view, { files: [imageFile()] });
    await fake.resolve(prepared([IMAGE_A]));

    expect(docOf(view)).toBe(`ab\n${REF_A}\n\ncd`);
    expect(view.state.selection.main.head).toBe(`ab\n${REF_A}\n`.length);

    view.dispatch({
      ...view.state.replaceSelection("x"),
      userEvent: "input.type",
    });
    expect(docOf(view)).toBe(`ab\n${REF_A}\nx\ncd`);
  });

  it("puts the caret on a new empty line after a reference inserted at the end of the document", async () => {
    const { view, fake } = setup("ab", { caret: 2 });
    paste(view, { files: [imageFile()] });
    await fake.resolve(prepared([IMAGE_A]));

    expect(docOf(view)).toBe(`ab\n${REF_A}\n`);
    expect(view.state.selection.main.head).toBe(view.state.doc.length);

    view.dispatch({
      ...view.state.replaceSelection("x"),
      userEvent: "input.type",
    });
    expect(docOf(view)).toBe(`ab\n${REF_A}\nx`);
  });

  it("keeps the selection when the caret moved away from the anchor", async () => {
    const { view, fake } = setup("one\ntwo", { caret: 3 });
    paste(view, { files: [imageFile()] });
    view.dispatch({ selection: EditorSelection.cursor(0) });
    await fake.resolve(prepared([IMAGE_A]));

    expect(docOf(view)).toBe(`one\n${REF_A}\n\ntwo`);
    expect(view.state.selection.main.head).toBe(0);
  });

  it("separates the reference from a table directly above it with a blank line", async () => {
    const table = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, fake } = setup(`${table}\n`, { caret: table.length + 1 });
    paste(view, { files: [imageFile()] });
    await fake.resolve(prepared([IMAGE_A]));

    expect(docOf(view)).toBe(`${table}\n\n${REF_A}\n`);
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it("puts the reference inline in a body cell with the caret after it", async () => {
    const text = "| a | b |\n| - | - |\n| 1 | 2 |\n\n# next";
    const caret = text.indexOf("1") + 1;
    const { view, fake } = setup(text, { caret });
    paste(view, { files: [imageFile()] });
    await fake.resolve(prepared([IMAGE_A]));

    expect(docOf(view)).toBe(
      `| a | b |\n| - | - |\n| 1 ${REF_A} | 2 |\n\n# next`,
    );
    expect(view.state.selection.main.head).toBe(
      text.indexOf("1") + 2 + REF_A.length,
    );
  });

  it("keeps the table intact when inserting at the start of its header line", async () => {
    const table = "| a | b |\n| - | - |\n| 1 | 2 |";
    const { view, fake } = setup(table, { caret: 0 });
    paste(view, { files: [imageFile()] });
    await fake.resolve(prepared([IMAGE_A]));

    expect(docOf(view)).toBe(`${REF_A}\n\n${table}`);
    expect(view.state.selection.main.head).toBe(REF_A.length + 1);
  });

  it("separates several references in a cell with spaces", async () => {
    const text = "| a | b |\n| - | - |\n| 1 | 2 |\n\n# next";
    const caret = text.indexOf("1") + 1;
    const { view, fake } = setup(text, { caret });
    paste(view, { files: [imageFile(), imageFile("b.png")] });
    await fake.resolve(prepared([IMAGE_A, IMAGE_B]));

    expect(docOf(view)).toBe(
      `| a | b |\n| - | - |\n| 1 ${REF_A} ${REF_B} | 2 |\n\n# next`,
    );
  });

  it("puts the reference inline in a cell of a blockquote table", async () => {
    const text = "> | a | b |\n> | - | - |\n> | 1 | 2 |\n\n# next";
    const caret = text.indexOf("2") + 1;
    const { view, fake } = setup(text, { caret });
    paste(view, { files: [imageFile()] });
    await fake.resolve(prepared([IMAGE_A]));

    expect(docOf(view)).toBe(
      `> | a | b |\n> | - | - |\n> | 1 | 2 ${REF_A} |\n\n# next`,
    );
  });

  it("places the reference after a table whose last row has no cells", async () => {
    const text = "| a | b |\n| - | - |\n|";
    const { view, fake } = setup(text, { caret: text.length });
    paste(view, { files: [imageFile()] });
    const outcome = prepared([IMAGE_A]);
    await fake.resolve(outcome);

    expect(docOf(view)).toBe(`${text}\n\n${REF_A}\n`);
    expect(fake.onOutcome).toHaveBeenCalledWith(outcome);
  });

  it("inserts several images in order, one per line, registering each first", async () => {
    const { view, fake } = setup("");
    const docsAtRegister: string[] = [];
    fake.register.mockImplementation(() => {
      docsAtRegister.push(docOf(view));
    });

    paste(view, { files: [imageFile(), imageFile()] });
    await fake.resolve(prepared([IMAGE_A, IMAGE_B]));

    expect(docOf(view)).toBe(`${REF_A}\n${REF_B}\n`);
    expect(fake.register.mock.calls.map(([image]) => image)).toEqual([
      IMAGE_A,
      IMAGE_B,
    ]);
    expect(docsAtRegister).toEqual(["", ""]);
  });

  it("marks the insert as exempt from cloning and undoes it in one step", async () => {
    const transactions: Transaction[] = [];
    const { view, fake } = setup("text", {
      extensions: [
        EditorView.updateListener.of((update) =>
          transactions.push(...update.transactions),
        ),
      ],
    });
    paste(view, { files: [imageFile(), imageFile()] });
    await fake.resolve(prepared([IMAGE_A, IMAGE_B]));

    const insert = transactions.find((tr) => tr.docChanged);
    expect(insert?.annotation(imageCloneExempt)).toBe(true);
    expect(insert?.isUserEvent("input")).toBe(true);

    undo(view);
    expect(docOf(view)).toBe("text");
  });

  it("lets a paste without image files fall through to the link paste", () => {
    const { view, fake } = setup("see word", { caret: 4 });
    view.dispatch({ selection: EditorSelection.single(4, 8) });

    const event = paste(view, {
      text: "https://example.com",
      files: [imageFile("a.txt", "text/plain")],
    });

    expect(fake.prepare).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(docOf(view)).toBe("see [word](https://example.com)");
  });

  it("does not prevent a plain text paste before the editor handles it", () => {
    let preventedBefore: boolean | null = null;
    const { view, fake } = setup("", {
      extensions: [
        Prec.lowest(
          EditorView.domEventHandlers({
            paste(event) {
              preventedBefore = event.defaultPrevented;
              return false;
            },
          }),
        ),
      ],
    });
    paste(view, { text: "plain" });

    expect(fake.prepare).not.toHaveBeenCalled();
    expect(preventedBefore).toBe(false);
    expect(docOf(view)).toBe("plain");
  });

  it("pastes text from an office-style clipboard that also carries an image", () => {
    const { view, fake } = setup("");
    paste(view, {
      text: "a\tb",
      html: "<meta charset='utf-8'><table><tr><td>a</td><td>b</td></tr></table>",
      files: [imageFile()],
    });

    expect(fake.prepare).not.toHaveBeenCalled();
    expect(docOf(view)).toBe("a\tb");
  });

  it("pastes the image when the html is just an img", async () => {
    const { view, fake } = setup("");
    const event = paste(view, {
      text: "image.png",
      html: '<meta charset="utf-8"><img src="https://example.com/a.png">',
      files: [imageFile()],
    });

    expect(event.defaultPrevented).toBe(true);
    expect(fake.prepare).toHaveBeenCalledTimes(1);
    await fake.resolve(prepared([IMAGE_A]));
    expect(docOf(view)).toBe(`${REF_A}\n`);
  });

  it.each([
    ["read-only", { readOnly: true }],
    ["without the facet", { withFacet: false }],
  ])("swallows an image paste %s without preparing", (_name, options) => {
    const { view, fake } = setup("x", options);
    const event = paste(view, { files: [imageFile()] });

    expect(event.defaultPrevented).toBe(true);
    expect(fake.prepare).not.toHaveBeenCalled();
    expect(docOf(view)).toBe("x");
  });

  it("swallows an image paste while disabled", () => {
    const { view, fake } = setup("x");
    fake.enabled = false;
    const event = paste(view, { files: [imageFile()] });

    expect(event.defaultPrevented).toBe(true);
    expect(fake.prepare).not.toHaveBeenCalled();
    expect(insertImageFiles(view, [imageFile()])).toBe(false);
  });

  it("inserts and registers nothing when the editor became read-only", async () => {
    const { editor, view, fake } = setup("x");
    paste(view, { files: [imageFile()] });
    editor.setReadOnly(true);
    await fake.resolve(prepared([IMAGE_A]));

    expect(docOf(view)).toBe("x");
    expect(fake.register).not.toHaveBeenCalled();
  });

  it("inserts and registers nothing when insertion became disabled", async () => {
    const { view, fake } = setup("x");
    paste(view, { files: [imageFile()] });
    fake.enabled = false;
    await fake.resolve(prepared([IMAGE_A]));

    expect(docOf(view)).toBe("x");
    expect(fake.register).not.toHaveBeenCalled();
  });

  it("drops actions cancelled before completion", async () => {
    const { view, fake } = setup("x");
    paste(view, { files: [imageFile()] });
    cancelImageInsertions(view);
    await fake.resolve(prepared([IMAGE_A]));

    expect(docOf(view)).toBe("x");
    expect(fake.register).not.toHaveBeenCalled();
    expect(fake.onOutcome).not.toHaveBeenCalled();
  });

  it("reports tooMany and all-rejected outcomes without inserting", async () => {
    const { view, fake } = setup("x");
    paste(view, { files: [imageFile()] });
    paste(view, { files: [imageFile()] });

    const tooMany = { kind: "tooMany", count: 11 } as const;
    const rejected = {
      kind: "prepared",
      images: [],
      rejections: [{ kind: "tooManyPixels" }],
      total: 1,
    } satisfies PrepareImagesOutcome;
    await fake.resolve(tooMany, 0);
    await fake.resolve(rejected, 1);

    expect(docOf(view)).toBe("x");
    expect(fake.register).not.toHaveBeenCalled();
    expect(fake.onOutcome.mock.calls).toEqual([[tooMany], [rejected]]);
  });

  it("reports a failed preparation as unsupported and inserts nothing", async () => {
    const { view, fake } = setup("x");
    paste(view, { files: [imageFile(), imageFile()] });
    await fake.reject();

    expect(docOf(view)).toBe("x");
    expect(fake.onOutcome).toHaveBeenCalledWith({
      kind: "prepared",
      images: [],
      rejections: [{ kind: "unsupported" }, { kind: "unsupported" }],
      total: 2,
    });

    view.dispatch({ changes: { from: 0, insert: "y" } });
    expect(docOf(view)).toBe("yx");
  });
});

describe("busy signal", () => {
  it("is not sent for fast actions", async () => {
    vi.useFakeTimers();
    const { view, fake } = setup("");
    paste(view, { files: [imageFile()] });
    vi.advanceTimersByTime(299);
    await fake.resolve(prepared([IMAGE_A]));
    vi.advanceTimersByTime(1000);

    expect(fake.onBusy).not.toHaveBeenCalled();
  });

  it("is sent once for slow actions and then cleared", async () => {
    vi.useFakeTimers();
    const { view, fake } = setup("");
    paste(view, { files: [imageFile(), imageFile()] });
    vi.advanceTimersByTime(300);
    expect(fake.onBusy.mock.calls).toEqual([[true, 2]]);

    vi.advanceTimersByTime(5000);
    await fake.resolve(prepared([IMAGE_A, IMAGE_B]));
    expect(fake.onBusy.mock.calls).toEqual([
      [true, 2],
      [false, 2],
    ]);
  });
});

describe("image drop", () => {
  it("inserts at the drop position", async () => {
    const { view, fake } = setup("one\ntwo");
    const posAtCoords = vi.spyOn(view, "posAtCoords").mockReturnValue(3);
    const files = [imageFile()];

    const event = dragEvent(view, "drop", clipboard({ files }), { x: 5, y: 7 });
    expect(event.defaultPrevented).toBe(true);
    expect(posAtCoords).toHaveBeenCalledWith({ x: 5, y: 7 });
    expect(fake.prepare).toHaveBeenCalledWith(files);

    await fake.resolve(prepared([IMAGE_A]));
    expect(docOf(view)).toBe(`one\n${REF_A}\n\ntwo`);
  });

  it("falls back to the selection head without a drop position", async () => {
    const { view, fake } = setup("one", { caret: 0 });
    vi.spyOn(view, "posAtCoords").mockReturnValue(null);
    dragEvent(view, "drop", clipboard({ files: [imageFile()] }));
    await fake.resolve(prepared([IMAGE_A]));

    expect(docOf(view)).toBe(`${REF_A}\none`);
  });

  it("accepts dragged files on dragover as a copy", () => {
    const { view } = setup("");
    const transfer = { types: ["Files"], files: [], dropEffect: "none" };
    const event = dragEvent(
      view,
      "dragover",
      transfer as unknown as DataTransfer,
    );

    expect(event.defaultPrevented).toBe(true);
    expect(transfer.dropEffect).toBe("copy");
  });

  it("ignores dragover while read-only", () => {
    const { view } = setup("", { readOnly: true });
    const event = dragEvent(
      view,
      "dragover",
      clipboard({ files: [imageFile()] }),
    );
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves a drop without image files to the editor", () => {
    const { view, fake } = setup("");
    vi.spyOn(view, "posAtCoords").mockReturnValue(0);
    dragEvent(view, "drop", clipboard({ text: "dropped" }));

    expect(fake.prepare).not.toHaveBeenCalled();
    expect(docOf(view)).toBe("dropped");
  });

  it("swallows an image drop while read-only", () => {
    const { view, fake } = setup("", { readOnly: true });
    vi.spyOn(view, "posAtCoords").mockReturnValue(0);
    const event = dragEvent(view, "drop", clipboard({ files: [imageFile()] }));

    expect(event.defaultPrevented).toBe(true);
    expect(fake.prepare).not.toHaveBeenCalled();
  });
});

describe("insertImageFiles", () => {
  it("clamps the position to the document", async () => {
    const { view, fake } = setup("ab", { caret: 0 });
    expect(insertImageFiles(view, [imageFile()], 99)).toBe(true);
    await fake.resolve(prepared([IMAGE_A]));

    expect(docOf(view)).toBe(`ab\n${REF_A}\n`);
  });
});

describe("vim paste", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function vimSetup(initialMode: "normal" | "insert") {
    const fake = fakeConfig();
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "line",
        extensions: [
          markdownEditorExtensions(),
          imageFileHandlers(),
          imageInsertion.of(fake.config),
          vimExtension({
            initialMode,
            animatedCaret: false,
            onWrite: async () => {},
            onQuit: () => {},
          }),
        ],
      }),
    });
    views.push(view);
    await settle();
    return { view, fake };
  }

  it("inserts a pasted image in insert mode", async () => {
    const { view, fake } = await vimSetup("insert");
    expect(getCM(view)?.state.vim?.insertMode).toBe(true);

    paste(view, { files: [imageFile()] });
    expect(fake.prepare).toHaveBeenCalledTimes(1);
    await fake.resolve(prepared([IMAGE_A]));

    expect(docOf(view)).toBe(`${REF_A}\nline`);
  });

  it("leaves a paste in normal mode to Vim", async () => {
    const { view, fake } = await vimSetup("normal");
    const handleKey = vi.spyOn(Vim, "handleKey");

    const event = paste(view, { files: [imageFile()] });

    expect(event.defaultPrevented).toBe(true);
    expect(handleKey).toHaveBeenCalledWith(expect.anything(), "p", "user");
    expect(fake.prepare).not.toHaveBeenCalled();
    handleKey.mockRestore();
  });
});
