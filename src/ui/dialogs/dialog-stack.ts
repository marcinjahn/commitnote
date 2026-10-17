export interface DialogStack<T> {
  register(item: T): void;
  unregister(item: T): void;
  top(): T | null;
  subscribe(listener: (top: T | null) => void): () => void;
  observe(listener: (items: readonly T[]) => void): () => void;
}

export function createDialogStack<T>(): DialogStack<T> {
  const items: T[] = [];
  const listeners = new Set<(top: T | null) => void>();
  const observers = new Set<(items: readonly T[]) => void>();

  function top(): T | null {
    return items.at(-1) ?? null;
  }

  function snapshot(): readonly T[] {
    return Object.freeze([...items]);
  }

  function change(mutate: () => void): void {
    const before = [...items];
    mutate();
    const reordered =
      before.length !== items.length ||
      before.some((item, index) => item !== items[index]);
    if (reordered) {
      const current = snapshot();
      for (const observer of [...observers]) observer(current);
    }
    const after = top();
    if (after === (before.at(-1) ?? null)) return;
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
    observe(listener) {
      observers.add(listener);
      listener(snapshot());
      return () => {
        observers.delete(listener);
      };
    },
  };
}

export const dialogStack = createDialogStack<HTMLDialogElement>();
