import type { NoteHistory } from "../history/note-history";
import type { ShareEntry } from "../share/share-index";
import { describeSyncError } from "../ui/browse/sync-messages";
import {
  describeShareDate,
  SHARED_VERSION_GONE_MESSAGE,
  SHARED_VERSION_PASSPHRASE_CHANGED_MESSAGE,
} from "../ui/share/share-messages";

export type SharedVersionOutcome =
  | {
      readonly kind: "readable";
      readonly name: string | null;
      readonly content: string;
      readonly date: string;
    }
  | { readonly kind: "message"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

export async function readSharedVersion(
  deps: {
    readonly noteHistory: Pick<NoteHistory, "readVersion">;
    readonly forgeName: string;
  },
  entry: ShareEntry,
): Promise<SharedVersionOutcome> {
  const { source } = entry;
  if (source === null) {
    return { kind: "message", message: SHARED_VERSION_PASSPHRASE_CHANGED_MESSAGE };
  }
  const result = await deps.noteHistory
    .readVersion({
      sha: source.commit,
      storedPath: source.storedPath,
      committedAt: 0,
      name: null,
      events: [],
    })
    .catch(() => ({ kind: "failed", error: { kind: "server" } }) as const);
  switch (result.kind) {
    case "readable":
      return {
        kind: "readable",
        name: result.name,
        content: result.content,
        date: describeShareDate(entry),
      };
    case "undecryptable":
      return { kind: "message", message: SHARED_VERSION_GONE_MESSAGE };
    case "failed":
      return result.error.kind === "notFound"
        ? { kind: "message", message: SHARED_VERSION_GONE_MESSAGE }
        : {
            kind: "failed",
            message: describeSyncError(result.error, deps.forgeName),
          };
  }
}
