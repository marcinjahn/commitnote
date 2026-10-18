import { getContext, setContext } from "svelte";

const SCREEN_SCOPE = Symbol("screen-scope");

export function setScreenScope(isCurrent: () => boolean): void {
  setContext(SCREEN_SCOPE, isCurrent);
}

export function getScreenScope(): (() => boolean) | null {
  return getContext<(() => boolean) | undefined>(SCREEN_SCOPE) ?? null;
}
