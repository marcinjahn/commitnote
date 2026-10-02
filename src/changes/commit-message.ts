import { TRAILER } from "../format/v1";

export interface CommitTrailer {
  readonly key: string;
  readonly value: string;
}

export interface ParsedCommitMessage {
  readonly subject: string;
  /** Null when the message has no valid `Commitnote-Format` trailer. */
  readonly formatVersion: number | null;
  /** In message order, without the format trailer. */
  readonly trailers: readonly CommitTrailer[];
}

const TRAILER_LINE = /^([A-Za-z0-9-]+): (.*)$/;

/** Inverse of the message `encodeChangeSet` builds. */
export function parseCommitMessage(message: string): ParsedCommitMessage {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const subject = lines[0] ?? "";

  let blockStart = lines.length;
  while (blockStart > 1 && lines[blockStart - 1].trim() === "") blockStart--;
  const blockEnd = blockStart;
  while (blockStart > 1 && lines[blockStart - 1].trim() !== "") blockStart--;

  let formatVersion: number | null = null;
  const trailers: CommitTrailer[] = [];
  for (const line of lines.slice(Math.max(blockStart, 1), blockEnd)) {
    const match = TRAILER_LINE.exec(line);
    if (match === null) continue;
    const [, key, value] = match;
    if (key === TRAILER.format) {
      const version = Number(value);
      formatVersion = Number.isInteger(version) && version > 0 ? version : null;
      continue;
    }
    trailers.push({ key, value });
  }
  return { subject, formatVersion, trailers };
}
