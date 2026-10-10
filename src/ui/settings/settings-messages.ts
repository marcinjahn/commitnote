export function describeSystemAccent(input: {
  label: string;
  fromOs: boolean;
  standalone: boolean;
}): string {
  if (input.fromOs) {
    return `${input.label}, closest to your OS accent color`;
  }
  return input.standalone
    ? `${input.label}, because the OS accent color isn't available here`
    : `${input.label}, because the browser doesn't share your OS accent color`;
}

export function animatedCaretHint(standalone: boolean): string {
  const caret = standalone ? "the standard caret" : "the browser’s standard caret";
  return `A thicker accent caret that blinks softly and tints the letters just before it. Turn it off for ${caret}.`;
}
