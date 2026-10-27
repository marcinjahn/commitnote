import type { RepositorySummary } from "../../forge/forge-provider";
import { forgeProviders } from "../../forge/registry";
import { isForgeId, type ForgeId } from "../../forge/repo-coordinates";
import {
  initializeNotesRepo,
  inspectRepository,
  listRepositories,
  repositoryLabel,
  unlockNotesRepo,
  type LoginError,
  type LoginStep,
  type NotesRepoTarget,
  type PendingInitialization,
} from "../../login/login";
import type { Session } from "../../session/session";
import type { ForgeAdapter } from "../../forge/forge-adapter";
import {
  DEFAULT_ACCESS_TOKEN_HINT,
  describeLoginStep,
  describeSetUp,
  FOREIGN_REPOSITORY_HINT,
  PUBLIC_REPOSITORY_WARNING,
} from "../../ui/login/login-messages";
import {
  describeStrength,
  loadStrengthChecker,
  strengthUserInputs,
} from "../../ui/passphrase/passphrase-strength";
import type { CoreCommands, RepositoryView } from "../api";
import type { AppSession } from "../app-session";
import { toCoreError, toCoreErrorFromForge } from "../core-errors";
import type { HostServices } from "../host-services";
import {
  CoreCommandError,
  forgeParam,
  notReady,
  stringParam,
  type CommandHandler,
  type EmitCoreEvent,
} from "./command-context";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

interface Listing {
  readonly forge: ForgeId;
  readonly accessToken: string;
  readonly repositories: readonly RepositorySummary[];
}

type Inspected =
  | { readonly kind: "notesRepo"; target: NotesRepoTarget }
  | { readonly kind: "uninitialized"; readonly pending: PendingInitialization };

function repositoryView(summary: RepositorySummary): RepositoryView {
  return {
    label: repositoryLabel(summary.coordinates),
    url: summary.url,
    private: summary.private,
    publicWarning: summary.private ? null : PUBLIC_REPOSITORY_WARNING,
  };
}

export function createLoginCommands(context: {
  readonly host: HostServices;
  readonly app: AppSession;
  readonly emit: EmitCoreEvent;
}): Record<string, CommandHandler> {
  const { host, app, emit } = context;
  let listing: Listing | null = null;
  let inspected: Inspected | null = null;
  let inspectionRun = 0;

  const onStep = (step: LoginStep) => {
    emit("loadingProgress", { step, message: describeLoginStep(step) });
  };

  async function loginFailure(
    error: LoginError,
    forge: ForgeId,
  ): Promise<CoreCommandError> {
    return new CoreCommandError(
      toCoreError(error, {
        source: "login",
        forgeName: await app.forgeName(forge),
      }),
    );
  }

  async function logIn(result: {
    readonly session: Session;
    readonly adapter: ForgeAdapter;
  }): Promise<Result<"login.unlock">> {
    inspectionRun++;
    listing = null;
    inspected = null;
    await app.start({
      session: result.session,
      adapter: result.adapter,
      resumed: false,
    });
    return { kind: "loggedIn" };
  }

  return {
    async "forges.list"(): Promise<Result<"forges.list">> {
      const now = new Date(host.clock.now());
      return {
        forges: forgeProviders(await app.registry()).map((provider) => ({
          id: provider.id,
          name: provider.name,
          accessTokenHint:
            provider.accessTokenHint ?? DEFAULT_ACCESS_TOKEN_HINT,
          accessTokenCreationUrl: provider.accessTokenCreationUrl(now),
          repositoryCreationUrl: provider.repositoryCreationUrl(),
        })),
      };
    },

    async "login.lastRepository"(): Promise<Result<"login.lastRepository">> {
      const forge = app.store.lastForgeId();
      return {
        repoUrl: app.store.lastRepoUrl(),
        forge: isForgeId(forge) ? forge : null,
      };
    },

    async "login.listRepositories"(
      params,
    ): Promise<Result<"login.listRepositories">> {
      inspectionRun++;
      const forge = forgeParam(params, "forge");
      const accessToken = stringParam(params, "accessToken");
      const provider = (await app.registry())[forge];
      onStep("listingRepositories");
      const result = await listRepositories(provider, accessToken);
      if (result.kind === "failed") {
        throw new CoreCommandError(toCoreErrorFromForge(result, provider.name));
      }
      listing = { forge, accessToken, repositories: result.repositories };
      return {
        repositories: result.repositories.map((summary) => ({
          url: summary.url,
          label: repositoryLabel(summary.coordinates),
          private: summary.private,
        })),
      };
    },

    async "login.inspectRepository"(
      params,
    ): Promise<Result<"login.inspectRepository">> {
      const run = ++inspectionRun;
      const forge = forgeParam(params, "forge");
      const accessToken = stringParam(params, "accessToken");
      const repositoryUrl = stringParam(params, "repositoryUrl");
      const summary =
        listing !== null &&
        listing.forge === forge &&
        listing.accessToken === accessToken
          ? listing.repositories.find(
              (candidate) => candidate.url === repositoryUrl,
            )
          : undefined;
      if (summary === undefined) throw notReady();

      inspected = null;
      const state = await inspectRepository(
        summary,
        accessToken,
        await app.loginDeps(),
        onStep,
      );
      const current = run === inspectionRun;
      const repository = repositoryView(summary);
      switch (state.kind) {
        case "notesRepo":
          if (current) inspected = { kind: "notesRepo", target: state.target };
          return { kind: "notesRepo", repository };
        case "uninitialized":
          if (current) {
            inspected = { kind: "uninitialized", pending: state.pending };
          }
          return {
            kind: "uninitialized",
            repository,
            setUpDescription: describeSetUp(state.pending),
          };
        case "unusable":
          return {
            kind: "unusable",
            repository,
            error: toCoreError(state.error, {
              source: "login",
              forgeName: await app.forgeName(forge),
            }),
            canCheckAgain: state.error.kind !== "unauthorized",
            foreignHint:
              state.error.kind === "foreign" ? FOREIGN_REPOSITORY_HINT : null,
          };
      }
    },

    async "login.unlock"(params): Promise<Result<"login.unlock">> {
      const passphrase = stringParam(params, "passphrase");
      const current = inspected;
      if (current?.kind !== "notesRepo") throw notReady();
      const result = await unlockNotesRepo(
        current.target,
        passphrase,
        await app.loginDeps(),
        onStep,
      );
      if (result.kind === "failed") {
        if (result.target !== undefined) current.target = result.target;
        throw await loginFailure(
          result.error,
          current.target.coordinates.forge,
        );
      }
      return logIn(result);
    },

    async "login.initialize"(params): Promise<Result<"login.initialize">> {
      const passphrase = stringParam(params, "passphrase");
      const current = inspected;
      if (current?.kind !== "uninitialized") throw notReady();
      const result = await initializeNotesRepo(
        current.pending,
        passphrase,
        await app.loginDeps(),
        onStep,
      );
      if (result.kind === "failed") {
        throw await loginFailure(
          result.error,
          current.pending.coordinates.forge,
        );
      }
      return logIn(result);
    },

    async "passphrase.strength"(
      params,
    ): Promise<Result<"passphrase.strength">> {
      const passphrase = stringParam(params, "passphrase");
      const label = stringParam(params, "repositoryLabel");
      const checker = await loadStrengthChecker();
      const { score, warning } = checker(passphrase, strengthUserInputs(label));
      return { score, warning, ...describeStrength(score) };
    },
  };
}
