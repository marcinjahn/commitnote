import { describe, expect, it } from "vitest";
import {
  CORE_COMMAND_NAMES,
  CORE_EVENT_NAMES,
  FAKE_CORE_COMMAND_NAMES,
  NATIVE_CORE_API_VERSION,
  NATIVE_CORE_MARKER,
  type CoreCommands,
  type CoreEvents,
  type FakeCoreCommands,
} from "./api";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
function assertType<_T extends true>(): void {}

assertType<Equal<(typeof CORE_COMMAND_NAMES)[number], keyof CoreCommands>>();
assertType<Equal<(typeof CORE_EVENT_NAMES)[number], keyof CoreEvents>>();
assertType<
  Equal<(typeof FAKE_CORE_COMMAND_NAMES)[number], keyof FakeCoreCommands>
>();

describe("native core API", () => {
  it("declares version 3 and the marker", () => {
    expect(NATIVE_CORE_API_VERSION).toBe(3);
    expect(NATIVE_CORE_MARKER).toBe("commitnote-native-core");
  });

  it.each([
    ["commands", CORE_COMMAND_NAMES],
    ["events", CORE_EVENT_NAMES],
    ["fake commands", FAKE_CORE_COMMAND_NAMES],
  ])("lists %s without duplicates", (_label, names) => {
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps fake commands out of the production command list", () => {
    const production = new Set<string>(CORE_COMMAND_NAMES);
    expect(FAKE_CORE_COMMAND_NAMES.some((name) => production.has(name))).toBe(
      false,
    );
  });
});
