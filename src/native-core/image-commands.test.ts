import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromBase64 } from "../crypto/base64";
import { imageFilePath } from "../images/image-id";
import {
  parseImageReferences,
  referencedImageIds,
} from "../images/image-reference";
import type { HostDecodedImage } from "./host-services";
import { SAMPLE_IMAGE_WEBP_BASE64 } from "../testing/sample-notes-repo/sample-image";
import { sampleImageNote } from "../testing/sample-notes-repo/sample-source";
import {
  describeAddingImages,
  describeImageRejection,
  IMAGE_COUNT_LIMIT_MESSAGE,
} from "../ui/images/image-messages";
import type { CoreEvents, NativeCoreHandle } from "./api";
import {
  createCoreTestContext,
  type CoreTestContext,
} from "./testing/core-test-harness";

const REPO = "sample/notes";
const WELCOME = ["Welcome"];
const IMAGE_NOTE = [...sampleImageNote.folder, sampleImageNote.name];

interface ImagesProbe {
  images: Record<string, { blobSha: string; owners: readonly unknown[] }>;
  tombstones: string[];
  pending: string[];
}

let ctx: CoreTestContext;

beforeEach(async () => {
  ctx = await createCoreTestContext({
    extraCommands: (app) => ({
      "test.images": async (params): Promise<ImagesProbe> => {
        const { ids } = params as { ids: string[] };
        const { engine } = app.current()!;
        const index = engine.getState().synced!.images;
        return {
          images: Object.fromEntries(index.images),
          tombstones: [...index.tombstones.keys()],
          pending: ids.filter((id) => engine.getPendingImage(id) !== undefined),
        };
      },
    }),
  });
});

afterEach(() => {
  ctx.dispose();
});

const ascii = (text: string) =>
  Uint8Array.from(text, (char) => char.charCodeAt(0));

