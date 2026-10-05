import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import { chooseRepository, expectTree, SAMPLE, openNotes, logOut, showTree, fakeForge, expectFamily, expectedFamily, MONO_STACK, SERIF_STACK } from "./helpers";
import { chooseAccent, chooseOption, closeSettings, openSettings, rootAccent, settingsDialog } from "./helpers/settings";
import { openWelcome } from "./helpers/tree";



const TEAL = "rgb(0, 133, 115)";
const RED = "rgb(206, 44, 49)";
const VIOLET = "rgb(138, 70, 184)";
const PALETTE = [
  "System",
  "Blue",
  "Violet",
  "Pink",
  "Red",
  "Orange",
  "Amber",
  "Green",
  "Teal",
  "Slate",
];

function expectRootAccent(page: Page, color: string) {
  return expect.poll(() => rootAccent(page)).toBe(color);
}

async function emulateOsAccent(page: Page, color: string): Promise<void> {
  await page.evaluate((color) => {
    const w = window as any;
    if (w.__osAccent === undefined) {
      const original = window.getComputedStyle.bind(window);
      window.getComputedStyle = ((element: Element, pseudo?: string | null) =>
        element instanceof HTMLElement &&
        element.style.color.toLowerCase().includes("accentcolor")
          ? ({ color: w.__osAccent } as CSSStyleDeclaration)
          : original(element, pseudo)) as typeof window.getComputedStyle;
    }
    w.__osAccent = color;
    window.dispatchEvent(new Event("focus"));
  }, color);
}

async function expectSettingsCommits(page: Page, count: number) {
  await expect
    .poll(async () => await fakeForge(page).commitCount(), { timeout: 10_000 })
    .toBe(count);
}

const SEEDED_ROOT = [
  "Empty folder",
  "Journal",
  "Projects",
  "Welcome",
  "Zażółć gęślą jaźń",
];

const NOTE_OPTIONS = ["At the beginning", "At the end"];
const FOLDER_OPTIONS = ["At the beginning", "At the end", "After the last folder"];

function rootRows(page: Page) {
  return page.getByRole("tree", { name: "Notes" }).getByRole("treeitem");
}

async function addedCommits(
  page: Page,
  before: string[],
): Promise<string[]> {
  return (await fakeForge(page).commitMessages()).filter((m) => !before.includes(m));
}

async function createHeaderNote(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Note name" });
  await field.fill(name);
  await field.press("Enter");
  await expect(page.getByRole("textbox", { name: "Note editor" })).toBeVisible();
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Back to notes" }).click();
  }
  await expect(page.getByRole("treeitem", { name })).toBeVisible();
}

async function createHeaderFolder(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByLabel("Folder name").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("treeitem", { name })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openNotes(page);
});

test("Settings is the first command and opens a dialog with the accent color options", async ({
  page,
}) => {
  const commitsBefore = await fakeForge(page).commitMessages();

  await page.getByRole("button", { name: "More commands" }).click();
  const items = page
    .getByRole("menu", { name: "Commands" })
    .getByRole("menuitem");
  await expect(items.first()).toHaveText("Settings");
  await items.first().click();

  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible();
  const group = dialog.getByRole("radiogroup", { name: "Accent color" });
  await expect(group).toBeVisible();
  await expect(group.getByRole("radio")).toHaveCount(PALETTE.length);
  for (const [index, name] of PALETTE.entries()) {
    await expect(group.getByRole("radio").nth(index)).toHaveAccessibleName(name);
  }
  const systemRadio = group.getByRole("radio", { name: "System" });
  await expect(systemRadio).toBeChecked();
  await expect(systemRadio).toBeFocused();
  await expect(systemRadio).toHaveAccessibleDescription(/OS accent color/);
  await expect(
    group
      .locator("label")
      .filter({ has: page.getByRole("radio", { name: "System" }) })
      .locator("svg"),
  ).toBeVisible();
  await expect(dialog.locator(".accent-caption")).toHaveText(
    /^System · \w+, .*OS accent color$/,
  );

  const sections = dialog.getByRole("radiogroup");
  await expect(sections).toHaveCount(4);
  await expect(sections.nth(1)).toHaveAccessibleName("Note font");
  await expect(sections.nth(2)).toHaveAccessibleName("New notes");
  await expect(sections.nth(3)).toHaveAccessibleName("New folders");
  const notes = dialog.getByRole("radiogroup", { name: "New notes" });
  const folders = dialog.getByRole("radiogroup", { name: "New folders" });
  await expect(notes.getByRole("radio")).toHaveCount(NOTE_OPTIONS.length);
  for (const [index, name] of NOTE_OPTIONS.entries()) {
    await expect(notes.getByRole("radio").nth(index)).toHaveAccessibleName(name);
  }
  await expect(notes.getByRole("radio", { name: "At the beginning" })).toBeChecked();
  await expect(folders.getByRole("radio")).toHaveCount(FOLDER_OPTIONS.length);
  for (const [index, name] of FOLDER_OPTIONS.entries()) {
    await expect(folders.getByRole("radio").nth(index)).toHaveAccessibleName(name);
  }
  await expect(folders.getByRole("radio", { name: "At the end" })).toBeChecked();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("body")).toBeFocused();

  await openSettings(page);
  await settingsDialog(page).getByRole("button", { name: "Close" }).click();
  await expect(settingsDialog(page)).toHaveCount(0);

  expect(await fakeForge(page).commitMessages()).toEqual(commitsBefore);
});

