import { describe, expect, it } from "vitest";
import {
  describeDay,
  describeEvent,
  describeFold,
  describeHistoryEnd,
  describeSession,
  describeTime,
} from "./history-messages";

const NOW = new Date(2026, 8, 30, 9, 15).getTime();

describe("describeDay", () => {
  it("names today and yesterday", () => {
    expect(
      describeDay(new Date(2026, 8, 30, 0, 1).getTime(), NOW, "en-GB"),
    ).toBe("Today");
    expect(
      describeDay(new Date(2026, 8, 29, 23, 59).getTime(), NOW, "en-GB"),
    ).toBe("Yesterday");
  });

  it("shows the weekday and date for older days of this year", () => {
    expect(describeDay(new Date(2026, 2, 9, 12).getTime(), NOW, "en-GB")).toBe(
      "Mon 9 Mar",
    );
  });

  it("adds the year for days of another year", () => {
    expect(describeDay(new Date(2025, 2, 14, 12).getTime(), NOW, "en-GB")).toBe(
      "Fri 14 Mar 2025",
    );
  });

  it("follows the given locale", () => {
    expect(describeDay(new Date(2026, 2, 9, 12).getTime(), NOW, "en-US")).toBe(
      "Mon Mar 9",
    );
  });
});

describe("describeTime", () => {
  it("shows hours and minutes in the given locale", () => {
    const at = new Date(2026, 8, 30, 14, 2).getTime();

    expect(describeTime(at, "en-GB")).toBe("14:02");
    expect(describeTime(at, "en-US")).toBe("02:02 PM");
  });
});

describe("describeSession", () => {
  it("shows the time range and the number of saves", () => {
    expect(
      describeSession(
        new Date(2026, 8, 30, 14, 31).getTime(),
        new Date(2026, 8, 30, 14, 2).getTime(),
        18,
        "en-GB",
      ),
    ).toBe("14:02–14:31 · 18 saves");
  });

  it("shows one time when all saves fall in the same minute", () => {
    const at = new Date(2026, 8, 30, 14, 2).getTime();

    expect(describeSession(at + 30_000, at, 3, "en-GB")).toBe(
      "14:02 · 3 saves",
    );
  });
});

describe("describeEvent", () => {
  it("names the previous title of a renamed note when known", () => {
    expect(describeEvent("renamed", "Draft")).toBe("Renamed from “Draft”");
    expect(describeEvent("renamed", null)).toBe("Renamed");
  });
});

describe("describeHistoryEnd", () => {
  it("tells a deleted history apart from one under a previous passphrase", () => {
    expect(
      describeHistoryEnd({ kind: "passphraseChanged", historyDeleted: true }),
    ).toBe("Earlier history was deleted when the passphrase was changed.");
    expect(
      describeHistoryEnd({ kind: "passphraseChanged", historyDeleted: false }),
    ).toBe(
      "Earlier versions are encrypted with a previous passphrase and can't be shown.",
    );
  });
});

describe("line counts", () => {
  it("pluralizes", () => {
    expect(describeFold(1)).toBe("1 unchanged line");
    expect(describeFold(24)).toBe("24 unchanged lines");
  });
});
