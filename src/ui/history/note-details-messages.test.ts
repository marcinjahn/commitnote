import { describe, expect, it } from "vitest";
import {
  NOT_SAVED_YET_LABEL,
  countWords,
  describeCreated,
  describeUpdated,
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
    expect(describeCreated({ at, exact: true }, "en-GB")).toBe(
      "Created 12 Mar 2025",
    );
  });

  it("says before when the creation time is a lower bound", () => {
    expect(describeCreated({ at, exact: false }, "en-GB")).toBe(
      "Created before 12 Mar 2025",
    );
  });

  it("shows the year for a date in the current year", () => {
    expect(
      describeCreated(
        { at: new Date(2026, 8, 2, 12).getTime(), exact: true },
        "en-GB",
      ),
    ).toBe("Created 2 Sept 2026");
  });

  it("follows the given locale", () => {
    expect(describeCreated({ at, exact: true }, "de-DE")).toBe(
      "Created 12.03.2025",
    );
  });
});

describe("describeUpdated", () => {
  it("says just now under a minute", () => {
    expect(describeUpdated(NOW, NOW, "en-GB")).toBe("Updated just now");
    expect(describeUpdated(NOW - 59 * SECOND, NOW, "en-GB")).toBe(
      "Updated just now",
    );
  });

  it("says just now for a time in the future", () => {
    expect(describeUpdated(NOW + 5 * MINUTE, NOW, "en-GB")).toBe(
      "Updated just now",
    );
  });

  it("counts whole minutes", () => {
    expect(describeUpdated(NOW - MINUTE, NOW, "en-GB")).toBe(
      "Updated 1 minute ago",
    );
    expect(describeUpdated(NOW - 59 * MINUTE - 59 * SECOND, NOW, "en-GB")).toBe(
      "Updated 59 minutes ago",
    );
  });

  it("counts whole hours", () => {
    expect(describeUpdated(NOW - HOUR, NOW, "en-GB")).toBe(
      "Updated 1 hour ago",
    );
    expect(describeUpdated(NOW - 23 * HOUR - 59 * MINUTE, NOW, "en-GB")).toBe(
      "Updated 23 hours ago",
    );
  });

  it("names yesterday by calendar day", () => {
    expect(
      describeUpdated(new Date(2026, 8, 29, 23, 59).getTime(), NOW, "en-GB"),
    ).toBe("Updated 9 hours ago");
    expect(
      describeUpdated(new Date(2026, 8, 29, 8, 0).getTime(), NOW, "en-GB"),
    ).toBe("Updated yesterday");
  });

  it("counts calendar days up to six", () => {
    expect(
      describeUpdated(new Date(2026, 8, 27, 12).getTime(), NOW, "en-GB"),
    ).toBe("Updated 3 days ago");
    expect(
      describeUpdated(new Date(2026, 8, 24, 12).getTime(), NOW, "en-GB"),
    ).toBe("Updated 6 days ago");
  });

  it("switches to a date at seven days", () => {
    expect(
      describeUpdated(new Date(2026, 8, 23, 12).getTime(), NOW, "en-GB"),
    ).toBe("Updated 23 Sept 2026");
  });

  it("shows the year for older dates", () => {
    expect(
      describeUpdated(new Date(2025, 2, 12, 12).getTime(), NOW, "en-GB"),
    ).toBe("Updated 12 Mar 2025");
  });

  it("follows the given locale", () => {
    expect(describeUpdated(NOW - 5 * MINUTE, NOW, "de-DE")).toBe(
      "Updated vor 5 Minuten",
    );
  });
});

describe("countWords", () => {
  it("counts English prose", () => {
    expect(countWords("The quick brown fox, jumps over it.", "en-GB")).toBe(7);
  });

  it("ignores markdown punctuation", () => {
    expect(countWords("# Title\n\n- **one** two\n> three", "en-GB")).toBe(4);
  });

  it("segments CJK text into several words", () => {
    expect(countWords("今日は良い天気です", "ja")).toBe(5);
  });

  it("counts nothing for empty or whitespace-only text", () => {
    expect(countWords("", "en-GB")).toBe(0);
    expect(countWords(" \n\t ", "en-GB")).toBe(0);
  });
});

describe("describeWordCount", () => {
  it("pluralises", () => {
    expect(describeWordCount(0, "en-GB")).toBe("0 words");
    expect(describeWordCount(1, "en-GB")).toBe("1 word");
    expect(describeWordCount(2, "en-GB")).toBe("2 words");
  });

  it("groups thousands", () => {
    expect(describeWordCount(1234, "en-GB")).toBe("1,234 words");
  });
});
