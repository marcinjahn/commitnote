import { describe, expect, it, vi } from "vitest";
import { deliverArchive } from "./deliver-archive";

function setup(
  options: {
    coarsePointer?: boolean;
    canShare?: boolean;
    share?: () => Promise<void>;
    withShareApi?: boolean;
  } = {},
) {
  const file = new File(["zip"], "export.zip", { type: "application/zip" });
  const download = vi.fn();
  const share = vi.fn(options.share ?? (async () => {}));
  const canShare = vi.fn(() => options.canShare ?? true);
  const withShareApi = options.withShareApi ?? true;
  const run = () =>
    deliverArchive(file, {
      coarsePointer: options.coarsePointer ?? true,
      canShare: withShareApi ? canShare : undefined,
      share: withShareApi ? share : undefined,
      download,
    });
  return { file, download, share, run };
}

describe("deliverArchive", () => {
  it("downloads on a fine pointer even when sharing is available", async () => {
    const { file, download, share, run } = setup({ coarsePointer: false });
    expect(await run()).toBe("downloaded");
    expect(share).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledWith(file);
  });

  it("downloads on a coarse pointer without a share API", async () => {
    const { download, run } = setup({ withShareApi: false });
    expect(await run()).toBe("downloaded");
    expect(download).toHaveBeenCalledOnce();
  });

  it("downloads when the files cannot be shared", async () => {
    const { download, share, run } = setup({ canShare: false });
    expect(await run()).toBe("downloaded");
    expect(share).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledOnce();
  });

  it("shares the file on a coarse pointer", async () => {
    const { file, download, share, run } = setup();
    expect(await run()).toBe("shared");
    expect(share).toHaveBeenCalledOnce();
    expect(share).toHaveBeenCalledWith({ files: [file] });
    expect(download).not.toHaveBeenCalled();
  });

  it("does nothing when the share is cancelled", async () => {
    const { download, run } = setup({
      share: () => Promise.reject(new DOMException("cancel", "AbortError")),
    });
    expect(await run()).toBe("cancelled");
    expect(download).not.toHaveBeenCalled();
  });

  it("falls back to a download when sharing is not allowed", async () => {
    const { file, download, run } = setup({
      share: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
    });
    expect(await run()).toBe("downloaded");
    expect(download).toHaveBeenCalledWith(file);
  });
});
