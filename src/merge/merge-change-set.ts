import type {
  Change,
  ChangeSet,
  NotePath,
  OrderPosition,
} from "../changes/change";
import {
  isAtOrWithin,
  isWithinFolder,
  notePathEquals,
  parentPath,
} from "../changes/change";
import { utf8Encode } from "../crypto/base64";
import { MAX_NAME_BYTES } from "../format/v1";
import {
  parseTrashEntryId,
  withTrashEntryDepth,
} from "../trash/trash-entry-id";
import type { ShareIndex } from "../share/share-index";
import type { TrashEntry } from "../trash/trash-index";
import { validateName } from "../tree/note-names";
import type { FolderNode, NoteTree, TreeNode } from "../tree/note-tree";
import { findNode, listNotes } from "../tree/note-tree";
import type { ConflictHunk, TextMergeResult } from "./merge-text";
import { mergeText } from "./merge-text";
import { findRemoteRename, relocateShareEntry } from "./remote-rename";

export type MergeNotice =
  | { readonly kind: "edit-restored"; readonly path: NotePath }
  | {
      readonly kind: "delete-skipped";
      readonly path: NotePath;
      readonly target: "note" | "folder";
    }
  | {
      readonly kind: "rename-skipped";
      readonly from: NotePath;
      readonly to: NotePath;
      readonly reason: "target-exists" | "source-missing";
    }
  | {
      readonly kind: "relocated";
      readonly from: NotePath;
      readonly to: NotePath;
      readonly target: "note" | "folder";
    }
  | {
      readonly kind: "restore-skipped";
      /** Where the item was before it was trashed. */
      readonly path: NotePath;
      readonly target: "note" | "folder";
    };

export interface NoteConflict {
  readonly path: NotePath;
  readonly base: string;
  readonly mine: string;
  readonly theirs: string;
  readonly merged: string;
  readonly hunks: readonly ConflictHunk[];
}

export interface MergeChangeSetInput {
  readonly base: NoteTree;
  readonly remote: NoteTree;
  readonly changeSet: ChangeSet;
  readonly baseTrash: readonly TrashEntry[];
  readonly remoteTrash: readonly TrashEntry[];
  readonly remoteShares: ShareIndex;
  readonly readBaseContent: (path: NotePath) => Promise<string>;
  readonly readRemoteContent: (path: NotePath) => Promise<string>;
}

export interface MergeChangeSetResult {
  readonly changeSet: ChangeSet;
  readonly notices: readonly MergeNotice[];
  readonly conflicts: readonly NoteConflict[];
}

interface RemoteBlob {
  readonly path: NotePath;
  readonly blobSha: string;
}

type WorkingItem =
  | { readonly kind: "folder" }
  | { readonly kind: "note"; readonly remote?: RemoteBlob };

type MergeMode =
  | { readonly kind: "unset" }
  | { readonly kind: "direct" }
  | { readonly kind: "merge"; readonly base: string; readonly theirs: string };

interface NoteState {
  readonly origin: NotePath | null;
  mode: MergeMode;
  conflict?: NoteConflict;
}

interface TrashItem {
  /** Relative to the trashed item. */
  readonly path: NotePath;
  readonly kind: "note" | "folder";
}

/** `null` items: undecryptable, so it can only be purged. */
type TrashItems = Map<string, TrashItem> | null;

/** A local trash that was not applied because the item changed remotely. */
interface SkippedTrash {
  readonly path: NotePath;
  /** Local note states of the item, keyed by path relative to it. */
  states: [NotePath, NoteState][];
}

interface Redirect {
  readonly from: NotePath;
  readonly to: NotePath;
}

function keyOf(path: NotePath): string {
  return JSON.stringify(path);
}

function rebase(path: NotePath, from: NotePath, to: NotePath): NotePath {
  return [...to, ...path.slice(from.length)];
}

class WorkingTree {
  private readonly items = new Map<
    string,
    { path: NotePath; item: WorkingItem }
  >();

  constructor(remote: NoteTree) {
    const walk = (folder: FolderNode): void => {
      for (const child of folder.children) {
        if (child.kind === "folder") {
          this.set(child.path, { kind: "folder" });
          walk(child);
        } else {
          this.set(child.path, {
            kind: "note",
            remote: { path: child.path, blobSha: child.blobSha },
          });
        }
      }
    };
    walk(remote.root);
  }

