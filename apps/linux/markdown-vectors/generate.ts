import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SyntaxNode } from "@lezer/common";
import { markdownParser } from "../../../src/markdown/markdown-parser";

interface CorpusEntry {
  name: string;
  text: string;
}

interface VectorNode {
  kind: string;
  level?: number;
  checked?: boolean;
  from: number;
  to: number;
}

const directory = dirname(fileURLToPath(import.meta.url));
const corpusPath = join(directory, "corpus.json");
const vectorsPath = join(directory, "vectors.json");

const DIRECT_KINDS: Record<string, string> = {
  CodeBlock: "indentedCode",
  FencedCode: "fencedCode",
  Blockquote: "blockquote",
  HorizontalRule: "horizontalRule",
  BulletList: "bulletList",
  OrderedList: "orderedList",
  ListItem: "listItem",
  Paragraph: "paragraph",
  HardBreak: "hardBreak",
  Emphasis: "emphasis",
  StrongEmphasis: "strongEmphasis",
  Link: "link",
  Image: "image",
  InlineCode: "inlineCode",
  Autolink: "autolink",
  HeaderMark: "headerMark",
  QuoteMark: "quoteMark",
  ListMark: "listMark",
  LinkMark: "linkMark",
  EmphasisMark: "emphasisMark",
  CodeMark: "codeMark",
  CodeText: "codeText",
  CodeInfo: "codeInfo",
  URL: "url",
  Table: "table",
  Task: "task",
  Strikethrough: "strikethrough",
  StrikethroughMark: "strikethroughMark",
};

const DROPPED_NAMES = new Set([
  "Document",
  "HTMLBlock",
  "LinkReference",
  "CommentBlock",
  "ProcessingInstructionBlock",
  "Escape",
  "Entity",
  "HTMLTag",
  "Comment",
  "ProcessingInstruction",
  "LinkTitle",
  "LinkLabel",
  "TableHeader",
  "TableRow",
  "TableCell",
  "TableDelimiter",
  "Subscript",
  "SubscriptMark",
  "Superscript",
  "SuperscriptMark",
  "Emoji",
]);

function mapNode(
  node: SyntaxNode,
  text: string,
): Omit<VectorNode, "from" | "to"> | null {
  const direct = DIRECT_KINDS[node.name];
  if (direct) return { kind: direct };
  const heading = /^(ATX|Setext)Heading([1-6])$/.exec(node.name);
  if (heading) {
    return {
      kind: heading[1] === "ATX" ? "atxHeading" : "setextHeading",
      level: Number(heading[2]),
    };
  }
  if (node.name === "TaskMarker") {
    return {
      kind: "taskMarker",
      checked: (text.charCodeAt(node.from + 1) | 0x20) === 0x78,
    };
  }
  if (DROPPED_NAMES.has(node.name)) return null;
  throw new Error(`unmapped lezer node: ${node.name}`);
}

function children(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    result.push(child);
  }
  return result;
}

function flatten(node: SyntaxNode, text: string, out: VectorNode[]): void {
  const mapped = mapNode(node, text);
  if (mapped && node.from <= node.to) {
    out.push({ ...mapped, from: node.from, to: node.to });
  }
  const kids = children(node);
  if (node.name === "LinkReference") {
    for (const kid of kids) {
      if (kid.name === "QuoteMark") flatten(kid, text, out);
    }
    return;
  }
  if (node.name === "Link" || node.name === "Image") {
    flattenLink(kids, text, out);
    return;
  }
  for (const kid of kids) flatten(kid, text, out);
}

function flattenLink(kids: SyntaxNode[], text: string, out: VectorNode[]): void {
  const marks = kids.filter((kid) => kid.name === "LinkMark");
  const open = marks[0];
  const close = marks[1];
  const inline =
    marks.length >= 4 && text.charCodeAt(close.to) === 0x28 && open.to < close.from;
  for (const kid of kids) {
    flatten(kid, text, out);
    if (inline && kid === open) {
      out.push({ kind: "linkLabel", from: open.to, to: close.from });
    }
  }
}

function build(): string {
  const corpus: CorpusEntry[] = JSON.parse(readFileSync(corpusPath, "utf8"));
  const names = new Set<string>();
  const entries = corpus.map(({ name, text }) => {
    if (names.has(name)) throw new Error(`duplicate corpus entry: ${name}`);
    names.add(name);
    const nodes: VectorNode[] = [];
    flatten(markdownParser.parse(text).topNode, text, nodes);
    return { name, text, nodes };
  });
  return `${JSON.stringify({ entries }, null, 2)}\n`;
}

const generated = build();
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(vectorsPath, "utf8");
  } catch {}
  if (current !== generated) {
    console.error(
      "apps/linux/markdown-vectors/vectors.json is stale: run `npx tsx apps/linux/markdown-vectors/generate.ts` and commit the result",
    );
    process.exit(1);
  }
} else {
  writeFileSync(vectorsPath, generated);
}
