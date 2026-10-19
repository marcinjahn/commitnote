import type { ArchiveDownload } from "../export/deliver-archive";

export interface DesktopDownloadDeps {
  defaultPath(fileName: string): Promise<string>;
  save(options: {
    defaultPath: string;
    filters: { name: string; extensions: string[] }[];
  }): Promise<string | null>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
}

async function resolveDefaultPath(
  deps: DesktopDownloadDeps,
  fileName: string,
): Promise<string> {
  try {
    return await deps.defaultPath(fileName);
  } catch (error) {
    console.error(error);
    return fileName;
  }
}

export function createDesktopDownload(
  deps: DesktopDownloadDeps,
): ArchiveDownload {
  return async (file) => {
    const path = await deps.save({
      defaultPath: await resolveDefaultPath(deps, file.name),
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
    });
    if (path === null) return "cancelled";
    await deps.writeFile(path, new Uint8Array(await file.arrayBuffer()));
    return "downloaded";
  };
}
