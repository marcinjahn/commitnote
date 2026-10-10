import { getContext, setContext } from "svelte";

const STANDALONE = Symbol("standalone");

export function setStandalone(standalone: boolean): void {
  setContext(STANDALONE, standalone);
}

export function getStandalone(): boolean {
  return getContext<boolean | undefined>(STANDALONE) ?? false;
}