  get(path: NotePath): WorkingItem | undefined {
    if (path.length === 0) return { kind: "folder" };
    return this.items.get(keyOf(path))?.item;
  }

  set(path: NotePath, item: WorkingItem): void {
    this.items.set(keyOf(path), { path, item });
  }

  isFolder(path: NotePath): boolean {
    return this.get(path)?.kind === "folder";
  }

  within(folder: NotePath): { path: NotePath; item: WorkingItem }[] {
    return [...this.items.values()].filter((entry) =>
      isWithinFolder(entry.path, folder),
    );
  }

  childNames(folder: NotePath): string[] {
    return this.within(folder)
      .filter((entry) => entry.path.length === folder.length + 1)
      .map((entry) => entry.path[entry.path.length - 1]);
  }

  delete(path: NotePath): void {
    for (const entry of this.within(path)) {
      this.items.delete(keyOf(entry.path));
    }
    this.items.delete(keyOf(path));
  }

  move(from: NotePath, to: NotePath): void {
    const moved = [
      { path: from, item: this.get(from) },
      ...this.within(from),
    ].filter(
      (entry): entry is { path: NotePath; item: WorkingItem } =>
        entry.item !== undefined,
    );
    this.delete(from);
    for (const entry of moved) {
      this.set(rebase(entry.path, from, to), entry.item);
    }
  }
}

function trashItemsOf(tree: TreeNode, root: NotePath): Map<string, TrashItem> {
  const items = new Map<string, TrashItem>();
  const walk = (node: TreeNode): void => {
    const path = node.path.slice(root.length);
    items.set(keyOf(path), { path, kind: node.kind });
    if (node.kind === "folder") node.children.forEach(walk);
  };
  walk(tree);
  return items;
}

function conflictName(name: string, attempt: number): string {
  const suffix = attempt === 1 ? " (conflict)" : ` (conflict ${attempt})`;
  const codePoints = Array.from(name);
  let candidate = name + suffix;
  while (
    utf8Encode(candidate).length > MAX_NAME_BYTES &&
    codePoints.length > 0
  ) {
    codePoints.pop();
    candidate = codePoints.join("") + suffix;
  }
  return candidate;
}

class ChangeSetMerger {
  private readonly working: WorkingTree;
  private readonly notes = new Map<string, NoteState>();
  private readonly redirects = new Map<string, Redirect>();
  private readonly output: Change[] = [];
  private readonly notices: MergeNotice[] = [];
  private readonly conflictStates: NoteState[] = [];
  private readonly trash = new Map<string, TrashItems>();
  private readonly skippedTrash = new Map<string, SkippedTrash>();
  private readonly trashOrigins = new Map<string, NotePath>();
  private readonly emittedEntryIds = new Map<string, string>();

  constructor(private readonly input: MergeChangeSetInput) {
    this.working = new WorkingTree(input.remote);
    for (const note of listNotes(input.base)) {
      this.notes.set(keyOf(note.path), {
        origin: note.path,
        mode: { kind: "unset" },
      });
    }
    for (const entry of input.remoteTrash) {
      this.trash.set(
        entry.id,
        entry.undecryptable ? null : trashItemsOf(entry.tree, entry.originalPath),
      );
    }
    for (const entry of [...input.remoteTrash, ...input.baseTrash]) {
      if (!entry.undecryptable && !this.trashOrigins.has(entry.id)) {
        this.trashOrigins.set(entry.id, entry.originalPath);
      }
    }
  }

  async run(): Promise<MergeChangeSetResult> {
    for (const change of this.input.changeSet) {
      await this.apply(change);
    }
    return {
      changeSet: this.output,
      notices: this.notices,
      conflicts: this.conflictStates.map((state) => state.conflict!),
    };
  }