test("clicking the backdrop closes the Settings dialog", async ({
  page,
}) => {
  await openSettings(page);
  await page.mouse.click(1, 1);
  await expect(settingsDialog(page)).toHaveCount(0);
});

test("choosing an accent color applies it and saves one commit without the value", async ({
  page,
}) => {
  const commitsBefore = await fakeForge(page).commitMessages();
  const system = await rootAccent(page);
  await openSettings(page);
  const dialog = settingsDialog(page);

  await chooseAccent(page, "Teal");

  await expect(dialog.getByRole("radio", { name: "Teal" })).toBeChecked();
  await expect(dialog.locator(".accent-caption")).toHaveText("Teal");
  await expectRootAccent(page, TEAL);
  await expect
    .poll(() =>
      dialog
        .locator(".dialog-card")
        .evaluate((el) => getComputedStyle(el).borderTopColor),
    )
    .toBe(TEAL);
  expect(TEAL).not.toBe(system);

  await expectSettingsCommits(page, commitsBefore.length + 1);
  const added = (await fakeForge(page).commitMessages()).filter(
    (m) => !commitsBefore.includes(m),
  );
  expect(added).toHaveLength(1);
  expect(added[0]).toContain("Commitnote-Settings: accentColor");
  expect(added[0].toLowerCase()).not.toContain("teal");
});

test("rapid accent changes are saved as a single commit", async ({ page }) => {
  const commitsBefore = await fakeForge(page).commitMessages();
  await openSettings(page);

  await chooseAccent(page, "Blue");
  await chooseAccent(page, "Red");
  await chooseAccent(page, "Teal");

  await expectSettingsCommits(page, commitsBefore.length + 1);
  await page.waitForTimeout(2500);
  expect(await fakeForge(page).commitMessages()).toHaveLength(commitsBefore.length + 1);
});

test("returning to the saved accent color or re-clicking it makes no commit", async ({
  page,
}) => {
  const commitsBefore = await fakeForge(page).commitMessages();
  await openSettings(page);
  await chooseAccent(page, "Teal");
  await expectSettingsCommits(page, commitsBefore.length + 1);

  await chooseAccent(page, "Red");
  await chooseAccent(page, "Teal");
  await page.waitForTimeout(2500);
  expect(await fakeForge(page).commitMessages()).toHaveLength(commitsBefore.length + 1);

  await chooseAccent(page, "Teal");
  await page.waitForTimeout(2500);
  expect(await fakeForge(page).commitMessages()).toHaveLength(commitsBefore.length + 1);
});

test("choosing System after another accent restores the system accent", async ({
  page,
}) => {
  const system = await rootAccent(page);
  await openSettings(page);

  await chooseAccent(page, "Teal");
  await expectRootAccent(page, TEAL);

  await chooseAccent(page, "System");
  await expect(
    settingsDialog(page)
      .getByRole("radiogroup", { name: "Accent color" })
      .getByRole("radio", { name: "System" }),
  ).toBeChecked();
  await expectRootAccent(page, system);
});

