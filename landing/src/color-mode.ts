export function applySavedColorMode(
  storage: Pick<Storage, "getItem">,
  document: Document,
): void {
  try {
    const mode = storage.getItem("commitnote.colorMode");
    if (mode !== "light" && mode !== "dark") return;
    const color = document.querySelector<HTMLMetaElement>(
      `meta[name="theme-color"][media="(prefers-color-scheme: ${mode})"]`,
    )!.content;
    document.documentElement.dataset.colorMode = mode;
    document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')!.content =
      mode;
    document
      .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
      .forEach((meta) => (meta.content = color));
  } catch {}
}
