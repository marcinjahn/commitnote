import { deriveKeyring } from "../../crypto/keyring";
import { decryptNote } from "../../crypto/note-cipher";
import { parseRepoConfig } from "../../crypto/repo-config";
import { REPO_CONFIG_PATH } from "../../format/v1";
import {
  sampleImageNote,
  SAMPLE_NOTES_REPO_PASSPHRASE,
  sampleNotesRepoSource,
  type SampleEntry,
} from "../../testing/sample-notes-repo/sample-source";
import {
  createSampleNotesRepoAdapter,
  sampleNotesRepo,
} from "../../testing/sample-notes-repo/seed-sample-notes-repo";
import type { FakeForgeControls } from "../../testing/fake-forge/fake-forge-factory";
import { buildNoteTree, listNotes } from "../../tree/note-tree";
import type { SyncEngine } from "../../sync/sync-engine";
import {
  CoreCommandError,
  invalidParams,
  notReady,
} from "../commands/command-context";
import { coreLevelError } from "../core-errors";
import type { HostServices } from "../host-services";
import { createHostFetch } from "../runtime/fetch";
import { hostArgon2id } from "../runtime/host-argon2";
import { checkTestVectors } from "./check-vectors";

export interface FakeCommandsApp {
  current(): { readonly engine: SyncEngine } | null;
}

type Params = Readonly<Record<string, unknown>>;

function asParams(params: unknown): Params {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw invalidParams();
  }
  return params as Params;
}

function stringParam(params: Params, name: string): string {
  const value = params[name];
  if (typeof value !== "string") throw invalidParams();
  return value;
}

function stringArrayParam(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw invalidParams();
  }
  return value;
}

function flattenNotes(
  entries: readonly SampleEntry[],
  parent: readonly string[] = [],
): { path: string[]; text: string }[] {
  return entries.flatMap((entry) => {
    const path = [...parent, entry.name];
    return entry.kind === "note"
      ? [{ path, text: entry.markdown }]
      : flattenNotes(entry.children, path);
  });
}

async function readSampleImageNote(
  host: HostServices,
): Promise<{ path: string[]; text: string }> {
  const parsed = parseRepoConfig(
    sampleNotesRepo.commits[0]!.files[REPO_CONFIG_PATH]!,
  );
  if (parsed.kind !== "valid") throw new Error("Invalid sample repo config");
  const keyring = await deriveKeyring(
    SAMPLE_NOTES_REPO_PASSPHRASE,
    parsed.config.kdf,
    hostArgon2id(host.crypto),
  );
  const adapter = await createSampleNotesRepoAdapter();
  const tree = await buildNoteTree(
    await adapter.listTree(await adapter.getHead()),
    keyring,
  );
  const path = [...sampleImageNote.folder, sampleImageNote.name];
  const note = listNotes(tree).find(
    (candidate) => candidate.path.join("\u0000") === path.join("\u0000"),
  );
  if (note === undefined) throw new Error("Sample image note is missing");
  return {
    path,
    text: await decryptNote(keyring, await adapter.readBlob(note.blobSha)),
  };
}

export function createFakeCommands(options: {
  readonly getApp: () => FakeCommandsApp;
  readonly controls: () => Promise<FakeForgeControls>;
  readonly host: HostServices;
}): Record<string, (params: unknown) => Promise<unknown>> {
  const { host } = options;
  const hostFetch = createHostFetch(() => host);
  let sampleNotes: Promise<{ path: string[]; text: string }[]> | null = null;

  return {
    async "fake.saveNote"(raw) {
      const params = asParams(raw);
      const path = stringArrayParam(params.path);
      const text = stringParam(params, "text");
      const running = options.getApp().current();
      if (running === null) throw notReady();
      running.engine.editNote(path, text);
      const result = await running.engine.flush();
      if (result.kind !== "saved") {
        throw new CoreCommandError(coreLevelError("internal"));
      }
      return {};
    },

    async "fake.exportRepo"(raw) {
      const repoKey = stringParam(asParams(raw), "repoKey");
      const controls = await options.controls();
      try {
        return { exported: controls.exportRepo(repoKey) };
      } catch {
        throw invalidParams();
      }
    },

    async "fake.expectedSampleNotes"() {
      sampleNotes ??= readSampleImageNote(host).then((image) => [
        ...flattenNotes(sampleNotesRepoSource),
        image,
      ]);
      return { notes: await sampleNotes };
    },

    async "fake.checkVectors"(raw) {
      const files = asParams(raw).files;
      if (typeof files !== "object" || files === null || Array.isArray(files)) {
        throw invalidParams();
      }
      return checkTestVectors(
        files as Record<string, unknown>,
        hostArgon2id(host.crypto),
      );
    },

    async "fake.httpRequest"(raw) {
      const params = asParams(raw);
      const headers = params.headers;
      if (typeof headers !== "object" || headers === null) throw invalidParams();
      const bodyText = stringParam(params, "bodyText");
      const response = await hostFetch(stringParam(params, "url"), {
        method: stringParam(params, "method"),
        headers: headers as Record<string, string>,
        ...(bodyText === "" ? {} : { body: bodyText }),
      });
      const responseHeaders: Record<string, string> = {};
      for (const [name, value] of response.headers) {
        responseHeaders[name.toLowerCase()] = value;
      }
      return {
        status: response.status,
        headers: responseHeaders,
        bodyText: await response.text(),
      };
    },

    async "fake.timerProbe"(raw) {
      const params = asParams(raw);
      const delays = params.delaysMs;
      if (
        !Array.isArray(delays) ||
        !delays.every((delay) => typeof delay === "number")
      ) {
        throw invalidParams();
      }
      const cancelIndex = params.cancelIndex;
      if (cancelIndex !== null && typeof cancelIndex !== "number") {
        throw invalidParams();
      }
      const fired: number[] = [];
      let pending = 0;
      return new Promise<{ fired: number[] }>((resolve) => {
        const handles = delays.map((delay, index) => {
          pending++;
          return setTimeout(() => {
            fired.push(index);
            if (--pending === 0) resolve({ fired });
          }, delay);
        });
        if (cancelIndex !== null && handles[cancelIndex] !== undefined) {
          clearTimeout(handles[cancelIndex]);
          pending--;
        }
        if (pending === 0) resolve({ fired });
      });
    },
  };
}