test("System uses the palette color closest to the OS accent and follows OS accent changes", async ({
  page,
}) => {
  await emulateOsAccent(page, "rgb(230, 45, 66)");
  await openSettings(page);
  const dialog = settingsDialog(page);

  await expect(dialog.locator(".accent-caption")).toHaveText(
    "System · Red, closest to your OS accent color",
  );
  await expect(
    dialog
      .getByRole("radiogroup", { name: "Accent color" })
      .getByRole("radio", { name: "System" }),
  ).toHaveAccessibleDescription("Red, closest to your OS accent color");
  await expectRootAccent(page, RED);

  await emulateOsAccent(page, "rgb(145, 65, 172)");

  await expect(dialog.locator(".accent-caption")).toHaveText(
    "System · Violet, closest to your OS accent color",
  );
  await expectRootAccent(page, VIOLET);
});

test("arrow keys move the accent color selection", async ({ page }) => {
  const system = await rootAccent(page);
  await openSettings(page);
  const dialog = settingsDialog(page);
  const accent = dialog.getByRole("radiogroup", { name: "Accent color" });
  await expect(accent.getByRole("radio", { name: "System" })).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");

  await expect(accent.getByRole("radio", { name: "Violet" })).toBeChecked();
  await expect.poll(() => rootAccent(page)).not.toBe(system);
});

test("a saved accent color applies on the passphrase step and after login, and logout returns to system", async ({
  page,
}) => {
  const commitsBefore = await fakeForge(page).commitMessages();
  const system = await rootAccent(page);
  await openSettings(page);
  await chooseAccent(page, "Teal");
  await expectRootAccent(page, TEAL);
  await expectSettingsCommits(page, commitsBefore.length + 1);
  await page.keyboard.press("Escape");
  await expect(settingsDialog(page)).toHaveCount(0);

  await logOut(page);
  await expect(page.getByLabel("Access token")).toBeVisible({ timeout: 10_000 });
  await expectRootAccent(page, system);

  await chooseRepository(page, { repo: SAMPLE.repo });
  await expect(page.getByLabel("Passphrase", { exact: true })).toBeVisible();
  await expectRootAccent(page, TEAL);

  await page.getByLabel("Passphrase", { exact: true }).fill(SAMPLE.passphrase);
  await page.getByRole("button", { name: "Log in" }).click();
  await expectTree(page);
  await expectRootAccent(page, TEAL);
});

test("a saved note placement is one commit naming only the key, and returning to it makes no commit", async ({
  page,
}) => {
  const commitsBefore = await fakeForge(page).commitMessages();
  await openSettings(page);

  await chooseOption(page, "New notes", "At the end");
  await expectSettingsCommits(page, commitsBefore.length + 1);
  const added = await addedCommits(page, commitsBefore);
  expect(added).toHaveLength(1);
  expect(added[0].split("\n")).toContain("Commitnote-Settings: newNotePlacement");

  await chooseOption(page, "New notes", "At the beginning");
  await chooseOption(page, "New notes", "At the end");
  await page.waitForTimeout(2500);
  expect(await fakeForge(page).commitMessages()).toHaveLength(commitsBefore.length + 1);
});

test("a saved folder placement is one commit naming only the key", async ({
  page,
}) => {
  const commitsBefore = await fakeForge(page).commitMessages();
  await openSettings(page);

  await chooseOption(page, "New folders", "After the last folder");
  await expectSettingsCommits(page, commitsBefore.length + 1);
  const added = await addedCommits(page, commitsBefore);
  expect(added).toHaveLength(1);
  expect(added[0].split("\n")).toContain(
    "Commitnote-Settings: newFolderPlacement",
  );
  expect(added[0]).not.toContain("afterLastFolder");
});

test("by default a new note is first and a new folder is last at the root", async ({
  page,
}, testInfo) => {
  await createHeaderNote(page, testInfo, "Fresh note");
  await createHeaderFolder(page, "Fresh folder");

  await expect(rootRows(page)).toHaveText([
    "Fresh note",
    ...SEEDED_ROOT,
    "Fresh folder",
  ]);
});

test("changed placements apply to items created right after closing Settings", async ({
  page,
}, testInfo) => {
  await openSettings(page);
  await chooseOption(page, "New notes", "At the end");
  await chooseOption(page, "New folders", "After the last folder");
  await page.keyboard.press("Escape");
  await expect(settingsDialog(page)).toHaveCount(0);

  await createHeaderNote(page, testInfo, "Fresh note");
  await createHeaderFolder(page, "Fresh folder");

  await expect(rootRows(page)).toHaveText([
    "Empty folder",
    "Journal",
    "Projects",
    "Fresh folder",
    "Welcome",
    "Zażółć gęślą jaźń",
    "Fresh note",
  ]);
});

