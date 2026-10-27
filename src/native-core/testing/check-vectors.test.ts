import { describe, expect, it } from "vitest";
import { argon2idDirect } from "../../crypto/argon2";
import { checkTestVectors } from "./check-vectors";

const vectorModules = import.meta.glob<unknown>(
  "../../../apps/test-vectors/*.json",
  { eager: true, import: "default" },
);

function freshFiles(): Record<string, any> {
  return Object.fromEntries(
    Object.entries(vectorModules).map(([path, content]) => [
      path.slice(path.lastIndexOf("/") + 1),
      structuredClone(content),
    ]),
  );
}

function flipLastHexDigit(hex: string): string {
  const last = hex.at(-1)!;
  return hex.slice(0, -1) + (last === "0" ? "1" : "0");
}

describe("checkTestVectors", () => {
  it("reports each tampered vector by file and vector name only", async () => {
    const files = freshFiles();
    files["primitives.json"].aesGcm[1].ciphertextHex = flipLastHexDigit(
      files["primitives.json"].aesGcm[1].ciphertextHex,
    );
    files["notes.json"].notes[2].randomHex += "00";
    files["git-blob-sha1.json"].vectors[0].sha = flipLastHexDigit(
      files["git-blob-sha1.json"].vectors[0].sha,
    );
    delete files["device-trailer.json"];

    const result = await checkTestVectors(files, argon2idDirect);

    expect(result.failures).toEqual([
      "device-trailer.json: format",
      "primitives.json: aesGcm[1]",
      "notes.json: notes[2]",
      "device-trailer.json: trailers",
      "git-blob-sha1.json: vectors[0]",
    ]);
  });
});
