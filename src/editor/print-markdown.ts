import type { ImageId } from "../images/image-id";
import {
  buildPrintNodes,
  PRINT_IMAGE_UNAVAILABLE_TEXT,
  showsPrintTitle,
  type PrintNode,
} from "../print/print-nodes";

export { PRINT_IMAGE_UNAVAILABLE_TEXT, showsPrintTitle };

function materialise(doc: Document, node: PrintNode): Node {
  if (node.kind === "text") return doc.createTextNode(node.text);
  const element = doc.createElement(node.tag);
  for (const [name, value] of node.attrs) {
    if (name === "style") element.style.cssText = value;
    else element.setAttribute(name, value);
  }
  for (const child of node.children) {
    element.appendChild(materialise(doc, child));
  }
  return element;
}

export function renderPrintMarkdown(
  text: string,
  doc: Document = document,
  images: ReadonlyMap<ImageId, string> = new Map(),
): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  for (const node of buildPrintNodes(text, images)) {
    fragment.appendChild(materialise(doc, node));
  }
  return fragment;
}
