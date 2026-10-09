import type { NotesSnapshot } from "../sync/sync-engine";
import { type ArchiveDelivery, deliverArchive } from "./deliver-archive";
import { buildNotesArchive } from "./notes-archive";

function exportFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `commitnote-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;
}

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function exportNotesArchive(
  snapshot: NotesSnapshot,
): Promise<ArchiveDelivery> {
  const now = new Date();
  const archive = await buildNotesArchive(
    snapshot.tree.root,
    snapshot.readNote,
    now,
  );
  const file = new File([archive], exportFileName(now), {
    type: "application/zip",
  });
  return deliverArchive(file, {
    coarsePointer: matchMedia("(pointer: coarse)").matches,
    canShare:
      typeof navigator.canShare === "function"
        ? navigator.canShare.bind(navigator)
        : undefined,
    share:
      typeof navigator.share === "function"
        ? navigator.share.bind(navigator)
        : undefined,
    download: downloadFile,
  });
}
