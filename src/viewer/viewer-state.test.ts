import { beforeAll, describe, expect, it, vi } from "vitest";
import { argon2idDirect, type Argon2idFunction } from "../crypto/argon2";
import {
  ShareReadError,
  type ShareLocator,
  type ShareReadErrorKind,
  type ShareReaders,
} from "../forge/share-host";
import { sealShare } from "../share/share-envelope";
import { formatShareLink } from "../share/share-link";
import { createViewerController, type ViewerState } from "./viewer-state";

const NOTE = { name: "Plan", markdown: "# Plan\n", sharedAt: "2026-01-01T00:00:00.000Z", updatedAt: null };
const LOCATORS: Record<"github" | "gitlab", ShareLocator> = {
  github: { provider: "github", gistId: "a".repeat(32) },
  gitlab: { provider: "gitlab", snippetId: "123" },
};

const stubArgon2: Argon2idFunction = async (input) =>
  new Uint8Array(32).fill(input.password.length);

interface Sealed {
  envelope: string;
  linkSecret: string;
}

let plain: Sealed;
let protectedShare: Sealed;

async function seal(password?: string, argon2id: Argon2idFunction = stubArgon2): Promise<Sealed> {
  const result = await sealShare({ ...NOTE, password, argon2id });
  if (result.kind !== "sealed") {
    throw new Error("expected sealed");
  }
  return result;
}

beforeAll(async () => {
  plain = await seal();
  protectedShare = await seal("hunter2", argon2idDirect);
}, 60_000);

function hashFor(provider: "github" | "gitlab", sealed: Sealed): string {
  return new URL(formatShareLink("https://x.test/", LOCATORS[provider], sealed.linkSecret)).hash;
}

function setup(options: {
  read: () => Promise<string>;
  hash?: string;
  supported?: boolean;
  provider?: "github" | "gitlab";
  argon2id?: Argon2idFunction;
  sealed?: Sealed;
}) {
  const read = vi.fn(options.read);
  const readers: ShareReaders = { github: { read }, gitlab: { read } };
  const controller = createViewerController({
    hash: options.hash ?? hashFor(options.provider ?? "github", options.sealed ?? plain),
    readers,
    argon2id: options.argon2id ?? stubArgon2,
    supported: options.supported ?? true,
  });
  return { controller, read };
}

