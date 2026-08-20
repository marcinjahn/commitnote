import type { NotePath } from "../../changes/change";
import type { EngineNotice } from "../../sync/sync-engine";

function quoted(path: NotePath): string {
  return `“${path.join(" / ")}”`;
}

export function describeNotice(notice: EngineNotice): string {
  switch (notice.kind) {
    case "conflict":
      return `${quoted(notice.path)} was changed on another device too. Open it to resolve the conflict.`;
    case "dropped": {
      const change = notice.change;
      switch (change.kind) {
        case "rename-note":
        case "rename-folder":
          return `Couldn't rename or move ${quoted(change.from)}: it changed on another device.`;
        case "delete-note":
        case "delete-folder":
          return `${quoted(change.path)} was not deleted because it changed on another device.`;
        default:
          return `A change to ${quoted(change.path)} couldn't be saved because it changed on another device.`;
      }
    }
    case "merge": {
      const merge = notice.notice;
      switch (merge.kind) {
        case "edit-restored":
          return `${quoted(merge.path)} was moved or deleted on another device. Your edits were saved at its original location.`;
        case "delete-skipped":
          return `${quoted(merge.path)} was changed on another device, so it was not deleted.`;
        case "rename-skipped":
          return merge.reason === "target-exists"
            ? `Couldn't rename or move ${quoted(merge.from)} to ${quoted(merge.to)}: that name is already taken.`
            : `Couldn't rename or move ${quoted(merge.from)}: it no longer exists.`;
        case "relocated":
          return `${quoted(merge.from)} was saved as ${quoted(merge.to)} because another device created an item with the same name.`;
      }
    }
  }
}
