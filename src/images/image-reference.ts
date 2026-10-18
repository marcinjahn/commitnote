import type { SyntaxNode } from "@lezer/common";
import { GFM, parser } from "@lezer/markdown";
import { type ImageId, isImageId } from "./image-id";

export interface ImageReference {
  from: number;
  to: number;
  imageId: ImageId;
  alt: string;
  width?: number;
  height?: number;
}

const URL_PATTERN =
  /^image:([a-z2-7]{26})(?:#([1-9][0-9]{0,4})x([1-9][0-9]{0,4}))?$/;
const URL_SCHEME_LENGTH = "image:".length;
const MAX_DIMENSION = 99999;

const markdownParser = parser.configure(GFM);

interface ParsedReference extends ImageReference {
  idFrom: number;
}

function parseAll(text: string): ParsedReference[] {
  const references: ParsedReference[] = [];
  markdownParser.parse(text).iterate({
    enter(node) {
      if (node.name !== "Image") return;
      const reference = readImage(node.node, text);
      if (reference) references.push(reference);
      return false;
    },
  });
  return references;
}

function readImage(node: SyntaxNode, text: string): ParsedReference | null {
  const url = node.getChild("URL");
  if (!url) return null;
  const match = URL_PATTERN.exec(text.slice(url.from, url.to));
  if (!match) return null;

  const marks = node.getChildren("LinkMark");
  const closingBracket = marks.filter((mark) => mark.to <= url.from).at(-2);
  if (!closingBracket || marks[0] === undefined) return null;

  const reference: ParsedReference = {
    from: node.from,
    to: node.to,
    imageId: match[1],
    alt: text.slice(marks[0].to, closingBracket.from),
    idFrom: url.from + URL_SCHEME_LENGTH,
  };
  if (match[2] !== undefined && match[3] !== undefined) {
    reference.width = Number(match[2]);
    reference.height = Number(match[3]);
  }
  return reference;
}

export function parseImageReferences(text: string): ImageReference[] {
  return parseAll(text).map(({ idFrom: _idFrom, ...reference }) => reference);
}

export function referencedImageIds(text: string): Set<ImageId> {
  return new Set(parseAll(text).map((reference) => reference.imageId));
}

function isDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_DIMENSION;
}

export function formatImageReference(input: {
  imageId: ImageId;
  alt: string;
  width: number;
  height: number;
}): string {
  if (!isImageId(input.imageId)) throw new Error("Invalid image id");
  if (!isDimension(input.width) || !isDimension(input.height)) {
    throw new Error("Invalid image dimensions");
  }
  const alt = input.alt
    .replace(/[\\[\]]/g, (char) => `\\${char}`)
    .replace(/\r\n|\r|\n/g, " ");
  return `![${alt}](image:${input.imageId}#${input.width}x${input.height})`;
}

function replaceSpans(
  text: string,
  edits: { from: number; to: number; insert: string }[],
): string {
  let result = "";
  let cursor = 0;
  for (const edit of edits) {
    result += text.slice(cursor, edit.from) + edit.insert;
    cursor = edit.to;
  }
  return result + text.slice(cursor);
}

export function stripImageReferences(
  text: string,
  mode: "alt" | "remove",
): string {
  return replaceSpans(
    text,
    parseAll(text).map((reference) => ({
      from: reference.from,
      to: reference.to,
      insert: mode === "alt" ? reference.alt : "",
    })),
  );
}

export function rewriteImageReferences(
  text: string,
  replacements: ReadonlyMap<ImageId, ImageId>,
): string {
  const edits = parseAll(text).flatMap((reference) => {
    const next = replacements.get(reference.imageId);
    if (next === undefined) return [];
    return [
      {
        from: reference.idFrom,
        to: reference.idFrom + reference.imageId.length,
        insert: next,
      },
    ];
  });
  return replaceSpans(text, edits);
}
