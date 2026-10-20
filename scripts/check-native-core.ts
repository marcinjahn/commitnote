import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  FAKE_CORE_COMMAND_NAMES,
  NATIVE_CORE_API_VERSION,
  NATIVE_CORE_MARKER,
  type CoreError,
  type CoreEventMessage,
  type CoreResponse,
  type NativeCoreGlobal,
  type NativeCoreHandle,
  type OpenNote,
  type TreeNode,
} from "../src/native-core/api";
import type { HostServices } from "../src/native-core/host-services";
import {
  createNodeHostServices,
  type NodeHostServices,
} from "../src/native-core/testing/node-host-services";
import { LARGE_TREE_REPO_KEY } from "../src/testing/sample-notes-repo/large-tree-source";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../src/testing/sample-notes-repo/sample-source";
import { PROD_LEAK_NEEDLES, TAURI_NEEDLES } from "./bundle-needles";
import {
  readBackNativeRepo,
  type ReadBackScenario,
} from "./native-core/read-back";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROD_DIR = join(rootDir, "dist-native-core");
const FAKE_DIR = join(rootDir, "dist-native-core-fake");
const BUNDLE_FILE = "commitnote-core.js";
const VECTORS_DIR = join(rootDir, "apps", "test-vectors");

const DEVICE_MODEL = "Bare host";
const ACCESS_TOKEN = "test-token";
const INITIALIZE_PASSPHRASE = "bare host initialize passphrase";
const EDITED_TEXT = "# Bare host\n\nZażółć gęślą jaźń 🙂\nSecond line\n";
const RESPONSE_TIMEOUT_MS = 60_000;
const PURGE_POLL_MS = 200;
const PURGE_DEADLINE_MS = 30_000;

const WASM_NEEDLES = ["hash-wasm", "WebAssembly"];

const PROD_CORE_NEEDLES: readonly string[] = [
  ...PROD_LEAK_NEEDLES,
  ...TAURI_NEEDLES,
  ...WASM_NEEDLES,
  "webp_enc",
  "AGFzbQ",
  "new Worker",
  "Worker(",
  "argon2.worker",
  "importScripts",
  "serviceWorker",
  "document.",
  "window.",
  "navigator.",
  ...FAKE_CORE_COMMAND_NAMES,
];

const FAKE_CORE_CONTROLS: readonly string[] = [
  "fake.saveNote",
  LARGE_TREE_REPO_KEY,
  SAMPLE_NOTES_REPO_PASSPHRASE,
];

async function bundleFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

async function foundNeedles(
  dir: string,
  needles: readonly string[],
): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  for (const file of await bundleFiles(dir)) {
    const text = await readFile(file, "utf8");
    for (const needle of needles) {
      if (text.includes(needle)) {
        found.set(needle, [...(found.get(needle) ?? []), file]);
      }
    }
  }
  return found;
}

async function leakProblems(): Promise<string[]> {
  const problems: string[] = [];
  const prodHits = await foundNeedles(PROD_DIR, PROD_CORE_NEEDLES);
  for (const [needle, files] of prodHits) {
    problems.push(`the core bundle contains "${needle}" (${files.join(", ")})`);
  }
  const fakeHits = await foundNeedles(FAKE_DIR, WASM_NEEDLES);
  for (const [needle, files] of fakeHits) {
    problems.push(
      `the fake core bundle contains "${needle}" (${files.join(", ")})`,
    );
  }
  return problems;
}

async function positiveControlProblems(): Promise<string[]> {
  const problems: string[] = [];
  const fakeHits = await foundNeedles(FAKE_DIR, [
    ...FAKE_CORE_CONTROLS,
    NATIVE_CORE_MARKER,
  ]);
  for (const needle of FAKE_CORE_CONTROLS) {
    if (!fakeHits.has(needle)) {
      problems.push(
        `the fake core bundle does not contain "${needle}"; the leak check cannot prove it detects a leak`,
      );
    }
  }
  if (!fakeHits.has(NATIVE_CORE_MARKER)) {
    problems.push(
      `the fake core bundle does not contain "${NATIVE_CORE_MARKER}"`,
    );
  }
  if (
    !(await foundNeedles(PROD_DIR, [NATIVE_CORE_MARKER])).has(
      NATIVE_CORE_MARKER,
    )
  ) {
    problems.push(`the core bundle does not contain "${NATIVE_CORE_MARKER}"`);
  }
  return problems;
}

