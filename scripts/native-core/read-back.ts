import { parseCommitMessage } from "../../src/changes/commit-message";
import { readDeviceTrailer } from "../../src/changes/device-trailer";
import { argon2idDirect, type Argon2idFunction } from "../../src/crypto/argon2";
import { deriveKeyring, verifyKeyCheck } from "../../src/crypto/keyring";
import { decryptNote } from "../../src/crypto/note-cipher";
import { parseRepoConfig } from "../../src/crypto/repo-config";
import { FakeForgeAdapter } from "../../src/forge/fake/fake-forge-adapter";
import {
  InMemoryGitRepo,
  type GitObjectsSnapshot,
  type StoredCommit,
} from "../../src/forge/fake/in-memory-git-repo";
import {
  APP_ID,
  FORMAT_VERSION,
  INITIALIZE_SUBJECT,
  MAIN_BRANCH,
} from "../../src/format/v1";
import { README_COMMIT_MESSAGE } from "../../src/login/repo-readme";
import { buildNoteTree, findNode } from "../../src/tree/note-tree";

export interface ReadBackScenario {
  name: string;
  passphrase: string;
  exported: string;
  expect: {
    initialized: boolean;
    notes: { path: string[]; text: string }[];
    folders?: string[][];
    deviceName: string | null;
  };
}

function parseExport(
  exported: string,
): { objects: GitObjectsSnapshot; main: string | null } | null {
  try {
    const parsed = JSON.parse(exported) as {
      objects?: GitObjectsSnapshot;
      main?: string | null;
    };
    if (typeof parsed.objects !== "object" || parsed.objects === null) {
      return null;
    }
    return { objects: parsed.objects, main: parsed.main ?? null };
  } catch {
    return null;
  }
}

function mainHistory(
  repo: InMemoryGitRepo,
  head: string,
): StoredCommit[] | null {
  const commits: StoredCommit[] = [];
  let sha: string | null = head;
  while (sha !== null) {
    const commit = repo.getCommit(sha);
    if (commit === undefined) return null;
    commits.push(commit);
    sha = commit.parent;
  }
  return commits;
}

/** Failure strings name the scenario and the check, never note contents or names. */
export async function readBackNativeRepo(
  scenario: ReadBackScenario,
  options: { readonly argon2id?: Argon2idFunction } = {},
): Promise<string[]> {
  const fail = (check: string): string[] => [`${scenario.name}: ${check}`];

  const snapshot = parseExport(scenario.exported);
  if (snapshot === null) return fail("the export is not a repo export");
  if (snapshot.main === null) return fail("the export has no main branch");

  const repo = new InMemoryGitRepo();
  repo.importObjects(snapshot.objects);
  repo.setRef(MAIN_BRANCH, snapshot.main);
  const adapter = new FakeForgeAdapter({ repo });

  const history = mainHistory(repo, snapshot.main);
  if (history === null) return fail("main's history has missing commits");

  const inspection = await adapter.inspect();
  const configText =
    inspection.kind === "populated"
      ? (inspection.main?.repoConfigText ?? null)
      : null;
  if (configText === null) return fail("main has no repo config");
  const parsed = parseRepoConfig(configText);
  if (parsed.kind !== "valid") {
    return fail(`the repo config is ${parsed.kind}`);
  }

  const keyring = await deriveKeyring(
    scenario.passphrase,
    parsed.config.kdf,
    options.argon2id ?? argon2idDirect,
  );
  if (!(await verifyKeyCheck(keyring, parsed.config))) {
    return fail("the passphrase does not pass the key check");
  }

  const failures: string[] = [];

  const readmeCommit = (commit: StoredCommit) =>
    parseCommitMessage(commit.message).subject === README_COMMIT_MESSAGE;
  history.forEach((commit, index) => {
    const message = parseCommitMessage(commit.message);
    const fromApp = message.subject.startsWith(`${APP_ID}:`);
    if (index === 0 && !fromApp && !readmeCommit(commit)) {
      failures.push(...fail("the head commit was not written by the app"));
    }
    if (fromApp && message.formatVersion !== FORMAT_VERSION) {
      failures.push(
        ...fail(
          `commit ${history.length - index} of main has format version ${message.formatVersion ?? "none"}, expected ${FORMAT_VERSION}`,
        ),
      );
    }
  });

  // Initializing ends with a plain README commit, so the device is read from
  // the commit below it.
  const head =
    readmeCommit(history[0]!) && history.length > 1 ? history[1]! : history[0]!;
  const root = history[history.length - 1]!;
  const expectedDevice = scenario.expect.deviceName;
  if (expectedDevice !== null) {
    const headDevice = await readDeviceTrailer(
      head.message,
      keyring.contentKey,
    );
    if (headDevice !== expectedDevice) {
      failures.push(
        ...fail(
          headDevice === null
            ? "the head commit has no readable device trailer"
            : "the head commit's device trailer names a different device",
        ),
      );
    }
  }

  const rootInitializes =
    parseCommitMessage(root.message).subject === INITIALIZE_SUBJECT;
  const rootDevice = await readDeviceTrailer(root.message, keyring.contentKey);
  const initializedHere =
    rootInitializes &&
    (expectedDevice === null || rootDevice === expectedDevice);
  if (scenario.expect.initialized && !initializedHere) {
    failures.push(
      ...fail(
        rootInitializes
          ? "the initialize commit was written by a different device"
          : "main does not start with an initialize commit",
      ),
    );
  }
  if (
    !scenario.expect.initialized &&
    (history.length < 2 || (expectedDevice !== null && initializedHere))
  ) {
    failures.push(
      ...fail(
        "the repo was initialized by this device, but expected to exist before",
      ),
    );
  }

  const tree = await buildNoteTree(
    await adapter.listTree(snapshot.main),
    keyring,
  );
  for (const [index, expected] of scenario.expect.notes.entries()) {
    const label = `expected note ${index + 1}`;
    const node = findNode(tree, expected.path);
    if (node === undefined || node.kind !== "note") {
      failures.push(...fail(`${label} is not in the head tree`));
      continue;
    }
    let text: string;
    try {
      text = await decryptNote(keyring, await adapter.readBlob(node.blobSha));
    } catch {
      failures.push(...fail(`${label} does not decrypt`));
      continue;
    }
    if (text !== expected.text) {
      failures.push(...fail(`${label} has different text`));
    }
  }

  for (const [index, folder] of (scenario.expect.folders ?? []).entries()) {
    const node = findNode(tree, folder);
    if (node === undefined || node.kind !== "folder") {
      failures.push(
        ...fail(`expected folder ${index + 1} is not in the head tree`),
      );
    }
  }

  return failures;
}
