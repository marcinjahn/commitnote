import type { CommandLineKind } from "../../editor/vim/vim-status";

export interface VimBarCommands {
  escape(): void;
  enterInsert(): void;
  openCommandLine(kind: CommandLineKind): void;
  keyDown(event: KeyboardEvent, value: string): void;
  keyUp(event: KeyboardEvent, value: string): void;
  input(event: Event, value: string): void;
  close(): void;
}
