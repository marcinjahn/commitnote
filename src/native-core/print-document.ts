export const PRINT_STYLE = `
:root { color-scheme: light; }
@page { margin: 16mm; }
html, body { margin: 0; background: #fff; color: #000; }
.print-view {
  display: block;
  background: #fff;
  color: #000;
  font: 11pt/1.5 "commitnote-note", -apple-system, system-ui, sans-serif;
  overflow-wrap: break-word;
}
.print-view h1, .print-view h2, .print-view h3,
.print-view h4, .print-view h5, .print-view h6 {
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.25;
  margin: 1.2em 0 0.4em;
  break-after: avoid;
}
.print-view h1 { font-size: 1.75em; }
.print-view h2 { font-size: 1.25em; }
.print-view h3 { font-size: 1.125em; }
.print-view h4, .print-view h5, .print-view h6 { font-size: 1em; }
.print-view .print-title {
  font-size: 2em;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.2;
  padding-bottom: 0.3em;
  border-bottom: 0.5pt solid #000;
  margin: 0 0 1em;
  break-after: avoid;
}
.print-view p { margin: 0 0 0.6em; orphans: 3; widows: 3; }
.print-view ul, .print-view ol { margin: 0 0 0.6em; padding-left: 1.5em; }
.print-view li ul, .print-view li ol { margin-bottom: 0; }
.print-view li > p { margin: 0; }
.print-view li[data-task] { list-style: none; }
.print-view .print-task-box {
  display: inline-block;
  width: 0.8em;
  height: 0.8em;
  border: 0.5pt solid #000;
  vertical-align: -0.1em;
  margin: 0 0.4em 0 -1.2em;
  position: relative;
}
.print-view li[data-task="done"] > .print-task-box::after {
  content: "";
  position: absolute;
  left: 0.22em;
  top: 0;
  width: 0.2em;
  height: 0.42em;
  border: solid #000;
  border-width: 0 1pt 1pt 0;
  transform: rotate(45deg);
}
.print-view blockquote {
  margin: 0 0 0.6em;
  padding-left: 0.9em;
  border-left: 1pt solid #444;
  color: #000;
}
.print-view code, .print-view pre {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 0.875em;
}
.print-view code { background: none; }
.print-view pre {
  border: 0.5pt solid #000;
  padding: 0.5em 0.7em;
  margin: 0 0 0.6em;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.print-view pre code { font-size: inherit; }
.print-view table { border-collapse: collapse; margin: 0 0 0.6em; }
.print-view th, .print-view td {
  border: 0.5pt solid #000;
  padding: 0.2em 0.5em;
  vertical-align: top;
}
.print-view th { font-weight: 600; text-align: left; }
.print-view hr { border: 0; border-top: 0.5pt solid #000; margin: 1em 0; }
.print-view a { color: #000; text-decoration: underline; }
.print-view .print-url { color: #444; font-size: 0.85em; overflow-wrap: anywhere; }
img { max-width: 100%; height: auto; break-inside: avoid; }
.print-view img.print-note-image {
  display: block;
  max-height: 180mm;
  width: auto;
  margin: 0.5em 0;
}
.print-view .print-image-unavailable { font-style: italic; color: #444; }
.print-view pre, .print-view tr, .print-view li,
.print-view blockquote, .print-view .print-image {
  break-inside: avoid;
}
`;

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
