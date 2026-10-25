import type { Page } from "@playwright/test";

export interface ImageSpec {
  readonly width: number;
  readonly height: number;
  readonly shade: number;
  readonly name?: string;
}

export async function pngBase64(page: Page, spec: ImageSpec): Promise<string> {
  return page.evaluate(async ({ width, height, shade }) => {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d")!;
    context.fillStyle = `rgb(${shade}, ${255 - shade}, 128)`;
    context.fillRect(0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, spec);
}

export async function dispatchImages(
  page: Page,
  kind: "paste" | "drop",
  specs: readonly ImageSpec[],
  point?: { x: number; y: number },
): Promise<void> {
  await page.locator(".cm-content").evaluate(
    async (element, { kind, specs, point }) => {
      const data = new DataTransfer();
      for (const { width, height, shade, name } of specs) {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d")!;
        context.fillStyle = `rgb(${shade}, ${255 - shade}, 128)`;
        context.fillRect(0, 0, width, height);
        const blob = await canvas.convertToBlob({ type: "image/png" });
        data.items.add(new File([blob], name ?? "photo.png", { type: "image/png" }));
      }
      if (kind === "paste") {
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          }),
        );
        return;
      }
      for (const type of ["dragenter", "dragover", "drop"]) {
        element.dispatchEvent(
          new DragEvent(type, {
            dataTransfer: data,
            clientX: point?.x,
            clientY: point?.y,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
    { kind, specs, point },
  );
}
