import type { A11yState } from "./helpers/a11y";

export interface A11yExclusion {
  finding: string;
  rule: string;
  states: readonly A11yState[];
  target?: string;
  projects?: readonly string[];
}

export const A11Y_EXCLUSIONS: readonly A11yExclusion[] = [];
