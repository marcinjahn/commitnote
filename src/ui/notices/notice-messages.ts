import type { NotePath } from "../../changes/change";
import type { EngineNotice } from "../../sync/sync-engine";

export type ToastTone = "success" | "info" | "warning" | "error";

export interface ToastMessage {
  readonly id: number;
  readonly tone: ToastTone;
  readonly text: string;
  readonly action?: {
    readonly label: string;
    readonly run: () => void;
  };
  readonly durationMs?: number;
}

export function noticeTone(notice: EngineNotice): ToastTone {
  switch (notice.kind) {
    case "conflict":
    case "dropped":
      return "warning";
    case "merge":
    case "edited-merge-restored":
      return "info";
  }
}

export function toneLabel(tone: ToastTone): string {
  switch (tone) {
    case "success":
      return "Success";
    case "info":
      return "Info";
    case "warning":
      return "Warning";
    case "error":
      return "Error";
  }
}

function quoted(path: NotePath): string {
  return `“${path.join(" / ")}”`;
}

export function describeNotice(notice: EngineNotice): string {
  switch (notice.kind) {
    case "conflict":
      return `${quoted(notice.path)} was changed on another device too. Open it to resolve the conflict.`;
    case "edited-merge-restored":
      return `${quoted(notice.path)} was moved or deleted on another device while you were editing the merged text. Your merged text was saved at its original location — check it for parts you hadn't resolved yet.`;
    case "dropped": {
      const change = notice.change;
      switch (change.kind) {
        case "rename-note":
        case "rename-folder":
          return `Couldn't rename or move ${quoted(change.from)}: it changed on another device.`;
        case "delete-note":
        case "delete-folder":
          return `${quoted(change.path)} was not deleted because it changed on another device.`;
        case "restore-trash":
          return `Couldn't restore ${quoted(change.to)} from the trash: it changed on another device.`;
        case "purge-trash":
          return "Some items couldn't be permanently deleted from the trash because it changed on another device.";
        case "set-order":
          return "Some items couldn't be moved to their new position because they changed on another device.";
        case "set-settings":
          return "Some settings couldn't be saved because they changed on another device.";
        case "add-share":
        case "update-share":
        case "remove-share":
          return "A change to your shared links couldn't be saved.";
        case "set-color-tag":
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
        case "restore-skipped":
          return `Couldn't restore ${quoted(merge.path)}: it is no longer in the trash.`;
      }
    }
  }
}
