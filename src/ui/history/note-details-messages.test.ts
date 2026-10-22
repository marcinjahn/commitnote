import { describe, expect, it } from "vitest";
import {
  NOT_SAVED_YET_LABEL,
  describeCreated,
  describeUpdated,
  describeTaskProgress,
  describeWordCount,
} from "./note-details-messages";

const NOW = new Date(2026, 8, 30, 9, 15).getTime();
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

describe("NOT_SAVED_YET_LABEL", () => {
  it("is the placeholder text", () => {
    expect(NOT_SAVED_YET_LABEL).toBe("Not saved yet");
  });
});

describe("describeCreated", () => {
  const at = new Date(2025, 2, 12, 15).getTime();

  it("shows the date for an exact creation time", () => {
    expect(describeCreated({ at, exact: true }, "en-GB")).toEqual({ label: "Created", value: "12 Mar 2025" });
  });

  it("says before when the creation time is a lower bound", () => {
    expect(describeCreated({ at, exact: false }, "en-GB")).toEqual({ label: "Created before", value: "12 Mar 2025" });
  });

  it("shows the year for a date in the current year", () => {
    expect(
      describeCreated(
        { at: new Date(2026, 8, 2, 12).getTime(), exact: true },
        "en-GB",
      ),
    ).toEqual({ label: "Created", value: "2 Sept 2026" });
  });

  it("follows the given locale", () => {
    expect(describeCreated({ at, exact: true }, "de-DE")).toEqual({ label: "Created", value: "12.03.2025" });
  });
});

describe("describeUpdated", () => {
  it("says just now under a minute", () => {
    expect(describeUpdated(NOW, NOW, "en-GB")).toEqual({ label: "Updated", value: "just now" });
    expect(describeUpdated(NOW - 59 * SECOND, NOW, "en-GB")).toEqual({ label: "Updated", value: "just now" });
  });

  it("says just now for a time in the future", () => {
    expect(describeUpdated(NOW + 5 * MINUTE, NOW, "en-GB")).toEqual({ label: "Updated", value: "just now" });
  });

  it("counts whole minutes", () => {
    expect(describeUpdated(NOW - MINUTE, NOW, "en-GB")).toEqual({ label: "Updated", value: "1 minute ago" });
    expect(describeUpdated(NOW - 59 * MINUTE - 59 * SECOND, NOW, "en-GB")).toEqual({ label: "Updated", value: "59 minutes ago" });
  });

  it("counts whole hours", () => {
    expect(describeUpdated(NOW - HOUR, NOW, "en-GB")).toEqual({ label: "Updated", value: "1 hour ago" });
    expect(describeUpdated(NOW - 23 * HOUR - 59 * MINUTE, NOW, "en-GB")).toEqual({ label: "Updated", value: "23 hours ago" });
  });

  it("names yesterday by calendar day", () => {
    expect(
      describeUpdated(new Date(2026, 8, 29, 23, 59).getTime(), NOW, "en-GB"),
    ).toEqual({ label: "Updated", value: "9 hours ago" });
    expect(
      describeUpdated(new Date(2026, 8, 29, 8, 0).getTime(), NOW, "en-GB"),
    ).toEqual({ label: "Updated", value: "yesterday" });
  });

  it("counts calendar days up to six", () => {
    expect(
      describeUpdated(new Date(2026, 8, 27, 12).getTime(), NOW, "en-GB"),
    ).toEqual({ label: "Updated", value: "3 days ago" });
    expect(
      describeUpdated(new Date(2026, 8, 24, 12).getTime(), NOW, "en-GB"),
    ).toEqual({ label: "Updated", value: "6 days ago" });
  });

  it("switches to a date at seven days", () => {
    expect(
      describeUpdated(new Date(2026, 8, 23, 12).getTime(), NOW, "en-GB"),
    ).toEqual({ label: "Updated", value: "23 Sept 2026" });
  });

  it("shows the year for older dates", () => {
    expect(
      describeUpdated(new Date(2025, 2, 12, 12).getTime(), NOW, "en-GB"),
    ).toEqual({ label: "Updated", value: "12 Mar 2025" });
  });

  it("follows the given locale", () => {
    expect(describeUpdated(NOW - 5 * MINUTE, NOW, "de-DE")).toEqual({ label: "Updated", value: "vor 5 Minuten" });
  });
});

describe("describeWordCount", () => {
  it("pluralises", () => {
    expect(describeWordCount(0, "en-GB")).toEqual({ label: "words", value: "0" });
    expect(describeWordCount(1, "en-GB")).toEqual({ label: "word", value: "1" });
    expect(describeWordCount(2, "en-GB")).toEqual({ label: "words", value: "2" });
  });

  it("groups thousands", () => {
    expect(describeWordCount(1234, "en-GB")).toEqual({ label: "words", value: "1,234" });
  });
});

describe("describeTaskProgress", () => {
  it("shows done out of total", () => {
    expect(describeTaskProgress({ done: 3, total: 7 }, "en-GB")).toEqual({ label: "tasks done", value: "3/7" });
  });

  it("groups thousands", () => {
    expect(describeTaskProgress({ done: 1200, total: 1234 }, "en-GB")).toEqual({ label: "tasks done", value: "1,200/1,234" });
  });

  it("keeps the plural label for a single task", () => {
    expect(describeTaskProgress({ done: 1, total: 1 }, "en-GB")).toEqual({ label: "tasks done", value: "1/1" });
  });

  it("groups thousands in the given locale", () => {
    expect(describeTaskProgress({ done: 1000, total: 2000 }, "de-DE")).toEqual({ label: "tasks done", value: "1.000/2.000" });
  });
});
