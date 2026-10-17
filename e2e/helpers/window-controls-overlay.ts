import type { Page } from "@playwright/test";

export type OverlayPlatform = "windows" | "macos";

export interface TitlebarArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const WINDOWS_CONTROLS = { width: 138, height: 33 };
const MACOS_CONTROLS = { width: 78, height: 28 };

export function titlebarArea(
  platform: OverlayPlatform,
  viewportWidth: number,
): TitlebarArea {
  if (platform === "windows") {
    return {
      x: 0,
      y: 0,
      width: viewportWidth - WINDOWS_CONTROLS.width,
      height: WINDOWS_CONTROLS.height,
    };
  }
  return {
    x: MACOS_CONTROLS.width,
    y: 0,
    width: viewportWidth - MACOS_CONTROLS.width,
    height: MACOS_CONTROLS.height,
  };
}

export function controlsRects(
  platform: OverlayPlatform,
  viewportWidth: number,
): Rect[] {
  const area = titlebarArea(platform, viewportWidth);
  if (platform === "windows") {
    return [
      {
        x: area.x + area.width,
        y: 0,
        width: viewportWidth - area.width - area.x,
        height: area.height,
      },
    ];
  }
  return [{ x: 0, y: 0, width: area.x, height: area.height }];
}

interface EmulationOptions {
  platform: OverlayPlatform;
  drawControls?: boolean;
  hideTestBanner?: boolean;
}

interface InPageArguments {
  area: TitlebarArea;
  rects: Rect[];
  platform: OverlayPlatform;
  drawControls: boolean;
  hideTestBanner: boolean;
  styleId: string;
  controlsAttribute: string;
}

const STYLE_ID = "wco-emulation";
const CONTROLS_ATTRIBUTE = "data-wco-emulation-controls";

export async function emulateWindowControlsOverlay(
  page: Page,
  options: EmulationOptions,
): Promise<TitlebarArea> {
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("The page has no viewport size");
  const area = titlebarArea(options.platform, viewport.width);
  const rects = controlsRects(options.platform, viewport.width);
  await page.evaluate(
    ({
      area,
      rects,
      platform,
      drawControls,
      hideTestBanner,
      styleId,
      controlsAttribute,
    }: InPageArguments) => {
      const FEATURE = /\(\s*display-mode\s*:\s*window-controls-overlay\s*\)/;
      const px = (value: number): string => `${value}px`;

      const splitQueries = (text: string): string[] => {
        const queries: string[] = [];
        let depth = 0;
        let start = 0;
        for (let index = 0; index < text.length; index++) {
          const char = text[index];
          if (char === "(") depth++;
          else if (char === ")") depth--;
          else if (char === "," && depth === 0) {
            queries.push(text.slice(start, index));
            start = index + 1;
          }
        }
        queries.push(text.slice(start));
        return queries.map((query) => query.trim());
      };

      const remainingCondition = (mediaText: string): string | null => {
        const remaining: string[] = [];
        for (const query of splitQueries(mediaText)) {
          if (!FEATURE.test(query)) continue;
          const rest = query
            .replace(
              new RegExp(`\\s*\\band\\s*${FEATURE.source}|${FEATURE.source}\\s*and\\b\\s*|${FEATURE.source}`),
              "",
            )
            .trim();
          if (rest === "") return null;
          remaining.push(rest);
        }
        return remaining.join(", ");
      };

      const substituteEnv = (cssText: string): string =>
        cssText.replace(
          /env\(\s*titlebar-area-(x|y|width|height)\s*(?:,[^)]*)?\)/g,
          (_match, name: keyof TitlebarArea) => px(area[name]),
        );

      const wrapperHeader = (rule: CSSRule): string | null => {
        if (rule instanceof CSSMediaRule) return `@media ${rule.media.mediaText}`;
        if (rule instanceof CSSSupportsRule) {
          return `@supports ${rule.conditionText}`;
        }
        if (typeof CSSLayerBlockRule !== "undefined" && rule instanceof CSSLayerBlockRule) {
          return `@layer ${rule.name}`;
        }
        return null;
      };

      const emitted: string[] = [];
      const walk = (rules: CSSRuleList, ancestors: string[]): void => {
        for (const rule of Array.from(rules)) {
          if (
            rule instanceof CSSMediaRule &&
            FEATURE.test(rule.media.mediaText)
          ) {
            const condition = remainingCondition(rule.media.mediaText);
            const headers =
              condition === null
                ? ancestors
                : [...ancestors, `@media ${condition}`];
            const inner = Array.from(rule.cssRules)
              .map((child) => substituteEnv(child.cssText))
              .join("\n");
            emitted.push(
              headers.reduceRight((body, header) => `${header} { ${body} }`, inner),
            );
            continue;
          }
          const header = wrapperHeader(rule);
          if (header !== null) {
            walk((rule as CSSGroupingRule).cssRules, [...ancestors, header]);
          }
        }
      };

      for (const sheet of Array.from(document.styleSheets)) {
        if (sheet.ownerNode instanceof Element && sheet.ownerNode.id === styleId) {
          continue;
        }
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        walk(rules, []);
      }

      if (emitted.length === 0) {
        throw new Error("The app stylesheets contain no window-controls-overlay rules");
      }

      const css = [...emitted];
      if (hideTestBanner) css.push(".test-mode-banner{display:none!important}");

      document.getElementById(styleId)?.remove();
      document.querySelectorAll(`[${controlsAttribute}]`).forEach((node) => node.remove());
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = css.join("\n");
      document.head.append(style);

      if (!drawControls) return;
      for (const rect of rects) {
        const box = document.createElement("div");
        box.setAttribute(controlsAttribute, "");
        box.setAttribute("aria-hidden", "true");
        Object.assign(box.style, {
          position: "fixed",
          left: px(rect.x),
          top: px(rect.y),
          width: px(rect.width),
          height: px(rect.height),
          pointerEvents: "none",
          zIndex: "2147483647",
          display: "flex",
          alignItems: "center",
          font: "14px system-ui, sans-serif",
        });
        if (platform === "windows") {
          for (const glyph of ["–", "☐", "✕"]) {
            const cell = document.createElement("span");
            cell.textContent = glyph;
            Object.assign(cell.style, {
              width: "46px",
              height: px(rect.height),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "currentColor",
            });
            box.append(cell);
          }
        } else {
          for (const [index, color] of ["#ff5f57", "#febc2e", "#28c840"].entries()) {
            const dot = document.createElement("span");
            Object.assign(dot.style, {
              position: "absolute",
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: color,
              left: px(6 + index * 20),
              top: px((rect.height - 12) / 2),
            });
            box.append(dot);
          }
        }
        document.body.append(box);
      }
    },
    { area, rects, platform: options.platform, drawControls: options.drawControls ?? false, hideTestBanner: options.hideTestBanner ?? true, styleId: STYLE_ID, controlsAttribute: CONTROLS_ATTRIBUTE },
  );
  return area;
}
