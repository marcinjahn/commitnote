export type ImportOutcome =
  | { readonly kind: "queued" }
  | { readonly kind: "conflicts"; readonly count: number }
  | { readonly kind: "needsSetup"; readonly canConfigure: boolean }
  | { readonly kind: "error"; readonly message: string };
