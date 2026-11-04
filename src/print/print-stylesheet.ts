export interface PrintStylesheetOptions {
  readonly root: string;
  readonly bodyFont: string;
  readonly monoFont: string;
  readonly pageMargin: string;
}

export function printStylesheet(options: PrintStylesheetOptions): string {
  const { root: r, bodyFont, monoFont, pageMargin } = options;
  return `
@page { margin: ${pageMargin}; }
${r} {
  background: #fff;
  color: #000;
  font-family: ${bodyFont};
  font-size: 11pt;
  line-height: 1.5;
  overflow-wrap: break-word;
}
${r} .print-body > :first-child { margin-top: 0; }
${r} h1, ${r} h2, ${r} h3,
${r} h4, ${r} h5, ${r} h6 {
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.25;
  margin: 1.2em 0 0.4em;
  break-after: avoid;
}
${r} h1 { font-size: 1.75em; }
${r} h2 { font-size: 1.25em; }
${r} h3 { font-size: 1.125em; }
${r} h4, ${r} h5, ${r} h6 { font-size: 1em; }
${r} .print-title {
  font-size: 2em;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.2;
  padding-bottom: 0.3em;
  border-bottom: 0.5pt solid #000;
  margin: 0 0 1em;
  break-after: avoid;
}
${r} p { margin: 0 0 0.6em; orphans: 3; widows: 3; }
${r} ul, ${r} ol { margin: 0 0 0.6em; padding-left: 1.5em; }
${r} li ul, ${r} li ol { margin-bottom: 0; }
${r} li > p { margin: 0; }
${r} li[data-task] { list-style: none; }
${r} .print-task-box {
  display: inline-block;
  width: 0.8em;
  height: 0.8em;
  border: 0.5pt solid #000;
  vertical-align: -0.1em;
  margin: 0 0.4em 0 -1.2em;
  position: relative;
}
${r} li[data-task="done"] > .print-task-box::after {
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
${r} blockquote {
  margin: 0 0 0.6em;
  padding-left: 0.9em;
  border-left: 1pt solid #444;
  color: #000;
}
${r} code, ${r} pre {
  font-family: ${monoFont};
  font-size: 0.875em;
}
${r} code { background: none; }
${r} pre {
  border: 0.5pt solid #000;
  padding: 0.5em 0.7em;
  margin: 0 0 0.6em;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
${r} pre code { font-size: inherit; }
${r} table { border-collapse: collapse; margin: 0 0 0.6em; }
${r} th, ${r} td {
  border: 0.5pt solid #000;
  padding: 0.2em 0.5em;
  vertical-align: top;
}
${r} th { font-weight: 600; text-align: left; }
${r} hr { border: 0; border-top: 0.5pt solid #000; margin: 1em 0; }
${r} a { color: #000; text-decoration: underline; }
${r} .print-url { color: #444; font-size: 0.85em; overflow-wrap: anywhere; }
${r} img.print-note-image { display: block; max-width: 100%; max-height: 180mm; width: auto; height: auto; margin: 0.5em 0; }
${r} .print-image-unavailable { font-style: italic; color: #444; }
${r} pre, ${r} tr, ${r} li, ${r} blockquote, ${r} .print-image, ${r} img.print-note-image { break-inside: avoid; }
`;
}
