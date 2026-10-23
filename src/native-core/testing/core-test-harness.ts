import { expect, vi } from "vitest";
import { sharedMemoizedArgon2id } from "../../crypto/testing/shared-argon2id";
import type { ForgeRegistry } from "../../forge/registry";
import { createTestClock } from "../../sync/testing/test-clock";
import {
  createFakeForge,
  type FakeForgeControls,
} from "../../testing/fake-forge/fake-forge-factory";
import { SAMPLE_NOTES_REPO_PASSPHRASE } from "../../testing/sample-notes-repo/sample-source";
import type { CoreEventMessage, CoreResponse, NativeCoreHandle } from "../api";
import type { AppSession } from "../app-session";
import { createNativeCore } from "../native-core";
import { createCryptoShim } from "../runtime/crypto-shim";
import {
  createNodeHostServices,
  type NodeHostServices,
} from "./node-host-services";

const TOKEN = "test-token";

type ExtraCommands = Record<string, (params: unknown) => Promise<unknown>>;
type ExtraCommandsInput = ExtraCommands | ((app: AppSession) => ExtraCommands);

export interface CoreTestContext {
  readonly host: NodeHostServices;
  readonly clock: ReturnType<typeof createTestClock>;
  readonly registry: ForgeRegistry;
  readonly controls: FakeForgeControls;
  readonly cores: NativeCoreHandle[];
  startCore(
    forges?: ForgeRegistry,
    extraCommands?: ExtraCommandsInput,
  ): NativeCoreHandle;
  sendRaw(
    core: NativeCoreHandle,
    message: string,
    id: number,
  ): Promise<CoreResponse>;
  send(
    core: NativeCoreHandle,
    command: string,
    params?: Record<string, unknown>,
  ): Promise<CoreResponse>;
  call(
    core: NativeCoreHandle,
    command: string,
    params?: Record<string, unknown>,
  ): Promise<any>;
  postedMessages(): (CoreResponse | CoreEventMessage)[];
  responsesTo(id: number): CoreResponse[];
  events(name: string): unknown[];
  inspect(core: NativeCoreHandle, repo: string): Promise<any>;
  logIn(core: NativeCoreHandle): Promise<void>;
  dispose(): void;
}

export async function createCoreTestContext(
  options: {
    readonly extraCommands?: ExtraCommandsInput;
    readonly analyticsEndpoint?: string | null;
  } = {},
): Promise<CoreTestContext> {
  const clock = createTestClock(Date.UTC(2026, 9, 1, 12));
  const base = createNodeHostServices({
    clock: {
      now: () => clock.now(),
      setTimeout: (callback, ms) => clock.setTimeout(callback, ms) as number,
      clearTimeout: (id) => clock.clearTimeout(id),
    },
  });
  const host: NodeHostServices = {
    ...base,
    crypto: {
      ...base.crypto,
      argon2id: (input) => sharedMemoizedArgon2id(input),
    },
  };
  const shim = createCryptoShim(() => host);
  vi.stubGlobal("crypto", shim.crypto);
  vi.stubGlobal("CryptoKey", shim.CryptoKey);

  const { registry, controls } = await createFakeForge({
    argon2id: sharedMemoizedArgon2id,
  });
  const cores: NativeCoreHandle[] = [];
  let nextId = 1;

  function resolveExtra(
    input: ExtraCommandsInput | undefined,
    app: AppSession,
  ): ExtraCommands {
    return typeof input === "function" ? input(app) : (input ?? {});
  }

  function startCore(
    forges: ForgeRegistry = registry,
    extraCommands?: ExtraCommandsInput,
  ): NativeCoreHandle {
    const core = createNativeCore({
      host,
      deviceModel: "iPhone",
      analyticsEndpoint: options.analyticsEndpoint ?? null,
      registry: () => Promise.resolve(forges),
      extraCommands: (app) => ({
        ...resolveExtra(options.extraCommands, app),
        ...resolveExtra(extraCommands, app),
      }),
    });
    cores.push(core);
    return core;
  }

  function postedMessages(): (CoreResponse | CoreEventMessage)[] {
    return host.posted.map(
      (message) => JSON.parse(message) as CoreResponse | CoreEventMessage,
    );
  }

  function events(name: string): unknown[] {
    return postedMessages()
      .filter(
        (message): message is CoreEventMessage =>
          message.kind === "event" && message.event === name,
      )
      .map((message) => message.payload);
  }

  function responsesTo(id: number): CoreResponse[] {
    return postedMessages().filter(
      (message): message is CoreResponse =>
        message.kind === "response" && message.id === id,
    );
  }

  async function sendRaw(
    core: NativeCoreHandle,
    message: string,
    id: number,
  ): Promise<CoreResponse> {
    core.send(message);
    return vi.waitFor(
      () => {
        const [response] = responsesTo(id);
        if (response === undefined) throw new Error("No response yet");
        return response;
      },
      { timeout: 20_000, interval: 2 },
    );
  }

  function send(
    core: NativeCoreHandle,
    command: string,
    params: Record<string, unknown> = {},
  ): Promise<CoreResponse> {
    const id = nextId++;
    return sendRaw(core, JSON.stringify({ id, command, params }), id);
  }

  async function call(
    core: NativeCoreHandle,
    command: string,
    params: Record<string, unknown> = {},
  ): Promise<any> {
    const response = await send(core, command, params);
    if (!response.ok)
      throw new Error(`${command} failed: ${response.error.kind}`);
    return response.result;
  }

  async function inspect(core: NativeCoreHandle, repo: string): Promise<any> {
    await call(core, "login.listRepositories", {
      forge: "github",
      accessToken: TOKEN,
    });
    return call(core, "login.inspectRepository", {
      forge: "github",
      accessToken: TOKEN,
      repositoryUrl: `https://github.com/${repo}`,
    });
  }

  async function logIn(core: NativeCoreHandle): Promise<void> {
    await inspect(core, "sample/notes");
    expect(
      await call(core, "login.unlock", {
        passphrase: SAMPLE_NOTES_REPO_PASSPHRASE,
      }),
    ).toEqual({ kind: "loggedIn" });
  }

  return {
    host,
    clock,
    registry,
    controls,
    cores,
    startCore,
    sendRaw,
    send,
    call,
    postedMessages,
    responsesTo,
    events,
    inspect,
    logIn,
    dispose() {
      for (const core of cores) core.stop();
      vi.unstubAllGlobals();
    },
  };
}
