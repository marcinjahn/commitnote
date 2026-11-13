export type InputKind = "prose" | "verbatim";

export interface InputKindAttributes {
  readonly autocapitalize: "sentences" | "off";
  readonly autocorrect: "on" | "off";
  readonly spellcheck: "true" | "false";
}

const PROSE_ATTRIBUTES: InputKindAttributes = Object.freeze({
  autocapitalize: "sentences",
  autocorrect: "on",
  spellcheck: "true",
});

const VERBATIM_ATTRIBUTES: InputKindAttributes = Object.freeze({
  autocapitalize: "off",
  autocorrect: "off",
  spellcheck: "false",
});

export function inputKindAttributes(kind: InputKind): InputKindAttributes {
  return kind === "prose" ? PROSE_ATTRIBUTES : VERBATIM_ATTRIBUTES;
}
