export interface SettingOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export function parseOptionId<const T extends { readonly id: string }>(
  options: readonly T[],
  raw: unknown,
): T["id"] | undefined {
  return options.find((option) => option.id === raw)?.id;
}