describe("viewer controller", () => {
  it("starts in loading", () => {
    const { controller } = setup({ read: async () => plain.envelope });
    expect(controller.getState()).toEqual({ kind: "loading" });
  });

  it("reports unsupported without reading", async () => {
    const { controller, read } = setup({ read: async () => plain.envelope, supported: false });
    await controller.start();
    expect(controller.getState()).toEqual({
      kind: "error",
      error: "unsupported",
      provider: null,
      retryable: false,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["", "#share=", "#other", "#share=1.gh.zz.yy.xx"])("rejects invalid hash %j", async (hash) => {
    const { controller, read } = setup({ read: async () => plain.envelope, hash });
    await controller.start();
    expect(controller.getState()).toEqual({
      kind: "error",
      error: "invalid",
      provider: null,
      retryable: false,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("opens a share without a password straight to the note", async () => {
    const { controller, read } = setup({ read: async () => plain.envelope, provider: "gitlab" });
    const seen: ViewerState["kind"][] = [];
    controller.subscribe((s) => seen.push(s.kind));
    await controller.start();
    expect(controller.getState()).toEqual({ kind: "note", note: NOTE });
    expect(seen).toEqual(["loading", "note"]);
    expect(read).toHaveBeenCalledWith(LOCATORS.gitlab);
  });

  it("stops notifying after unsubscribe", async () => {
    const { controller } = setup({ read: async () => plain.envelope });
    const listener = vi.fn();
    controller.subscribe(listener)();
    await controller.start();
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    ["notFound", false],
    ["damaged", false],
    ["rateLimited", true],
    ["network", true],
    ["server", true],
  ] as [ShareReadErrorKind, boolean][])("maps reader error %s", async (kind, retryable) => {
    const { controller } = setup({
      read: async () => {
        throw new ShareReadError(kind);
      },
      provider: "gitlab",
    });
    await controller.start();
    expect(controller.getState()).toEqual({ kind: "error", error: kind, provider: "gitlab", retryable });
  });

  it("maps unknown reader errors to a retryable server error", async () => {
    const { controller } = setup({
      read: async () => {
        throw new TypeError("boom");
      },
    });
    await controller.start();
    expect(controller.getState()).toEqual({
      kind: "error",
      error: "server",
      provider: "github",
      retryable: true,
    });
  });

  it("recovers on retry after a network error", async () => {
    let calls = 0;
    const { controller, read } = setup({
      read: async () => {
        calls += 1;
        if (calls === 1) {
          throw new ShareReadError("network");
        }
        return plain.envelope;
      },
    });
    await controller.start();
    expect(controller.getState().kind).toBe("error");
    await controller.retry();
    expect(controller.getState()).toEqual({ kind: "note", note: NOTE });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("ignores retry unless the error is retryable", async () => {
    const { controller, read } = setup({
      read: async () => {
        throw new ShareReadError("notFound");
      },
    });
    await controller.retry();
    expect(read).not.toHaveBeenCalled();
    await controller.start();
    await controller.retry();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reports a malformed envelope as damaged", async () => {
    const { controller } = setup({ read: async () => "not an envelope" });
    await controller.start();
    expect(controller.getState()).toEqual({
      kind: "error",
      error: "damaged",
      provider: "github",
      retryable: false,
    });
  });

  it("reports a tampered passwordless envelope as damaged", async () => {
    const other = await seal();
    const { controller } = setup({ read: async () => other.envelope, sealed: plain });
    await controller.start();
    expect(controller.getState()).toMatchObject({ kind: "error", error: "damaged" });
  });

  describe("password-protected share", () => {
    it("prompts, tolerates wrong passwords, then opens the note without refetching", async () => {
      const { controller, read } = setup({
        read: async () => protectedShare.envelope,
        sealed: protectedShare,
        argon2id: argon2idDirect,
      });
      await controller.start();
      expect(controller.getState()).toEqual({ kind: "password", busy: false, wrongPassword: false });

      await controller.unlock("wrong");
      expect(controller.getState()).toEqual({ kind: "password", busy: false, wrongPassword: true });
      await controller.unlock("still wrong");
      expect(controller.getState()).toEqual({ kind: "password", busy: false, wrongPassword: true });

      await controller.unlock("hunter2");
      expect(controller.getState()).toEqual({ kind: "note", note: NOTE });
      expect(read).toHaveBeenCalledTimes(1);
    }, 60_000);

    it("ignores an empty password", async () => {
      const argon2id = vi.fn(stubArgon2);
      const { controller } = setup({
        read: async () => protectedShare.envelope,
        sealed: protectedShare,
        argon2id,
      });
      await controller.start();
      await controller.unlock("");
      expect(controller.getState()).toEqual({ kind: "password", busy: false, wrongPassword: false });
      expect(argon2id).not.toHaveBeenCalled();
    });

    it("ignores unlock while busy and keeps wrongPassword while busy", async () => {
      let release: (key: Uint8Array) => void = () => {};
      const argon2id = vi.fn<Argon2idFunction>(
        () => new Promise<Uint8Array>((resolve) => (release = resolve)),
      );
      const { controller } = setup({
        read: async () => protectedShare.envelope,
        sealed: protectedShare,
        argon2id,
      });
      await controller.start();
      const first = controller.unlock("one");
      expect(controller.getState()).toEqual({ kind: "password", busy: true, wrongPassword: false });
      await controller.unlock("two");
      expect(argon2id).toHaveBeenCalledTimes(1);
      release(new Uint8Array(32));
      await first;
      expect(controller.getState()).toEqual({ kind: "password", busy: false, wrongPassword: true });
    });

    it("ignores unlock outside the password state", async () => {
      const { controller } = setup({ read: async () => plain.envelope });
      await controller.unlock("x");
      expect(controller.getState()).toEqual({ kind: "loading" });
    });
  });
});
