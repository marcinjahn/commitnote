export function moveActive(index: number, count: number, delta: 1 | -1): number {
  if (count <= 0) return -1;
  if (index < 0) return delta === 1 ? 0 : count - 1;
  return (index + delta + count) % count;
}

export function keepActive(previousKey: string | null, keys: readonly string[]): number {
  if (keys.length === 0) return -1;
  if (previousKey === null) return 0;
  const index = keys.indexOf(previousKey);
  return index === -1 ? 0 : index;
}
