import type { LoginStep } from "../login/login";
import type { ColorTag } from "../tags/color-tag";
import type { HostServices } from "./host-services";

export type { ColorTag };

export const NATIVE_CORE_API_VERSION = 3;
export const NATIVE_CORE_MARKER = "commitnote-native-core";

type ForgeKind = "github" | "gitlab";

export type CoreErrorKind =
  | "unauthorized"
  | "noAccess"
  | "forbidden"
  | "notFound"
  | "rateLimited"
  | "network"
  | "server"
  | "readOnly"
  | "foreign"
  | "noMainBranch"
  | "newerFormat"
  | "wrongPassphrase"
  | "initializationRaced"
  | "repositoryChanged"
  | "treeTruncated"
  | "undecryptable"
  | "keyChanged"
  | "unknownCommand"
  | "invalidParams"
  | "notReady"
  | "internal";

export interface CoreError {
  kind: CoreErrorKind;
  message: string;
  transient: boolean;
  retryAfterMs?: number;
  formatVersion?: number;
}

export type TreeNode =
  | {
      kind: "folder";
      name: string;
      path: string[];
      noteCount: number;
      children: TreeNode[];
    }
  | {
      kind: "note";
      name: string;
      path: string[];
      colorTag: ColorTag | null;
      shared: boolean;
    };

export type StructureOutcome =
  { kind: "ok"; path: string[] } | { kind: "error"; message: string };

export interface MoveTargetView {
  path: string[];
  label: string;
  depth: number;
  disabled: boolean;
}

export interface TrashPreview {
  title: string;
  message: string;
  confirmLabel: string;
  itemCount: number;
  shareCount: number;
}

export type TrashOutcome =
  | { kind: "trashed"; entryId: string }
  | { kind: "deleted" }
  | { kind: "confirm"; preview: TrashPreview }
  | { kind: "error"; message: string };

export interface TrashItemView {
  kind: "note" | "folder";
  name: string;
  subPath: string[];
  children: TrashItemView[];
}

export interface TrashEntryView {
  id: string;
  kind: "note" | "folder";
  name: string;
  originalFolder: string;
  daysLeft: string;
  colorTag: ColorTag | null;
  children: TrashItemView[];
}

export interface TrashConfirmationText {
  title: string;
  message: string;
}

export interface SearchRow {
  path: string[];
  name: string;
  folder: string | null;
  nameRanges: [number, number][];
  snippet: { text: string; match: boolean }[] | null;
  colorTag: ColorTag | null;
}

export interface SearchCopy {
  recentHeading: string;
  namesHeading: string;
  contentsHeading: string;
  noMatches: string;
  stillReading: string;
  hint: string;
}

export interface SearchResults {
  recent: SearchRow[];
  names: SearchRow[];
  contents: SearchRow[];
  countText: string | null;
  namesMore: string | null;
  contentsMore: string | null;
  copy: SearchCopy;
}

export interface DetailItemText {
  label: string;
  value: string;
}

export type NameCommitOutcome =
  | { kind: "none" }
  | { kind: "restore" }
  | { kind: "error"; message: string }
  | { kind: "ok"; path: string[] };

export interface LastViewState {
  note: string[] | null;
  folders: string[][];
}

export type EarlyDraftOutcome =
  | { kind: "none" }
  | { kind: "draft"; name: string; error: string | null }
  | { kind: "created"; path: string[]; fieldError: string | null };

export interface TagOptionView {
  tag: ColorTag;
  label: string;
}

export type OpenNote =
  | { state: "loading"; path: string[] }
  | {
      state: "loaded";
      path: string[];
      content: string;
      conflict: OpenNoteConflict | null;
      colorTag: ColorTag | null;
      shared: boolean;
    }
  | { state: "missing" | "trashed"; path: string[]; message: string }
  | { state: "failed"; path: string[]; message: string; error: CoreError };

export interface OpenNoteConflict {
  otherDevice: string | null;
  heading: string;
  text: string;
  keepThisLabel: string;
  keepOtherLabel: string;
  editMergedLabel: string;
  editHint: string;
  merged: string;
  editing: boolean;
}

export interface RemoteTextEdit {
  from: number;
  to: number;
  insert: string;
}