test("arrow keys move the note placement selection", async ({ page }) => {
  await openSettings(page);
  const group = settingsDialog(page).getByRole("radiogroup", {
    name: "New notes",
  });
  await group.getByRole("radio", { name: "At the beginning" }).focus();

  await page.keyboard.press("ArrowDown");

  await expect(group.getByRole("radio", { name: "At the end" })).toBeChecked();
});

const SYSTEM_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const NOTE_FONTS: Record<
  string,
  { stack: string; description: string; family?: string }
> = {
  Inter: { stack: "var(--font-sans)", description: "The app's font" },
  "System UI": {
    stack: SYSTEM_STACK,
    description:
      "Your device's interface font, like San Francisco, Segoe UI or Roboto",
  },
  "IBM Plex Sans": {
    stack: `"IBM Plex Sans Variable", ${SYSTEM_STACK}`,
    description: "Technical sans-serif",
    family: "IBM Plex Sans Variable",
  },
  "Atkinson Hyperlegible Next": {
    stack: `"Atkinson Hyperlegible Next Variable", ${SYSTEM_STACK}`,
    description: "Sans-serif designed for legibility",
    family: "Atkinson Hyperlegible Next Variable",
  },
  Nunito: {
    stack: `"Nunito Variable", ${SYSTEM_STACK}`,
    description: "Rounded sans-serif",
    family: "Nunito Variable",
  },
  "iA Writer Quattro": {
    stack: `"iA Writer Quattro", ${SYSTEM_STACK}`,
    description: "Writing font, nearly monospaced",
    family: "iA Writer Quattro",
  },
  Literata: {
    stack: `"Literata Variable", ${SERIF_STACK}`,
    description: "Serif made for long reading",
    family: "Literata Variable",
  },
  "Source Serif 4": {
    stack: `"Source Serif 4 Variable", ${SERIF_STACK}`,
    description: "Classic text serif",
    family: "Source Serif 4 Variable",
  },
  Lora: {
    stack: `"Lora Variable", ${SERIF_STACK}`,
    description: "Calligraphic serif",
    family: "Lora Variable",
  },
  "JetBrains Mono": {
    stack: '"JetBrains Mono Variable", var(--font-mono)',
    description: "Monospace for code and plain text",
    family: "JetBrains Mono Variable",
  },
  "IBM Plex Mono": {
    stack: '"IBM Plex Mono", var(--font-mono)',
    description: "Typewriter-like monospace",
    family: "IBM Plex Mono",
  },
};
const BUNDLED_FILE_PREFIXES = [
  "ibm-plex-sans-",
  "atkinson-hyperlegible-next-",
  "nunito-",
  "ia-writer-quattro-",
  "literata-",
  "source-serif-4-",
  "lora-",
  "jetbrains-mono-",
  "ibm-plex-mono-",
];
const SANS_STACK = "var(--font-sans)";

function noteFontGroup(page: Page) {
  return settingsDialog(page).getByRole("radiogroup", { name: "Note font" });
}

function rootNoteFont(page: Page): Promise<{ inline: string; computed: string }> {
  return page.evaluate(() => ({
    inline: document.documentElement.style.getPropertyValue("--font-note"),
    computed: getComputedStyle(document.documentElement)
      .getPropertyValue("--font-note")
      .trim(),
  }));
}

function noteFontRow(page: Page, name: string) {
  return noteFontGroup(page)
    .locator("label")
    .filter({ has: page.getByRole("radio", { name, exact: true }) });
}

function labelPreviewFamily(radio: Locator): Promise<string> {
  return radio.evaluate((el) => {
    const id = el.getAttribute("aria-labelledby") ?? "";
    const preview = document.getElementById(id);
    if (!preview) throw new Error("label preview not found");
    return getComputedStyle(preview.firstElementChild ?? preview).fontFamily;
  });
}

async function expectFontLoaded(page: Page, family: string): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        (family) => document.fonts.check(`16px "${family}"`),
        family,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        (family) =>
          [...document.fonts].some(
            (face) =>
              face.status === "loaded" &&
              face.family.replace(/^"|"$/g, "") === family,
          ),
        family,
      ),
    )
    .toBe(true);
}

function collectFontFiles(page: Page): string[] {
  const files: string[] = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path.endsWith(".woff2")) files.push(path.split("/").pop()!);
  });
  return files;
}

async function returnToWelcomeIfMobile(
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  if (testInfo.project.name === "mobile") {
    await openWelcome(page);
  }
}