  private async apply(change: Change): Promise<void> {
    switch (change.kind) {
      case "update-note":
        return this.updateNote(change.path, change.content);
      case "create-note":
        return this.createNote(change.path, change.content);
      case "delete-note":
        return this.deleteNote(change.path);
      case "create-folder":
        return this.createFolder(change.path);
      case "delete-folder":
        return this.deleteFolder(change.path);
      case "rename-note":
      case "rename-folder":
        return this.rename(change.kind, change.from, change.to);
      case "trash-note":
        return this.trashNote(change.path, change.entryId);
      case "trash-folder":
        return this.trashFolder(change.path, change.entryId);
      case "restore-trash":
        return this.restoreTrash(change);
      case "purge-trash":
        return this.purgeTrash(change.entryIds);
      case "set-order":
        return this.setOrder(change);
      case "set-settings":
      case "remove-share":
        return this.emit(change);
      case "add-share":
        return this.addShare(change);
      case "update-share":
        if (!this.input.remoteShares.entries.has(change.entry.id)) return;
        return this.addShare(change, true);
      case "set-color-tag":
        return this.setColorTag(change);
      default:
        change satisfies never;
    }
  }

  private resolve(path: NotePath): NotePath {
    let current = path;
    const used = new Set<string>();
    for (;;) {
      let applied = false;
      for (let length = current.length; length > 0; length--) {
        const key = keyOf(current.slice(0, length));
        const redirect = this.redirects.get(key);
        if (redirect !== undefined && !used.has(key)) {
          used.add(key);
          current = rebase(current, redirect.from, redirect.to);
          applied = true;
          break;
        }
      }
      if (!applied) return current;
    }
  }

  private addRedirect(from: NotePath, to: NotePath): void {
    if (notePathEquals(from, to)) {
      this.redirects.delete(keyOf(from));
    } else {
      this.redirects.set(keyOf(from), { from, to });
    }
  }

  private dropRedirects(localPath: NotePath): void {
    for (const [key, redirect] of [...this.redirects]) {
      if (isAtOrWithin(redirect.from, localPath)) this.redirects.delete(key);
    }
  }

  private emit(change: Change): void {
    this.output.push(change);
  }

  private isUnchangedRemotely(remote: RemoteBlob): boolean {
    const baseNode = findNode(this.input.base, remote.path);
    return baseNode?.kind === "note" && baseNode.blobSha === remote.blobSha;
  }

  private relocate(path: NotePath): NotePath {
    const parent = parentPath(path);
    const name = path[path.length - 1];
    const siblings = this.working.childNames(parent);
    for (let attempt = 1; ; attempt++) {
      const candidate = conflictName(name, attempt);
      const validation = validateName(candidate, siblings);
      if (validation.ok && validation.name === candidate) {
        return [...parent, candidate];
      }
    }
  }

  private ensureParents(path: NotePath): NotePath {
    let current = path;
    for (let length = 1; length < current.length; length++) {
      const prefix = current.slice(0, length);
      const item = this.working.get(prefix);
      if (item?.kind === "folder") continue;
      if (item === undefined) {
        this.emit({ kind: "create-folder", path: prefix });
        this.working.set(prefix, { kind: "folder" });
        continue;
      }
      const relocated = this.relocate(prefix);
      this.emit({ kind: "create-folder", path: relocated });
      this.working.set(relocated, { kind: "folder" });
      this.notices.push({
        kind: "relocated",
        from: prefix,
        to: relocated,
        target: "folder",
      });
      this.addRedirect(prefix, relocated);
      current = rebase(current, prefix, relocated);
    }
    return current;
  }

  private heldStateAt(path: NotePath): NoteState | undefined {
    return this.conflictStates.find((state) =>
      notePathEquals(state.conflict!.path, path),
    );
  }

  private applyMerge(
    state: NoteState & { mode: { kind: "merge" } },
    path: NotePath,
    mine: string,
    result: TextMergeResult,
  ): void {
    if (result.kind === "clean") {
      if (state.conflict !== undefined) {
        this.conflictStates.splice(this.conflictStates.indexOf(state), 1);
        state.conflict = undefined;
      }
      this.emit({ kind: "update-note", path, content: result.text });
      return;
    }
    const conflict: NoteConflict = {
      path,
      base: state.mode.base,
      mine,
      theirs: state.mode.theirs,
      merged: result.text,
      hunks: result.hunks,
    };
    if (state.conflict === undefined) this.conflictStates.push(state);
    state.conflict = conflict;
  }

