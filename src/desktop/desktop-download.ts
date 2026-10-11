import type { ArchiveDownload } from "../export/deliver-archive";

export interface DesktopDownloadDeps {
  save(options: {
    defaultPath: string;
    filters: { name: string; extensions: string[] }[];
  }): Promise<string | null>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
}

export function createDesktopDownload(
  deps: DesktopDownloadDeps,
): ArchiveDownload {
  return async (file) => {
    const path = await deps.save({
      defaultPath: file.name,
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
    });
    if (path === null) return "cancelled";
    await deps.writeFile(path, new Uint8Array(await file.arrayBuffer()));
    return "downloaded";
  };
}
