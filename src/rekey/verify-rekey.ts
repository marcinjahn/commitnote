import { verifyKeyCheck, type Keyring } from "../crypto/keyring";
import { decryptName, encryptName } from "../crypto/name-cipher";
import { decryptNote } from "../crypto/note-cipher";
import { parseRepoConfig } from "../crypto/repo-config";
import {
  blobShasByPath,
  type CommitFileChange,
  type TreeEntry,
} from "../forge/forge-adapter";
import { NOTE_PREFIX, REPO_CONFIG_PATH } from "../format/v1";

type RekeyVerificationFailure =
  | "config"
  | "keyCheck"
  | "collision"
  | "count"
  | "unmapped"
  | "oldKeyName"
  | "content";

export type RekeyVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: RekeyVerificationFailure };

export interface VerifyRekeyInput {
  readonly listing: readonly TreeEntry[];
  /** Text of every blob in `listing`, by blob SHA. */
  readonly contents: ReadonlyMap<string, string>;
  readonly changes: readonly CommitFileChange[];
  readonly oldKeyring: Keyring;
  readonly newKeyring: Keyring;
  readonly newConfigText: string;
}

type ResultContent =
  | { readonly kind: "blob"; readonly sha: string }
  | { readonly kind: "text"; readonly text: string };

class VerificationError extends Error {
  constructor(readonly failure: RekeyVerificationFailure) {
    super(`Re-encryption check failed: ${failure}`);
  }
}

function check(
  condition: boolean,
  failure: RekeyVerificationFailure,
): asserts condition {
  if (!condition) throw new VerificationError(failure);
}

async function tryDecryptNote(
  keyring: Keyring,
  text: string,
): Promise<string | null> {
  if (!text.startsWith(NOTE_PREFIX)) return null;
  try {
    return await decryptNote(keyring, text);
  } catch {
    return null;
  }
}

/**
 * Checks the tree that `changes` produce from scratch, without trusting the
 * plan that made them: every resulting file is traced back to exactly one
 * original file through its names, and must hold the same plaintext,
 * readable with the new keys only.
 */
export async function verifyRekey(
  input: VerifyRekeyInput,
): Promise<RekeyVerification> {
  try {
    await runChecks(input);
    return { ok: true };
  } catch (error) {
    if (error instanceof VerificationError) {
      return { ok: false, failure: error.failure };
    }
    throw error;
  }
}

async function runChecks(input: VerifyRekeyInput): Promise<void> {
  const { contents, oldKeyring, newKeyring } = input;

  const parsed = parseRepoConfig(input.newConfigText);
  check(parsed.kind === "valid", "config");
  check(await verifyKeyCheck(newKeyring, parsed.config), "keyCheck");
  check(!(await verifyKeyCheck(oldKeyring, parsed.config)), "keyCheck");

  const original = blobShasByPath(input.listing);

  const result = new Map<string, ResultContent>();
  for (const [path, sha] of original) result.set(path, { kind: "blob", sha });
  const touched = new Set<string>();
  for (const change of input.changes) {
    check(!touched.has(change.path), "collision");
    touched.add(change.path);
    switch (change.kind) {
      case "delete":
        check(result.delete(change.path), "unmapped");
        break;
      case "upsert-blob":
        check(contents.has(change.blobSha), "unmapped");
        result.set(change.path, { kind: "blob", sha: change.blobSha });
        break;
      case "upsert-text":
        result.set(change.path, { kind: "text", text: change.text });
        break;
    }
  }
  check(result.size === original.size, "count");

  for (const path of result.keys()) {
    const segments = path.split("/");
    for (let depth = 1; depth < segments.length; depth++) {
      check(!result.has(segments.slice(0, depth).join("/")), "collision");
    }
  }

  const oldNames = new Map<string, Promise<string | null>>();
  const newNames = new Map<string, Promise<string | null>>();
  const oldSegments = new Map<string, Promise<string>>();
  function cached<T>(
    cache: Map<string, Promise<T>>,
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    let value = cache.get(key);
    if (value === undefined) {
      value = load();
      cache.set(key, value);
    }
    return value;
  }

  const mapped = new Set<string>();
  for (const [path, content] of result) {
    const segments = path.split("/");
    const sourceSegments: string[] = [];
    let isNotePath = true;
    for (const segment of segments) {
      const asOld = await cached(oldNames, segment, () =>
        decryptName(oldKeyring, segment),
      );
      check(asOld === null, "oldKeyName");
      const asNew = await cached(newNames, segment, () =>
        decryptName(newKeyring, segment),
      );
      if (asNew === null) {
        isNotePath = false;
        sourceSegments.push(segment);
      } else {
        sourceSegments.push(
          await cached(oldSegments, asNew, () =>
            encryptName(oldKeyring, asNew),
          ),
        );
      }
    }
    const sourcePath = sourceSegments.join("/");
    const sourceSha = original.get(sourcePath);
    check(sourceSha !== undefined && !mapped.has(sourcePath), "unmapped");
    mapped.add(sourcePath);

    const newText =
      content.kind === "text" ? content.text : contents.get(content.sha);
    const oldText = contents.get(sourceSha);
    check(newText !== undefined && oldText !== undefined, "content");

    if (path === REPO_CONFIG_PATH) {
      check(newText === input.newConfigText, "config");
      continue;
    }

    const plaintext = await tryDecryptNote(oldKeyring, oldText);
    if (plaintext === null) {
      check(!isNotePath, "content");
      check(
        content.kind === "blob"
          ? content.sha === sourceSha
          : newText === oldText,
        "content",
      );
    } else {
      check((await tryDecryptNote(oldKeyring, newText)) === null, "content");
      check(
        (await tryDecryptNote(newKeyring, newText)) === plaintext,
        "content",
      );
    }
  }
}
