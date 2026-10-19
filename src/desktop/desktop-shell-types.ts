import type { ArchiveDownload } from "../export/deliver-archive";
import type { CloseGuardDeps } from "./close-guard";

export type DesktopCloseGuardDeps = Pick<
  CloseGuardDeps,
  "hasUnsaved" | "flush" | "onUnsavedChange" | "hasSettledUnsaved"
>;

export interface DesktopShell {
  download: ArchiveDownload;
  installCloseGuard(deps: DesktopCloseGuardDeps): () => void;
}