test("the Note font section lists eleven options with Inter checked, each label in its own font", async ({
  page,
}) => {
  await openSettings(page);
  const group = noteFontGroup(page);
  const names = Object.keys(NOTE_FONTS);

  await expect(group.getByRole("radio")).toHaveCount(11);
  for (const [index, name] of names.entries()) {
    await expect(group.getByRole("radio").nth(index)).toHaveAccessibleName(name);
  }
  await expect(group.getByRole("radio", { name: "Inter", exact: true })).toBeChecked();

  for (const [name, { stack, description }] of Object.entries(NOTE_FONTS)) {
    const radio = group.getByRole("radio", { name, exact: true });
    const expected = await expectedFamily(page, stack);
    await expect.poll(() => labelPreviewFamily(radio)).toBe(expected);
    await expect(radio).toHaveAccessibleDescription(description);
  }
  await expect(
    noteFontRow(page, "System UI").getByText(NOTE_FONTS["System UI"].description),
  ).toBeVisible();
});

test("the Note font options form two columns from desktop width and one on mobile", { tag: "@mobile" }, async ({
  page,
}, testInfo) => {
  await openSettings(page);
  const first = await noteFontRow(page, "Inter").boundingBox();
  const second = await noteFontRow(page, "System UI").boundingBox();
  if (!first || !second) throw new Error("rows not measurable");

  if (testInfo.project.name === "mobile") {
    expect(second.y).toBeGreaterThan(first.y);
  } else {
    expect(second.y).toBe(first.y);
    expect(second.x).not.toBe(first.x);
  }
});

test("only the Inter font file loads on app load", async ({ page }) => {
  await page.goto("about:blank");
  const files = collectFontFiles(page);
  await openNotes(page);
  await openWelcome(page);
  await expect.poll(() => files.length).toBeGreaterThan(0);
  await page.waitForTimeout(1000);

  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    expect(file.startsWith("InterVariable")).toBe(true);
  }
});

test("opening Settings downloads only the regular latin file of each bundled font", async ({
  page,
}) => {
  const files = collectFontFiles(page);
  await openSettings(page);
  for (const { family } of Object.values(NOTE_FONTS)) {
    if (family) await expectFontLoaded(page, family);
  }
  await page.waitForTimeout(500);

  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    expect(
      file.startsWith("InterVariable") ||
        BUNDLED_FILE_PREFIXES.some((prefix) => file.startsWith(prefix)),
    ).toBe(true);
    expect(file).not.toContain("italic");
    if (!file.startsWith("InterVariable")) {
      expect(file).toMatch(/-latin-(wght|400)-normal-/);
    }
  }
});

for (const font of ["Literata", "JetBrains Mono"]) {
  test(`choosing ${font} changes note text and loads the font`, async ({
    page,
  }, testInfo) => {
    const { stack, family } = NOTE_FONTS[font];
    await openWelcome(page);
    await showTree(page);
    await openSettings(page);
    await chooseOption(page, "Note font", font);
    await expect(
      noteFontGroup(page).getByRole("radio", { name: font, exact: true }),
    ).toBeChecked();
    await closeSettings(page);

    await expectFamily(
      page,
      page.getByRole("treeitem", { name: "Welcome", exact: true }),
      SANS_STACK,
    );

    await returnToWelcomeIfMobile(page, testInfo);
    const content = page.locator(".cm-content");
    await expectFamily(page, content, stack);
    await expectFamily(page, page.locator(".cm-scroller"), stack);
    await expectFamily(
      page,
      page.getByRole("textbox", { name: "Note name" }),
      stack,
    );
    await expectFamily(
      page,
      content.locator("*", { hasText: /^inline code$/ }).last(),
      MONO_STACK,
    );
    await expectFamily(
      page,
      page.locator(".cm-code-block-line").first(),
      MONO_STACK,
    );
    await expectFontLoaded(page, family!);
  });
}

test("choosing a note font saves one commit naming only the key", async ({
  page,
}) => {
  const commitsBefore = await fakeForge(page).commitMessages();
  await openSettings(page);

  await chooseOption(page, "Note font", "Literata");

  await expectSettingsCommits(page, commitsBefore.length + 1);
  const added = await addedCommits(page, commitsBefore);
  expect(added).toHaveLength(1);
  expect(added[0].split("\n")).toContain("Commitnote-Settings: noteFont");
  expect(added[0].toLowerCase()).not.toContain("literata");
});

