// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { undo } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import {
  createMarkdownEditor,
  type MarkdownEditor,
} from "./create-markdown-editor";
import {
  type ImageOpenRequest,
  imageOpenHandler,
  imageSource,
  imageWidgets,
  removeImageReference,
} from "./image-widgets";
import type { ImageSourceResult } from "../images/image-source";

const ID = "abcdefghijklmnopqrstuvwxyz";
const REF = `![A \\[cat\\]](image:${ID}#800x600)`;

let editor: MarkdownEditor | null = null;
let parent: HTMLElement | null = null;

function setup(
  text: string,
  options: { readOnly?: boolean; extensions?: Extension[] } = {},
): MarkdownEditor {
  parent = document.createElement("div");
  document.body.appendChild(parent);
  editor = createMarkdownEditor({
    parent,
    text,
    readOnly: options.readOnly ?? false,
    onChange: () => {},
    extensions: [imageWidgets(), ...(options.extensions ?? [])],
  });
  return editor;
}

function button(): HTMLButtonElement {
  const found = parent?.querySelector<HTMLButtonElement>(".cm-image");
  if (!found) throw new Error("image widget not rendered");
  return found;
}

function img(): HTMLImageElement {
  const found = button().querySelector("img");
  if (!found) throw new Error("img not rendered");
  return found;
}

function staticSource(result: ImageSourceResult) {
  return vi.fn(() => Promise.resolve(result));
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadImage(): Promise<void> {
  await settle();
  img().dispatchEvent(new Event("load"));
}

afterEach(() => {
  editor?.destroy();
  parent?.remove();
  editor = null;
  parent = null;
});

describe("image widget view", () => {
  it("loads the image from the source", async () => {
    const source = staticSource({ url: "blob:image" });
    setup(`${REF}\n`, { extensions: [imageSource.of(source)] });

    expect(button().dataset.state).toBe("loading");
    expect(button().dataset.imageId).toBe(ID);
    expect(source).toHaveBeenCalledWith(ID);
    await settle();
    expect(img().getAttribute("src")).toBe("blob:image");
    expect(button().dataset.state).toBe("loading");

    img().dispatchEvent(new Event("load"));
    expect(button().dataset.state).toBe("loaded");
    expect(img().alt).toBe("A [cat]");
    expect(img().draggable).toBe(false);
    expect(button().style.getPropertyValue("--image-ratio")).toBe("800 / 600");
  });

  it("shows the unavailable state when the source reports it", async () => {
    setup(`${REF}\n`, {
      extensions: [imageSource.of(staticSource({ unavailable: true }))],
    });
    await settle();
    expect(button().dataset.state).toBe("unavailable");
    expect(button().textContent).toContain("Image unavailable");
  });

  it("shows the unavailable state when there is no source", () => {
    setup(`${REF}\n`);
    expect(button().dataset.state).toBe("unavailable");
    expect(button().textContent).toContain("Image unavailable");
  });

  it("names the button after the unescaped alt text, or plainly without one", () => {
    setup(`${REF}\n`);
    expect(button().getAttribute("aria-label")).toBe("A [cat]");
    editor?.destroy();
    parent?.remove();

    setup(`![](image:${ID})\n`);
    expect(button().getAttribute("aria-label")).toBe("Image");
    expect(button().classList.contains("cm-image-unsized")).toBe(true);
  });

  it("prevents the default of a primary mousedown", () => {
    setup(`${REF}\n`);
    const primary = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    button().dispatchEvent(primary);
    expect(primary.defaultPrevented).toBe(true);
  });

  it.each([
    ["read-only", true],
    ["editable", false],
  ])(
    "opens a loaded image once in a %s editor",
    async (_label, readOnly) => {
      const handler = vi.fn<(request: ImageOpenRequest) => void>();
      setup(`${REF}\n`, {
        readOnly,
        extensions: [
          imageSource.of(staticSource({ url: "blob:image" })),
          imageOpenHandler.of(handler),
        ],
      });
      await loadImage();

      button().click();

      expect(handler).toHaveBeenCalledTimes(1);
      const request = handler.mock.calls[0]?.[0];
      expect(request?.imageId).toBe(ID);
      expect(request?.alt).toBe("A [cat]");
      expect(request?.width).toBe(800);
      expect(request?.height).toBe(600);
      expect(request?.thumbnail).toBe(button());
      if (readOnly) expect(request?.remove).toBeNull();
      else expect(request?.remove).toBeTypeOf("function");
    },
  );

  it("does not open an image that is still loading", () => {
    const handler = vi.fn();
    setup(`${REF}\n`, {
      extensions: [
        imageSource.of(() => new Promise(() => {})),
        imageOpenHandler.of(handler),
      ],
    });
    button().click();
    expect(handler).not.toHaveBeenCalled();
  });

  it("retries an unavailable image on click", async () => {
    const source = vi
      .fn<() => Promise<ImageSourceResult>>()
      .mockResolvedValueOnce({ unavailable: true })
      .mockResolvedValue({ url: "blob:image" });
    setup(`${REF}\n`, { extensions: [imageSource.of(source)] });
    await settle();
    expect(button().dataset.state).toBe("unavailable");

    button().click();
    expect(button().dataset.state).toBe("loading");
    expect(source).toHaveBeenCalledTimes(2);
    await loadImage();
    expect(button().dataset.state).toBe("loaded");
  });

  it("removes the reference through the open request", async () => {
    let request: ImageOpenRequest | null = null;
    const text = `first\n${REF}\nlast`;
    const view = setup(text, {
      extensions: [
        imageSource.of(staticSource({ url: "blob:image" })),
        imageOpenHandler.of((next) => {
          request = next;
        }),
      ],
    }).view;
    await loadImage();
    button().click();

    (request as ImageOpenRequest | null)?.remove?.();
    expect(view.state.doc.toString()).toBe("first\nlast");
  });
});

describe("removeImageReference", () => {
  it.each([
    ["alone on a middle line", `first\n${REF}\nlast`, "first\nlast"],
    ["alone on the last line", `first\n${REF}`, "first"],
    ["alone in the document", `  ${REF} `, ""],
    [
      "next to other text",
      `first\nsee ${REF} here\nlast`,
      "first\nsee  here\nlast",
    ],
  ])("removes a reference %s", (_name, text, expected) => {
    const changes: string[] = [];
    parent = document.createElement("div");
    document.body.appendChild(parent);
    editor = createMarkdownEditor({
      parent,
      text,
      readOnly: false,
      onChange: (next) => changes.push(next),
      extensions: [imageWidgets()],
    });
    const view = editor.view;

    expect(removeImageReference(view, ID, text.indexOf("!"))).toBe(true);
    expect(view.state.doc.toString()).toBe(expected);
    expect(changes).toEqual([expected]);

    undo(view);
    expect(view.state.doc.toString()).toBe(text);
  });

  it("removes the reference closest to the given position", () => {
    const text = `${REF}\nmiddle\n${REF}`;
    const view = setup(text).view;
    expect(removeImageReference(view, ID, text.length)).toBe(true);
    expect(view.state.doc.toString()).toBe(`${REF}\nmiddle`);
  });

  it("refuses when read-only or when the image is not referenced", () => {
    const text = `${REF}\n`;
    const view = setup(text, { readOnly: true }).view;
    expect(removeImageReference(view, ID, 0)).toBe(false);
    editor?.setReadOnly(false);
    expect(removeImageReference(view, "bbbbbbbbbbbbbbbbbbbbbbbbbb", 0)).toBe(
      false,
    );
    expect(view.state.doc.toString()).toBe(text);
  });
});
