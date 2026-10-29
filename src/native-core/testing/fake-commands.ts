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
import type { HoldableOperation } from "../../testing/fake-forge/forge-hold";
import type { ForgeErrorKind } from "../../forge/errors";
import { LARGE_TREE_REPO_KEY } from "../../testing/sample-notes-repo/large-tree-source";
import type { ShareService } from "../../share/share-service";
import { findWorkingNode } from "../../sync/working-tree";
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
  current(): {
    readonly engine: SyncEngine;
    readonly services: { readonly shareService: ShareService };
  } | null;
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

const FAILABLE_OPERATIONS: readonly HoldableOperation[] = [
  "inspect",
  "getHead",
  "listTree",
  "readBlob",
  "readBlobBytes",
  "commit",
  "replaceHistory",
  "createBlob",
  "listCommits",
  "readFileAt",
  "createShare",
  "updateShare",
  "deleteShare",
];

const LOADING_REPOS: readonly string[] = [
  "sample/notes",
  "sample/read-only",
  "sample/search",
  "sample/trash",
  "sample/newer",
  "sample/foreign",
  "sample/almost-empty",
  LARGE_TREE_REPO_KEY,
];

function failableOperation(params: Params): HoldableOperation {
  const operation = FAILABLE_OPERATIONS.find(
    (candidate) => candidate === params.operation,
  );
  if (operation === undefined) throw invalidParams();
  return operation;
}

const FORGE_ERROR_KINDS: readonly ForgeErrorKind[] = [
  "Unauthorized",
  "Forbidden",
  "NotFound",
  "RateLimited",
  "Network",
  "Server",
  "TreeTruncated",
];

function isForgeErrorKind(kind: string): kind is ForgeErrorKind {
  return FORGE_ERROR_KINDS.some((candidate) => candidate === kind);
}

async function fixtureCall(call: () => Promise<void>): Promise<void> {
  try {
    await call();
  } catch {
    throw invalidParams();
  }
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

    async "fake.remoteEdit"(raw) {
      const params = asParams(raw);
      const controls = await options.controls();
      await fixtureCall(() =>
        controls.editNote(
          stringParam(params, "repo"),
          stringArrayParam(params.path),
          stringParam(params, "text"),
          SAMPLE_NOTES_REPO_PASSPHRASE,
          stringParam(params, "device"),
        ),
      );
      return {};
    },

    async "fake.changeRepoKey"(raw) {
      const repo = stringParam(asParams(raw), "repo");
      const controls = await options.controls();
      await fixtureCall(() => controls.changeRepoKey(repo));
      return {};
    },

    async "fake.failNext"(raw) {
      const params = asParams(raw);
      const repo = stringParam(params, "repo");
      const operation = failableOperation(params);
      const kind = stringParam(params, "kind");
      const count = params.count;
      if (!isForgeErrorKind(kind)) throw invalidParams();
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
        throw invalidParams();
      }
      const controls = await options.controls();
      await fixtureCall(async () => {
        for (let queued = 0; queued < count; queued++) {
          controls.failNext(repo, operation, kind);
        }
      });
      return {};
    },

    async "fake.clearFailures"(raw) {
      const params = asParams(raw);
      const repo = stringParam(params, "repo");
      const operation = failableOperation(params);
      const controls = await options.controls();
      await fixtureCall(async () => controls.clearFailures(repo, operation));
      return {};
    },

    async "fake.shareNote"(raw) {
      const path = stringArrayParam(asParams(raw).path);
      const running = options.getApp().current();
      if (running === null) throw notReady();
      const { workingTree } = running.engine.getState();
      if (
        workingTree === null ||
        findWorkingNode(workingTree, path)?.kind !== "note"
      ) {
        throw invalidParams();
      }
      const result = await running.services.shareService.createShare({
        path,
        password: "",
      });
      if (!result.ok) throw new CoreCommandError(coreLevelError("internal"));
      return {};
    },

    async "fake.holdLoading"() {
      const controls = await options.controls();
      for (const repo of LOADING_REPOS) controls.hold(repo, "inspect");
      return {};
    },

    async "fake.releaseLoading"() {
      const controls = await options.controls();
      for (const repo of LOADING_REPOS) controls.release(repo, "inspect");
      return {};
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
