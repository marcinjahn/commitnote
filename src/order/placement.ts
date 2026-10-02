import type { OrderPosition } from "../changes/change";
import { keyBetween, keysBetween } from "./fractional-key";
import type { FolderOrder } from "./order-index";

/**
 * Positions that put `name` at `index` among `siblings`, the other children
 * of its folder in their visible order. Unpositioned siblings get positions
 * too, keeping their current order, so items added later go at the bottom.
 */
export function placementPositions(
  order: FolderOrder | undefined,
  siblings: readonly string[],
  name: string,
  index: number,
): OrderPosition[] {
  const keyOf = (sibling: string): string | undefined => order?.get(sibling);
  let keyed = 0;
  while (keyed < siblings.length && keyOf(siblings[keyed]) !== undefined) {
    keyed++;
  }
  const lastKey = keyed > 0 ? keyOf(siblings[keyed - 1])! : null;
  try {
    if (index < keyed) {
      const key = keyBetween(
        index > 0 ? keyOf(siblings[index - 1])! : null,
        keyOf(siblings[index])!,
      );
      const rest = siblings.slice(keyed);
      const restKeys = keysBetween(lastKey, null, rest.length);
      return [
        { name, key },
        ...rest.map((sibling, i) => ({ name: sibling, key: restKeys[i] })),
      ];
    }
    const tail = [
      ...siblings.slice(keyed, index),
      name,
      ...siblings.slice(index),
    ];
    const keys = keysBetween(lastKey, null, tail.length);
    return tail.map((sibling, i) => ({ name: sibling, key: keys[i] }));
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    // Neighbouring keys are equal (or out of order), so there is no key
    // between them: every sibling is positioned afresh.
    const all = [...siblings.slice(0, index), name, ...siblings.slice(index)];
    const keys = keysBetween(null, null, all.length);
    return all.map((sibling, i) => ({ name: sibling, key: keys[i] }));
  }
}
