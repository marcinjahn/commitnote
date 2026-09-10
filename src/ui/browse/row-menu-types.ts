export type RowAction =
  "new-note" | "new-folder" | "rename" | "move" | "delete" | "delete-permanently";

export type MenuAnchor =
  | { readonly kind: "rect"; readonly rect: DOMRect }
  | { readonly kind: "point"; readonly x: number; readonly y: number };

export interface MenuItem<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly icon: readonly string[];
  readonly disabled?: boolean;
}

export interface Command extends MenuItem<string> {
  readonly run: () => void;
}
