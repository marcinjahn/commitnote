import { describe, expect, it } from "vitest";
import {
  formatImageReference,
  parseImageReferences,
  referencedImageIds,
  rewriteImageReferences,
  stripImageReferences,
} from "./image-reference";
import source from "./image-reference.ts?raw";

const A = "abcdefghijklmnopqrstuvwxyz".slice(0, 26);
const B = "bcdefghijklmnopqrstuvwxyz2";
const C = "cdefghijklmnopqrstuvwxyz23";

describe("parseImageReferences", () => {
  it("parses a reference with dimensions", () => {
    const text = `![cat](image:${A}#640x480)`;
    expect(parseImageReferences(text)).toEqual([
      {
        from: 0,
        to: text.length,
        imageId: A,
        alt: "cat",
        width: 640,
        height: 480,
      },
    ]);
  });

  it("parses a reference without dimensions", () => {
    const [reference] = parseImageReferences(`![](image:${A})`);
    expect(reference).toEqual({ from: 0, to: 37, imageId: A, alt: "" });
    expect("width" in reference).toBe(false);
  });

  it("returns multiple references in document order with spans", () => {
    const first = `![one](image:${A}#1x2)`;
    const second = `![two](image:${B}#3x4)`;
    const text = `intro ${first} middle\n\n${second} end`;
    const references = parseImageReferences(text);
    expect(references.map((r) => r.imageId)).toEqual([A, B]);
    for (const reference of references) {
      expect(text.slice(reference.from, reference.to)).toBe(
        reference.alt === "one" ? first : second,
      );
    }
  });

  it("ignores references inside code", () => {
    const ref = `![x](image:${A}#1x1)`;
    const text = [
      "```",
      ref,
      "```",
      "",
      `    ${ref}`,
      "",
      `inline \`${ref}\` code`,
    ].join("\n");
    expect(parseImageReferences(text)).toEqual([]);
  });

  it.each([
    ["25 chars", A.slice(0, 25)],
    ["27 chars", `${A}a`],
    ["uppercase", A.toUpperCase()],
    ["digit 0", `0${A.slice(1)}`],
    ["digit 1", `1${A.slice(1)}`],
    ["digit 8", `8${A.slice(1)}`],
    ["digit 9", `9${A.slice(1)}`],
  ])("rejects an id with %s", (_name, id) => {
    expect(parseImageReferences(`![x](image:${id}#1x1)`)).toEqual([]);
  });

  it("rejects other schemes and missing url", () => {
    expect(parseImageReferences(`![x](https:${A})`)).toEqual([]);
    expect(parseImageReferences(`![x](https://example.com/${A}.png)`)).toEqual(
      [],
    );
    expect(parseImageReferences("![x]()")).toEqual([]);
  });

  it.each(["#0x5", "#12", "#12x", "#5x0", "#123456x1", "#01x1"])(
    "rejects suffix %s",
    (suffix) => {
      expect(parseImageReferences(`![x](image:${A}${suffix})`)).toEqual([]);
    },
  );

  it("allows a title and ignores it", () => {
    const [reference] = parseImageReferences(`![x](image:${A}#2x3 "title")`);
    expect(reference).toMatchObject({ imageId: A, width: 2, height: 3 });
  });

  it("does not treat links as references", () => {
    expect(parseImageReferences(`[x](image:${A}#1x1)`)).toEqual([]);
  });

  it("round-trips escaped alt text", () => {
    const alt = "a [b] \\ c";
    const text = formatImageReference({
      imageId: A,
      alt,
      width: 10,
      height: 20,
    });
    expect(text).toBe(`![a \\[b\\] \\\\ c](image:${A}#10x20)`);
    const [reference] = parseImageReferences(text);
    expect(reference).toMatchObject({ imageId: A, width: 10, height: 20 });
    expect(reference.to).toBe(text.length);
  });
});

describe("referencedImageIds", () => {
  it("collects unique ids", () => {
    const text = `![a](image:${A}#1x1) ![b](image:${A}#2x2) ![c](image:${B})`;
    expect(referencedImageIds(text)).toEqual(new Set([A, B]));
  });
});

describe("formatImageReference", () => {
  it("replaces line breaks with a space", () => {
    expect(
      formatImageReference({ imageId: A, alt: "a\nb\r\nc", width: 1, height: 1 }),
    ).toBe(`![a b c](image:${A}#1x1)`);
  });

  it("throws on invalid input", () => {
    const valid = { imageId: A, alt: "", width: 1, height: 1 };
    expect(() => formatImageReference({ ...valid, imageId: "nope" })).toThrow();
    expect(() => formatImageReference({ ...valid, width: 0 })).toThrow();
    expect(() => formatImageReference({ ...valid, height: -1 })).toThrow();
    expect(() => formatImageReference({ ...valid, width: 1.5 })).toThrow();
  });
});

describe("stripImageReferences", () => {
  const text = `before ![cat](image:${A}#1x1) mid ![](image:${B}) \`![x](image:${C}#1x1)\` after`;

  it("replaces references with alt text", () => {
    expect(stripImageReferences(text, "alt")).toBe(
      `before cat mid  \`![x](image:${C}#1x1)\` after`,
    );
  });

  it("removes references", () => {
    expect(stripImageReferences(text, "remove")).toBe(
      `before  mid  \`![x](image:${C}#1x1)\` after`,
    );
  });
});

describe("rewriteImageReferences", () => {
  it("replaces only mapped ids and keeps everything else identical", () => {
    const text = `a ![x [y]](image:${A}#1x2 "t") b ![z](image:${B}#3x4) \`![q](image:${A}#1x1)\``;
    const result = rewriteImageReferences(text, new Map([[A, C]]));
    expect(result).toBe(
      `a ![x [y]](image:${C}#1x2 "t") b ![z](image:${B}#3x4) \`![q](image:${A}#1x1)\``,
    );
  });

  it("returns the text unchanged for an empty map", () => {
    const text = `![x](image:${A}#1x1)`;
    expect(rewriteImageReferences(text, new Map())).toBe(text);
  });
});

describe("module dependencies", () => {
  it("imports no codemirror package", () => {
    expect(source).not.toContain("@codemirror/");
  });
});
