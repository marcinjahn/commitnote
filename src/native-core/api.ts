import type { LaunchAction } from "../app/launch-action";
import type { LoginStep } from "../login/login";
import type { SettingScope } from "../settings/setting-scope";
import type { ColorTag } from "../tags/color-tag";
import type { MessagePart } from "../ui/share/share-messages";
import type { HostServices } from "./host-services";

export type { ColorTag, LaunchAction, MessagePart, SettingScope };

export const NATIVE_CORE_API_VERSION = 7;
export const NATIVE_CORE_MARKER = "commitnote-native-core";

export type NativePlatform = "ios" | "linux";
export const NATIVE_PLATFORMS = [
  "ios",
  "linux",
] as const satisfies readonly NativePlatform[];

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

export type SettingKeyView =
  | "colorMode"
  | "accentColor"
  | "noteFont"
  | "newNotePlacement"
  | "newFolderPlacement"
  | "typeToStart"
  | "vimMode";
export type ScopedSettingKey =
  | "colorMode"
  | "accentColor"
  | "noteFont"
  | "typeToStart";

export interface SettingOptionView {
  id: string;
  label: string;
  description: string | null;
}
export interface AccentOptionView {
  id: string;
  label: string;
  light: string | null;
  dark: string | null;
}
export interface SettingChoiceCopy {
  label: string;
  options: SettingOptionView[];
}

export interface SettingsCopy {
  title: string;
  intro: string;
  sections: {
    appearance: string;
    editor: string;
    notes: string;
    thisDevice: string;
    dataSecurity: string;
  };
  scopeLabels: { synced: string; device: string };
  colorMode: SettingChoiceCopy;
  accentColor: { label: string; options: AccentOptionView[] };
  noteFont: {
    label: string;
    options: SettingOptionView[];
    previewHeading: string;
    previewBody: string;
    previewCode: string;
  };
  editorUnavailable: string;
  typeToStart: { label: string; hint: string };
  vimMode?: { label: string; hint: string };
  newNotePlacement: SettingChoiceCopy;
  newFolderPlacement: SettingChoiceCopy;
  deviceName: { label: string; hint: string; maxLength: number };
  reopenLastView: { label: string };
  analytics: { label: string; hint: string };
  data: {
    exportLabel: string;
    exportingLabel: string;
    exportShareLabel: string;
    exportFilesLabel: string;
    exportFailed: string;
    importLabel: string;
    importingLabel: string;
    changePassphraseLabel: string;
  };
  retryLabel: string;
}

export interface SettingsView {
  values: {
    colorMode: string;
    accentColor: string;
    noteFont: string;
    newNotePlacement: string;
    newFolderPlacement: string;
    typeToStart: boolean;
    vimMode?: boolean;
  };
  scopes: {
    colorMode: SettingScope;
    accentColor: SettingScope;
    noteFont: SettingScope;
    typeToStart: SettingScope;
  };
  deviceName: string;
  automaticDeviceName: string;
  reopenLastView: boolean;
  analyticsCounted: boolean;
  canExport: boolean;
  canImport: boolean;
  canChangePassphrase: boolean;
}

export interface SettingsSaveView {
  state: "synced" | "syncing" | "pending" | "failed";
  label: string;
  detail: string;
  canRetry: boolean;
}

export type ImportPolicy = "stop" | "rename";
export type ImportDestinationView =
  | { kind: "root" }
  | { kind: "folder"; path: string[] }
  | { kind: "newFolder"; parent: string[]; name: string };
export interface ImportTargetView {
  path: string[];
  label: string;
  depth: number;
}
export interface ImportFormCopy {
  title: string;
  conflictsTitle: string;
  setupTitle: string;
  intoLabel: string;
  newFolderLabel: string;
  folderNameLabel: string;
  existingFolderLabel: string;
  rootLabel: string;
  emptyText: string;
  importLabel: string;
  importingLabel: string;
  renameLabel: string;
  enableAtomicLabel: string;
  cancelLabel: string;
}
export interface ImportForm {
  fileName: string;
  defaultFolderName: string;
  skipped: string | null;
  empty: boolean;
  targets: ImportTargetView[];
  copy: ImportFormCopy;
}
export type ImportArchiveOutcome =
  { kind: "ready"; form: ImportForm } | { kind: "error"; message: string };
