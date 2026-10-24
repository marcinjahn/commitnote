import type { LastView } from "../../app/last-view";
import { repositoryLabel } from "../../login/login";
import {
  createPassphraseChange,
  type CommitPassphraseChangeResult,
  type PassphraseChange,
  type PassphraseChangeFailure,
  type PassphraseChangeStep,
  type PreparedPassphraseChange,
} from "../../rekey/change-passphrase";
import { ENABLE_ATOMIC_LABEL } from "../../ui/import/import-messages";
import {
  CANCEL_LABEL,
  CHANGE_PASSPHRASE_CONFIRM_LABEL,
  CHANGE_PASSPHRASE_CONTINUE_LABEL,
  CHANGE_PASSPHRASE_INTRO,
  CHANGE_PASSPHRASE_TITLE,
  CHANGE_STARTING_LABEL,
  CHECK_AGAIN_LABEL,
  CHECKING_LABEL,
  CURRENT_PASSPHRASE_LABEL,
  describeCarriedOver,
  describeChangeAtomicSetup,
  describeChangeFailure,
  describeChangeStep,
  describeEnableAtomicChangeFailure,
  describePassphraseChanged,
  describeRekeySummary,
  describeRemoveHistory,
  ENTER_CURRENT_PASSPHRASE,
  HISTORY_WARNING,
  LOG_OUT_LABEL,
  NEW_PASSPHRASE_HINT,
  NEW_PASSPHRASE_LABEL,
  otherDevicesWarning,
  PASSPHRASES_DIFFER,
  REMOVE_HISTORY_LABEL,
  REMOVE_HISTORY_REVIEW,
  REPEAT_PASSPHRASE_LABEL,
  VERSION_HISTORY_NOTICE,
} from "../../ui/passphrase/passphrase-messages";
import type { ActionNotices } from "../action-notices";
import type {
  CoreCommands,
  PassphraseChangeCopy,
  PassphraseChangeOutcome,
} from "../api";
import type { AppSession, NativeRunningApp } from "../app-session";
import type { EngineEvents } from "../engine-events";
import type { HostServices } from "../host-services";
import { hostArgon2id } from "../runtime/host-argon2";
import {
  booleanParam,
  invalidParams,
  notReady,
  stringParam,
  type CommandHandler,
  type EmitCoreEvent,
} from "./command-context";

type Result<Name extends keyof CoreCommands> = CoreCommands[Name]["result"];

interface HeldChange {
  readonly owner: NativeRunningApp;
  readonly change: PassphraseChange;
  readonly prepared: PreparedPassphraseChange;
  readonly stage: "review" | "unsettled";
}

function changeCopy(forgeName: string): PassphraseChangeCopy {
  return {
    title: CHANGE_PASSPHRASE_TITLE,
    intro: CHANGE_PASSPHRASE_INTRO,
    currentLabel: CURRENT_PASSPHRASE_LABEL,
    newLabel: NEW_PASSPHRASE_LABEL,
    repeatLabel: REPEAT_PASSPHRASE_LABEL,
    newHint: NEW_PASSPHRASE_HINT,
    removeHistoryLabel: REMOVE_HISTORY_LABEL,
    removeHistoryDescription: describeRemoveHistory(forgeName),
    historyWarning: HISTORY_WARNING,
    otherDevicesWarning: otherDevicesWarning(true),
    versionHistoryNotice: VERSION_HISTORY_NOTICE,
    continueLabel: CHANGE_PASSPHRASE_CONTINUE_LABEL,
    confirmLabel: CHANGE_PASSPHRASE_CONFIRM_LABEL,
    cancelLabel: CANCEL_LABEL,
    checkAgainLabel: CHECK_AGAIN_LABEL,
    checkingLabel: CHECKING_LABEL,
    logOutLabel: LOG_OUT_LABEL,
    startingLabel: CHANGE_STARTING_LABEL,
    enableAtomicLabel: ENABLE_ATOMIC_LABEL,
    passphrasesDiffer: PASSPHRASES_DIFFER,
    enterCurrentPassphrase: ENTER_CURRENT_PASSPHRASE,
  };
}

function progressOf(step: PassphraseChangeStep) {
  const counted = step.kind === "reading" || step.kind === "encrypting";
  return {
    message: describeChangeStep(step),
    done: counted ? step.done : null,
    total: counted ? step.total : null,
  };
}

