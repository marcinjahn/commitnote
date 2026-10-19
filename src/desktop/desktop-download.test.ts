import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopDownload } from "./desktop-download";

function makeFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "commitnote-export-2026-01-02.zip");
}

const defaultPath = async (fileName: string) => `/home/u/Downloads/${fileName}`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createDesktopDownload", () => {
  it("saves the file bytes to the chosen path", async () => {
    const save = vi.fn().mockResolvedValue("/home/u/out.zip");
    const writeFile = vi.fn().mockResolvedValue(undefined);

    const result = await createDesktopDownload({ defaultPath, save, writeFile })(makeFile());

    expect(result).toBe("downloaded");
    expect(save).toHaveBeenCalledWith({
      defaultPath: "/home/u/Downloads/commitnote-export-2026-01-02.zip",
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
    });
    expect(writeFile).toHaveBeenCalledWith(
      "/home/u/out.zip",
      new Uint8Array([1, 2, 3]),
    );
  });

  it("falls back to the bare file name when the default folder cannot be resolved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const save = vi.fn().mockResolvedValue(null);

    await createDesktopDownload({
      defaultPath: () => Promise.reject(new Error("no home")),
      save,
      writeFile: vi.fn(),
    })(makeFile());

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "commitnote-export-2026-01-02.zip" }),
    );
  });

  it("reports cancelled without writing", async () => {
    const save = vi.fn().mockResolvedValue(null);
    const writeFile = vi.fn();

    const result = await createDesktopDownload({ defaultPath, save, writeFile })(makeFile());

    expect(result).toBe("cancelled");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("propagates a write failure", async () => {
    const save = vi.fn().mockResolvedValue("/x.zip");
    const writeFile = vi.fn().mockRejectedValue(new Error("disk full"));

    await expect(
      createDesktopDownload({ defaultPath, save, writeFile })(makeFile()),
    ).rejects.toThrow("disk full");
  });

  it("propagates a save dialog failure", async () => {
    const save = vi.fn().mockRejectedValue(new Error("no dialog"));
    const writeFile = vi.fn();

    await expect(
      createDesktopDownload({ defaultPath, save, writeFile })(makeFile()),
    ).rejects.toThrow("no dialog");
    expect(writeFile).not.toHaveBeenCalled();
  });
});