export type ImportOutcomeView =
  | { kind: "queued"; expand: string[] | null }
  | { kind: "conflicts"; count: number; message: string }
  | {
      kind: "needsSetup";
      canConfigure: boolean;
      message: string;
      actionLabel: string;
    }
  | { kind: "error"; message: string };
export interface AtomicBlockedView {
  title: string;
  message: string;
  enableLabel: string;
  saveWithoutLabel: string;
  canConfigure: boolean;
}

export interface PassphraseChangeCopy {
  title: string;
  intro: string;
  currentLabel: string;
  newLabel: string;
  repeatLabel: string;
  newHint: string;
  removeHistoryLabel: string;
  removeHistoryDescription: string;
  historyWarning: string;
  otherDevicesWarning: string;
  versionHistoryNotice: string;
  continueLabel: string;
  confirmLabel: string;
  cancelLabel: string;
  checkAgainLabel: string;
  checkingLabel: string;
  logOutLabel: string;
  startingLabel: string;
  enableAtomicLabel: string;
  passphrasesDiffer: string;
  enterCurrentPassphrase: string;
}
export type PassphraseChangeOutcome =
  | {
      kind: "review";
      summary: string;
      carriedOver: string[];
      historyWarning: string | null;
    }
  | { kind: "changed" }
  | { kind: "failed"; message: string; clearCurrent: boolean }
  | {
      kind: "needsSetup";
      canConfigure: boolean;
      message: string;
      actionLabel: string;
    }
  | { kind: "unsettled"; message: string };

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

export interface HistoryVersionView {
  sha: string;
  time: string;
  dateTime: string;
  current: boolean;
  shared: boolean;
  events: string[];
  name: string | null;
}

export type HistoryRow =
  | { kind: "single"; version: HistoryVersionView }
  | {
      kind: "session";
      title: string;
      shared: boolean;
      versions: HistoryVersionView[];
    };

export interface HistorySection {
  title: string;
  rows: HistoryRow[];
}

export interface HistoryView {
  path: string[];
  phase: "saving" | "unsaved" | "ready";
  message: string | null;
  sections: HistorySection[];
  loading: boolean;
  error: string | null;
  end: string | null;
  canLoadMore: boolean;
}

export type DiffLineView =
  | { kind: "same"; text: string }
  | {
      kind: "added" | "removed";
      segments: { text: string; changed: boolean }[];
    };

export type DiffItemView =
  | { kind: "line"; line: DiffLineView }
  | { kind: "fold"; label: string; lines: DiffLineView[] };

export type PreviewBody =
  | { kind: "tooLarge"; message: string }
  | { kind: "unchanged"; message: string }
  | { kind: "diff"; items: DiffItemView[]; finalNewline: string | null };

export type VersionPreview =
  | { kind: "failed"; message: string }
  | { kind: "undecryptable"; message: string }
  | { kind: "closed"; message: string }
  | {
      kind: "version";
      titleChange: string | null;
      body: PreviewBody;
      restoreTitle: string | null;
      restore: { label: string; enabled: boolean; reason: string | null };
    };

export type RestoreVersionOutcome =
  | { kind: "restored" }
  | { kind: "blocked"; message: string }
  | { kind: "error"; message: string }
  | { kind: "closed" };

export interface ShareActionView {
  id:
    | "copy-link"
    | "copy-password"
    | "update"
    | "view"
    | "open"
    | "rename"
    | "revoke";
  label: string;
  disabled: boolean;
  destructive: boolean;
}