  private restore(localPath: NotePath, path: NotePath, mine: string): void {
    const item = this.working.get(path);
    if (item?.kind === "folder") {
      const relocated = this.relocate(path);
      this.emit({ kind: "create-note", path: relocated, content: mine });
      this.working.set(relocated, { kind: "note" });
      this.addRedirect(localPath, relocated);
      this.notices.push({
        kind: "relocated",
        from: path,
        to: relocated,
        target: "note",
      });
      return;
    }
    const target = this.ensureParents(path);
    this.emit({ kind: "create-note", path: target, content: mine });
    this.working.set(target, { kind: "note" });
    this.notices.push({ kind: "edit-restored", path: target });
  }

  private async writeContent(
    localPath: NotePath,
    state: NoteState,
    mine: string,
  ): Promise<void> {
    const path = this.resolve(localPath);
    const item = this.working.get(path);

    if (item?.kind !== "note") {
      state.mode = { kind: "direct" };
      this.restore(localPath, path, mine);
      return;
    }

    if (state.mode.kind === "unset") {
      if (item.remote === undefined) {
        state.mode = { kind: "direct" };
      } else if (
        state.origin !== null &&
        notePathEquals(state.origin, item.remote.path) &&
        this.isUnchangedRemotely(item.remote)
      ) {
        state.mode = { kind: "direct" };
      } else {
        const base =
          state.origin === null
            ? ""
            : await this.input.readBaseContent(state.origin);
        const theirs = await this.input.readRemoteContent(item.remote.path);
        state.mode = { kind: "merge", base, theirs };
      }
    }

    const mode = state.mode;
    if (mode.kind === "merge") {
      this.applyMerge(
        state as NoteState & { mode: typeof mode },
        path,
        mine,
        mergeText(mode.base, mine, mode.theirs),
      );
      return;
    }
    this.emit({ kind: "update-note", path, content: mine });
  }

  private async updateNote(localPath: NotePath, mine: string): Promise<void> {
    let state = this.notes.get(keyOf(localPath));
    if (state === undefined) {
      state = { origin: null, mode: { kind: "unset" } };
      this.notes.set(keyOf(localPath), state);
    }
    await this.writeContent(localPath, state, mine);
  }

  private async createNote(
    localPath: NotePath,
    content: string,
  ): Promise<void> {
    const path = this.resolve(localPath);
    const held = this.heldStateAt(path);
    if (held !== undefined) {
      this.notes.set(keyOf(localPath), held);
      await this.writeContent(localPath, held, content);
      return;
    }

    const state: NoteState = { origin: null, mode: { kind: "unset" } };
    this.notes.set(keyOf(localPath), state);
    const item = this.working.get(path);
    if (item === undefined) {
      state.mode = { kind: "direct" };
      const target = this.ensureParents(path);
      this.emit({ kind: "create-note", path: target, content });
      this.working.set(target, { kind: "note" });
      return;
    }
    await this.writeContent(localPath, state, content);
  }

  private deleteNote(localPath: NotePath): void {
    const state = this.notes.get(keyOf(localPath));
    this.notes.delete(keyOf(localPath));
    const path = this.resolve(localPath);
    if (state?.conflict !== undefined) return;
    this.dropRedirects(localPath);

    const item = this.working.get(path);
    if (item?.kind !== "note") return;
    if (item.remote !== undefined && !this.isUnchangedRemotely(item.remote)) {
      this.notices.push({ kind: "delete-skipped", path, target: "note" });
      return;
    }
    this.emit({ kind: "delete-note", path });
    this.working.delete(path);
  }

  private createFolder(localPath: NotePath): void {
    const path = this.resolve(localPath);
    const item = this.working.get(path);
    if (item?.kind === "folder") return;
    if (item?.kind === "note") {
      const relocated = this.relocate(path);
      this.emit({ kind: "create-folder", path: relocated });
      this.working.set(relocated, { kind: "folder" });
      this.addRedirect(localPath, relocated);
      this.notices.push({
        kind: "relocated",
        from: path,
        to: relocated,
        target: "folder",
      });
      return;
    }
    if (!this.working.isFolder(parentPath(path))) return;
    this.emit({ kind: "create-folder", path });
    this.working.set(path, { kind: "folder" });
  }