function isUint8Array(value: unknown): value is Uint8Array {
  return Object.prototype.toString.call(value) === "[object Uint8Array]";
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function convertDeep(
  value: unknown,
  bytes: (value: Uint8Array) => Uint8Array,
): unknown {
  if (isUint8Array(value)) return bytes(value);
  if (isThenable(value)) {
    return Promise.resolve(value).then((settled) =>
      convertDeep(settled, bytes),
    );
  }
  if (Array.isArray(value))
    return value.map((item) => convertDeep(item, bytes));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [
        key,
        convertDeep(field, bytes),
      ]),
    );
  }
  return value;
}

/**
 * The core runs in its own realm, where an outer-realm Uint8Array fails
 * `instanceof Uint8Array`; every byte array crossing the boundary is copied
 * into the receiving realm's Uint8Array.
 */
function crossRealmHost(
  host: NodeHostServices,
  innerUint8Array: Uint8ArrayConstructor,
  onPost: (message: string) => void,
): HostServices {
  const toInner = (value: unknown) =>
    convertDeep(value, (bytes) => new innerUint8Array(bytes));
  const toOuter = (value: unknown) =>
    convertDeep(value, (bytes) => Uint8Array.from(bytes));

  const wrapService = <Service extends object>(service: Service): Service =>
    Object.fromEntries(
      Object.entries(service).map(([name, method]) => [
        name,
        (...args: unknown[]) =>
          toInner(
            (method as (...args: unknown[]) => unknown).apply(
              service,
              args.map(toOuter),
            ),
          ),
      ]),
    ) as Service;

  return {
    crypto: wrapService(host.crypto),
    random: wrapService(host.random),
    http: wrapService(host.http),
    clock: wrapService(host.clock),
    rememberedSession: wrapService(host.rememberedSession),
    blobCache: wrapService(host.blobCache),
    deviceSettings: wrapService(host.deviceSettings),
    log: wrapService(host.log),
    post(message) {
      host.post(message);
      onPost(message);
    },
  };
}

class CoreCommandFailure extends Error {
  constructor(
    readonly command: string,
    readonly error: CoreError,
  ) {
    super(`${command} failed with ${error.kind}: ${error.message}`);
  }
}

let nextRequestId = 1;

class BareHostCore {
  readonly events: CoreEventMessage[] = [];
  private readonly pending = new Map<
    number,
    (response: CoreResponse) => void
  >();
  private readonly handle: NativeCoreHandle;

  constructor(
    bundle: vm.Script,
    readonly host: NodeHostServices,
  ) {
    const context = vm.createContext({});
    vm.runInContext("delete globalThis.WebAssembly", context);
    bundle.runInContext(context);
    const core = vm.runInContext("globalThis.CommitnoteNativeCore", context) as
      NativeCoreGlobal | undefined;
    if (core?.apiVersion !== NATIVE_CORE_API_VERSION) {
      throw new Error(
        `the fake core bundle reports native core API version ${String(core?.apiVersion)}, expected ${NATIVE_CORE_API_VERSION}`,
      );
    }
    const innerHost = crossRealmHost(
      host,
      vm.runInContext("Uint8Array", context) as Uint8ArrayConstructor,
      (message) => this.receive(message),
    );
    this.handle = core.start(innerHost, { deviceModel: DEVICE_MODEL });
  }

  private receive(message: string): void {
    const parsed = JSON.parse(message) as CoreResponse | CoreEventMessage;
    if (parsed.kind === "event") {
      this.events.push(parsed);
      return;
    }
    const resolve = this.pending.get(parsed.id);
    this.pending.delete(parsed.id);
    resolve?.(parsed);
  }