export interface ShareRowView {
  id: string;
  title: string;
  label: string | null;
  date: string;
  passwordProtected: boolean;
  link: string;
  password: string | null;
  notePath: string[] | null;
  menuLabel: string;
  actions: ShareActionView[];
}

export interface ShareCopy {
  explanation: string;
  labelField: string;
  passwordField: string;
  passwordHint: string;
  create: string;
  creating: string;
  createAnother: string;
  shareLink: string;
  sharePassword: string;
  sharedLinksTitle: string;
  sharedLinksEmpty: string;
  passwordProtected: string;
  updating: string;
  linkCopied: string;
  passwordCopied: string;
  revoke: { title: string; message: string; confirmLabel: string };
  rename: { title: string; fieldLabel: string; confirmLabel: string };
  sharedVersionTitle: string;
  loadingSharedVersion: string;
}

export type ShareCreateOutcome =
  | { kind: "created"; link: string; password: string | null }
  | { kind: "error"; parts: MessagePart[] };

export type SharedVersionOutcome =
  | { kind: "readable"; name: string | null; content: string; date: string }
  | { kind: "message"; message: string }
  | { kind: "failed"; message: string };

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
  "export.notes": {
    params: { includeImages: boolean };
    result: ExportedArchive;
  };
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
  "image.insert": {
    params: { inputs: string[] };
    result: { references: string[] };
  };
  "image.clonePasted": {
    params: { path: string[] | null; current: string; pasted: string };
    result: { text: string };
  };
  "history.open": { params: { path: string[] }; result: {} };
  "history.close": { params: {}; result: {} };
  "history.loadMore": { params: {}; result: {} };
  "history.retry": { params: {}; result: {} };
  "history.preview": {
    params: { sha: string; restoreTitle: boolean };
    result: { preview: VersionPreview };
  };
  "history.restore": {
    params: { sha: string; restoreTitle: boolean };
    result: { outcome: RestoreVersionOutcome };
  };
  "share.form": { params: { path: string[] }; result: { title: string } };
  "share.create": {
    params: { path: string[]; password: string; label: string };
    result: { outcome: ShareCreateOutcome };
  };
  "share.update": { params: { id: string }; result: {} };
  "share.rename": {
    params: { id: string; label: string };
    result: { outcome: { kind: "ok" } | { kind: "error"; message: string } };
  };
  "share.revoke": { params: { id: string }; result: {} };
  "share.sharedVersion": {
    params: { id: string };
    result: { outcome: SharedVersionOutcome };
  };
  "lastView.load": { params: {}; result: { view: LastViewState | null } };
  "lastView.save": { params: LastViewState; result: {} };
  "earlyDraft.handOff": {
    params: { name: string; body: string; nameConfirmed: boolean };
    result: { outcome: EarlyDraftOutcome };
  };
  "launch.deliver": { params: { action: LaunchAction }; result: {} };
  "launch.attach": { params: { accepts: LaunchAction[] }; result: {} };
  "launch.detach": { params: {}; result: {} };
  "settings.open": {
    params: {};
    result: { copy: SettingsCopy; view: SettingsView; save: SettingsSaveView };
  };
  "settings.change": {
    params: { key: SettingKeyView; value: string };
    result: {};
  };
  "settings.setScope": {
    params: { key: ScopedSettingKey; scope: SettingScope };
    result: {};
  };
  "settings.retry": { params: {}; result: {} };
  "settings.flush": { params: {}; result: {} };
  "device.setName": {
    params: { name: string | null };
    result: { name: string };
  };
  "lastView.setEnabled": {
    params: { enabled: boolean; view: LastViewState };
    result: {};
  };
  "analytics.visit": { params: {}; result: { url: string | null } };
  "analytics.setCounted": { params: { counted: boolean }; result: {} };
  "print.render": {
    params: { name: string; text: string };
    result: { html: string };
  };
  "import.readArchive": {
    params: { input: string; fileName: string };
    result: ImportArchiveOutcome;
  };
  "import.preview": {
    params: { destination: ImportDestinationView };
    result: { text: string | null };
  };
  "import.commit": {
    params: { destination: ImportDestinationView; policy: ImportPolicy };
    result: { outcome: ImportOutcomeView };
  };
  "import.cancel": { params: {}; result: {} };
  "import.dropFiles": {
    params: {
      files: { input: string; name: string }[];
      parent: string[] | null;
      source: "picker" | "tree";
    };
    result: { outcome: ImportOutcomeView };
  };
  "import.enableAtomic": {
    params: {};
    result: { error: string | null; outcome: ImportOutcomeView | null };
  };
  "import.saveWithoutAtomic": { params: {}; result: {} };
  "passphrase.changeForm": {
    params: {};
    result: {
      copy: PassphraseChangeCopy;
      canRemoveHistory: boolean;
      repositoryLabel: string;
    };
  };
  "passphrase.prepareChange": {
    params: { current: string; next: string; removeHistory: boolean };
    result: { outcome: PassphraseChangeOutcome };
  };
  "passphrase.commitChange": {
    params: {};
    result: { outcome: PassphraseChangeOutcome };
  };
  "passphrase.settle": {
    params: {};
    result: { outcome: PassphraseChangeOutcome };
  };
  "passphrase.cancelChange": { params: {}; result: {} };
  "passphrase.enableAtomic": { params: {}; result: { error: string | null } };
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
  "fake.processImage": {
    params: { base64: string; type: string; profile: "note" | "share" };
    result: {
      result:
        | {
            ok: true;
            type: "image/webp" | "image/gif";
            width: number;
            height: number;
            base64: string;
          }
        | { ok: false; rejection: string };
    };
  };
  "fake.importArchive": { params: {}; result: ImportArchiveOutcome };
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
  historyChanged: { history: HistoryView | null };
  sharesChanged: {
    shares: ShareRowView[];
    unreadable: string | null;
    updatingId: string | null;
    copy: ShareCopy;
  };
  settingsChanged: { view: SettingsView };
  settingsSaveChanged: { save: SettingsSaveView };
  importStatusChanged: {
    importing: boolean;
    atomicBlocked: AtomicBlockedView | null;
  };
  passphraseChangeProgress: {
    message: string;
    done: number | null;
    total: number | null;
  };
  launchAction: { action: LaunchAction };
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
  "image.insert",
  "image.clonePasted",
  "history.open",
  "history.close",
  "history.loadMore",
  "history.retry",
  "history.preview",
  "history.restore",
  "share.form",
  "share.create",
  "share.update",
  "share.rename",
  "share.revoke",
  "share.sharedVersion",
  "lastView.load",
  "lastView.save",
  "earlyDraft.handOff",
  "launch.deliver",
  "launch.attach",
  "launch.detach",
  "settings.open",
  "settings.change",
  "settings.setScope",
  "settings.retry",
  "settings.flush",
  "device.setName",
  "lastView.setEnabled",
  "analytics.visit",
  "analytics.setCounted",
  "print.render",
  "import.readArchive",
  "import.preview",
  "import.commit",
  "import.cancel",
  "import.dropFiles",
  "import.enableAtomic",
  "import.saveWithoutAtomic",
  "passphrase.changeForm",
  "passphrase.prepareChange",
  "passphrase.commitChange",
  "passphrase.settle",
  "passphrase.cancelChange",
  "passphrase.enableAtomic",
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
  "historyChanged",
  "sharesChanged",
  "settingsChanged",
  "settingsSaveChanged",
  "importStatusChanged",
  "passphraseChangeProgress",
  "launchAction",
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
  "fake.processImage",
  "fake.importArchive",
] as const satisfies readonly (keyof FakeCoreCommands)[];

export interface NativeCoreStartOptions {
  deviceModel: string;
  platform: NativePlatform;
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