  private takeLocalNotesWithin(localPath: NotePath): [string, NoteState][] {
    const taken: [string, NoteState][] = [];
    for (const [key, state] of this.notes) {
      if (isWithinFolder(JSON.parse(key) as string[], localPath)) {
        taken.push([key, state]);
      }
    }
    for (const [key] of taken) this.notes.delete(key);
    return taken;
  }

  private deleteFolder(localPath: NotePath): void {
    const removed = this.takeLocalNotesWithin(localPath);
    const path = this.resolve(localPath);
    if (removed.some(([, state]) => state.conflict !== undefined)) return;
    this.dropRedirects(localPath);

    if (!this.working.isFolder(path) || path.length === 0) return;
    if (this.hasRemoteChangesWithin(path)) {
      this.notices.push({ kind: "delete-skipped", path, target: "folder" });
      return;
    }
    this.emit({ kind: "delete-folder", path });
    this.working.delete(path);
  }

  private hasRemoteChangesWithin(path: NotePath): boolean {
    return this.working
      .within(path)
      .some(
        ({ item }) =>
          item.kind === "note" &&
          item.remote !== undefined &&
          !this.isUnchangedRemotely(item.remote),
      );
  }

  private trashNote(localPath: NotePath, entryId: string): void {
    const state = this.notes.get(keyOf(localPath));
    this.notes.delete(keyOf(localPath));
    const path = this.resolve(localPath);
    this.trashOrigins.set(entryId, localPath);
    const skip = (): void => {
      this.skippedTrash.set(entryId, {
        path,
        states: state === undefined ? [] : [[[], state]],
      });
    };
    if (state?.conflict !== undefined) return skip();
    this.dropRedirects(localPath);

    const item = this.working.get(path);
    if (item?.kind !== "note") return;
    if (item.remote !== undefined && !this.isUnchangedRemotely(item.remote)) {
      this.notices.push({ kind: "delete-skipped", path, target: "note" });
      return skip();
    }
    this.emitTrash("note", path, entryId);
  }

  private trashFolder(localPath: NotePath, entryId: string): void {
    const removed = this.takeLocalNotesWithin(localPath);
    const path = this.resolve(localPath);
    this.trashOrigins.set(entryId, localPath);
    const skip = (): void => {
      this.skippedTrash.set(entryId, {
        path,
        states: removed.map(([key, state]) => [
          (JSON.parse(key) as string[]).slice(localPath.length),
          state,
        ]),
      });
    };
    if (removed.some(([, state]) => state.conflict !== undefined)) {
      return skip();
    }
    this.dropRedirects(localPath);

    if (!this.working.isFolder(path) || path.length === 0) return;
    if (this.hasRemoteChangesWithin(path)) {
      this.notices.push({ kind: "delete-skipped", path, target: "folder" });
      return skip();
    }
    this.emitTrash("folder", path, entryId);
  }

  // The entry id encodes the item's depth, which differs from the local one
  // when the item's working path was redirected.
  private emitTrash(
    target: "note" | "folder",
    path: NotePath,
    entryId: string,
  ): void {
    const emittedId =
      parseTrashEntryId(entryId)?.depth === path.length
        ? entryId
        : withTrashEntryDepth(entryId, path.length);
    const items = new Map<string, TrashItem>([
      [keyOf([]), { path: [], kind: target }],
    ]);
    for (const entry of this.working.within(path)) {
      const relative = entry.path.slice(path.length);
      items.set(keyOf(relative), { path: relative, kind: entry.item.kind });
    }
    this.trash.set(entryId, items);
    this.emittedEntryIds.set(entryId, emittedId);
    this.emit(
      target === "note"
        ? { kind: "trash-note", path, entryId: emittedId }
        : { kind: "trash-folder", path, entryId: emittedId },
    );
    this.working.delete(path);
  }

  private skipRestore(
    entryId: string,
    subPath: NotePath,
    target: "note" | "folder",
    to: NotePath,
  ): void {
    const origin = this.trashOrigins.get(entryId);
    this.notices.push({
      kind: "restore-skipped",
      path: origin === undefined ? to : [...origin, ...subPath],
      target,
    });
  }