export type SyncState =
  | { kind: "synced" }
  | { kind: "syncing" }
  | { kind: "out-of-sync"; reason: "pending" | "failed" | "conflict" };

export interface SyncStatusMenuItem {
  id: string;
  label: string;
  path: string[] | null;
}

export type NoticeAction =
  | { kind: "openNote"; label: "Open note"; path: string[] }
  | { kind: "undo"; label: "Undo" };

export type FlushOutcome =
  { kind: "saved" } | { kind: "unsaved"; count: number };

export type ConflictResolution = "keepMine" | "keepTheirs" | "editMerged";

export type LogoutOutcome =
  { kind: "loggedOut" } | { kind: "unsaved"; count: number; message: string };

export interface NoteDraft {
  parent: string[];
  name: string;
}

export type NoteDraftOutcome =
  | { kind: "none" }
  | { kind: "error"; message: string }
  | { kind: "created"; path: string[]; fieldError: string | null };

export type FolderCreateOutcome =
  { kind: "created"; path: string[] } | { kind: "error"; message: string };

export interface ExportedArchive {
  fileName: string;
  mimeType: "application/zip";
  base64: string;
}

export interface RepositoryView {
  label: string;
  url: string;
  private: boolean;
  publicWarning: string | null;
}

export interface ForgeView {
  id: ForgeKind;
  name: string;
  accessTokenHint: string;
  accessTokenCreationUrl: string;
  repositoryCreationUrl: string;
}

export interface CoreRequest<Name extends string = string, Params = unknown> {
  id: number;
  command: Name;
  params: Params;
}

export type CoreResponse<Result = unknown> =
  | { kind: "response"; id: number; ok: true; result: Result }
  | { kind: "response"; id: number; ok: false; error: CoreError };

export interface CoreEventMessage<
  Name extends string = string,
  Payload = unknown,
> {
  kind: "event";
  event: Name;
  payload: Payload;
}

export type LoggedIn = { kind: "loggedIn" };

