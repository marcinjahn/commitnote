import { describe, expect, it } from "vitest";
import {
  classifySearchShortcut,
  isApplePlatform,
  searchShortcutHint,
  type ShortcutContext,
  type ShortcutKeyEvent,
} from "./search-shortcuts";

const key = (key: string, overrides: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  ...overrides,
});

const context = (overrides: Partial<ShortcutContext> = {}): ShortcutContext => ({
  apple: false,
  paletteOpen: false,
  otherDialogOpen: false,
  editableTarget: false,
  ...overrides,
});

describe("classifySearchShortcut", () => {
  it.each([
    { name: "Ctrl+K opens on non-Apple", event: key("k", { ctrlKey: true }), ctx: {}, expected: "open" },
    { name: "Ctrl+K uppercase opens", event: key("K", { ctrlKey: true }), ctx: {}, expected: "open" },
    { name: "Cmd+K opens on Apple", event: key("k", { metaKey: true }), ctx: { apple: true }, expected: "open" },
    { name: "Cmd+K ignored on non-Apple", event: key("k", { metaKey: true }), ctx: {}, expected: null },
    { name: "Ctrl+K ignored on Apple", event: key("k", { ctrlKey: true }), ctx: { apple: true }, expected: null },
    { name: "both modifiers rejected", event: key("k", { ctrlKey: true, metaKey: true }), ctx: {}, expected: null },
    { name: "plain k ignored", event: key("k"), ctx: {}, expected: null },
    { name: "toggle closes when open", event: key("k", { ctrlKey: true }), ctx: { paletteOpen: true }, expected: "close" },
    { name: "Cmd toggle closes when open", event: key("k", { metaKey: true }), ctx: { apple: true, paletteOpen: true }, expected: "close" },
    { name: "other dialog blocks open", event: key("k", { ctrlKey: true }), ctx: { otherDialogOpen: true }, expected: null },
    { name: "works in editable target", event: key("k", { ctrlKey: true }), ctx: { editableTarget: true }, expected: "open" },
    { name: "Alt rejected", event: key("k", { ctrlKey: true, altKey: true }), ctx: {}, expected: null },
    { name: "Shift rejected", event: key("k", { ctrlKey: true, shiftKey: true }), ctx: {}, expected: null },
    { name: "composing ignored", event: key("k", { ctrlKey: true, isComposing: true }), ctx: {}, expected: null },
    { name: "slash opens", event: key("/"), ctx: {}, expected: "open" },
    { name: "slash opens on Apple", event: key("/"), ctx: { apple: true }, expected: "open" },
    { name: "slash blocked while typing", event: key("/"), ctx: { editableTarget: true }, expected: null },
    { name: "slash blocked when palette open", event: key("/"), ctx: { paletteOpen: true }, expected: null },
    { name: "slash blocked by other dialog", event: key("/"), ctx: { otherDialogOpen: true }, expected: null },
    { name: "Ctrl+slash ignored", event: key("/", { ctrlKey: true }), ctx: {}, expected: null },
    { name: "Meta+slash ignored", event: key("/", { metaKey: true }), ctx: { apple: true }, expected: null },
    { name: "Alt+slash ignored", event: key("/", { altKey: true }), ctx: {}, expected: null },
    { name: "Shift+slash ignored", event: key("/", { shiftKey: true }), ctx: {}, expected: null },
    { name: "composing slash ignored", event: key("/", { isComposing: true }), ctx: {}, expected: null },
    { name: "other keys ignored", event: key("j", { ctrlKey: true }), ctx: {}, expected: null },
  ])("$name", ({ event, ctx, expected }) => {
    expect(classifySearchShortcut(event, context(ctx))).toBe(expected);
  });
});

describe("isApplePlatform", () => {
  it.each([
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", true],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", true],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", true],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0", false],
    ["Mozilla/5.0 (X11; Linux x86_64) Firefox/120.0", false],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/120.0 Mobile", false],
  ])("%s -> %s", (userAgent, expected) => {
    expect(isApplePlatform(userAgent)).toBe(expected);
  });
});

describe("searchShortcutHint", () => {
  it("renders the platform hint", () => {
    expect(searchShortcutHint(true)).toBe("⌘K");
    expect(searchShortcutHint(false)).toBe("Ctrl K");
  });
});
