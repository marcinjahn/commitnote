import { SvelteMap } from "svelte/reactivity";
import type { NotePath } from "../../changes/change";

export interface TreeExpansion {
  isExpanded(path: NotePath): boolean;
  setExpanded(path: NotePath, expanded: boolean): void;
  expandedPaths(): NotePath[];
}

export function createTreeExpansion(initial: readonly NotePath[] = []): TreeExpansion {
  const entries = new SvelteMap<string, NotePath>();
  const keyOf = (path: NotePath): string => JSON.stringify(path);

  function setExpanded(path: NotePath, expanded: boolean): void {
    const key = keyOf(path);
    if (expanded) {
      if (!entries.has(key)) entries.set(key, [...path]);
    } else {
      entries.delete(key);
    }
  }

  for (const path of initial) setExpanded(path, true);

  return {
    isExpanded: (path) => entries.has(keyOf(path)),
    setExpanded,
    expandedPaths: () => [...entries.values()].map((path) => [...path]),
  };
}
