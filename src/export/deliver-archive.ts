export type ArchiveDelivery = "shared" | "cancelled" | "downloaded";

export interface ArchiveDeliveryEnvironment {
  coarsePointer: boolean;
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
  download: (file: File) => void;
}

export async function deliverArchive(
  file: File,
  environment: ArchiveDeliveryEnvironment,
): Promise<ArchiveDelivery> {
  const { coarsePointer, canShare, share, download } = environment;
  const data: ShareData = { files: [file] };
  if (coarsePointer && canShare && share && canShare(data)) {
    try {
      await share(data);
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return "cancelled";
      }
    }
  }
  download(file);
  return "downloaded";
}
