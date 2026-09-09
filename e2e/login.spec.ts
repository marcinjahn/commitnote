import { test, expect } from "@playwright/test";
import { continueWithToken, logIn, expectTree } from "./helpers";

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
  await expect(page.getByLabel("Access token")).toHaveValue("");

  await logIn(page, { repo: EMPTY_REPO, passphrase: "first passphrase" });
  await expect(page.getByText("No notes yet")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Initialize this repository?" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Log out" }).click();
  await logIn(page, { repo: EMPTY_REPO, passphrase: "wrong passphrase" });
  await expect(page.getByRole("alert")).toHaveText("Wrong passphrase.");
});

test("an empty repo offers creating a note from the sidebar", async ({
  page,
}) => {
  await page.goto("/");
  await logIn(page, { repo: EMPTY_REPO, passphrase: "first passphrase" });
  await page.getByLabel("Repeat passphrase").fill("first passphrase");
  await page.getByRole("button", { name: "Initialize notes repo" }).click();
  await expect(page.getByText("No notes yet")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "create one" }).click();
  await expect(page.getByRole("textbox", { name: "Note name" })).toBeFocused();
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
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);

  await page.getByRole("button", { name: "Log out" }).click();
  // Wait for the logged-out login screen before reloading, so the reload
  // can't race the async IndexedDB record deletion that log out kicks off.
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await continueWithToken(page);
  await expect(page.getByLabel("Repository", { exact: true })).toHaveValue(
    NOTES_REPO,
  );
});

test("no Remember me", async ({ page }) => {
  await page.goto("/");

  await continueWithToken(page);
  await expect(
    page.getByRole("checkbox", { name: "Remember me" }),
  ).not.toBeChecked();

  await logIn(page, { repo: NOTES_REPO, passphrase: NOTES_PASSPHRASE });
  await expectTree(page);

  await page.reload();
  await expect(page.getByLabel("Access token")).toHaveValue("");
  await continueWithToken(page);
  await expect(page.getByLabel("Repository", { exact: true })).toHaveValue(
    NOTES_REPO,
  );
  await expect(page.getByLabel("Passphrase", { exact: true })).toHaveValue("");
});

test("the token link opens a pre-filled fine-grained token form", async ({
  page,
}) => {
  await page.goto("/");

  const link = page.getByRole("link", { name: "Create a token on GitHub" });
  const url = new URL((await link.getAttribute("href")) ?? "");
  expect(url.origin + url.pathname).toBe(
    "https://github.com/settings/personal-access-tokens/new",
  );
  expect(url.searchParams.get("contents")).toBe("write");
  await expect(link).toHaveAttribute("target", "_blank");
});

test("the repository list comes from the access token", async ({ page }) => {
  await page.goto("/");

  await continueWithToken(page);
  const repository = page.getByLabel("Repository", { exact: true });
  await expect(repository).toHaveValue("");
  await expect(repository.getByRole("option")).toHaveText([
    "Choose a repository",
    "sample/empty",
    "sample/empty-read-only",
    "sample/foreign",
    "sample/newer",
    "sample/notes",
    "sample/read-only",
    "sample/trash",
  ]);

  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Choose a repository.");

  await page.getByLabel("Access token").fill("another-token");
  await expect(repository).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
});

test("refusal: an invalid access token", async ({ page }) => {
  await page.goto("/");

  await continueWithToken(page, "invalid-token");

  await expect(page.getByRole("alert")).toHaveText(
    "The access token is invalid or has expired.",
  );
  await expect(page.getByLabel("Repository", { exact: true })).toHaveCount(0);
});

const refusals: ReadonlyArray<{
  readonly name: string;
  readonly repo: string;
  readonly passphrase: string;
  readonly message: string;
}> = [
  {
    name: "a repo commitnote did not initialize",
    repo: "https://github.com/sample/foreign",
    passphrase: "whatever",
    message:
      "This repository is neither empty nor a notes repo. commitnote only uses an empty repository or one it initialized, and it has not changed anything here.",
  },
  {
    name: "a repo initialized by a newer format version",
    repo: "https://github.com/sample/newer",
    passphrase: "whatever",
    message:
      "This notes repo was created by a newer version of commitnote. Update the app to open it.",
  },
  {
    name: "a read-only notes repo",
    repo: "https://github.com/sample/read-only",
    passphrase: NOTES_PASSPHRASE,
    message:
      'This access token cannot write to the repository. Give it read and write access to the repository contents.',
  },
  {
    name: "a read-only empty repo",
    repo: "https://github.com/sample/empty-read-only",
    passphrase: "whatever",
    message:
      'This access token cannot write to the repository. Give it read and write access to the repository contents.',
  },
];

