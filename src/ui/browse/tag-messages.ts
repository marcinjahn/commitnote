import { colorTagOption, type ColorTag } from "../../tags/color-tag";

export function describeColorTag(tag: ColorTag): string {
  return `${colorTagOption(tag).label} tag`;
}