test("rapid note font changes are saved as a single commit", async ({ page }) => {
  const commitsBefore = await fakeForge(page).commitMessages();
  await openSettings(page);

  await chooseOption(page, "Note font", "System UI");
  await chooseOption(page, "Note font", "JetBrains Mono");
  await chooseOption(page, "Note font", "Literata");

  await expectSettingsCommits(page, commitsBefore.length + 1);
  await page.waitForTimeout(2500);
  expect(await fakeForge(page).commitMessages()).toHaveLength(commitsBefore.length + 1);
});

test("re-picking the saved note font makes no commit", async ({ page }) => {
  const commitsBefore = await fakeForge(page).commitMessages();
  await openSettings(page);
  await chooseOption(page, "Note font", "Literata");
  await expectSettingsCommits(page, commitsBefore.length + 1);

  await chooseOption(page, "Note font", "Literata");
  await chooseOption(page, "Note font", "JetBrains Mono");
  await chooseOption(page, "Note font", "Literata");
  await page.waitForTimeout(2500);
  expect(await fakeForge(page).commitMessages()).toHaveLength(commitsBefore.length + 1);
});

test("a saved note font is applied after login and reset on logout", async ({
  page,
}) => {
  const commitsBefore = await fakeForge(page).commitMessages();
  const initial = await rootNoteFont(page);
  expect(initial.inline).toBe("");
  await openSettings(page);
  await chooseOption(page, "Note font", "Literata");
  await expectSettingsCommits(page, commitsBefore.length + 1);
  await expect.poll(async () => (await rootNoteFont(page)).inline).not.toBe("");
  await closeSettings(page);

  await logOut(page);
  await expect(page.getByLabel("Access token")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => rootNoteFont(page)).toEqual(initial);

  await chooseRepository(page, { repo: SAMPLE.repo });
  await page.getByLabel("Passphrase", { exact: true }).fill(SAMPLE.passphrase);
  await page.getByRole("button", { name: "Log in" }).click();
  await expectTree(page);
  await expect.poll(async () => (await rootNoteFont(page)).inline).not.toBe("");

  await openWelcome(page);
  await expectFamily(page, page.locator(".cm-content"), NOTE_FONTS.Literata.stack);
});

test("arrow keys move the note font selection", async ({ page }) => {
  await openSettings(page);
  const group = noteFontGroup(page);
  await group.getByRole("radio", { name: "Inter", exact: true }).focus();

  await page.keyboard.press("ArrowDown");

  await expect(group.getByRole("radio", { name: "System UI", exact: true })).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expect(group.getByRole("radio", { name: "IBM Plex Sans", exact: true })).toBeChecked();
});

test("typing after switching the note font lands where the line was clicked", async ({
  page,
}, testInfo) => {
  await openWelcome(page);
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("MARKER");
  await expect(content).toContainText("MARKER");

  await showTree(page);
  await openSettings(page);
  await chooseOption(page, "Note font", "Literata");
  await closeSettings(page);
  await returnToWelcomeIfMobile(page, testInfo);

  await expect(content).toContainText("MARKER");
  await expectFamily(page, content, NOTE_FONTS.Literata.stack);
  await expectFontLoaded(page, "Literata Variable");

  const line = page.locator(".cm-line", { hasText: /^- Second bullet$/ });
  const box = await line.boundingBox();
  if (!box) throw new Error("line not measurable");
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
  await page.keyboard.type("XYZ");

  await expect(page.locator(".cm-line", { hasText: /Second bulletXYZ$/ })).toHaveCount(1);

  await page.keyboard.press("ControlOrMeta+z");

  await expect(page.locator(".cm-line", { hasText: /^- Second bullet$/ })).toHaveCount(1);
  await expect(content).not.toContainText("XYZ");
  await expect(content).toContainText("MARKER");
});

function fontPreview(page: Page) {
  return settingsDialog(page).getByTestId("font-preview");
}

