import {
  commitImport,
  enableAtomicCommits,
  importCompletion,
  importedNotePaths,
  importExpandPath,
  routeImportFiles,
  undoFileDrop,
} from "../../app/import-actions";
import type { NotePath } from "../../changes/change";
import {
  planImport,
  type CollisionPolicy,
  type ImportDestination,
} from "../../import/plan-import";
import {
  readDroppedFiles,
  type DroppedFile,
} from "../../import/read-dropped-files";
import { sharesWithin } from "../../share/share-index";
import { validateName } from "../../tree/note-names";
import { describeNameError } from "../../ui/dialogs/name-messages";
import {
  describeImportPreview,
  describeImportRefusal,
  describeNothingDropped,
  IMPORT_MIXED_FILES_MESSAGE,
  IMPORT_RETRYING_MESSAGE,
} from "../../ui/import/import-messages";
import type { ActionNotices } from "../action-notices";
import type { CoreCommands, CoreEvents, ImportOutcomeView } from "../api";
import type { AppSession, NativeRunningApp } from "../app-session";
import type { EngineEvents } from "../engine-events";
import type { HostServices, StagedInput } from "../host-services";
import {
  archiveImagePreparer,
  importStateOf,
  notifyImportState,
  onImportStateChanged,
  openImportArchive,
  type HeldDrop,
  type ImportState,
} from "../import-state";
import {
  importBusy,
  toAtomicBlockedView,
  toImportOutcomeView,
} from "../import-view";
import {
  invalidParams,
  notReady,
  pathParam,
  stringParam,
  type CommandHandler,
  type CommandParams,
  type EmitCoreEvent,
} from "./command-context";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

type DestinationParam =
  | { readonly kind: "valid"; readonly destination: ImportDestination }
  | { readonly kind: "invalidName"; readonly message: string };

