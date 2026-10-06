import type { NotePath } from "../changes/change";
import type { ColorTag } from "../tags/color-tag";

export type SearchSourceContent =
  | { readonly kind: "local"; readonly text: string }
  | { readonly kind: "blob"; readonly blobSha: string };

export interface SearchSource {
  readonly path: NotePath;
  readonly name: string;
  readonly colorTag: ColorTag | null;
  readonly content: SearchSourceContent;
}
