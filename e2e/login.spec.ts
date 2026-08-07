import { test, expect } from "@playwright/test";
import { logIn, expectTree } from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";
const EMPTY_REPO = "https://github.com/sample/empty";

test("first-time initialization and login", async ({ page }) => {
  await page.goto("/");

  await logIn(page, { repo: EMPTY_REPO, passphrase: "first passphrase" });
  await expect(
    page.getByRole("heading", { name: "Initialize this repository?" }),
  ).toBeVisible();

  await page.getByLabel("Repeat passphrase").fill("a different passphrase");
  await page.getByRole("button", { name: "Initialize notes repo" }).click();
  await expect(page.getByRole("alert")).toHaveText("Passphrases do not match.");

  await page.getByLabel("Repeat passphrase").fill("first passphrase");
  await page.getByRole("button", { name: "Initialize notes repo" }).click();
  // An empty notes repo has no tree, just the empty-state message.
  await expect(page.getByText("No notes yet")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByLabel("Repo URL")).toHaveValue(EMPTY_REPO);
  await expect(page.getByLabel("Access token")).toHaveValue("");
  await expect(page.getByLabel("Passphrase", { exact: true })).toHaveValue("");

  await logIn(page, { repo: EMPTY_REPO, passphrase: "first passphrase" });
  await expect(page.getByText("No notes yet")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Initialize this repository?" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Log out" }).click();
  await logIn(page, { repo: EMPTY_REPO, passphrase: "wrong passphrase" });
  await expect(page.getByRole("alert")).toHaveText("Wrong passphrase.");
});

test("progress is visible", async ({ page }) => {
  await page.goto("/");

  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expect(page.getByRole("status")).toBeVisible();
  await expectTree(page);
});

test("wrong passphrase", async ({ page }) => {
  await page.goto("/");

  await logIn(page, {
    repo: NOTES_REPO,
    passphrase: "not the right passphrase",
  });
  await expect(page.getByRole("alert")).toHaveText("Wrong passphrase.");

  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);
});

test("Remember me across reload", async ({ page }) => {
  await page.goto("/");

  await logIn(page, {
    repo: NOTES_REPO,
    passphrase: NOTES_PASSPHRASE,
    rememberMe: true,
  });
  await expectTree(page);

  await page.reload();
  await expectTree(page);
  await expect(page.getByRole("button", { name: "Log in" })).toHaveCount(0);

  await page.getByRole("button", { name: "Log out" }).click();
  // Wait for the logged-out login screen before reloading, so the reload
  // can't race the async IndexedDB record deletion that log out kicks off.
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  await expect(page.getByLabel("Repo URL")).toHaveValue(NOTES_REPO);
});

test("no Remember me", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("checkbox", { name: "Remember me" }),
  ).not.toBeChecked();

  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.reload();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  await expect(page.getByLabel("Repo URL")).toHaveValue(NOTES_REPO);
  await expect(page.getByLabel("Access token")).toHaveValue("");
  await expect(page.getByLabel("Passphrase", { exact: true })).toHaveValue("");
});

const refusals: ReadonlyArray<{
  readonly name: string;
  readonly repo: string;
  readonly token?: string;
  readonly passphrase: string;
  readonly message: string;
}> = [
  {
    name: "a repo git-notes did not initialize",
    repo: "https://github.com/sample/foreign",
    passphrase: "whatever",
    message:
      "This repository is neither empty nor a notes repo. git-notes only uses an empty repository or one it initialized, and it has not changed anything here.",
  },
  {
    name: "a repo initialized by a newer format version",
    repo: "https://github.com/sample/newer",
    passphrase: "whatever",
    message:
      "This notes repo was created by a newer version of git-notes. Update the app to open it.",
  },
  {
    name: "a read-only notes repo",
    repo: "https://github.com/sample/read-only",
    passphrase: NOTES_PASSPHRASE,
    message:
      'This access token cannot write to the repository. Give it "Contents: read and write" access.',
  },
  {
    name: "a read-only empty repo",
    repo: "https://github.com/sample/empty-read-only",
    passphrase: "whatever",
    message:
      'This access token cannot write to the repository. Give it "Contents: read and write" access.',
  },
  {
    name: "an invalid access token",
    repo: NOTES_REPO,
    token: "invalid-token",
    passphrase: NOTES_PASSPHRASE,
    message: "The access token is invalid or has expired.",
  },
  {
    name: "a repository that does not exist",
    repo: "https://github.com/sample/missing",
    passphrase: "whatever",
    message:
      "The repository was not found, or the access token has no access to it.",
  },
  {
    name: "an unsupported forge",
    repo: "https://gitlab.com/a/b",
    passphrase: "whatever",
    message: "Only github.com repositories are supported, not gitlab.com.",
  },
];

for (const refusal of refusals) {
  test(`refusal: ${refusal.name}`, async ({ page }) => {
    await page.goto("/");

    await logIn(page, {
      repo: refusal.repo,
      token: refusal.token,
      passphrase: refusal.passphrase,
    });

    await expect(page.getByRole("alert")).toHaveText(refusal.message);
    await expect(
      page.getByRole("heading", { name: "Initialize this repository?" }),
    ).toHaveCount(0);
    await expect(page.getByRole("tree", { name: "Notes" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  });
}
