export const FOLD_TABLE: Readonly<Record<string, string>> = {
  ł: "l",
  ø: "o",
  đ: "d",
  ð: "d",
  ı: "i",
  ħ: "h",
  ŧ: "t",
  ŀ: "l",
  ƀ: "b",
  ƶ: "z",
};

export const INDEXER_CONCURRENCY = 3;
export const READS_PER_MINUTE = 120;
export const READS_PER_HOUR = 1_500;
export const INDEX_MEMORY_CAP_BYTES = 48 * 1024 * 1024;
export const INDEX_BYTES_PER_CHAR = 4;
export const CONTENT_QUERY_DEBOUNCE_MS = 100;
export const SOURCE_REFRESH_THROTTLE_MS = 250;
export const RESULT_CAP = 50;
export const SNIPPET_LENGTH = 140;
export const SNIPPET_LEAD = 30;
export const OCCURRENCE_SCORE_CAP = 10;
export const RATE_LIMIT_MIN_PAUSE_MS = 60_000;
export const READ_RETRY_BASE_MS = 1_000;
export const READ_ATTEMPTS = 4;
