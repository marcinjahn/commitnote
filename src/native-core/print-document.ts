import { printStylesheet } from "../print/print-stylesheet";

export const PRINT_STYLE = `
:root { color-scheme: light; }
html, body { margin: 0; background: #fff; color: #000; }
.print-view { display: block; }
${printStylesheet({
  root: ".print-view",
  bodyFont: '"commitnote-note", -apple-system, system-ui, sans-serif',
  monoFont: "ui-monospace, Menlo, monospace",
  pageMargin: "16mm",
})}`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function printDocumentHtml(
  name: string,
  bodyHtml: string,
  showTitle: boolean,
): string {
  const escaped = escapeHtml(name);
  const title = showTitle ? `<h1 class="print-title">${escaped}</h1>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escaped}</title><style>${PRINT_STYLE}</style></head><body><main class="print-view">${title}${bodyHtml}</main></body></html>`;
}