for (const refusal of refusals) {
  test(`refusal: ${refusal.name}`, async ({ page }) => {
    await page.goto("/");

    await logIn(page, {
      repo: refusal.repo,
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

test("a long repository name keeps the form inside the login card", async ({
  page,
}) => {
  await page.goto("/");

  await continueWithToken(page, `github_pat_${"x".repeat(82)}`);
  const repository = page.getByLabel("Repository", { exact: true });
  await repository.evaluate((select) => {
    const option = document.createElement("option");
    option.textContent =
      "some-organization-name/a-really-long-repository-name-for-notes";
    select.append(option);
  });

  const card = await page.locator(".login-card").boundingBox();
  const button = await page
    .getByRole("button", { name: "Log in" })
    .boundingBox();
  expect(button!.x + button!.width).toBeLessThanOrEqual(card!.x + card!.width);
});

test.describe("several providers", () => {
  const SECOND_NOTES_REPO = "https://fakelab.test/team/notes";
  const SECOND_EMPTY_REPO = "https://fakelab.test/team/empty";

  test("the provider picker lists every provider and defaults to the first", async ({
    page,
  }) => {
    await page.goto("/");

    const github = page.getByRole("radio", { name: "GitHub" });
    const fakelab = page.getByRole("radio", { name: "Fakelab" });
    await expect(github).toBeChecked();
    await expect(fakelab).not.toBeChecked();
  });

  test("switching provider updates the token help and link and clears the token", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByLabel("Access token").fill("secret-token");
    await page.getByRole("radio", { name: "Fakelab" }).check();

    await expect(page.getByLabel("Access token")).toHaveValue("");
    await expect(page.getByText("A Fakelab token with the")).toBeVisible();
    const link = page.getByRole("link", { name: "Create a token on Fakelab" });
    await expect(link).toHaveAttribute(
      "href",
      "https://fakelab.test/tokens/new",
    );
    await expect(
      page.getByRole("link", { name: "Create a token on GitHub" }),
    ).toHaveCount(0);
  });

  test("switching provider drops the loaded repository list", async ({
    page,
  }) => {
    await page.goto("/");

    await continueWithToken(page);
    await expect(page.getByLabel("Repository", { exact: true })).toBeVisible();

    await page.getByRole("radio", { name: "Fakelab" }).check();
    await expect(page.getByLabel("Repository", { exact: true })).toHaveCount(0);

    await continueWithToken(page);
    await expect(
      page.getByLabel("Repository", { exact: true }).getByRole("option"),
    ).toHaveText(["Choose a repository", "team/empty", "team/notes"]);
  });

  test("logging in with the second provider", async ({ page }) => {
    await page.goto("/");

    await logIn(page, {
      provider: "Fakelab",
      repo: SECOND_NOTES_REPO,
      passphrase: NOTES_PASSPHRASE,
    });
    await expectTree(page);
  });

  test("initializing a repository on the second provider", async ({ page }) => {
    await page.goto("/");

    await logIn(page, {
      provider: "Fakelab",
      repo: SECOND_EMPTY_REPO,
      passphrase: "first passphrase",
    });
    await page.getByLabel("Repeat passphrase").fill("first passphrase");
    await page.getByRole("button", { name: "Initialize notes repo" }).click();
    await expect(page.getByText("No notes yet")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("errors name the selected provider", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("radio", { name: "Fakelab" }).check();
    await continueWithToken(page, "invalid-token");
    await expect(page.getByRole("alert")).toHaveText(
      "The access token is invalid or has expired.",
    );
  });

  test("the last used provider is preselected after logging out", async ({
    page,
  }) => {
    await page.goto("/");

    await logIn(page, {
      provider: "Fakelab",
      repo: SECOND_NOTES_REPO,
      passphrase: NOTES_PASSPHRASE,
    });
    await expectTree(page);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("radio", { name: "Fakelab" })).toBeChecked();

    await page.reload();
    await expect(page.getByRole("radio", { name: "Fakelab" })).toBeChecked();
  });

  test("the provider picker stays inside the login card", async ({ page }) => {
    await page.goto("/");

    const card = (await page.locator(".login-card").boundingBox())!;
    for (const name of ["GitHub", "Fakelab"]) {
      const box = (await page
        .getByRole("radio", { name })
        .locator("xpath=..")
        .boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(card.x);
      expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
    }
  });
});
