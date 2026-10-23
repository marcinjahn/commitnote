import { Emoji, GFM, Subscript, Superscript, parser } from "@lezer/markdown";

export const markdownParser = parser.configure([
  GFM,
  Subscript,
  Superscript,
  Emoji,
]);
