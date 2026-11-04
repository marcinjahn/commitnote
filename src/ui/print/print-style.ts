import { printStylesheet } from "../../print/print-stylesheet";

export const PRINT_VIEW_STYLE =
  "@media print { " +
  printStylesheet({
    root: ".print-view",
    bodyFont: "var(--font-note)",
    monoFont: "var(--font-mono)",
    pageMargin: "18mm",
  }) +
  " }";