function png(width: number, height: number): Uint8Array {
  const out = new Uint8Array(8 + 8 + 13);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(out.buffer);
  view.setUint32(8, 13);
  out.set(ascii("IHDR"), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  out.set([8, 6, 0, 0, 0], 24);
  return out;
}

function stagePng(width: number, height: number): string {
  return ctx.host.stageInput(png(width, height), "image/png");
}

async function started(): Promise<NativeCoreHandle> {
  const core = ctx.startCore();
  await ctx.logIn(core);
  return core;
}

async function openNote(
  core: NativeCoreHandle,
  path: string[],
): Promise<string> {
  const { note } = await ctx.call(core, "note.open", { path });
  expect(note.state).toBe("loaded");
  return note.content as string;
}

function notices(): CoreEvents["notice"][] {
  return ctx.events("notice") as CoreEvents["notice"][];
}

function clearedIds(): string[] {
  return (ctx.events("noticeCleared") as { id: string }[]).map(({ id }) => id);
}

async function insert(
  core: NativeCoreHandle,
  inputs: string[],
): Promise<string[]> {
  return (await ctx.call(core, "image.insert", { inputs })).references;
}

function idOf(reference: string): string {
  return parseImageReferences(reference)[0]!.imageId;
}

async function save(
  core: NativeCoreHandle,
  path: string[],
  text: string,
): Promise<void> {
  await ctx.call(core, "note.edit", { path, text });
  expect(await ctx.call(core, "sync.flush")).toEqual({
    result: { kind: "saved" },
  });
}

async function probe(
  core: NativeCoreHandle,
  ids: string[],
): Promise<ImagesProbe> {
  return ctx.call(core, "test.images", { ids });
}

describe("image.insert", () => {
  it("inserts staged images and commits them once a saved text references them", async () => {
    const core = await started();
    const text = await openNote(core, WELCOME);

    const references = await insert(core, [
      stagePng(3000, 2000),
      stagePng(1200, 3000),
    ]);

    expect(references).toHaveLength(2);
    expect(references[0]).toMatch(/^!\[\]\(image:[a-z2-7]{26}#2560x1707\)$/);
    expect(references[1]).toMatch(/^!\[\]\(image:[a-z2-7]{26}#1024x2560\)$/);
    expect(notices()).toEqual([]);
    const ids = references.map(idOf);
    expect((await probe(core, ids)).pending).toEqual(ids);

    await save(core, WELCOME, `${text}\n${references.join("\n")}\n`);

    const paths = await ctx.controls.headPaths(REPO);
    for (const id of ids) expect(paths).toContain(imageFilePath(id));
    const { images, pending } = await probe(core, ids);
    expect(pending).toEqual([]);
    for (const id of ids) {
      expect(images[id]!.owners).toEqual([{ state: "active", path: WELCOME }]);
    }
  });

  it("refuses more than ten inputs without taking any", async () => {
    const core = await started();
    await openNote(core, WELCOME);
    const takeInput = vi.spyOn(ctx.host.imageCodec, "takeInput");
    const inputs = Array.from({ length: 11 }, () => stagePng(10, 10));

    expect(await insert(core, inputs)).toEqual([]);

    expect(takeInput).not.toHaveBeenCalled();
    expect(notices()).toEqual([
      {
        id: expect.any(String),
        tone: "error",
        message: IMAGE_COUNT_LIMIT_MESSAGE,
        persistent: true,
        action: null,
      },
    ]);
  });

  it("returns nothing and posts nothing while sync is stopped", async () => {
    const core = await started();
    await ctx.controls.changeRepoKey(REPO);
    await ctx.send(core, "sync.refresh");
    await vi.waitFor(() => expect(ctx.events("keyChanged")).toHaveLength(1));
    const takeInput = vi.spyOn(ctx.host.imageCodec, "takeInput");
    const before = notices().length;

    expect(await insert(core, [stagePng(10, 10)])).toEqual([]);

    expect(takeInput).not.toHaveBeenCalled();
    expect(notices()).toHaveLength(before);
  });

  it("returns the prepared images and one error notice for a rejected input", async () => {
    const core = await started();
    await openNote(core, WELCOME);

    const references = await insert(core, [
      stagePng(20, 10),
      ctx.host.stageInput(ascii("just some text"), "text/plain"),
      stagePng(30, 15),
    ]);

    expect(references).toHaveLength(2);
    expect(references[0]).toMatch(/#20x10\)$/);
    expect(references[1]).toMatch(/#30x15\)$/);
    expect(notices()).toEqual([
      {
        id: expect.any(String),
        tone: "error",
        message: describeImageRejection({ kind: "notImage" }),
        persistent: true,
        action: null,
      },
    ]);
  });

  it("rejects an unknown input like a non-image", async () => {
    const core = await started();

    expect(await insert(core, ["unknown-input"])).toEqual([]);

    expect(notices().map((notice) => notice.message)).toEqual([
      describeImageRejection({ kind: "notImage" }),
    ]);
  });

  it("shows the busy notice only once the work takes 300 ms and clears it afterwards", async () => {
    const core = await started();
    await openNote(core, WELCOME);
    expect(await insert(core, [stagePng(10, 10)])).toHaveLength(1);
    expect(notices()).toEqual([]);

    const decode = ctx.host.imageCodec.decode.bind(ctx.host.imageCodec);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = vi
      .spyOn(ctx.host.imageCodec, "decode")
      .mockImplementation(async (bytes): Promise<HostDecodedImage> => {
        await gate;
        return decode(bytes);
      });
    const pending = ctx.send(core, "image.insert", {
      inputs: [stagePng(10, 10), stagePng(12, 12)],
    });
    await vi.waitFor(() => expect(held).toHaveBeenCalled());

    ctx.clock.advance(299);
    expect(notices()).toEqual([]);
    ctx.clock.advance(1);
    expect(notices()).toEqual([
      {
        id: expect.any(String),
        tone: "info",
        message: describeAddingImages(2),
        persistent: false,
        action: null,
      },
    ]);
    const busyId = notices()[0]!.id;
    expect(clearedIds()).not.toContain(busyId);

    release();
    const response = await pending;
    expect(response.ok && (response.result as any).references).toHaveLength(2);
    expect(clearedIds()).toContain(busyId);
    expect(notices()).toHaveLength(1);
  });

  it("fails as notReady without a running session", async () => {
    const core = ctx.startCore();
    const response = await ctx.send(core, "image.insert", { inputs: [] });
    expect(response).toMatchObject({ ok: false, error: { kind: "notReady" } });
  });

  it("rejects inputs that are not strings", async () => {
    const core = await started();
    const response = await ctx.send(core, "image.insert", { inputs: [1] });
    expect(response).toMatchObject({
      ok: false,
      error: { kind: "invalidParams" },
    });
  });
});

describe("image.clonePasted", () => {
  async function whiteboardReference(core: NativeCoreHandle): Promise<{
    text: string;
    reference: string;
    imageId: string;
  }> {
    const text = await openNote(core, IMAGE_NOTE);
    const [found] = parseImageReferences(text);
    return {
      text,
      reference: text.slice(found!.from, found!.to),
      imageId: found!.imageId,
    };
  }

  it("clones a reference pasted into another note", async () => {
    const core = await started();
    const { reference, imageId } = await whiteboardReference(core);
    const welcome = await openNote(core, WELCOME);
    const pasted = `See ${reference} here`;

    const { text } = await ctx.call(core, "image.clonePasted", {
      path: WELCOME,
      current: welcome,
      pasted,
    });

    const [clone] = [...referencedImageIds(text)];
    expect(clone).toBeDefined();
    expect(clone).not.toBe(imageId);
    expect(text).toBe(pasted.replace(imageId, clone!));

    await save(core, WELCOME, `${welcome}\n${text}\n`);
    const { image } = await ctx.call(core, "image.read", { imageId: clone });
    expect(fromBase64(image.base64)).toEqual(
      fromBase64(SAMPLE_IMAGE_WEBP_BASE64),
    );
  });

  it("keeps references already in the text or owned by the note", async () => {
    const core = await started();
    const { text, reference } = await whiteboardReference(core);

    expect(
      await ctx.call(core, "image.clonePasted", {
        path: IMAGE_NOTE,
        current: "",
        pasted: reference,
      }),
    ).toEqual({ text: reference });
    expect(
      await ctx.call(core, "image.clonePasted", {
        path: WELCOME,
        current: text,
        pasted: reference,
      }),
    ).toEqual({ text: reference });
  });

  it("clones into a draft and keeps references that cannot be cloned", async () => {
    const core = await started();
    const { reference, imageId } = await whiteboardReference(core);
    const unknown = "a".repeat(imageId.length);
    const missing = reference.replace(imageId, unknown);

    const { text } = await ctx.call(core, "image.clonePasted", {
      path: null,
      current: "",
      pasted: `${reference}\n${reference}\n${missing}`,
    });

    const ids = [...referencedImageIds(text)];
    expect(ids).toHaveLength(2);
    expect(ids).toContain(unknown);
    expect(ids).not.toContain(imageId);
  });
});

describe("removing an image reference", () => {
  it("deletes the image file on save and revives it when the reference returns", async () => {
    const core = await started();
    const text = await openNote(core, WELCOME);
    const [reference] = await insert(core, [stagePng(40, 30)]);
    const id = idOf(reference!);
    await save(core, WELCOME, `${text}\n${reference}\n`);
    const { blobSha } = (await probe(core, [id])).images[id]!;

    await save(core, WELCOME, text);
    expect(await ctx.controls.headPaths(REPO)).not.toContain(imageFilePath(id));
    const removed = await probe(core, [id]);
    expect(removed.images[id]).toBeUndefined();
    expect(removed.tombstones).toContain(id);
    expect(removed.pending).toEqual([]);

    await save(core, WELCOME, `${text}\n${reference}\n`);
    expect(await ctx.controls.headPaths(REPO)).toContain(imageFilePath(id));
    const revived = await probe(core, [id]);
    expect(revived.images[id]).toEqual({
      blobSha,
      owners: [{ state: "active", path: WELCOME }],
    });
    expect(revived.tombstones).not.toContain(id);
  });
});
