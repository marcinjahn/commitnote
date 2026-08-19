export type RowAction =
  "new-note" | "new-folder" | "rename" | "move" | "delete";

export type MenuAnchor =
  | { readonly kind: "rect"; readonly rect: DOMRect }
  | { readonly kind: "point"; readonly x: number; readonly y: number };
