import { describe, expect, it } from "vitest";
import type { ImagePayload } from "../../crypto/image-cipher";
import type { ImageId } from "../../images/image-id";
import { createPrintImages } from "./print-images";

const A = "abcdefghijklmnopqrstuvwxyz";
const B = "bcdefghijklmnopqrstuvwxyz2";
const C = "cdefghijklmnopqrstuvwxyz23";

function ref(imageId: ImageId): string {
  return `![x](image:${imageId}#10x10)`;
}

const PAYLOAD: ImagePayload = {
  type: "image/webp",
  width: 10,
  height: 10,
  bytes: new Uint8Array([1, 2, 3]),
};

interface Deferred {
  resolve(value: ImagePayload | null): void;
  reject(error: unknown): void;
}

function setup() {
  const reads: ImageId[] = [];
  const deferred = new Map<ImageId, Deferred[]>();
  const created: string[] = [];
  const revoked: string[] = [];
  let settled = 0;
  const images = createPrintImages({
    readImage: (imageId) => {
      reads.push(imageId);
      return new Promise((resolve, reject) => {
        const list = deferred.get(imageId) ?? [];
        list.push({ resolve, reject });
        deferred.set(imageId, list);
      });
    },
    onSettled: () => settled++,
    createObjectUrl: () => {
      const url = `blob:${created.length}`;
      created.push(url);
      return url;
    },
    revokeObjectUrl: (url) => revoked.push(url),
  });
  const settle = async (
    imageId: ImageId,
    result: ImagePayload | null | Error = PAYLOAD,
    index = 0,
  ) => {
    const read = deferred.get(imageId)![index];
    if (result instanceof Error) read.reject(result);
    else read.resolve(result);
    await new Promise((resolve) => setTimeout(resolve));
  };
  return {
    images,
    reads,
    created,
    revoked,
    settle,
    settled: () => settled,
  };
}

describe("createPrintImages", () => {
  it("reads each referenced id once and reports when all reads settled", async () => {
    const s = setup();
    s.images.show(`${ref(A)} ${ref(B)} ${ref(A)}`);
    expect(s.reads).toEqual([A, B]);

    await s.settle(A);
    expect(s.settled()).toBe(0);
    expect(s.images.urls).toEqual(new Map([[A, "blob:0"]]));

    await s.settle(B);
    expect(s.settled()).toBe(1);
    expect(s.images.urls).toEqual(
      new Map([
        [A, "blob:0"],
        [B, "blob:1"],
      ]),
    );
  });

  it("reuses urls across re-renders of the same note", async () => {
    const s = setup();
    s.images.show(ref(A));
    await s.settle(A);
    const version = s.images.version;

    s.images.show(ref(A));
    s.images.show(`${ref(A)} edited`);

    expect(s.reads).toEqual([A]);
    expect(s.images.urls).toEqual(new Map([[A, "blob:0"]]));
    expect(s.images.version).toBe(version);
  });

  it("revokes urls of ids the text no longer references", async () => {
    const s = setup();
    s.images.show(`${ref(A)} ${ref(B)}`);
    await s.settle(A);
    await s.settle(B);

    s.images.show(ref(B));

    expect(s.revoked).toEqual(["blob:0"]);
    expect(s.images.urls).toEqual(new Map([[B, "blob:1"]]));
  });

  it("revokes a read that settles after its id was removed", async () => {
    const s = setup();
    s.images.show(ref(A));
    s.images.show("none");
    await s.settle(A);

    expect(s.revoked).toEqual(["blob:0"]);
    expect(s.images.urls.size).toBe(0);
    expect(s.settled()).toBe(0);
  });

  it("revokes everything on reset and results that settle after it", async () => {
    const s = setup();
    s.images.show(`${ref(A)} ${ref(B)}`);
    await s.settle(A);
    const version = s.images.version;

    s.images.reset();
    expect(s.revoked).toEqual(["blob:0"]);
    expect(s.images.urls.size).toBe(0);
    expect(s.images.version).toBeGreaterThan(version);

    await s.settle(B);
    expect(s.revoked).toEqual(["blob:0", "blob:1"]);
    expect(s.images.urls.size).toBe(0);
    expect(s.settled()).toBe(0);
  });

  it("reads again after reset when the same text is shown", async () => {
    const s = setup();
    s.images.show(ref(A));
    await s.settle(A);
    s.images.reset();

    s.images.show(ref(A));
    await s.settle(A, PAYLOAD, 1);

    expect(s.reads).toEqual([A, A]);
    expect(s.images.urls).toEqual(new Map([[A, "blob:1"]]));
  });

  it("maps a null result and a thrown error to unavailable", async () => {
    const s = setup();
    s.images.show(`${ref(A)} ${ref(B)} ${ref(C)}`);
    await s.settle(A, null);
    await s.settle(B, new Error("network"));
    await s.settle(C);

    expect(s.images.urls).toEqual(new Map([[C, "blob:0"]]));
    expect(s.settled()).toBe(1);

    s.images.show(`${ref(A)} ${ref(B)} ${ref(C)} again`);
    expect(s.reads).toEqual([A, B, C]);
  });

  it("ignores image syntax inside code", () => {
    const s = setup();
    s.images.show("`" + ref(A) + "`");
    expect(s.reads).toEqual([]);
  });
});