export type CoreCommands = {
  "forges.list": { params: {}; result: { forges: ForgeView[] } };
  "login.lastRepository": {
    params: {};
    result: { repoUrl: string | null; forge: ForgeKind | null };
  };
  "login.listRepositories": {
    params: { forge: ForgeKind; accessToken: string };
    result: {
      repositories: { url: string; label: string; private: boolean }[];
    };
  };
  "login.inspectRepository": {
    params: { forge: ForgeKind; accessToken: string; repositoryUrl: string };
    result:
      | { kind: "notesRepo"; repository: RepositoryView }
      | {
          kind: "uninitialized";
          repository: RepositoryView;
          setUpDescription: string;
        }
      | {
          kind: "unusable";
          repository: RepositoryView;
          error: CoreError;
          canCheckAgain: boolean;
          foreignHint: string | null;
        };
  };
  "login.unlock": { params: { passphrase: string }; result: LoggedIn };
  "login.initialize": { params: { passphrase: string }; result: LoggedIn };
  "passphrase.strength": {
    params: { passphrase: string; repositoryLabel: string };
    result: {
      score: 0 | 1 | 2 | 3 | 4;
      label: string;
      filledSegments: number;
      weak: boolean;
      warning: string;
    };
  };
  "session.resume": {
    params: {};
    result:
      | { kind: "none" }
      | { kind: "resumed" }
      | { kind: "failed"; error: CoreError; canRetry: boolean };
  };
  "session.logout": {
    params: { anyway: boolean };
    result: { outcome: LogoutOutcome };
  };
  "tree.get": { params: {}; result: { tree: TreeNode[] | null } };
  "note.open": {
    params: { path: string[] | null };
    result: { note: OpenNote | null };
  };
  "sync.refresh": { params: {}; result: {} };
  "note.edit": { params: { path: string[]; text: string }; result: {} };
  "sync.flush": { params: {}; result: { result: FlushOutcome } };
  "sync.retry": { params: {}; result: {} };
  "conflict.resolve": {
    params: { path: string[]; resolution: ConflictResolution };
    result: {};
  };
  "export.notes": { params: {}; result: ExportedArchive };
  "draft.start": { params: { parent: string[] }; result: { draft: NoteDraft } };
  "draft.commitName": {
    params: { name: string };
    result: { outcome: NoteDraftOutcome };
  };
  "draft.content": {
    params: { name: string; content: string };
    result: { outcome: NoteDraftOutcome };
  };
  "draft.leave": { params: {}; result: {} };
  "folder.create": {
    params: { parent: string[]; name: string };
    result: { outcome: FolderCreateOutcome };
  };
  "lifecycle.setVisible": { params: { visible: boolean }; result: {} };
  "lifecycle.setOnline": { params: { online: boolean }; result: {} };
  "device.name": { params: {}; result: { name: string } };
  "notices.dismiss": { params: { id: string }; result: {} };
  "notices.perform": { params: { id: string }; result: {} };
  "node.rename": {
    params: { path: string[]; name: string };
    result: { outcome: StructureOutcome };
  };
  "node.move": {
    params: { path: string[]; parent: string[] };
    result: { outcome: StructureOutcome };
  };
  "node.place": {
    params: { path: string[]; parent: string[]; before: string | null };
    result: { outcome: StructureOutcome };
  };
  "node.moveSibling": {
    params: { path: string[]; direction: "up" | "down" };
    result: { outcome: StructureOutcome | { kind: "none" } };
  };
  "node.moveTargets": {
    params: { path: string[] };
    result: { targets: MoveTargetView[] };
  };
  "node.trashPreview": {
    params: { path: string[] };
    result: { preview: TrashPreview };
  };
  "node.trash": {
    params: { path: string[]; shareCount: number };
    result: { outcome: TrashOutcome };
  };
  "node.setColorTag": {
    params: { path: string[]; tag: ColorTag | null };
    result: { outcome: StructureOutcome };
  };
  "trash.restoreTargets": {
    params: { entryId: string; subPath: string[] };
    result: { targets: MoveTargetView[] };
  };
  "trash.restore": {
    params: { entryId: string; subPath: string[]; parent: string[] };
    result: { outcome: StructureOutcome };
  };
  "trash.delete": { params: { entryId: string }; result: {} };
  "trash.empty": { params: {}; result: {} };
  "tags.setFilter": { params: { tag: ColorTag | null }; result: {} };
  "search.open": { params: {}; result: {} };
  "search.close": { params: {}; result: {} };
  "search.query": {
    params: { query: string };
    result: { results: SearchResults };
  };
  "note.rename": {
    params: { path: string[]; name: string };
    result: { outcome: NameCommitOutcome };
  };
  "note.stats": {
    params: { path: string[] };
    result: { words: DetailItemText; tasks: DetailItemText | null };
  };
  "note.dates": {
    params: { path: string[] };
    result: {
      notSaved: boolean;
      created: DetailItemText | null;
      updated: DetailItemText | null;
    };
  };
  "image.read": {
    params: { imageId: string };
    result: {
      image: { type: "image/webp" | "image/gif"; base64: string } | null;
    };
  };
  "lastView.load": { params: {}; result: { view: LastViewState | null } };
  "lastView.save": { params: LastViewState; result: {} };
  "earlyDraft.handOff": {
    params: { name: string; body: string; nameConfirmed: boolean };
    result: { outcome: EarlyDraftOutcome };
  };
};

export type FakeCoreCommands = {
  "fake.saveNote": { params: { path: string[]; text: string }; result: {} };
  "fake.exportRepo": {
    params: { repoKey: string };
    result: { exported: string };
  };
  "fake.expectedSampleNotes": {
    params: {};
    result: { notes: { path: string[]; text: string }[] };
  };
  "fake.checkVectors": {
    params: { files: Record<string, unknown> };
    result: { checked: number; failures: string[] };
  };
  "fake.httpRequest": {
    params: {
      method: string;
      url: string;
      headers: Record<string, string>;
      bodyText: string;
    };
    result: {
      status: number;
      headers: Record<string, string>;
      bodyText: string;
    };
  };
  "fake.timerProbe": {
    params: { delaysMs: number[]; cancelIndex: number | null };
    result: { fired: number[] };
  };
  "fake.remoteEdit": {
    params: { repo: string; path: string[]; text: string; device: string };
    result: {};
  };
  "fake.changeRepoKey": { params: { repo: string }; result: {} };
  "fake.failNext": {
    params: { repo: string; operation: string; kind: string; count: number };
    result: {};
  };
  "fake.clearFailures": {
    params: { repo: string; operation: string };
    result: {};
  };
  "fake.shareNote": { params: { path: string[] }; result: {} };
  "fake.holdLoading": { params: {}; result: {} };
  "fake.releaseLoading": { params: {}; result: {} };
};