async function moveOffFontList(page: Page): Promise<void> {
  const box = await settingsDialog(page)
    .getByRole("heading", { name: "Settings" })
    .boundingBox();
  if (!box) throw new Error("dialog header not measurable");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

test("the font preview follows the selected font and keeps code in the code font", async ({
  page,
}) => {
  await openSettings(page);
  const preview = fontPreview(page);

  await expectFamily(page, preview, NOTE_FONTS.Inter.stack);
  await expectFamily(page, preview.locator("code"), MONO_STACK);

  await chooseOption(page, "Note font", "Literata");

  await expectFamily(page, preview, NOTE_FONTS.Literata.stack);
  await expectFamily(page, preview.locator("code"), MONO_STACK);
});

test("the font preview is hidden from assistive technology", async ({ page }) => {
  await openSettings(page);

  await expect(fontPreview(page)).toHaveAttribute("aria-hidden", "true");
  await expect(settingsDialog(page).getByText("Weekly notes")).toHaveCount(1);
  expect(await settingsDialog(page).ariaSnapshot()).not.toContain("Weekly notes");
});

test("hovering a font previews it without selecting it, and leaving the list restores the preview", async ({
  page,
}) => {
  const commitsBefore = await fakeForge(page).commitMessages();
  await openSettings(page);
  const preview = fontPreview(page);

  await noteFontRow(page, "Lora").hover();

  await expectFamily(page, preview, NOTE_FONTS.Lora.stack);
  await expect(
    noteFontGroup(page).getByRole("radio", { name: "Inter", exact: true }),
  ).toBeChecked();
  await page.waitForTimeout(2500);
  expect(await addedCommits(page, commitsBefore)).toEqual([]);

  await moveOffFontList(page);

  await expectFamily(page, preview, NOTE_FONTS.Inter.stack);
});

test("hover takes precedence over focus, and focus over the selection", async ({
  page,
}) => {
  await openSettings(page);
  const preview = fontPreview(page);
  await chooseOption(page, "Note font", "Literata");

  await page.keyboard.press("ArrowDown");
  await expect(
    noteFontGroup(page).getByRole("radio", { name: "Source Serif 4", exact: true }),
  ).toBeChecked();
  await noteFontRow(page, "JetBrains Mono").hover();

  await expectFamily(page, preview, NOTE_FONTS["JetBrains Mono"].stack);

  await moveOffFontList(page);

  await expectFamily(page, preview, NOTE_FONTS["Source Serif 4"].stack);
});

test("on mobile the font preview stays visible while the font list scrolls and does not cover the placement options", { tag: "@mobile-only" }, async ({
  page,
}) => {
  const commitsBefore = await fakeForge(page).commitMessages();
  await openSettings(page);
  const preview = fontPreview(page);

  await noteFontGroup(page)
    .getByRole("radio", { name: "IBM Plex Mono", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(preview).toBeInViewport();

  await noteFontRow(page, "Nunito").tap();
  await expectFamily(page, preview, NOTE_FONTS.Nunito.stack);
  await expect(preview).toBeInViewport();

  const placement = settingsDialog(page)
    .getByRole("radiogroup", { name: "New notes" })
    .getByRole("radio", { name: "At the end", exact: true });
  await placement.scrollIntoViewIfNeeded();
  await chooseOption(page, "New notes", "At the end");

  await expect(placement).toBeChecked();
  await expectSettingsCommits(page, commitsBefore.length + 1);
});

test("previewing a font downloads only that font's face", async ({
  page,
}) => {
  await openSettings(page);
  for (const { family } of Object.values(NOTE_FONTS)) {
    if (family) await expectFontLoaded(page, family);
  }
  await page.waitForTimeout(500);
  const files = collectFontFiles(page);

  await noteFontRow(page, "Lora").hover();
  await expect
    .poll(() =>
      page.evaluate(() => document.fonts.check('italic 16px "Lora Variable"')),
    )
    .toBe(true);
  await page.waitForTimeout(500);

  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    expect(file.startsWith("lora-")).toBe(true);
  }
});

interface PickerLayout {
  readonly preview: string;
  readonly list: string;
  readonly rows: string[];
  readonly placement: string;
}

function pickerLayout(page: Page): Promise<PickerLayout> {
  return settingsDialog(page).evaluate((dialog) => {
    const box = (el: Element | null): string => {
      if (!el) throw new Error("font picker element not found");
      const { x, y, width, height } = el.getBoundingClientRect();
      return [x, y, width, height].map((value) => value.toFixed(1)).join(" ");
    };
    const list = dialog.querySelector('[role="radiogroup"][aria-label="Note font"]');
    return {
      preview: box(dialog.querySelector('[data-testid="font-preview"]')),
      list: box(list),
      rows: [...(list?.querySelectorAll("label") ?? [])].map(box),
      placement: box(dialog.querySelector('[role="radiogroup"][aria-label="New notes"]')),
    };
  });
}

async function openUnscrolledSettings(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport");
  await page.setViewportSize({ width: viewport.width, height: 2000 });
  await openSettings(page);
  await expect
    .poll(() =>
      settingsDialog(page)
        .locator(".dialog-body")
        .evaluate((body) => body.scrollHeight <= body.clientHeight),
    )
    .toBe(true);
}

async function waitForAllNoteFonts(page: Page): Promise<void> {
  for (const { family } of Object.values(NOTE_FONTS)) {
    if (family) await expectFontLoaded(page, family);
  }
  await page.evaluate(() => document.fonts.ready);
}

test("hovering across the font options moves nothing around the font picker", async ({
  page,
}) => {
  await openUnscrolledSettings(page);
  await waitForAllNoteFonts(page);
  const preview = fontPreview(page);
  const before = await pickerLayout(page);

  for (const [name, { stack }] of Object.entries(NOTE_FONTS)) {
    await noteFontRow(page, name).hover();
    await expectFamily(page, preview, stack);
    await page.evaluate(() => document.fonts.ready);

    expect(await pickerLayout(page), name).toEqual(before);
  }
});

test("moving keyboard focus across the font options moves nothing around the font picker", { tag: "@mobile" }, async ({
  page,
}) => {
  await openUnscrolledSettings(page);
  await waitForAllNoteFonts(page);
  const preview = fontPreview(page);
  const before = await pickerLayout(page);
  await noteFontGroup(page).getByRole("radio", { name: "Inter", exact: true }).focus();

  for (const [index, [name, { stack }]] of Object.entries(NOTE_FONTS).entries()) {
    if (index > 0) await page.keyboard.press("ArrowDown");
    await expect(
      noteFontGroup(page).getByRole("radio", { name, exact: true }),
    ).toBeFocused();
    await expectFamily(page, preview, stack);
    await page.evaluate(() => document.fonts.ready);

    expect(await pickerLayout(page), name).toEqual(before);
  }
});

test("hovering font rows under the stuck preview moves nothing and keeps the scroll position", async ({
  page,
}) => {
  await openSettings(page);
  await waitForAllNoteFonts(page);
  const body = settingsDialog(page).locator(".dialog-body");
  const preview = fontPreview(page);
  const scrollTop = await body.evaluate((el) => {
    const previewEl = el.querySelector('[data-testid="font-preview"]')!;
    el.scrollTop +=
      previewEl.getBoundingClientRect().top - el.getBoundingClientRect().top + 40;
    return el.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);
  const before = await pickerLayout(page);
  const previewBox = await preview.boundingBox();
  const bodyBox = await body.boundingBox();
  if (!previewBox || !bodyBox) throw new Error("dialog not measurable");
  const top = previewBox.y + previewBox.height + 8;
  const bottom = bodyBox.y + bodyBox.height - 8;

  for (const x of [previewBox.x + previewBox.width / 4, previewBox.x + (previewBox.width * 3) / 4]) {
    for (let y = top; y < bottom; y += 12) {
      await page.mouse.move(x, y);
      await page.evaluate(() => document.fonts.ready);

      expect(await pickerLayout(page), `pointer at ${x},${y}`).toEqual(before);
    }
  }
  expect(await body.evaluate((el) => el.scrollTop)).toBe(scrollTop);
});

test("the font picker keeps its layout while the fonts are still downloading", { tag: "@mobile" }, async ({
  page,
  isMobile,
}) => {
  let releaseFonts!: () => void;
  const fontsReleased = new Promise<void>((resolve) => {
    releaseFonts = resolve;
  });
  await page.route(
    (url) =>
      url.pathname.endsWith(".woff2") &&
      BUNDLED_FILE_PREFIXES.some((prefix) =>
        url.pathname.split("/").pop()!.startsWith(prefix),
      ),
    async (route) => {
      await fontsReleased;
      await route.continue();
    },
  );
  await openUnscrolledSettings(page);
  const before = await pickerLayout(page);

  for (const [name, { family }] of Object.entries(NOTE_FONTS)) {
    const radio = noteFontGroup(page).getByRole("radio", { name, exact: true });
    if (isMobile) await radio.focus();
    else await noteFontRow(page, name).hover();

    expect(await pickerLayout(page), name).toEqual(before);
    if (family) {
      expect(
        await page.evaluate((family) => document.fonts.check(`16px "${family}"`), family),
        `${name} is still downloading`,
      ).toBe(false);
    }
  }

  releaseFonts();
  await waitForAllNoteFonts(page);
  expect(await pickerLayout(page)).toEqual(before);
});