  private restoreTrash(
    change: Extract<Change, { kind: "restore-trash" }>,
  ): void {
    const { entryId, subPath, target } = change;
    const skipped = this.skippedTrash.get(entryId);
    if (skipped !== undefined) {
      this.restoreSkippedTrash(change, skipped);
      return;
    }

    const items = this.trash.get(entryId);
    if (
      items === undefined ||
      items === null ||
      items.get(keyOf(subPath))?.kind !== target ||
      change.to.length === 0
    ) {
      this.skipRestore(entryId, subPath, target, change.to);
      return;
    }

    let path = this.ensureParents(this.resolve(change.to));
    if (this.working.get(path) !== undefined) {
      const relocated = this.relocate(path);
      this.notices.push({ kind: "relocated", from: path, to: relocated, target });
      this.addRedirect(change.to, relocated);
      path = relocated;
    }
    this.emit({
      kind: "restore-trash",
      entryId: this.emittedEntryIds.get(entryId) ?? entryId,
      subPath,
      target,
      to: path,
    });
    for (const [key, item] of [...items]) {
      if (!isAtOrWithin(item.path, subPath)) continue;
      items.delete(key);
      this.working.set(
        rebase(item.path, subPath, path),
        item.kind === "note" ? { kind: "note" } : { kind: "folder" },
      );
    }
    if (subPath.length === 0) this.trash.delete(entryId);
  }

  // The item stayed in place, so the restored local path points back at it.
  private restoreSkippedTrash(
    change: Extract<Change, { kind: "restore-trash" }>,
    skipped: SkippedTrash,
  ): void {
    const { entryId, subPath, target, to } = change;
    const source = [...skipped.path, ...subPath];
    if (this.working.get(source)?.kind !== target || to.length === 0) {
      this.skipRestore(entryId, subPath, target, to);
      return;
    }
    const remaining: [NotePath, NoteState][] = [];
    for (const [relative, state] of skipped.states) {
      if (isAtOrWithin(relative, subPath)) {
        this.notes.set(keyOf(rebase(relative, subPath, to)), state);
      } else {
        remaining.push([relative, state]);
      }
    }
    skipped.states = remaining;
    this.addRedirect(to, source);
    if (subPath.length === 0) this.skippedTrash.delete(entryId);
  }

  private purgeTrash(entryIds: readonly string[]): void {
    const purged: string[] = [];
    for (const entryId of entryIds) {
      this.skippedTrash.delete(entryId);
      if (!this.trash.has(entryId)) continue;
      this.trash.delete(entryId);
      purged.push(this.emittedEntryIds.get(entryId) ?? entryId);
    }
    if (purged.length > 0) this.emit({ kind: "purge-trash", entryIds: purged });
  }

  private setColorTag(
    change: Extract<Change, { kind: "set-color-tag" }>,
  ): void {
    const path = this.resolve(change.path);
    if (this.working.get(path)?.kind === "note") {
      this.emit({ ...change, path });
      return;
    }
    const renamed = findRemoteRename(this.input.base, this.input.remote, path);
    if (renamed !== null && this.working.get(renamed)?.kind === "note") {
      this.emit({ ...change, path: renamed });
    }
  }

  private addShare(
    change: Extract<Change, { kind: "add-share" | "update-share" }>,
    requireActive = false,
  ): void {
    const isNote = (path: NotePath) => this.working.get(path)?.kind === "note";
    const entry = relocateShareEntry(
      change.entry,
      (localPath) => {
        const path = this.resolve(localPath);
        if (isNote(path)) return path;
        const renamed = findRemoteRename(
          this.input.base,
          this.input.remote,
          path,
        );
        return renamed !== null && isNote(renamed) ? renamed : null;
      },
      this.input.remoteTrash,
    );
    if (requireActive && entry.note.state !== "active") return;
    this.emit({ ...change, entry });
  }