  async send<Result>(command: string, params: object = {}): Promise<Result> {
    const id = nextRequestId++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const response = await new Promise<CoreResponse>((resolve, reject) => {
      this.pending.set(id, resolve);
      timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `${command} got no response within ${RESPONSE_TIMEOUT_MS / 1000} s`,
          ),
        );
      }, RESPONSE_TIMEOUT_MS);
      this.handle.send(JSON.stringify({ id, command, params }));
    }).finally(() => clearTimeout(timer));
    if (!response.ok) throw new CoreCommandFailure(command, response.error);
    return response.result as Result;
  }

  async poll<Value>(
    what: string,
    read: () => Promise<Value | null>,
    intervalMs: number,
    deadlineMs: number,
  ): Promise<Value> {
    const deadline = this.host.clock.now() + deadlineMs;
    for (;;) {
      const value = await read();
      if (value !== null) return value;
      if (this.host.clock.now() >= deadline) {
        throw new Error(`${what} did not happen within ${deadlineMs / 1000} s`);
      }
      await new Promise<void>((resolve) => {
        this.host.clock.setTimeout(resolve, intervalMs);
      });
    }
  }

  async logIn(repoKey: string): Promise<string> {
    const { repositories } = await this.send<{
      repositories: { url: string }[];
    }>("login.listRepositories", {
      forge: "github",
      accessToken: ACCESS_TOKEN,
    });
    const repository = repositories.find((candidate) =>
      candidate.url.toLowerCase().endsWith(`/${repoKey}`),
    );
    if (repository === undefined) {
      throw new Error(`login.listRepositories does not list ${repoKey}`);
    }
    const inspected = await this.send<{ kind: string }>(
      "login.inspectRepository",
      {
        forge: "github",
        accessToken: ACCESS_TOKEN,
        repositoryUrl: repository.url,
      },
    );
    return inspected.kind;
  }

  async exportRepo(repoKey: string): Promise<string> {
    return (
      await this.send<{ exported: string }>("fake.exportRepo", { repoKey })
    ).exported;
  }

  stop(): void {
    this.handle.stop();
  }
}

function exportedMain(exported: string): string | null {
  return (JSON.parse(exported) as { main: string | null }).main;
}

function firstNote(nodes: readonly TreeNode[]): string[] | null {
  for (const node of nodes) {
    if (node.kind === "note") return node.path;
    const nested = firstNote(node.children);
    if (nested !== null) return nested;
  }
  return null;
}

async function expectReadBack(scenario: ReadBackScenario): Promise<void> {
  const failures = await readBackNativeRepo(scenario);
  if (failures.length > 0) throw new Error(failures.join("; "));
}

async function vectorFiles(): Promise<Record<string, unknown>> {
  const files: Record<string, unknown> = {};
  for (const name of (await readdir(VECTORS_DIR)).sort()) {
    if (name.endsWith(".json")) {
      files[name] = JSON.parse(await readFile(join(VECTORS_DIR, name), "utf8"));
    }
  }
  return files;
}

async function vectorsCheck(bundle: vm.Script): Promise<string> {
  const core = new BareHostCore(bundle, createNodeHostServices());
  try {
    const files = await vectorFiles();
    const { checked, failures } = await core.send<{
      checked: number;
      failures: string[];
    }>("fake.checkVectors", { files });
    if (failures.length > 0) {
      throw new Error(
        `${failures.length} test vector failures: ${failures.join("; ")}`,
      );
    }
    if (checked === 0) throw new Error("no test vectors were checked");
    return `${checked} test vectors from ${Object.keys(files).length} files pass`;
  } finally {
    core.stop();
  }
}

async function smokeCheck(bundle: vm.Script): Promise<string> {
  const host = createNodeHostServices();

  const login = new BareHostCore(bundle, host);
  try {
    const kind = await login.logIn("sample/notes");
    if (kind !== "notesRepo")
      throw new Error(`sample/notes inspected as ${kind}`);
    await login.send("login.unlock", {
      passphrase: SAMPLE_NOTES_REPO_PASSPHRASE,
    });
  } finally {
    login.stop();
  }

  const resumed = new BareHostCore(bundle, host);
  try {
    const resume = await resumed.send<{ kind: string }>("session.resume");
    if (resume.kind !== "resumed") {
      throw new Error(`session.resume returned ${resume.kind}`);
    }
    const tree = await resumed.poll(
      "loading the tree",
      async () =>
        (await resumed.send<{ tree: TreeNode[] | null }>("tree.get")).tree,
      100,
      RESPONSE_TIMEOUT_MS,
    );
    const path = firstNote(tree);
    if (path === null) throw new Error("the tree holds no note");
    const opened = await resumed.poll(
      "opening the note",
      async () => {
        const { note } = await resumed.send<{ note: OpenNote | null }>(
          "note.open",
          { path },
        );
        if (note === null || note.state === "loading") return null;
        return note;
      },
      100,
      RESPONSE_TIMEOUT_MS,
    );
    if (opened.state !== "loaded") {
      throw new Error(`note.open ended in state ${opened.state}`);
    }
    await resumed.send("fake.saveNote", { path, text: EDITED_TEXT });
    await expectReadBack({
      name: "bare host save",
      passphrase: SAMPLE_NOTES_REPO_PASSPHRASE,
      exported: await resumed.exportRepo("sample/notes"),
      expect: {
        initialized: false,
        notes: [{ path, text: EDITED_TEXT }],
        deviceName: DEVICE_MODEL,
      },
    });
  } finally {
    resumed.stop();
  }
  return `logged in, resumed in a new context (${host.posted.length} messages posted), opened and saved a note, and read the commit back`;
}