function isRecord(value: unknown): value is CommandParams {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function destinationParam(params: CommandParams): DestinationParam {
  const value = params.destination;
  if (!isRecord(value)) throw invalidParams();
  switch (value.kind) {
    case "root":
      return { kind: "valid", destination: { kind: "root" } };
    case "folder": {
      const path = pathParam(value, "path");
      return {
        kind: "valid",
        destination:
          path.length === 0 ? { kind: "root" } : { kind: "folder", path },
      };
    }
    case "newFolder": {
      const parent = pathParam(value, "parent");
      const validation = validateName(stringParam(value, "name"), []);
      if (!validation.ok) {
        return {
          kind: "invalidName",
          message: describeNameError(validation.error),
        };
      }
      return {
        kind: "valid",
        destination: { kind: "new-folder", parent, name: validation.name },
      };
    }
    default:
      throw invalidParams();
  }
}

function policyParam(params: CommandParams): CollisionPolicy {
  const value = params.policy;
  if (value !== "stop" && value !== "rename") throw invalidParams();
  return value;
}

function filesParam(
  params: CommandParams,
): { readonly input: string; readonly name: string }[] {
  const value = params.files;
  if (!Array.isArray(value)) throw invalidParams();
  return value.map((file: unknown) => {
    if (!isRecord(file)) throw invalidParams();
    return {
      input: stringParam(file, "input"),
      name: stringParam(file, "name"),
    };
  });
}

function parentParam(params: CommandParams): NotePath | null {
  return params.parent === null ? null : pathParam(params, "parent");
}

function sourceParam(params: CommandParams): "picker" | "tree" {
  const value = params.source;
  if (value !== "picker" && value !== "tree") throw invalidParams();
  return value;
}

function droppedFile(name: string, input: StagedInput): DroppedFile {
  const { bytes } = input;
  return {
    name,
    size: bytes.byteLength,
    directory: false,
    arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
  };
}

function errorOutcome(message: string): ImportOutcomeView {
  return { kind: "error", message };
}

export function createImportCommands(context: {
  readonly host: HostServices;
  readonly app: AppSession;
  readonly events: EngineEvents;
  readonly notices: ActionNotices;
  readonly emit: EmitCoreEvent;
}): {
  readonly handlers: Record<string, CommandHandler>;
  dispose(): void;
} {
  const { host, app, events, notices, emit } = context;
  let statusKey: string | null = null;

  function running(): NativeRunningApp {
    const current = app.current();
    if (current === null) throw notReady();
    events.attach(current);
    return current;
  }

  function forgeName(): string {
    return app.activeForgeName();
  }

  function emitStatus(): void {
    const current = app.current();
    const engineState = current?.engine.getState() ?? null;
    const payload: CoreEvents["importStatusChanged"] = {
      importing:
        engineState !== null && (engineState.importing || importBusy(app)),
      atomicBlocked:
        engineState === null
          ? null
          : toAtomicBlockedView(engineState.atomicBlocked, forgeName()),
    };
    const key = JSON.stringify(payload);
    if (key === statusKey) return;
    statusKey = key;
    emit("importStatusChanged", payload);
  }

  function shareCountWithin(owner: NativeRunningApp, path: NotePath): number {
    const shares = owner.engine.getState().shares;
    return shares === null ? 0 : sharesWithin(shares, path).length;
  }

  function checkCompletion(): void {
    const owner = app.current();
    if (owner === null) return;
    const state = importStateOf(app);
    const { started } = state;
    const completion = importCompletion(started, owner.engine.getState());
    switch (completion.kind) {
      case "cleared":
        state.started = null;
        notifyImportState(app);
        return;
      case "retrying":
        state.started = { ...started!, retryingShown: true };
        notices.show(owner, "import", "warning", IMPORT_RETRYING_MESSAGE);
        return;
      case "done": {
        state.started = null;
        const { undoPaths } = completion;
        if (undoPaths === null) {
          notices.show(owner, "import", completion.tone, completion.message);
        } else {
          notices.showUndo(owner, "import", completion.message, async () => {
            const result = undoFileDrop(
              { engine: owner.engine },
              undoPaths,
              (path) => shareCountWithin(owner, path),
              null,
            );
            if (result.message !== null) {
              notices.show(owner, "trash", "success", result.message);
            }
            return { kind: "ok" };
          });
        }
        notifyImportState(app);
        return;
      }
      case "none":
        return;
    }
  }

  async function starting<T>(
    state: ImportState,
    run: () => Promise<T>,
  ): Promise<T> {
    state.starting++;
    notifyImportState(app);
    try {
      return await run();
    } finally {
      state.starting--;
      notifyImportState(app);
    }
  }

  function takeInput(input: string): StagedInput {
    const taken = host.stagedInputs.take(input);
    if (taken === null) throw invalidParams();
    return taken;
  }

  async function importDropped(
    owner: NativeRunningApp,
    state: ImportState,
    drop: HeldDrop,
  ): Promise<ImportOutcomeView> {
    const { outcome, plan } = await commitImport(
      { engine: owner.engine, forgeName: forgeName() },
      {
        destination: drop.destination,
        entries: drop.entries,
        policy: "rename",
      },
    );
    state.dropped = outcome.kind === "needsSetup" ? drop : null;
    if (plan === null) return toImportOutcomeView(outcome, forgeName(), null);
    events.clearTagFilter();
    state.started = {
      summary: plan.summary,
      retryingShown: false,
      fileDrop: { paths: importedNotePaths(plan), skipped: drop.skipped },
    };
    checkCompletion();
    return toImportOutcomeView(
      outcome,
      forgeName(),
      importExpandPath(drop.destination, plan),
    );
  }

  const stopEngine = app.onEngineState((engine) => {
    if (engine !== null) checkCompletion();
    emitStatus();
    if (engine === null) statusKey = null;
  });
  const stopState = onImportStateChanged(app, emitStatus);

  const handlers: Record<string, CommandHandler> = {
    async "import.readArchive"(params): Promise<Result<"import.readArchive">> {
      const input = stringParam(params, "input");
      const fileName = stringParam(params, "fileName");
      running();
      const { bytes } = takeInput(input);
      return openImportArchive(app, host, bytes, fileName);
    },

    async "import.preview"(params): Promise<Result<"import.preview">> {
      const destination = destinationParam(params);
      const tree = running().engine.getState().workingTree;
      const { archive } = importStateOf(app);
      if (destination.kind !== "valid" || tree === null || archive === null) {
        return { text: null };
      }
      try {
        const plan = planImport(
          tree,
          destination.destination,
          archive.contents.entries,
          "rename",
        );
        return { text: plan.ok ? describeImportPreview(plan.summary) : null };
      } catch {
        return { text: null };
      }
    },

    async "import.commit"(params): Promise<Result<"import.commit">> {
      const destinationResult = destinationParam(params);
      const policy = policyParam(params);
      const owner = running();
      if (destinationResult.kind === "invalidName") {
        return { outcome: errorOutcome(destinationResult.message) };
      }
      const { destination } = destinationResult;
      const state = importStateOf(app);
      const pending = state.archive;
      if (pending === null) {
        return { outcome: errorOutcome(describeImportRefusal("unavailable")) };
      }
      return starting(state, async () => {
        const preparer = archiveImagePreparer(state, owner, host);
        const images = await preparer.prepare(pending.contents);
        if (!images.ok) return { outcome: errorOutcome(images.message) };
        const { prepared } = images;
        const { outcome, plan } = await commitImport(
          { engine: owner.engine, forgeName: forgeName() },
          {
            destination,
            entries: prepared.entries,
            policy,
            images: prepared.images,
          },
        );
        if (plan === null) {
          return { outcome: toImportOutcomeView(outcome, forgeName(), null) };
        }
        events.clearTagFilter();
        state.archive = null;
        preparer.reset();
        if (plan.changes.length > 0) {
          state.started = {
            summary: plan.summary,
            retryingShown: false,
            images: { added: prepared.added, failed: prepared.failed },
          };
          checkCompletion();
        }
        return {
          outcome: toImportOutcomeView(
            outcome,
            forgeName(),
            importExpandPath(destination, plan),
          ),
        };
      });
    },

    async "import.cancel"(): Promise<Result<"import.cancel">> {
      running();
      const state = importStateOf(app);
      state.archive = null;
      state.preparer?.reset();
      return {};
    },

    async "import.dropFiles"(params): Promise<Result<"import.dropFiles">> {
      const files = filesParam(params);
      const parent = parentParam(params);
      const source = sourceParam(params);
      const owner = running();
      const taken = files.map((file) =>
        droppedFile(file.name, takeInput(file.input)),
      );
      if (source === "picker") {
        const route = routeImportFiles(files);
        if (route.kind !== "notes") {
          return {
            outcome: errorOutcome(
              route.kind === "error"
                ? route.message
                : IMPORT_MIXED_FILES_MESSAGE,
            ),
          };
        }
      }
      const state = importStateOf(app);
      if (owner.engine.getState().importing || importBusy(app)) {
        return { outcome: errorOutcome(describeImportRefusal("unavailable")) };
      }
      return starting(state, async () => {
        const { entries, skipped } = await readDroppedFiles(taken);
        if (entries.length === 0) {
          state.dropped = null;
          return { outcome: errorOutcome(describeNothingDropped(skipped)) };
        }
        const destination: ImportDestination =
          parent === null || parent.length === 0
            ? { kind: "root" }
            : { kind: "folder", path: parent };
        return {
          outcome: await importDropped(owner, state, {
            entries,
            skipped,
            destination,
          }),
        };
      });
    },

    async "import.enableAtomic"(): Promise<Result<"import.enableAtomic">> {
      const owner = running();
      const state = importStateOf(app);
      return starting(state, async () => {
        const error = await enableAtomicCommits({
          engine: owner.engine,
          forgeName: forgeName(),
        });
        if (error !== null) return { error, outcome: null };
        const drop = state.dropped;
        if (drop === null) return { error: null, outcome: null };
        state.dropped = null;
        return {
          error: null,
          outcome: await importDropped(owner, state, drop),
        };
      });
    },

    async "import.saveWithoutAtomic"(): Promise<
      Result<"import.saveWithoutAtomic">
    > {
      running().engine.saveImportWithoutAtomic();
      return {};
    },
  };

  return {
    handlers,
    dispose() {
      stopEngine();
      stopState();
    },
  };
}
