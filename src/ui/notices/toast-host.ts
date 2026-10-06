import type { ActionReturn } from "svelte/action";
import { dialogStack } from "../dialogs/dialog-stack";

/** Keeps the node inside the topmost open modal dialog, the only part of the page that is not inert. */
export function toastHost(node: HTMLElement): ActionReturn {
  let home: { parent: Node; next: Node | null } | null = null;

  // Re-inserted toasts would replay their @starting-style entry; computing their style while
  // `data-moving` disables transitions makes the move invisible.
  function move(insert: () => void): void {
    node.setAttribute("data-moving", "");
    insert();
    node.getBoundingClientRect();
    node.removeAttribute("data-moving");
  }

  function goHome(): void {
    if (home === null) return;
    const { parent, next } = home;
    home = null;
    // A missing anchor means the home itself was unmounted; re-inserting would leak a stray node.
    if (next !== null && next.parentNode === parent) move(() => parent.insertBefore(node, next));
    else if (next === null && parent.isConnected) move(() => parent.appendChild(node));
  }

  const unsubscribe = dialogStack.subscribe((top) => {
    if (top === null) {
      goHome();
      return;
    }
    if (node.parentNode === top) return;
    if (home === null && node.parentNode !== null) {
      home = { parent: node.parentNode, next: node.nextSibling };
    }
    move(() => top.appendChild(node));
  });

  return {
    destroy() {
      unsubscribe();
      goHome();
    },
  };
}
