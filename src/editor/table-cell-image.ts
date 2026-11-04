import type { EditorView } from "@codemirror/view";
import { devicePixelRatio, imageSource } from "./image-widgets";
import type { CellImage } from "./table-cell-content";

const CELL_IMAGE_MAX_HEIGHT = 160;

function fitWidth(width: number, height: number): string {
  const natural = width / devicePixelRatio();
  return `${Math.min(natural, (CELL_IMAGE_MAX_HEIGHT * width) / height)}px`;
}

export function renderTableCellImage(
  view: EditorView,
  image: CellImage,
  isAlive: () => boolean,
): HTMLElement {
  const wrapper = document.createElement("span");
  wrapper.className = "cm-table-image";
  wrapper.dataset.imageId = image.imageId;

  const img = document.createElement("img");
  img.alt = image.alt;
  img.draggable = false;

  const alt = document.createElement("span");
  alt.className = "cm-table-image-alt";
  alt.textContent = image.alt || "Image";

  wrapper.append(img, alt);

  if (image.width !== undefined && image.height !== undefined) {
    img.style.width = fitWidth(image.width, image.height);
    img.style.aspectRatio = `${image.width} / ${image.height}`;
  }

  const setState = (state: "loading" | "loaded" | "unavailable"): void => {
    wrapper.dataset.state = state;
  };

  img.addEventListener("load", () => {
    if (!isAlive() || !img.getAttribute("src")) return;
    if (!img.style.width && img.naturalWidth > 0 && img.naturalHeight > 0) {
      img.style.width = fitWidth(img.naturalWidth, img.naturalHeight);
      img.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    }
    setState("loaded");
    view.requestMeasure();
  });
  img.addEventListener("error", () => {
    if (!isAlive() || !img.getAttribute("src")) return;
    setState("unavailable");
    view.requestMeasure();
  });

  const source = view.state.facet(imageSource);
  if (!source) {
    setState("unavailable");
    return wrapper;
  }
  setState("loading");
  source(image.imageId).then(
    (result) => {
      if (!isAlive()) return;
      if ("url" in result) {
        img.src = result.url;
      } else {
        setState("unavailable");
        view.requestMeasure();
      }
    },
    () => {
      if (!isAlive()) return;
      setState("unavailable");
      view.requestMeasure();
    },
  );
  return wrapper;
}
