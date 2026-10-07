import { describe, expect, it } from "vitest";
import {
  readFakeForgeOptions,
  resolveCornerStyleOverride,
  resolvePlatformOverride,
} from "./fake-forge-options";
import { GITHUB_LIKE_LATENCY, NO_LATENCY } from "./forge-latency";

describe("readFakeForgeOptions", () => {
  it("missing options means GitHub-like latency", () => {
    expect(readFakeForgeOptions(undefined).latency).toBe(GITHUB_LIKE_LATENCY);
  });

  it("null options mean GitHub-like latency", () => {
    expect(readFakeForgeOptions(null).latency).toBe(GITHUB_LIKE_LATENCY);
  });

  it.each(["none", 42, true])(
    "a non-object value %s means GitHub-like latency",
    (source) => {
      expect(readFakeForgeOptions(source).latency).toBe(GITHUB_LIKE_LATENCY);
    },
  );

  it("an object without latency means GitHub-like latency", () => {
    expect(readFakeForgeOptions({}).latency).toBe(GITHUB_LIKE_LATENCY);
  });

  it('latency "github" means GitHub-like latency', () => {
    expect(readFakeForgeOptions({ latency: "github" }).latency).toBe(
      GITHUB_LIKE_LATENCY,
    );
  });

  it.each(["fast", "", 0, null])(
    "an unknown latency value %s means GitHub-like latency",
    (latency) => {
      expect(readFakeForgeOptions({ latency }).latency).toBe(
        GITHUB_LIKE_LATENCY,
      );
    },
  );

  it('latency "none" turns every simulated delay off', () => {
    expect(readFakeForgeOptions({ latency: "none" }).latency).toBe(NO_LATENCY);
    expect(Object.values(NO_LATENCY).every((ms) => ms === 0)).toBe(true);
  });
});

describe("readFakeForgeOptions argon2Results", () => {
  it.each([undefined, null, "none", {}, { latency: "none" }])(
    "is null when the source %j has no argon2Results",
    (source) => {
      expect(readFakeForgeOptions(source).argon2Results).toBeNull();
    },
  );

  it.each(["key:hash", { key: "hash" }, 1, null])(
    "is null when argon2Results %j is not an array",
    (argon2Results) => {
      expect(readFakeForgeOptions({ argon2Results }).argon2Results).toBeNull();
    },
  );

  it("an empty array means memoize with no seed", () => {
    expect(readFakeForgeOptions({ argon2Results: [] }).argon2Results).toEqual(
      [],
    );
  });

  it("keeps well-formed entries in order", () => {
    const argon2Results = [
      ["a", "AAAA"],
      ["b", "BBBB"],
    ];
    expect(readFakeForgeOptions({ argon2Results }).argon2Results).toEqual(
      argon2Results,
    );
  });

  it("skips malformed entries", () => {
    const argon2Results = [
      ["a", "AAAA"],
      ["only key"],
      ["b", "BBBB", "extra"],
      ["c", 3],
      [4, "DDDD"],
      "e:EEEE",
      null,
      ["f", "FFFF"],
    ];
    expect(readFakeForgeOptions({ argon2Results }).argon2Results).toEqual([
      ["a", "AAAA"],
      ["f", "FFFF"],
    ]);
  });

  it("does not change how latency is read", () => {
    expect(
      readFakeForgeOptions({ latency: "none", argon2Results: [] }).latency,
    ).toBe(NO_LATENCY);
  });
});

describe("readFakeForgeOptions platform", () => {
  it.each(["mac", "windows", "linux", "ios", "android", "other"])(
    "reads the valid platform %s",
    (platform) => {
      expect(readFakeForgeOptions({ platform }).platform).toBe(platform);
    },
  );

  it.each([undefined, null, "", "MAC", "beos", 3, {}])(
    "ignores the invalid platform %j",
    (platform) => {
      expect(readFakeForgeOptions({ platform }).platform).toBeNull();
    },
  );

  it("is null when the source has no platform", () => {
    expect(readFakeForgeOptions(undefined).platform).toBeNull();
  });
});

describe("resolvePlatformOverride", () => {
  const withOption = readFakeForgeOptions({ platform: "windows" });
  const withoutOption = readFakeForgeOptions({});

  it("prefers the URL parameter over the option", () => {
    expect(resolvePlatformOverride("?fake-platform=mac", withOption)).toBe(
      "mac",
    );
  });

  it("falls back to the option when the URL parameter is invalid", () => {
    expect(resolvePlatformOverride("?fake-platform=bogus", withOption)).toBe(
      "windows",
    );
  });

  it("uses the option when there is no URL parameter", () => {
    expect(resolvePlatformOverride("?other=1", withOption)).toBe("windows");
  });

  it("is null when neither is set", () => {
    expect(resolvePlatformOverride("", withoutOption)).toBeNull();
    expect(
      resolvePlatformOverride("?fake-platform=bogus", withoutOption),
    ).toBeNull();
  });
});

describe("readFakeForgeOptions cornerStyle", () => {
  it.each(["rounded", "square"])("reads the valid corner style %s", (cornerStyle) => {
    expect(readFakeForgeOptions({ cornerStyle }).cornerStyle).toBe(cornerStyle);
  });

  it.each([undefined, null, "", "SQUARE", "round", 3, {}])(
    "ignores the invalid corner style %j",
    (cornerStyle) => {
      expect(readFakeForgeOptions({ cornerStyle }).cornerStyle).toBeNull();
    },
  );

  it("is null when the source has no corner style", () => {
    expect(readFakeForgeOptions(undefined).cornerStyle).toBeNull();
  });
});

describe("resolveCornerStyleOverride", () => {
  const withOption = readFakeForgeOptions({ cornerStyle: "square" });
  const withoutOption = readFakeForgeOptions({});

  it("prefers the URL parameter over the option", () => {
    expect(resolveCornerStyleOverride("?fake-corners=rounded", withOption)).toBe(
      "rounded",
    );
  });

  it("falls back to the option when the URL parameter is invalid", () => {
    expect(resolveCornerStyleOverride("?fake-corners=bogus", withOption)).toBe(
      "square",
    );
  });

  it("uses the option when there is no URL parameter", () => {
    expect(resolveCornerStyleOverride("?other=1", withOption)).toBe("square");
  });

  it("is null when neither is set", () => {
    expect(resolveCornerStyleOverride("", withoutOption)).toBeNull();
    expect(
      resolveCornerStyleOverride("?fake-corners=bogus", withoutOption),
    ).toBeNull();
  });
});