export type CoreEvents = {
  loadingProgress: { step: LoginStep; message: string };
  treeChanged: {
    tree: TreeNode[] | null;
    tagFilter: ColorTag | null;
    usedTags: ColorTag[];
    tagsWritable: boolean;
    tagOptions: TagOptionView[];
  };
  trashChanged: {
    entries: TrashEntryView[];
    deleteConfirmation: TrashConfirmationText;
    emptyConfirmation: TrashConfirmationText;
  };
  searchStatusChanged: {
    status: string | null;
    progress: number | null;
    partial: boolean;
  };
  noteChanged: { note: OpenNote | null; edits: RemoteTextEdit[] | null };
  noteContentChangedRemotely: {
    change: "updated" | "relocated" | "trashed";
    message: string;
  };
  syncStateChanged: {
    online: boolean;
    refreshing: boolean;
    treeLoaded: boolean;
    lastRefreshError: CoreError | null;
    state: SyncState;
    label: string;
    status: string | null;
    unsavedCount: number;
    canRetry: boolean;
    unsavedMenu: SyncStatusMenuItem[];
  };
  notice: {
    id: string;
    tone: "info" | "warning" | "error" | "success";
    message: string;
    persistent: boolean;
    action: NoticeAction | null;
  };
  noticeCleared: { id: string };
  keyChanged: {
    unsavedCount: number;
    message: string;
    detail: string;
    exportLabel: string;
  };
  sessionEnded: { reason: "loggedOut" };
};

export const CORE_COMMAND_NAMES = [
  "forges.list",
  "login.lastRepository",
  "login.listRepositories",
  "login.inspectRepository",
  "login.unlock",
  "login.initialize",
  "passphrase.strength",
  "session.resume",
  "session.logout",
  "tree.get",
  "note.open",
  "sync.refresh",
  "note.edit",
  "sync.flush",
  "sync.retry",
  "conflict.resolve",
  "export.notes",
  "draft.start",
  "draft.commitName",
  "draft.content",
  "draft.leave",
  "folder.create",
  "lifecycle.setVisible",
  "lifecycle.setOnline",
  "device.name",
  "notices.dismiss",
  "notices.perform",
  "node.rename",
  "node.move",
  "node.place",
  "node.moveSibling",
  "node.moveTargets",
  "node.trashPreview",
  "node.trash",
  "node.setColorTag",
  "trash.restoreTargets",
  "trash.restore",
  "trash.delete",
  "trash.empty",
  "tags.setFilter",
  "search.open",
  "search.close",
  "search.query",
  "note.rename",
  "note.stats",
  "note.dates",
  "image.read",
  "lastView.load",
  "lastView.save",
  "earlyDraft.handOff",
] as const satisfies readonly (keyof CoreCommands)[];

export const CORE_EVENT_NAMES = [
  "loadingProgress",
  "treeChanged",
  "trashChanged",
  "searchStatusChanged",
  "noteChanged",
  "noteContentChangedRemotely",
  "syncStateChanged",
  "notice",
  "noticeCleared",
  "keyChanged",
  "sessionEnded",
] as const satisfies readonly (keyof CoreEvents)[];

export const FAKE_CORE_COMMAND_NAMES = [
  "fake.saveNote",
  "fake.exportRepo",
  "fake.expectedSampleNotes",
  "fake.checkVectors",
  "fake.httpRequest",
  "fake.timerProbe",
  "fake.remoteEdit",
  "fake.changeRepoKey",
  "fake.failNext",
  "fake.clearFailures",
  "fake.shareNote",
  "fake.holdLoading",
  "fake.releaseLoading",
] as const satisfies readonly (keyof FakeCoreCommands)[];

export interface NativeCoreStartOptions {
  deviceModel: string;
}

export interface NativeCoreHandle {
  send(message: string): void;
  stop(): void;
}

export interface NativeCoreGlobal {
  apiVersion: number;
  marker: string;
  start(host: HostServices, options: NativeCoreStartOptions): NativeCoreHandle;
}
