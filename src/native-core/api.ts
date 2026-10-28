import type { LoginStep } from "../login/login";
import type { HostServices } from "./host-services";

export const NATIVE_CORE_API_VERSION = 2;
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
  | { kind: "note"; name: string; path: string[] };

export type OpenNote =
  | { state: "loading"; path: string[] }
  | {
      state: "loaded";
      path: string[];
      content: string;
      conflict: OpenNoteConflict | null;
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

export type NoticeAction = {
  kind: "openNote";
  label: "Open note";
  path: string[];
};

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
};

export type CoreEvents = {
  loadingProgress: { step: LoginStep; message: string };
  treeChanged: { tree: TreeNode[] | null };
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
] as const satisfies readonly (keyof CoreCommands)[];

export const CORE_EVENT_NAMES = [
  "loadingProgress",
  "treeChanged",
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
