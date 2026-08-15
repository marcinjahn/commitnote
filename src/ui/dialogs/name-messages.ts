import type { NameError } from "../../tree/note-names";

export function describeNameError(error: NameError): string {
  switch (error.kind) {
    case "empty":
      return "Enter a name.";
    case "containsSlash":
      return "Names can't contain “/”.";
    case "dotName":
      return "“.” and “..” can't be used as names.";
    case "tooLong":
      return `Names can be at most ${error.maxBytes} bytes. Some characters, like accented letters or emoji, count as more than one byte.`;
    case "duplicate":
      return "A note or folder with this name already exists here.";
  }
}
