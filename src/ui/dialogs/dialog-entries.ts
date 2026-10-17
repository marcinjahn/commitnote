export interface DialogEntriesOptions {
  history: Pick<History, "state" | "pushState" | "replaceState" | "back">;
  events: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  onBack: (count: number) => void;
}

export interface DialogEntries {
  pushDialog(): void;
  consumeDialog(): void;
  dispose(): void;
}

function record(state: unknown): Record<string, unknown> {
  return typeof state === "object" && state !== null && !Array.isArray(state)
    ? (state as Record<string, unknown>)
    : {};
}

function depthOf(state: unknown): number {
  const depth = record(state).dialogDepth;
  return typeof depth === "number" && Number.isInteger(depth) && depth >= 0
    ? depth
    : 0;
}

export function createDialogEntries(
  options: DialogEntriesOptions,
): DialogEntries {
  const { history, events, onBack } = options;
  let written = 0;
  let swallow = 0;

  const onPopState = (event: Event) => {
    if (swallow > 0) {
      swallow -= 1;
      return;
    }
    const state = (event as PopStateEvent).state;
    const landed = depthOf(state);
    if (landed < written) {
      const passed = written - landed;
      written = landed;
      onBack(passed);
    } else if (landed > written) {
      history.replaceState({ ...record(state), dialogDepth: written }, "");
    }
  };

  events.addEventListener("popstate", onPopState);

  return {
    pushDialog() {
      written += 1;
      history.pushState({ ...record(history.state), dialogDepth: written }, "");
    },
    consumeDialog() {
      if (written === 0) return;
      written -= 1;
      swallow += 1;
      history.back();
    },
    dispose() {
      events.removeEventListener("popstate", onPopState);
    },
  };
}
