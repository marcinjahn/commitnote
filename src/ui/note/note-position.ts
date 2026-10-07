import type { NotePath } from "../../changes/change";

export interface NotePosition {
  readonly anchor: number;
  readonly head: number;
  readonly scrollTop: number;
}

export interface NotePositions {
  save(path: NotePath, position: NotePosition): void;
  get(path: NotePath): NotePosition | undefined;
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

export function clampNotePosition(
  position: NotePosition,
  docLength: number,
): NotePosition {
  return {
    anchor: clamp(position.anchor, docLength),
    head: clamp(position.head, docLength),
    scrollTop: Math.max(position.scrollTop, 0),
  };
}

export function createNotePositions(): NotePositions {
  const positions = new Map<string, NotePosition>();
  return {
    save(path, position) {
      positions.set(JSON.stringify(path), position);
    },
    get(path) {
      return positions.get(JSON.stringify(path));
    },
  };
}
