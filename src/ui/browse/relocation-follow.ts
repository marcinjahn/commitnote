import { notePathEquals, type NotePath } from "../../changes/change";

export function ancestorFolders(path: NotePath): NotePath[] {
  return path.slice(0, -1).map((_, index) => path.slice(0, index + 1));
}

export function shouldFollowFocus(input: {
  recordedFocus: NotePath | null;
  from: NotePath;
  focusLost: boolean;
}): boolean {
  return (
    input.recordedFocus !== null && notePathEquals(input.recordedFocus, input.from) && input.focusLost
  );
}
