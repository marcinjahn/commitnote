import type { NotesSnapshot } from "../sync/sync-engine";
import { buildNotesArchive } from "./notes-archive";

function exportFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `commitnote-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;
}

export async function downloadNotesArchive(
  snapshot: NotesSnapshot,
): Promise<void> {
  const now = new Date();
  const archive = await buildNotesArchive(
    snapshot.tree.root,
    snapshot.readNote,
    now,
  );
  const url = URL.createObjectURL(
    new Blob([archive], { type: "application/zip" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFileName(now);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
