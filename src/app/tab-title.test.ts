import { describe, expect, it } from "vitest";
import { LOGIN_TAB_TITLE, computeTabTitle, createTabTitle } from "./tab-title";

describe("computeTabTitle", () => {
  it("is the plain name when saved", () => {
    expect(computeTabTitle({ unsaved: false, override: null })).toBe("commitnote");
  });

  it("is marked when unsaved", () => {
    expect(computeTabTitle({ unsaved: true, override: null })).toBe("● commitnote");
  });

  it("prefers the override", () => {
    expect(computeTabTitle({ unsaved: true, override: "Welcome" })).toBe("Welcome");
    expect(computeTabTitle({ unsaved: false, override: "Welcome" })).toBe("Welcome");
  });
});

describe("createTabTitle", () => {
  it("sets and clears the unsaved marker", () => {
    const target = { title: "" };
    const title = createTabTitle(target);
    title.setUnsaved(true);
    expect(target.title).toBe("● commitnote");
    title.setUnsaved(false);
    expect(target.title).toBe("commitnote");
  });

  it("lets an override win over unsaved and restores the current computed title on release", () => {
    const target = { title: "" };
    const title = createTabTitle(target);
    title.setUnsaved(true);
    const release = title.override("Welcome");
    expect(target.title).toBe("Welcome");
    title.setUnsaved(false);
    expect(target.title).toBe("Welcome");
    release();
    expect(target.title).toBe("commitnote");
  });

  it("ignores a second release", () => {
    const target = { title: "" };
    const title = createTabTitle(target);
    const release = title.override("Welcome");
    release();
    title.setUnsaved(true);
    release();
    expect(target.title).toBe("● commitnote");
  });

  it("lets a newer override replace an older one", () => {
    const target = { title: "" };
    const title = createTabTitle(target);
    const first = title.override("First");
    const second = title.override("Second");
    first();
    expect(target.title).toBe("Second");
    second();
    expect(target.title).toBe("commitnote");
  });

  it("shows the login title until released, then the notes title", () => {
    const target = { title: "" };
    const title = createTabTitle(target);
    const release = title.override(LOGIN_TAB_TITLE);
    expect(target.title).toBe("Log in · commitnote");
    release();
    expect(target.title).toBe("commitnote");
  });
});