  // Positions follow their items through redirects; positions of items that
  // are gone or now elsewhere are dropped.
  private setOrder(change: Extract<Change, { kind: "set-order" }>): void {
    const parent = this.resolve(change.parent);
    if (!this.working.isFolder(parent)) return;
    const positions: OrderPosition[] = [];
    let moved: string | undefined;
    for (const { name, key } of change.positions) {
      const path = this.resolve([...change.parent, name]);
      if (
        path.length !== parent.length + 1 ||
        !isWithinFolder(path, parent) ||
        this.working.get(path) === undefined
      ) {
        continue;
      }
      positions.push({ name: path[path.length - 1], key });
      if (name === change.moved) moved = path[path.length - 1];
    }
    if (positions.length > 0) {
      this.emit({
        kind: "set-order",
        parent,
        positions,
        ...(moved === undefined ? {} : { moved }),
      });
    }
  }

  private moveLocalState(
    kind: "rename-note" | "rename-folder",
    from: NotePath,
    to: NotePath,
  ): NoteState[] {
    const moved: [NotePath, NoteState][] = [];
    if (kind === "rename-note") {
      const state = this.notes.get(keyOf(from));
      if (state !== undefined) {
        this.notes.delete(keyOf(from));
        moved.push([to, state]);
      }
    } else {
      for (const [key, state] of this.takeLocalNotesWithin(from)) {
        moved.push([rebase(JSON.parse(key) as string[], from, to), state]);
      }
    }
    for (const [path, state] of moved) this.notes.set(keyOf(path), state);
    return moved.map(([, state]) => state);
  }

  private rekeyRedirects(
    from: NotePath,
    to: NotePath,
    workingFrom?: NotePath,
    workingTo?: NotePath,
  ): void {
    const entries = [...this.redirects.values()];
    this.redirects.clear();
    for (const redirect of entries) {
      let key = redirect.from;
      let value = redirect.to;
      if (isAtOrWithin(key, from)) {
        key = rebase(key, from, to);
      } else if (
        workingFrom !== undefined &&
        workingTo !== undefined &&
        isWithinFolder(key, workingFrom)
      ) {
        key = rebase(key, workingFrom, workingTo);
      }
      if (
        workingFrom !== undefined &&
        workingTo !== undefined &&
        isAtOrWithin(value, workingFrom)
      ) {
        value = rebase(value, workingFrom, workingTo);
      }
      this.addRedirect(key, value);
    }
  }

  private skipRename(
    from: NotePath,
    to: NotePath,
    workingFrom: NotePath,
    reason: "target-exists" | "source-missing",
  ): void {
    this.notices.push({ kind: "rename-skipped", from, to, reason });
    this.holdRename(from, to, workingFrom);
  }

  private holdRename(from: NotePath, to: NotePath, workingFrom: NotePath) {
    this.rekeyRedirects(from, to);
    this.addRedirect(to, workingFrom);
  }

  private rename(
    kind: "rename-note" | "rename-folder",
    from: NotePath,
    to: NotePath,
  ): void {
    const workingFrom = this.resolve(from);
    const workingTo = this.resolve(to);
    const states = this.moveLocalState(kind, from, to);

    if (states.some((state) => state.conflict !== undefined)) {
      this.holdRename(from, to, workingFrom);
      return;
    }

    const source = this.working.get(workingFrom);
    const expected = kind === "rename-note" ? "note" : "folder";
    if (source?.kind !== expected || workingFrom.length === 0) {
      this.skipRename(from, to, workingFrom, "source-missing");
      return;
    }
    if (notePathEquals(workingFrom, workingTo)) {
      this.holdRename(from, to, workingFrom);
      return;
    }
    if (
      this.working.get(workingTo) !== undefined ||
      isWithinFolder(workingTo, workingFrom)
    ) {
      this.skipRename(from, to, workingFrom, "target-exists");
      return;
    }

    const target = this.ensureParents(workingTo);
    this.emit(
      kind === "rename-note"
        ? { kind: "rename-note", from: workingFrom, to: target }
        : { kind: "rename-folder", from: workingFrom, to: target },
    );
    this.working.move(workingFrom, target);
    this.rekeyRedirects(from, to, workingFrom, target);
    this.addRedirect(to, target);
  }
}

export function mergeChangeSet(
  input: MergeChangeSetInput,
): Promise<MergeChangeSetResult> {
  return new ChangeSetMerger(input).run();
}