async function initializeCheck(bundle: vm.Script): Promise<string> {
  const core = new BareHostCore(bundle, createNodeHostServices());
  try {
    const kind = await core.logIn("sample/empty");
    if (kind !== "uninitialized")
      throw new Error(`sample/empty inspected as ${kind}`);
    await core.send("login.initialize", { passphrase: INITIALIZE_PASSPHRASE });
    await expectReadBack({
      name: "bare host initialize",
      passphrase: INITIALIZE_PASSPHRASE,
      exported: await core.exportRepo("sample/empty"),
      expect: { initialized: true, notes: [], deviceName: DEVICE_MODEL },
    });
  } finally {
    core.stop();
  }
  return "initialized an empty repo and read it back";
}

async function housekeepingCheck(bundle: vm.Script): Promise<string> {
  const core = new BareHostCore(bundle, createNodeHostServices());
  try {
    const kind = await core.logIn("sample/trash");
    if (kind !== "notesRepo")
      throw new Error(`sample/trash inspected as ${kind}`);
    // The zero-latency fake forge can land the purge before login.unlock
    // responds, so the baseline is the fixture's main before unlocking.
    const fixtureMain = exportedMain(await core.exportRepo("sample/trash"));
    const startedAt = core.host.clock.now();
    await core.send("login.unlock", {
      passphrase: SAMPLE_NOTES_REPO_PASSPHRASE,
    });
    const exported = await core.poll(
      "the automatic trash purge commit",
      async () => {
        const current = await core.exportRepo("sample/trash");
        return exportedMain(current) === fixtureMain ? null : current;
      },
      PURGE_POLL_MS,
      PURGE_DEADLINE_MS,
    );
    const waitedMs = core.host.clock.now() - startedAt;
    await expectReadBack({
      name: "bare host housekeeping",
      passphrase: SAMPLE_NOTES_REPO_PASSPHRASE,
      exported,
      expect: { initialized: false, notes: [], deviceName: DEVICE_MODEL },
    });
    return `the trash purge commit landed ${waitedMs} ms after starting to unlock and reads back`;
  } finally {
    core.stop();
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  let failed = false;
  const report = (label: string, problems: string[], passed: string) => {
    if (problems.length === 0) {
      console.log(`PASS ${label}: ${passed}`);
    } else {
      failed = true;
      console.error(
        `FAIL ${label}:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
      );
    }
  };

  report(
    "leak check",
    await leakProblems(),
    `the core bundle contains none of ${PROD_CORE_NEEDLES.length} forbidden strings and neither bundle contains WebAssembly code`,
  );
  report(
    "positive controls",
    await positiveControlProblems(),
    `the fake core bundle contains ${FAKE_CORE_CONTROLS.length} fake-only strings and both bundles carry the native core marker`,
  );

  const bundle = new vm.Script(
    await readFile(join(FAKE_DIR, BUNDLE_FILE), "utf8"),
    {
      filename: join(FAKE_DIR, BUNDLE_FILE),
    },
  );
  for (const [label, check] of [
    ["test vectors", vectorsCheck],
    ["bare-host check", smokeCheck],
    ["bare-host initialize", initializeCheck],
    ["bare-host housekeeping", housekeepingCheck],
  ] as const) {
    try {
      report(label, [], await check(bundle));
    } catch (error) {
      report(label, [describeError(error)], "");
    }
  }

  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
