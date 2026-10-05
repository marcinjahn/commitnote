import type { NotePath } from "../../changes/change";
import type { NoteDates, NoteDatesResolver } from "../../history/note-dates";
import type { Clock } from "../../sync/clock";
import type { OpenNoteState } from "../../sync/sync-engine";

export interface ShownNoteDates {
  path: NotePath;
  dates: NoteDates;
}

export interface NoteDatesViewDeps {
  resolver: NoteDatesResolver;
  clock: Clock;
  debounceMs: number;
  onShow: (shown: ShownNoteDates | null) => void;
}

export interface NoteDatesViewInput {
  key: string | null;
  blobSha: string | null;
  idle: boolean;
  headHasOpenNote: boolean;
  open: OpenNoteState | null;
  head: string | undefined;
}

export interface NoteDatesView {
  update(input: NoteDatesViewInput): (() => void) | undefined;
}

export function createNoteDatesView(deps: NoteDatesViewDeps): NoteDatesView {
  const { resolver, clock, debounceMs, onShow } = deps;
  // Any change of the loaded note's path starts a new opening: a different
  // note, or the same note relocated. The dates cache for a path is trusted
  // only when the note was opened from its committed blob and the entry was
  // resolved for that blob; otherwise the entry may belong to an earlier note
  // at that path.
  let openingKey: string | null = null;
  let opening = 0;
  let openingHandled = false;
  let openingTrustsCache = false;

  function update(input: NoteDatesViewInput): (() => void) | undefined {
    const { key, blobSha, idle, headHasOpenNote, open, head } = input;
    if (key !== openingKey) {
      openingTrustsCache = openingKey === null && blobSha !== null;
      openingKey = key;
      opening += 1;
      openingHandled = false;
      onShow(null);
    }
    if (key === null || blobSha === null || !headHasOpenNote) return;
    if (open?.kind !== "loaded" || head === undefined) return;
    const path = open.path;

    const justOpened = !openingHandled;
    openingHandled = true;
    if (justOpened && resolver.cached(path)?.blobSha !== blobSha) {
      openingTrustsCache = false;
    }
    if (!openingTrustsCache) {
      resolver.forget(path);
      openingTrustsCache = true;
    }
    const entry = resolver.cached(path);
    if (entry !== null) onShow({ path, dates: entry.dates });
    if (entry?.blobSha === blobSha) return;

    const resolvingFor = opening;
    const resolve = (): void => {
      resolver.resolve(path, head, blobSha).then(
        (dates) => {
          if (resolvingFor === opening) onShow({ path, dates });
        },
        () => {},
      );
    };

    if (justOpened || entry === null) {
      resolve();
      return;
    }
    if (!idle) return;
    const timer = clock.setTimeout(resolve, debounceMs);
    return () => clock.clearTimeout(timer);
  }

  return { update };
}
