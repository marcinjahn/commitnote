export function siblingMoveBefore(
  siblings: readonly string[],
  name: string,
  direction: "up" | "down",
): { readonly before: string | null } | null {
  const index = siblings.indexOf(name);
  if (index === -1) return null;
  if (direction === "up") {
    return index === 0 ? null : { before: siblings[index - 1]! };
  }
  return index === siblings.length - 1 ? null : { before: siblings[index + 2] ?? null };
}
