import type { DialogStack } from "./dialog-stack";

export interface DialogHistoryOptions<T> {
  stack: Pick<DialogStack<T>, "observe" | "top">;
  navigation: { pushDialog(): void; consumeDialog(): void };
  requestClose: (item: T) => void;
  settle: () => Promise<void>;
}

export interface DialogHistory {
  closeFromBack(count: number): Promise<void>;
  dispose(): void;
}

export function bindDialogHistory<T>(
  options: DialogHistoryOptions<T>,
): DialogHistory {
  const { stack, navigation, requestClose, settle } = options;
  const closingByBack = new Set<T>();
  let items: readonly T[] = [];
  let disposed = false;

  const unobserve = stack.observe((next) => {
    const previous = items;
    items = next;
    for (const item of previous) {
      if (next.includes(item) || closingByBack.has(item)) continue;
      navigation.consumeDialog();
    }
    for (const item of next) {
      if (!previous.includes(item)) navigation.pushDialog();
    }
  });

  return {
    async closeFromBack(count) {
      if (count <= 0) return;
      const closing = items.slice(-count).reverse();
      for (const item of closing) closingByBack.add(item);
      for (const item of closing) requestClose(item);
      await settle();
      for (const item of closing) {
        closingByBack.delete(item);
        if (!disposed && items.includes(item)) navigation.pushDialog();
      }
    },
    dispose() {
      disposed = true;
      unobserve();
    },
  };
}
