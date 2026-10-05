import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  KEY_DERIVATION_TIMEOUT,
  chooseRepository,
  continueWithToken,
  expectEmptyNotesRepo,
  expectLoginAlert,
  expectTree,
  logIn,
  setUpNotesRepo,
} from "./helpers";

const NOTES_REPO = "https://github.com/sample/notes";
const NOTES_PASSPHRASE = "sample notes repo passphrase";
const EMPTY_REPO = "https://github.com/sample/empty";
const ALMOST_EMPTY_REPO = "https://github.com/sample/almost-empty";

const FIXTURE_CONTROLS = "__commitNoteFakeForge";

async function failNextOnLoad(
  page: Page,
  repoKey: string,
  operation: string,
  kind: string,
): Promise<void> {
  await page.addInitScript(
    ([key, repo, op, errorKind]) => {
      let controls: any;
      Object.defineProperty(window, key, {
        configurable: true,
        get: () => controls,
        set: (value) => {
          controls = value;
          controls.failNext(repo, op, errorKind);
        },
      });
    },
    [FIXTURE_CONTROLS, repoKey, operation, kind],
  );
}

test("setting up an empty repo, then logging in to it", async ({ page }) => {
  await page.goto("/");

  await chooseRepository(page, { repo: EMPTY_REPO });
  await expect(
    page.getByText(
      "This repository is empty. Setting it up as a notes repo adds a commitnote configuration file and a README.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Passphrase", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Create passphrase")).toBeVisible({
    timeout: KEY_DERIVATION_TIMEOUT,
  });
  await expect(page.getByLabel("Create passphrase")).toBeFocused();

  await page.getByLabel("Create passphrase").fill("first passphrase");
  await page.getByLabel("Repeat passphrase").fill("a different passphrase");
  await page.getByRole("button", { name: "Set up notes repo" }).click();
  await expect(page.getByRole("alert")).toHaveText("Passphrases do not match.");
  await expect(page.getByLabel("Repeat passphrase")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByLabel("Repeat passphrase")).toHaveAccessibleDescription(
    "Passphrases do not match.",
  );

  await page.getByLabel("Repeat passphrase").fill("first passphrase");
  await page.getByRole("button", { name: "Set up notes repo" }).click();
  // An empty notes repo has no tree, just the empty-state message.
  await expectEmptyNotesRepo(page);

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByLabel("Access token")).toHaveValue("");

  await logIn(page, { repo: EMPTY_REPO, passphrase: "first passphrase" });
  await expectEmptyNotesRepo(page);

  await page.getByRole("button", { name: "Log out" }).click();
  await chooseRepository(page, { repo: EMPTY_REPO });
  await expect(page.getByLabel("Passphrase", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Create passphrase")).toHaveCount(0);
  await page
    .getByLabel("Passphrase", { exact: true })
    .fill("wrong passphrase");
  await page.getByRole("button", { name: "Log in" }).click();
  await expectLoginAlert(page, "Wrong passphrase.");
  await expect(page.getByLabel("Passphrase", { exact: true })).toHaveValue("");
});

test("a weak passphrase shows a strength warning but does not block setup", async ({
  page,
}) => {
  await page.goto("/");
  await chooseRepository(page, { repo: EMPTY_REPO });

  const strength = page.locator("#login-create-passphrase-strength");
  const createField = page.getByLabel("Create passphrase");
  await expect(strength).toHaveCount(0);

  await createField.fill("password");
  await expect(strength).toBeVisible();
  await expect(strength).toContainText("Weak");
  await expect(createField).toHaveAccessibleDescription(
    /Passphrase strength: Weak\./,
  );

  await page
    .getByLabel("Create passphrase")
    .fill("violet anchor pepper tundra kayak");
  await expect(strength).toContainText(/Good|Strong/);

  await page.getByLabel("Create passphrase").fill("password");
  await page.getByLabel("Repeat passphrase").fill("password");
  await page.getByRole("button", { name: "Set up notes repo" }).click();
  await expectEmptyNotesRepo(page);
});

test("the log-in form has no strength meter", async ({ page }) => {
  await page.goto("/");
  await chooseRepository(page, { repo: NOTES_REPO });
  await expect(page.getByLabel("Passphrase", { exact: true })).toBeVisible();
  await page.getByLabel("Passphrase", { exact: true }).fill("password");
  await expect(page.getByText(/Passphrase strength:/)).toHaveCount(0);
});

test("an empty repo offers creating a note from the sidebar", async ({
  page,
}) => {
  await page.goto("/");
  await setUpNotesRepo(page, { repo: EMPTY_REPO, passphrase: "first passphrase" });
  await expectEmptyNotesRepo(page);

  await page.getByRole("button", { name: "create one" }).click();
  await expect(page.getByRole("textbox", { name: "Note name" })).toBeFocused();
});

test("setting up a repo holding only a README, LICENSE and .gitignore keeps them", async ({
  page,
}) => {
  await page.goto("/");

  await chooseRepository(page, { repo: ALMOST_EMPTY_REPO });
  await expect(
    page.getByText(
      "This repository holds only .gitignore, LICENSE and README.md. Setting it up as a notes repo keeps them as they are and adds a commitnote configuration file.",
    ),
  ).toBeVisible();
  await page.getByLabel("Create passphrase").fill("almost empty passphrase");
  await page.getByLabel("Repeat passphrase").fill("almost empty passphrase");
  await page.getByRole("button", { name: "Set up notes repo" }).click();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible({
    timeout: KEY_DERIVATION_TIMEOUT,
  });

  await page.getByRole("button", { name: "Log out" }).click();
  await logIn(page, {
    repo: ALMOST_EMPTY_REPO,
    passphrase: "almost empty passphrase",
  });
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible({
    timeout: KEY_DERIVATION_TIMEOUT,
  });
});

test("a repo changed during setup can be checked again and set up", async ({
  page,
}) => {
  await failNextOnLoad(page, "sample/almost-empty", "commit", "stale");
  await page.goto("/");

  await setUpNotesRepo(page, {
    repo: ALMOST_EMPTY_REPO,
    passphrase: "almost empty passphrase",
  });
  await expectLoginAlert(
    page,
    "The repository changed while it was being set up. Check it again.",
  );
  await expect(page.getByLabel("Create passphrase")).toHaveCount(0);

  await page.getByRole("button", { name: "Check again" }).click();
  await page.getByLabel("Create passphrase").fill("almost empty passphrase");
  await page.getByLabel("Repeat passphrase").fill("almost empty passphrase");
  await page.getByRole("button", { name: "Set up notes repo" }).click();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible({
    timeout: KEY_DERIVATION_TIMEOUT,
  });
});

test("a repository that could not be checked can be checked again", async ({
  page,
}) => {
  await failNextOnLoad(page, "sample/notes", "inspect", "Network");
  await page.goto("/");

  await chooseRepository(page, { repo: NOTES_REPO });
  await expect(page.getByRole("alert")).toHaveText(
    "Could not reach GitHub. Check your connection and try again.",
  );
  await expect(page.getByLabel("Passphrase", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Check again" }).click();
  await page
    .getByLabel("Passphrase", { exact: true })
    .fill(NOTES_PASSPHRASE);
  await page.getByRole("button", { name: "Log in" }).click();
  await expectTree(page);
});

test("a repository that is not private shows a warning", async ({ page }) => {
  await page.goto("/");

  await chooseRepository(page, { repo: "https://github.com/sample/public-empty" });
  const warning = page.getByRole("note").filter({ hasText: "not private" });
  await expect(warning).toHaveText(
    "This repository is not private. Your notes stay encrypted, but anyone who can see the repository can see when you save, how many files there are, their sizes and how often you write.",
  );
  await expect(page.getByLabel("Create passphrase")).toBeVisible();

  await page
    .getByLabel("Repository", { exact: true })
    .selectOption({ label: "sample/empty" });
  await expect(page.getByLabel("Create passphrase")).toBeVisible();
  await expect(warning).toHaveCount(0);
});

test("passphrase forms name the repository for password managers", async ({
  page,
}) => {
  await page.goto("/");

  await chooseRepository(page, { repo: NOTES_REPO });
  const passphrase = page.getByLabel("Passphrase", { exact: true });
  await expect(passphrase).toHaveAttribute("autocomplete", "current-password");
  const loginForm = page.locator("form", { has: passphrase });
  const username = loginForm.locator('input[autocomplete="username"]');
  await expect(username).toHaveValue("sample/notes");
  await expect(username).toHaveAttribute("readonly", "");
  await expect(username).toHaveAttribute("tabindex", "-1");
  await expect(loginForm.getByLabel("Access token")).toHaveCount(0);

  await page
    .getByLabel("Repository", { exact: true })
    .selectOption({ label: "sample/empty" });
  const create = page.getByLabel("Create passphrase");
  await expect(create).toHaveAttribute("autocomplete", "new-password");
  await expect(page.getByLabel("Repeat passphrase")).toHaveAttribute(
    "autocomplete",
    "new-password",
  );
  await expect(
    page
      .locator("form", { has: create })
      .locator('input[autocomplete="username"]'),
  ).toHaveValue("sample/empty");
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
  await expectLoginAlert(page, "Wrong passphrase.");

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

async function rememberSession(page: Page): Promise<void> {
  await page.goto("/");
  await logIn(page, {
    repo: NOTES_REPO,
    passphrase: NOTES_PASSPHRASE,
    rememberMe: true,
  });
  await expectTree(page);
}

test("a remembered session keeps the loading screen until the notes load", async ({
  page,
}) => {
  await rememberSession(page);
  await page.addInitScript(() => {
    const seen = new Set<string>();
    (window as any).__seenTexts = seen;
    new MutationObserver(() => {
      const text = document.body?.textContent ?? "";
      for (const phrase of ["Loading notes", "Create a new note", "create a new note"]) {
        if (text.includes(phrase)) seen.add(phrase);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });

  await page.reload();
  await expectTree(page);

  expect(await page.evaluate(() => [...(window as any).__seenTexts])).toEqual([
    "create a new note",
  ]);
});

test("a remembered session whose notes fail to load shows the error", async ({
  page,
}) => {
  await rememberSession(page);
  await page.addInitScript(() => {
    let controls: any;
    Object.defineProperty(window, "__commitNoteFakeForge", {
      configurable: true,
      get: () => controls,
      set: (value) => {
        controls = value;
        controls.failNext("sample/notes", "getHead", "Network");
      },
    });
  });

  await page.reload();

  await expect(page.getByRole("alert")).toHaveText(
    "Could not reach GitHub. Showing the last loaded notes.",
    { timeout: 15_000 },
  );
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /create a new note/i })).toHaveCount(0);
});

test("no Remember me", async ({ page }) => {
  await page.goto("/");

  await chooseRepository(page, { repo: NOTES_REPO });
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
  await expect(page.getByLabel("Passphrase", { exact: true })).toBeFocused();
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

test("the token help links to creating an empty private repository", async ({
  page,
}) => {
  await page.goto("/");

  const link = page.getByRole("link", {
    name: "Create an empty private repository",
  });
  await expect(link).toHaveAttribute(
    "href",
    "https://github.com/new?name=notes&visibility=private",
  );
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

test("a token without repositories says how to create one", async ({
  page,
}) => {
  await page.goto("/");

  await continueWithToken(page, "no-repositories-token");

  const alert = page.getByRole("alert");
  await expect(alert).toContainText(
    "This access token has no access to any repository. Edit it on GitHub and add your notes repository.",
  );
  await expect(alert).toContainText(
    "No notes repo yet? Create an empty private repository first, then give the token access to it.",
  );
  await expect(
    alert.getByRole("link", { name: "Create an empty private repository" }),
  ).toHaveAttribute("href", "https://github.com/new?name=notes&visibility=private");
  await expect(page.getByLabel("Repository", { exact: true })).toHaveCount(0);
});

test("the repository list comes from the access token", async ({ page }) => {
  await page.goto("/");

  await continueWithToken(page);
  const repository = page.getByLabel("Repository", { exact: true });
  await expect(repository).toHaveValue("");
  await expect(repository.getByRole("option")).toHaveText([
    "Choose a repository",
    "sample/almost-empty",
    "sample/empty",
    "sample/empty-read-only",
    "sample/foreign",
    "sample/newer",
    "sample/notes",
    "sample/public-empty",
    "sample/read-only",
    "sample/trash",
  ]);

  await expect(page.getByLabel("Passphrase", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Create passphrase")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log in" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);

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
  readonly message: string;
}> = [
  {
    name: "a repo commitnote did not initialize",
    repo: "https://github.com/sample/foreign",
    message:
      "This repository has files commitnote does not use. commitnote accepts an empty repository, one with only a README, LICENSE or .gitignore, or a notes repo. Nothing was changed here.",
  },
  {
    name: "a repo initialized by a newer format version",
    repo: "https://github.com/sample/newer",
    message:
      "This notes repo was created by a newer version of commitnote. Update the app to open it.",
  },
  {
    name: "a read-only notes repo",
    repo: "https://github.com/sample/read-only",
    message:
      'This access token cannot write to the repository. Give it read and write access to the repository contents.',
  },
  {
    name: "a read-only empty repo",
    repo: "https://github.com/sample/empty-read-only",
    message:
      'This access token cannot write to the repository. Give it read and write access to the repository contents.',
  },
];

for (const refusal of refusals) {
  test(`refusal: ${refusal.name}`, async ({ page }) => {
    await page.goto("/");

    await chooseRepository(page, { repo: refusal.repo });

    await expect(page.getByRole("alert")).toHaveText(refusal.message);
    await expect(page.getByLabel("Passphrase", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Create passphrase")).toHaveCount(0);
    await expect(page.getByLabel("Repository", { exact: true })).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Check again" }),
    ).toBeVisible();
  });
}

test("after a refusal another repository can be chosen with the same token", async ({
  page,
}) => {
  await page.goto("/");

  await chooseRepository(page, { repo: "https://github.com/sample/foreign" });
  await expect(page.getByRole("alert")).toBeVisible();
  const createLinks = page.getByRole("link", {
    name: "Create an empty private repository",
  });
  await expect(createLinks).toHaveCount(2);
  await expect(createLinks.nth(1)).toHaveAttribute(
    "href",
    "https://github.com/new?name=notes&visibility=private",
  );
  await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();

  await page
    .getByLabel("Repository", { exact: true })
    .selectOption({ label: "sample/notes" });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page
    .getByLabel("Passphrase", { exact: true })
    .fill(NOTES_PASSPHRASE);
  await page.getByRole("button", { name: "Log in" }).click();
  await expectTree(page);
});

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

  await repository.selectOption({
    label: "some-organization-name/a-really-long-repository-name-for-notes",
  });

  const card = await page.locator(".login-card").boundingBox();
  const select = await repository.boundingBox();
  expect(select!.x + select!.width).toBeLessThanOrEqual(card!.x + card!.width);
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
    await expect(
      page.getByRole("link", { name: "Create an empty private repository" }),
    ).toHaveAttribute("href", "https://fakelab.test/projects/new");
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

  test("setting up a repository on the second provider", async ({ page }) => {
    await page.goto("/");

    await setUpNotesRepo(page, {
      provider: "Fakelab",
      repo: SECOND_EMPTY_REPO,
      passphrase: "first passphrase",
    });
    await expectEmptyNotesRepo(page);
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
