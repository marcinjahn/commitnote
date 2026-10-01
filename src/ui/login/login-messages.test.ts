import { describe, expect, it } from "vitest";
import type { LoginError, LoginStep } from "../../login/login";
import {
  describeLoginError,
  describeLoginStep,
  describeSetUp,
  GENERIC_LOGIN_ERROR,
} from "./login-messages";

describe("describeLoginError", () => {
  it("describes an unauthorized error", () => {
    const error: LoginError = { kind: "unauthorized" };
    expect(describeLoginError(error, "GitHub")).toBe(
      "The access token is invalid or has expired.",
    );
  });

  it("describes a noAccess error", () => {
    const error: LoginError = { kind: "noAccess" };
    expect(describeLoginError(error, "GitHub")).toBe(
      "The repository was not found, or the access token has no access to it.",
    );
  });

  it("describes a network error", () => {
    const error: LoginError = { kind: "network" };
    expect(describeLoginError(error, "GitHub")).toBe(
      "Could not reach GitHub. Check your connection and try again.",
    );
  });

  it("describes a server error", () => {
    const error: LoginError = { kind: "server" };
    expect(describeLoginError(error, "GitHub")).toBe(
      "GitHub returned an error. Try again later.",
    );
  });

  it("describes a readOnly error", () => {
    const error: LoginError = { kind: "readOnly" };
    expect(describeLoginError(error, "GitHub")).toBe(
      'This access token cannot write to the repository. Give it read and write access to the repository contents.',
    );
  });

  it("describes a foreign repository error", () => {
    const error: LoginError = { kind: "foreign" };
    expect(describeLoginError(error, "GitHub")).toBe(
      "This repository has files commitnote does not use. commitnote accepts an empty repository, one with only a README, LICENSE or .gitignore, or a notes repo. Nothing was changed here.",
    );
  });

  it("describes a newerFormat error", () => {
    const error: LoginError = { kind: "newerFormat", formatVersion: 3 };
    expect(describeLoginError(error, "GitHub")).toBe(
      "This notes repo was created by a newer version of commitnote. Update the app to open it.",
    );
  });

  it("describes a wrongPassphrase error", () => {
    const error: LoginError = { kind: "wrongPassphrase" };
    expect(describeLoginError(error, "GitHub")).toBe("Wrong passphrase.");
  });

  it("describes an initializationRaced error", () => {
    const error: LoginError = { kind: "initializationRaced" };
    expect(describeLoginError(error, "GitHub")).toBe(
      "The repository changed while it was being set up. Check it again.",
    );
  });

  it("describes a repositoryChanged error", () => {
    const error: LoginError = { kind: "repositoryChanged" };
    expect(describeLoginError(error, "GitHub")).toBe(
      "The repository changed since it was checked. Check it again.",
    );
  });

  it("describes a noMainBranch error", () => {
    const error: LoginError = { kind: "noMainBranch" };
    expect(describeLoginError(error, "GitHub")).toBe(
      "commitnote needs a branch named main, and this repository has none. Nothing was changed here.",
    );
  });

  it("rounds up to whole minutes for rateLimited", () => {
    const error: LoginError = { kind: "rateLimited", retryAfterMs: 61_000 };
    expect(describeLoginError(error, "GitHub")).toBe(
      "GitHub's rate limit was reached. Try again in 2 minutes.",
    );
  });

  it("floors to a minimum of one minute for rateLimited", () => {
    const error: LoginError = { kind: "rateLimited", retryAfterMs: 1_000 };
    expect(describeLoginError(error, "GitHub")).toBe(
      "GitHub's rate limit was reached. Try again in 1 minute.",
    );
  });

  it("uses the singular form for exactly one minute", () => {
    const error: LoginError = { kind: "rateLimited", retryAfterMs: 60_000 };
    expect(describeLoginError(error, "GitHub")).toBe(
      "GitHub's rate limit was reached. Try again in 1 minute.",
    );
  });

  it("uses the plural form for exactly two minutes", () => {
    const error: LoginError = { kind: "rateLimited", retryAfterMs: 120_000 };
    expect(describeLoginError(error, "GitHub")).toBe(
      "GitHub's rate limit was reached. Try again in 2 minutes.",
    );
  });
});

describe("GENERIC_LOGIN_ERROR", () => {
  it("is the generic fallback copy", () => {
    expect(GENERIC_LOGIN_ERROR).toBe("Something went wrong. Try again.");
  });
});

describe("describeLoginStep", () => {
  const cases: ReadonlyArray<readonly [LoginStep, string]> = [
    ["listingRepositories", "Loading repositories…"],
    ["checkingRepository", "Checking repository…"],
    ["derivingKeys", "Deriving keys from your passphrase…"],
    ["initializing", "Setting up notes repo…"],
  ];

  for (const [step, expected] of cases) {
    it(`describes the ${step} step`, () => {
      expect(describeLoginStep(step)).toBe(expected);
    });
  }
});

describe("describeSetUp", () => {
  it("describes an empty repository", () => {
    expect(describeSetUp({ base: null, existingFiles: [] })).toBe(
      "This repository is empty. Setting it up as a notes repo adds a commitnote configuration file and a README.",
    );
  });

  it("names the kept files of a repository with a README", () => {
    expect(
      describeSetUp({
        base: { hasReadme: true },
        existingFiles: [".gitignore", "LICENSE", "README.md"],
      }),
    ).toBe(
      "This repository holds only .gitignore, LICENSE and README.md. Setting it up as a notes repo keeps them as they are and adds a commitnote configuration file.",
    );
  });

  it("adds a README when the repository has none", () => {
    expect(
      describeSetUp({ base: { hasReadme: false }, existingFiles: ["LICENSE"] }),
    ).toBe(
      "This repository holds only LICENSE. Setting it up as a notes repo keeps it as it is and adds a commitnote configuration file and a README.",
    );
  });
});
