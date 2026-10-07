export interface DialogStack<T> {
  register(item: T): void;
  unregister(item: T): void;
  top(): T | null;
  subscribe(listener: (top: T | null) => void): () => void;
}

export function createDialogStack<T>(): DialogStack<T> {
  const items: T[] = [];
  const listeners = new Set<(top: T | null) => void>();

  function top(): T | null {
    return items.at(-1) ?? null;
  }

  function change(mutate: () => void): void {
    const before = top();
    mutate();
    const after = top();
    if (after === before) return;
    for (const listener of [...listeners]) listener(after);
  }

  return {
    register(item) {
      change(() => {
        const index = items.indexOf(item);
        if (index !== -1) items.splice(index, 1);
        items.push(item);
      });
    },
    unregister(item) {
      change(() => {
        const index = items.indexOf(item);
        if (index !== -1) items.splice(index, 1);
      });
    },
    top,
    subscribe(listener) {
      listeners.add(listener);
      listener(top());
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const dialogStack = createDialogStack<HTMLDialogElement>();
