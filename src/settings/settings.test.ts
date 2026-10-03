import { describe, expect, it } from "vitest";
import {
  applySettingsEdits,
  changedSettingKeys,
  rawSettingsOf,
  resolveSettings,
  SETTINGS_SCHEMA,
  settingValuesEqual,
  type SettingDefinition,
} from "./settings";

const FLAVORS = ["sweet", "salty"] as const;
type Flavor = (typeof FLAVORS)[number];

const flag: SettingDefinition<boolean> = {
  default: false,
  parse: (raw) => (typeof raw === "boolean" ? raw : undefined),
};

const flavor: SettingDefinition<Flavor> = {
  default: "sweet",
  parse: (raw) => FLAVORS.find((f) => f === raw),
};

const TEST_SCHEMA = { flag, flavor } as const;

describe("resolveSettings", () => {
  it("uses defaults for missing values", () => {
    expect(resolveSettings(TEST_SCHEMA, {})).toEqual({
      flag: false,
      flavor: "sweet",
    });
  });

  it("uses defaults for invalid values", () => {
    expect(resolveSettings(TEST_SCHEMA, { flag: "yes", flavor: 3 })).toEqual({
      flag: false,
      flavor: "sweet",
    });
  });

  it("returns valid values", () => {
    expect(
      resolveSettings(TEST_SCHEMA, { flag: true, flavor: "salty" }),
    ).toEqual({ flag: true, flavor: "salty" });
  });

  it("ignores unknown keys", () => {
    const resolved = resolveSettings(TEST_SCHEMA, { other: 1, flag: true });
    expect(resolved).toEqual({ flag: true, flavor: "sweet" });
    expect(Object.keys(resolved).sort()).toEqual(["flag", "flavor"]);
  });

  it.each([undefined, null, "x", [], 5])(
    "resolves non-object raw %j to all defaults",
    (raw) => {
      expect(resolveSettings(TEST_SCHEMA, raw)).toEqual({
        flag: false,
        flavor: "sweet",
      });
    },
  );

  it("does not read inherited properties", () => {
    const raw = Object.create({ flag: true });
    expect(resolveSettings(TEST_SCHEMA, raw).flag).toBe(false);
  });

  it("resolves the real schema to an empty object", () => {
    expect(SETTINGS_SCHEMA).toEqual({});
    expect(resolveSettings(SETTINGS_SCHEMA, { anything: 1 })).toEqual({});
    expect(resolveSettings(SETTINGS_SCHEMA, undefined)).toEqual({});
  });
});

describe("rawSettingsOf", () => {
  it("returns plain objects as they are and anything else as an empty object", () => {
    const obj = { a: 1 };
    expect(rawSettingsOf(obj)).toBe(obj);
    for (const value of [undefined, null, "x", [], 1]) {
      expect(rawSettingsOf(value)).toEqual({});
    }
  });
});

describe("applySettingsEdits", () => {
  it("changes only the edited keys", () => {
    expect(
      applySettingsEdits({ flag: false, flavor: "salty" }, { flag: true }),
    ).toEqual({ flag: true, flavor: "salty" });
  });

  it("keeps unknown keys and untouched invalid values", () => {
    expect(
      applySettingsEdits({ future: { a: [1] }, flavor: "bogus" }, { flag: true }),
    ).toEqual({ future: { a: [1] }, flavor: "bogus", flag: true });
  });

  it("does not mutate its input", () => {
    const raw = { flag: false, nested: { a: 1 } };
    const snapshot = structuredClone(raw);
    const result = applySettingsEdits(raw, { flag: true });
    expect(raw).toEqual(snapshot);
    expect(result).not.toBe(raw);
  });

  it.each([undefined, null, "x", []])(
    "replaces non-object raw %j with an object holding the edits",
    (raw) => {
      expect(applySettingsEdits(raw, { flag: true })).toEqual({ flag: true });
    },
  );

  it("treats equal-value edits as no-ops", () => {
    const raw = { flag: true, list: [1, { a: 2 }], flavor: "x" };
    const edits = { flag: true, list: [1, { a: 2 }] };
    expect(changedSettingKeys(raw, edits)).toEqual([]);
    expect(applySettingsEdits(raw, edits)).toEqual(raw);
  });
});

describe("changedSettingKeys", () => {
  it("returns differing and absent keys sorted", () => {
    expect(
      changedSettingKeys(
        { flag: true, same: 1 },
        { same: 1, flavor: "salty", flag: false },
      ),
    ).toEqual(["flag", "flavor"]);
  });

  it("treats every edit as changed when raw is not an object", () => {
    expect(changedSettingKeys(null, { b: 1, a: 2 })).toEqual(["a", "b"]);
  });
});

describe("settingValuesEqual", () => {
  it("compares primitives", () => {
    expect(settingValuesEqual(1, 1)).toBe(true);
    expect(settingValuesEqual("a", "a")).toBe(true);
    expect(settingValuesEqual(null, null)).toBe(true);
    expect(settingValuesEqual(NaN, NaN)).toBe(true);
    expect(settingValuesEqual(1, "1")).toBe(false);
    expect(settingValuesEqual(null, undefined)).toBe(false);
    expect(settingValuesEqual(false, 0)).toBe(false);
  });

  it("compares arrays in order", () => {
    expect(settingValuesEqual([1, 2], [1, 2])).toBe(true);
    expect(settingValuesEqual([1, 2], [2, 1])).toBe(false);
    expect(settingValuesEqual([1], [1, 2])).toBe(false);
    expect(settingValuesEqual([], {})).toBe(false);
  });

  it("compares nested objects regardless of key order", () => {
    expect(
      settingValuesEqual({ a: [1, { b: 2 }], c: "x" }, { c: "x", a: [1, { b: 2 }] }),
    ).toBe(true);
    expect(settingValuesEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(settingValuesEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(settingValuesEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });
});
