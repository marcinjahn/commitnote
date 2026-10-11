import { describe, expect, it, vi } from "vitest";
import { createDesktopDownload } from "./desktop-download";

function makeFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "commitnote-export-2026-01-02.zip");
}

describe("createDesktopDownload", () => {
  it("saves the file bytes to the chosen path", async () => {
    const save = vi.fn().mockResolvedValue("/home/u/out.zip");
    const writeFile = vi.fn().mockResolvedValue(undefined);

    const result = await createDesktopDownload({ save, writeFile })(makeFile());

    expect(result).toBe("downloaded");
    expect(save).toHaveBeenCalledWith({
      defaultPath: "commitnote-export-2026-01-02.zip",
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
    });
    expect(writeFile).toHaveBeenCalledWith(
      "/home/u/out.zip",
      new Uint8Array([1, 2, 3]),
    );
  });

  it("reports cancelled without writing", async () => {
    const save = vi.fn().mockResolvedValue(null);
    const writeFile = vi.fn();

    const result = await createDesktopDownload({ save, writeFile })(makeFile());

    expect(result).toBe("cancelled");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("propagates a write failure", async () => {
    const save = vi.fn().mockResolvedValue("/x.zip");
    const writeFile = vi.fn().mockRejectedValue(new Error("disk full"));

    await expect(
      createDesktopDownload({ save, writeFile })(makeFile()),
    ).rejects.toThrow("disk full");
  });

  it("propagates a save dialog failure", async () => {
    const save = vi.fn().mockRejectedValue(new Error("no dialog"));
    const writeFile = vi.fn();

    await expect(
      createDesktopDownload({ save, writeFile })(makeFile()),
    ).rejects.toThrow("no dialog");
    expect(writeFile).not.toHaveBeenCalled();
  });
});