export function createPassphraseCommands(context: {
  readonly host: HostServices;
  readonly app: AppSession;
  readonly events: EngineEvents;
  readonly notices: ActionNotices;
  readonly emit: EmitCoreEvent;
}): Record<string, CommandHandler> {
  const { host, app, events, notices, emit } = context;
  let held: HeldChange | null = null;
  let busy = false;

  app.onAppStarted(({ engine }) => () => {
    if (held?.owner.engine === engine) held = null;
  });

  function running(): NativeRunningApp {
    const current = app.current();
    if (current === null) throw notReady();
    events.attach(current);
    return current;
  }

  function changeFor(current: NativeRunningApp): PassphraseChange {
    return createPassphraseChange({
      adapter: current.adapter,
      engine: current.engine,
      rateBudget: app.rateBudgetFor(
        current.session.coordinates.forge,
        current.adapter,
      ),
      clock: app.clock,
      argon2id: hostArgon2id(host.crypto),
      deviceName: app.deviceName,
    });
  }

  function forgeNameOf(current: NativeRunningApp): Promise<string> {
    return app.forgeName(current.session.coordinates.forge);
  }

  const onStep = (step: PassphraseChangeStep) => {
    emit("passphraseChangeProgress", progressOf(step));
  };

  async function failureOutcome(
    current: NativeRunningApp,
    failure: PassphraseChangeFailure,
  ): Promise<PassphraseChangeOutcome> {
    const forgeName = await forgeNameOf(current);
    if (failure.kind === "needsSetup") {
      return {
        kind: "needsSetup",
        canConfigure: failure.canConfigure,
        message: describeChangeAtomicSetup(forgeName, failure.canConfigure),
        actionLabel: ENABLE_ATOMIC_LABEL,
      };
    }
    return {
      kind: "failed",
      message: describeChangeFailure(failure, forgeName, host.clock.now()),
      clearCurrent: failure.kind === "wrongPassphrase",
    };
  }

  async function loadLastView(): Promise<LastView | null> {
    try {
      return (await app.lastView()?.load()) ?? null;
    } catch {
      return null;
    }
  }

  async function restart(
    current: NativeRunningApp,
    result: Extract<CommitPassphraseChangeResult, { ok: true }>,
  ): Promise<void> {
    const view = await loadLastView();
    await app.stop({ clearBlobCache: false });
    await app.start({
      session: { ...current.session, keyring: result.keyring },
      adapter: current.sourceAdapter,
      resumed: false,
      purgeBlobCache: true,
    });
    const next = app.current();
    if (next === null) return;
    events.attach(next);
    if (view !== null) app.lastView()?.setEnabled(true, view);
    const notice = describePassphraseChanged(result.check, result.history);
    notices.show(next, "passphrase", notice.tone, notice.text);
  }

  async function finish(
    current: NativeRunningApp,
    pending: HeldChange,
    result: CommitPassphraseChangeResult,
  ): Promise<PassphraseChangeOutcome> {
    if (result.ok) {
      held = null;
      await restart(current, result);
      return { kind: "changed" };
    }
    if (result.unsettled === true) {
      held = { ...pending, stage: "unsettled" };
      return {
        kind: "unsettled",
        message: describeChangeFailure(
          result.failure,
          await forgeNameOf(current),
          host.clock.now(),
        ),
      };
    }
    held = null;
    return failureOutcome(current, result.failure);
  }

  async function exclusively<T>(work: () => Promise<T>): Promise<T> {
    if (busy) throw invalidParams();
    busy = true;
    try {
      return await work();
    } finally {
      busy = false;
    }
  }

  function heldBy(current: NativeRunningApp): HeldChange | null {
    return held?.owner === current ? held : null;
  }

  return {
    async "passphrase.changeForm"(): Promise<Result<"passphrase.changeForm">> {
      const current = running();
      return {
        copy: changeCopy(await forgeNameOf(current)),
        canRemoveHistory: changeFor(current).canRemoveHistory,
        repositoryLabel: repositoryLabel(current.session.coordinates),
      };
    },

    async "passphrase.prepareChange"(
      params,
    ): Promise<Result<"passphrase.prepareChange">> {
      const currentPassphrase = stringParam(params, "current");
      const newPassphrase = stringParam(params, "next");
      const removeHistory = booleanParam(params, "removeHistory");
      return exclusively(async () => {
        const current = running();
        const previous = heldBy(current);
        if (previous?.stage === "unsettled") throw notReady();
        if (previous !== null) {
          held = null;
          previous.change.cancel();
        }
        current.settingsSaver.flush();
        const change = changeFor(current);
        const result = await change.prepare(
          { currentPassphrase, newPassphrase, removeHistory },
          onStep,
        );
        if (!result.ok) {
          return { outcome: await failureOutcome(current, result.failure) };
        }
        if (app.current() !== current) {
          change.cancel();
          throw notReady();
        }
        const { prepared } = result;
        held = { owner: current, change, prepared, stage: "review" };
        return {
          outcome: {
            kind: "review",
            summary: describeRekeySummary(prepared.summary),
            carriedOver: describeCarriedOver(prepared.summary),
            historyWarning: prepared.removeHistory
              ? REMOVE_HISTORY_REVIEW
              : null,
          },
        };
      });
    },

    async "passphrase.commitChange"(): Promise<
      Result<"passphrase.commitChange">
    > {
      return exclusively(async () => {
        const current = running();
        const pending = heldBy(current);
        if (pending?.stage !== "review") throw notReady();
        const result = await pending.change.commit(pending.prepared, onStep);
        return { outcome: await finish(current, pending, result) };
      });
    },

    async "passphrase.settle"(): Promise<Result<"passphrase.settle">> {
      return exclusively(async () => {
        const current = running();
        const pending = heldBy(current);
        if (pending?.stage !== "unsettled") throw notReady();
        const result = await pending.change.settle(pending.prepared);
        return { outcome: await finish(current, pending, result) };
      });
    },

    async "passphrase.cancelChange"(): Promise<
      Result<"passphrase.cancelChange">
    > {
      if (busy) throw invalidParams();
      const current = app.current();
      const pending = current === null ? null : heldBy(current);
      if (pending?.stage === "review") {
        held = null;
        pending.change.cancel();
      }
      return {};
    },

    async "passphrase.enableAtomic"(): Promise<
      Result<"passphrase.enableAtomic">
    > {
      return exclusively(async () => {
        const current = running();
        let enabled = false;
        try {
          enabled =
            (await changeFor(current).enableAtomicCommits()).kind ===
            "available";
        } catch {
          enabled = false;
        }
        return {
          error: enabled
            ? null
            : describeEnableAtomicChangeFailure(await forgeNameOf(current)),
        };
      });
    },
  };
}
