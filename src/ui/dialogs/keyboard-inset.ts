export interface KeyboardInsetViewport extends Pick<
  EventTarget,
  "addEventListener" | "removeEventListener"
> {
  readonly height: number;
  readonly offsetTop: number;
}

export function keyboardInset(
  layoutHeight: number,
  viewport: { height: number; offsetTop: number },
): number {
  return Math.max(
    0,
    Math.round(layoutHeight - (viewport.height + viewport.offsetTop)),
  );
}

export function startKeyboardInset(options: {
  viewport: KeyboardInsetViewport | null;
  layoutHeight: () => number;
  target: { style: Pick<CSSStyleDeclaration, "setProperty"> };
}): () => void {
  const { viewport, layoutHeight, target } = options;
  let written: number | null = null;

  const write = (inset: number): void => {
    if (inset === written) return;
    written = inset;
    target.style.setProperty("--keyboard-inset", `${inset}px`);
  };

  if (viewport === null) {
    write(0);
    return () => {};
  }

  const update = (): void => write(keyboardInset(layoutHeight(), viewport));
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  return () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
  };
}
