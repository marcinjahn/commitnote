import MarkdownIt from "markdown-it";
import { tasklist } from "@mdit/plugin-tasklist";
import DOMPurify from "dompurify";

const markdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
}).use(tasklist, { disabled: true });

const SAFE_IMAGE_SRC_PREFIXES = ["https:", "data:"];

let purifier: ReturnType<typeof DOMPurify> | undefined;

function getPurifier(): ReturnType<typeof DOMPurify> {
  if (purifier === undefined) {
    purifier = DOMPurify(window);
    purifier.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A" && node.hasAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
      if (node.tagName === "IMG") {
        const src = node.getAttribute("src");
        if (src !== null) {
          const normalized = src.trim().toLowerCase();
          if (
            !SAFE_IMAGE_SRC_PREFIXES.some((prefix) =>
              normalized.startsWith(prefix),
            )
          ) {
            node.removeAttribute("src");
          }
        }
      }
    });
  }
  return purifier;
}

export function renderMarkdown(text: string): string {
  const html = markdownIt.render(text);
  return getPurifier().sanitize(html);
}
