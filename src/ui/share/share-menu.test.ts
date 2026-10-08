import { describe, expect, it } from "vitest";
import type { ShareEntry } from "../../share/share-index";
import { shareMenuIcons } from "../browse/action-icons";
import { shareMenuItems, type ShareMenuContext } from "./share-menu";

function entry(overrides: Partial<ShareEntry> = {}): ShareEntry {
  return {
    id: "s1",
    locator: { provider: "github", gistId: "gist" },
    linkSecret: "secret",
    password: "hunter2",
    name: "Alpha",
    sharedAt: "2026-01-01T00:00:00.000Z",
    note: { state: "active", path: ["Alpha"] },
    source: null,
    updatedAt: null,
    ...overrides,
  };
}

const CONTEXT: ShareMenuContext = { canOpen: true, writable: true, updating: false };

function find(items: ReturnType<typeof shareMenuItems>, id: string) {
  return items.find((item) => item.id === id);
}

describe("shareMenuItems", () => {
  it("lists every item in order for an active password share", () => {
    const items = shareMenuItems(entry(), CONTEXT);

    expect(items.map((item) => [item.id, item.label])).toEqual([
      ["copy-link", "Copy link"],
      ["copy-password", "Copy password"],
      ["update", "Update to current version"],
      ["view", "View shared version"],
      ["open", "Open note"],
      ["revoke", "Revoke…"],
    ]);
    for (const item of items) expect(item.icon).toBe(shareMenuIcons[item.id]);
  });

  it("omits Copy password without a password", () => {
    const items = shareMenuItems(entry({ password: null }), CONTEXT);

    expect(find(items, "copy-password")).toBeUndefined();
  });

  it("enables Update when writable and idle", () => {
    expect(find(shareMenuItems(entry(), CONTEXT), "update")?.disabled).toBeFalsy();
  });

  it("disables Update when the index is not writable", () => {
    const items = shareMenuItems(entry(), { ...CONTEXT, writable: false });

    expect(find(items, "update")?.disabled).toBe(true);
  });

  it("disables Update while an update runs", () => {
    const items = shareMenuItems(entry(), { ...CONTEXT, updating: true });

    expect(find(items, "update")?.disabled).toBe(true);
  });

  it("offers Open only when the note can be opened", () => {
    const items = shareMenuItems(entry(), { ...CONTEXT, canOpen: false });

    expect(find(items, "open")).toBeUndefined();
  });

  it("ends with a destructive Revoke", () => {
    const revoke = shareMenuItems(entry(), CONTEXT).at(-1);

    expect(revoke).toMatchObject({ id: "revoke", destructive: true });
    expect(revoke?.disabled).toBeFalsy();
  });

  it("disables Revoke when the index is not writable", () => {
    const items = shareMenuItems(entry(), { ...CONTEXT, writable: false });

    expect(items.at(-1)).toMatchObject({ id: "revoke", disabled: true });
  });
});
