export interface CssRule {
  prelude: string;
  body: string;
}

export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

export function topLevelRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  let depth = 0;
  let preludeStart = 0;
  let bodyStart = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        rules.push({
          prelude: css.slice(preludeStart, bodyStart - 1).trim(),
          body: css.slice(bodyStart, i),
        });
        preludeStart = i + 1;
      }
    }
  }
  return rules;
}

export function declarations(body: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
    result.set(match[1], normalize(match[2]));
  }
  return result;
}

export function normalize(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}
