import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  chromium,
  devices,
  type CDPSession,
  type Page,
} from "@playwright/test";
import { preview } from "vite";
import { openNotes } from "../e2e/helpers";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "dist-fake");
const REPO = "https://github.com/sample/large-tree";
const DEFAULT_PORT = 4177;
const FLING_SPEED = 5000;
const TOUCH_INTERVAL_MS = 16;
const SWIPE_SHARE = 0.7;
const FLING_COAST_MS = 500;
const MAX_SWIPES = 200;
const CPU_THROTTLING = 4;
const LONG_TASK_MS = 50;
const ROW_ACTIONS_WIDTH = 40;
const ICON_MAX_WIDTH = 20;
const SEGMENT_GAP = 6;
const START_MARK = "tree-scroll-profile:start";
const END_MARK = "tree-scroll-profile:end";
const TREE_ROWS = ".tree-container [data-tree-row]";
const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-devtools.screenshot",
  "latencyInfo",
  "input",
  "cc",
  "viz",
  "gpu",
  "benchmark",
  "blink.user_timing",
];

interface TraceEvent {
  readonly name: string;
  readonly cat: string;
  readonly ph: string;
  readonly ts: number;
  readonly dur?: number;
  readonly pid: number;
  readonly tid: number;
  readonly id?: string;
  readonly id2?: { readonly local?: string; readonly global?: string };
  readonly args?: Record<string, unknown>;
}

interface EventListenerEntry {
  readonly type: string;
  readonly useCapture: boolean;
  readonly handler?: {
    readonly objectId?: string;
    readonly description?: string;
  };
}

interface Slice {
  readonly name: string;
  readonly pid: number;
  readonly tid: number;
  readonly ts: number;
  readonly dur: number;
  readonly args?: Record<string, unknown>;
}

interface TraceMetrics {
  readonly flingMs: number;
  readonly framesPresented: number;
  readonly framesPartial: number;
  readonly framesDropped: number;
  readonly droppedPercent: number;
  readonly framesCheckerboardedNeedsRecord: number;
  readonly framesCheckerboardedNeedsRaster: number;
  readonly framesMissingContent: number;
  readonly framesScrollMainThread: number;
  readonly framesScrollCompositor: number;
  readonly longTaskCount: number;
  readonly longTaskMaxMs: number;
  readonly mainThreadBusyMs: number;
  readonly touchMoveLatencyP50Ms: number;
  readonly touchMoveLatencyP95Ms: number;
  readonly scrollUpdateLatencyP50Ms: number;
  readonly scrollUpdateLatencyP95Ms: number;
  readonly scrollUpdates: number;
  readonly inertialScrollUpdates: number;
  readonly firstScrollUpdateLatencyP50Ms: number;
  readonly firstScrollUpdateLatencyMaxMs: number;
  readonly touchBlockingDispatches: number;
  readonly touchNonBlockingDispatches: number;
  readonly touchDispatchCount: number;
  readonly touchDispatchMs: number;
  readonly scriptMs: number;
  readonly styleLayoutMs: number;
  readonly prePaintMs: number;
  readonly paintMs: number;
  readonly layerizeMs: number;
  readonly commitMs: number;
  readonly rasterMs: number;
  readonly gpuProcessMs: number;
}

interface RunMetrics extends TraceMetrics {
  readonly screenshots: number;
  readonly blankNameFrames: number;
  readonly missingIconFrames: number;
  readonly minRowsInFrame: number;
}

interface Listener {
  readonly target: string;
  readonly type: string;
  readonly passive: boolean;
  readonly useCapture: boolean;
  readonly once: boolean;
  readonly handler: string;
}

interface FrameAnalysis {
  readonly file: string;
  readonly rows: number;
  readonly blankNameRows: number;
  readonly missingIconRows: number;
}

interface Region {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly viewportWidth: number;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readArgs(): { out: string; runs: number } {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      runs: { type: "string", default: "3" },
    },
  });
  if (values.out === undefined) {
    fail("Usage: npm run profile:tree-scroll -- --out <dir> [--runs <n>]");
  }
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1) {
    fail(`--runs must be a positive integer, got ${values.runs}`);
  }
  return { out: resolve(values.out), runs };
}

function readPort(): number {
  const port = Number(process.env.PROFILE_PORT ?? DEFAULT_PORT);
  if (
    !Number.isInteger(port) ||
    port < 4174 ||
    port > 4199 ||
    port === 4180 ||
    port === 4190
  ) {
    fail(
      `PROFILE_PORT must be in 4174-4199 and not 4180 or 4190, got ${process.env.PROFILE_PORT}`,
    );
  }
  return port;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ];
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function nested(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, Math.max(0, ms)));
}

async function expandAll(page: Page): Promise<number> {
  for (;;) {
    const before = await page.locator(TREE_ROWS).count();
    const clicked = await page.evaluate(() => {
      const collapsed = document.querySelectorAll<HTMLElement>(
        '.tree-container [role="treeitem"][aria-expanded="false"]',
      );
      collapsed.forEach((row) => row.click());
      return collapsed.length;
    });
    if (clicked === 0) break;
    await page.waitForFunction(
      ({ selector, before }) =>
        document.querySelectorAll(selector).length > before,
      { selector: TREE_ROWS, before },
    );
  }
  let previous = -1;
  let count = await page.locator(TREE_ROWS).count();
  while (count !== previous) {
    previous = count;
    await page.waitForTimeout(500);
    count = await page.locator(TREE_ROWS).count();
  }
  return count;
}

async function scrollState(
  page: Page,
): Promise<{ top: number; max: number; height: number }> {
  return page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".tree-container");
    if (container === null) throw new Error("No .tree-container");
    return {
      top: container.scrollTop,
      max: container.scrollHeight - container.clientHeight,
      height: container.clientHeight,
    };
  });
}

async function settle(page: Page): Promise<void> {
  let previous = -1;
  let top = (await scrollState(page)).top;
  while (top !== previous) {
    previous = top;
    await page.waitForTimeout(250);
    top = (await scrollState(page)).top;
  }
}

async function swipe(
  cdp: CDPSession,
  x: number,
  fromY: number,
  toY: number,
): Promise<void> {
  const step = (FLING_SPEED * TOUCH_INTERVAL_MS) / 1000;
  const steps = Math.max(1, Math.round(Math.abs(toY - fromY) / step));
  const start = Date.now();
  const at = (i: number) => ({
    x,
    y: Math.round(fromY + ((toY - fromY) * i) / steps),
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [at(0)],
    timestamp: start / 1000,
  });
  for (let i = 1; i <= steps; i++) {
    const due = start + i * TOUCH_INTERVAL_MS;
    await delay(due - Date.now());
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [at(i)],
      timestamp: due / 1000,
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
    timestamp: (start + steps * TOUCH_INTERVAL_MS) / 1000,
  });
}

async function fling(
  cdp: CDPSession,
  page: Page,
  region: Region,
  direction: "down" | "up",
): Promise<number> {
  const x = Math.round((region.left + region.right) / 2);
  const centre = (region.top + region.bottom) / 2;
  const half = ((region.bottom - region.top) * SWIPE_SHARE) / 2;
  const [fromY, toY] =
    direction === "down"
      ? [centre + half, centre - half]
      : [centre - half, centre + half];
  let swipes = 0;
  for (;;) {
    const state = await scrollState(page);
    const done =
      direction === "down" ? state.top >= state.max - 1 : state.top <= 0;
    if (done) return swipes;
    if (swipes >= MAX_SWIPES) {
      throw new Error(
        `Fling ${direction} stalled at scrollTop ${state.top} of ${state.max}`,
      );
    }
    await swipe(cdp, x, fromY, toY);
    await delay(FLING_COAST_MS);
    swipes++;
  }
}

async function describeTarget(
  cdp: CDPSession,
  objectId: string,
): Promise<string> {
  const label = await cdp.send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: `function () {
      if (this === window) return "window";
      if (this === document) return "document";
      return this.tagName.toLowerCase() + (this.id ? "#" + this.id : "") +
        [...this.classList].filter((c) => !c.startsWith("svelte-")).map((c) => "." + c).join("");
    }`,
    returnByValue: true,
  });
  return String(label.result.value);
}

async function windowListeners(cdp: CDPSession): Promise<EventListenerEntry[]> {
  const window = await cdp.send("Runtime.evaluate", {
    objectGroup: "tree-scroll-profile",
    expression: "window",
  });
  const objectId = window.result.objectId;
  if (objectId === undefined) throw new Error("Could not resolve window");
  const { listeners } = await cdp.send("DOMDebugger.getEventListeners", {
    objectId,
  });
  return listeners;
}

async function removeHarnessListeners(cdp: CDPSession): Promise<number> {
  let removed = 0;
  for (const listener of await windowListeners(cdp)) {
    const handler = listener.handler?.objectId;
    if (
      handler === undefined ||
      !listener.handler?.description?.includes("_hitTargetInterceptor")
    ) {
      continue;
    }
    await cdp.send("Runtime.callFunctionOn", {
      objectId: handler,
      functionDeclaration:
        "function (type, capture) { window.removeEventListener(type, this, capture); }",
      arguments: [{ value: listener.type }, { value: listener.useCapture }],
    });
    removed++;
  }
  const remaining = (await windowListeners(cdp)).filter((listener) =>
    listener.handler?.description?.includes("_hitTargetInterceptor"),
  );
  if (remaining.length > 0) {
    throw new Error("Could not remove Playwright's hit target listeners");
  }
  return removed;
}

async function listEventListeners(cdp: CDPSession): Promise<Listener[]> {
  const relevant = /^(touch|pointer|wheel|mousewheel|scroll|gesture)/;
  const chain = await cdp.send("Runtime.evaluate", {
    objectGroup: "tree-scroll-profile",
    expression: `(() => {
      const chain = [];
      for (let el = document.querySelector(".tree-container"); el; el = el.parentElement) chain.push(el);
      chain.push(document, window);
      return chain;
    })()`,
  });
  if (chain.result.objectId === undefined) {
    throw new Error("Could not resolve the tree container ancestors");
  }
  const properties = await cdp.send("Runtime.getProperties", {
    objectId: chain.result.objectId,
    ownProperties: true,
  });
  const listeners: Listener[] = [];
  for (const property of properties.result) {
    const objectId = property.value?.objectId;
    if (!/^\d+$/.test(property.name) || objectId === undefined) continue;
    const target = await describeTarget(cdp, objectId);
    const result = await cdp.send("DOMDebugger.getEventListeners", {
      objectId,
      depth: 0,
    });
    for (const listener of result.listeners) {
      if (!relevant.test(listener.type)) continue;
      listeners.push({
        target,
        type: listener.type,
        passive: listener.passive,
        useCapture: listener.useCapture,
        once: listener.once,
        handler: (listener.handler?.description ?? "")
          .replace(/\s+/g, " ")
          .slice(0, 80),
      });
    }
  }
  return listeners;
}

interface LayerInfo {
  readonly layerId: string;
  readonly height: number;
  readonly drawsContent: boolean;
  readonly scrollRects?: readonly { readonly type: string }[];
}

async function countLayers(
  cdp: CDPSession,
  page: Page,
): Promise<{
  total: number;
  drawing: number;
  touchHandlerRects: number;
  tallestPx: number;
  compositingReasons: Record<string, number>;
}> {
  let latest: readonly LayerInfo[] = [];
  const onChange = (event: { layers?: LayerInfo[] }): void => {
    if (event.layers !== undefined) latest = event.layers;
  };
  cdp.on("LayerTree.layerTreeDidChange", onChange);
  await cdp.send("LayerTree.enable");
  for (let attempt = 0; attempt < 50 && latest.length === 0; attempt++) {
    await page.evaluate(() => {
      document.body.style.outline = document.body.style.outline
        ? ""
        : "0 solid transparent";
    });
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => {
    document.body.style.outline = "";
  });
  const compositingReasons: Record<string, number> = {};
  for (const layer of latest) {
    const { compositingReasonIds = [] } = await cdp.send(
      "LayerTree.compositingReasons",
      { layerId: layer.layerId },
    );
    for (const reason of compositingReasonIds) {
      compositingReasons[reason] = (compositingReasons[reason] ?? 0) + 1;
    }
  }
  await cdp.send("LayerTree.disable");
  cdp.off("LayerTree.layerTreeDidChange", onChange);
  return {
    tallestPx: Math.max(0, ...latest.map((layer) => layer.height)),
    compositingReasons,
    total: latest.length,
    drawing: latest.filter((layer) => layer.drawsContent).length,
    touchHandlerRects: latest
      .flatMap((layer) => layer.scrollRects ?? [])
      .filter((rect) => rect.type === "TouchEventHandler").length,
  };
}

function asyncSpans(
  events: readonly TraceEvent[],
  name: string,
): { begin: TraceEvent; dur: number }[] {
  const open = new Map<string, TraceEvent>();
  const spans: { begin: TraceEvent; dur: number }[] = [];
  for (const event of events) {
    if (event.name !== name) continue;
    const key = `${event.pid}:${event.id ?? event.id2?.local ?? event.id2?.global ?? ""}`;
    if (event.ph === "b") open.set(key, event);
    if (event.ph === "e") {
      const begin = open.get(key);
      if (begin !== undefined) {
        open.delete(key);
        spans.push({ begin, dur: event.ts - begin.ts });
      }
    }
  }
  return spans;
}

function slices(events: readonly TraceEvent[]): Slice[] {
  const result: Slice[] = [];
  const stacks = new Map<string, TraceEvent[]>();
  for (const event of events) {
    if (event.ph === "X" && event.dur !== undefined) {
      result.push({ ...event, dur: event.dur });
    } else if (event.ph === "B" || event.ph === "E") {
      const key = `${event.pid}:${event.tid}`;
      const stack = stacks.get(key) ?? [];
      stacks.set(key, stack);
      if (event.ph === "B") {
        stack.push(event);
      } else {
        const begin = stack.pop();
        if (begin !== undefined) {
          result.push({ ...begin, dur: event.ts - begin.ts });
        }
      }
    }
  }
  return result;
}

function analyseTrace(events: readonly TraceEvent[]): {
  metrics: TraceMetrics;
  screenshots: string[];
  rasterEvidence: string[];
} {
  const start = events.find((event) => event.name === START_MARK);
  const end = events.find((event) => event.name === END_MARK);
  if (start === undefined || end === undefined) {
    throw new Error("Fling marks missing from the trace");
  }
  const processNames = new Map<number, string>();
  for (const event of events) {
    if (event.ph === "M" && event.name === "process_name") {
      processNames.set(event.pid, String(nested(event.args, "name")));
    }
  }
  const renderer = start.pid;
  const main = start.tid;
  const inWindow = (ts: number): boolean => ts >= start.ts && ts <= end.ts;
  const windowed = events.filter((event) => inWindow(event.ts));
  const all = slices(events).filter((slice) => inWindow(slice.ts));
  const inRenderer = all.filter((slice) => slice.pid === renderer);
  const onMain = inRenderer.filter((slice) => slice.tid === main);
  const sum = (list: readonly Slice[]): number =>
    round(list.reduce((total, slice) => total + slice.dur, 0) / 1000);
  const named = (list: readonly Slice[], ...names: string[]): Slice[] =>
    list.filter((slice) => names.includes(slice.name));

  const frames = asyncSpans(events, "PipelineReporter")
    .filter(({ begin }) => begin.pid === renderer && inWindow(begin.ts))
    .map(({ begin }) => nested(begin.args, "frame_reporter"))
    .filter(
      (frame): frame is Record<string, unknown> =>
        typeof frame === "object" && frame !== null,
    );
  const updated = frames.filter(
    (frame) => frame.state !== "STATE_NO_UPDATE_DESIRED",
  );
  const count = (predicate: (frame: Record<string, unknown>) => boolean) =>
    updated.filter(predicate).length;
  const presented = count((frame) => frame.state === "STATE_PRESENTED_ALL");
  const partial = count((frame) => frame.state === "STATE_PRESENTED_PARTIAL");
  const dropped = count((frame) => frame.state === "STATE_DROPPED");
  const counted = presented + partial + dropped;

  const tasks = named(onMain, "RunTask");
  const longTasks = tasks.filter((task) => task.dur / 1000 > LONG_TASK_MS);

  const latencies = asyncSpans(events, "EventLatency").filter(({ begin }) =>
    inWindow(begin.ts),
  );
  const latencyOf = (...types: string[]): number[] =>
    latencies
      .filter(({ begin }) =>
        types.includes(
          String(nested(begin.args, "event_latency", "event_type")),
        ),
      )
      .map(({ dur }) => dur / 1000);
  const touchMoves = latencyOf("TOUCH_MOVED");
  const scrollUpdates = latencyOf(
    "FIRST_GESTURE_SCROLL_UPDATE",
    "GESTURE_SCROLL_UPDATE",
  );
  const firstScrollUpdates = latencyOf("FIRST_GESTURE_SCROLL_UPDATE");
  const inertial = latencyOf("INERTIAL_GESTURE_SCROLL_UPDATE");
  const queuedTouches = named(
    inRenderer,
    "MainThreadEventQueue::HandleEvent",
  ).filter((slice) => /kTouch/.test(String(nested(slice.args, "event_type"))));
  const dispatchType = (slice: Slice): number =>
    Number(nested(slice.args, "dispatch_type"));

  const touchDispatch = named(onMain, "EventDispatch").filter((slice) =>
    /^touch/.test(String(nested(slice.args, "data", "type"))),
  );
  const gpuPids = new Set(
    [...processNames]
      .filter(([, name]) => name === "GPU Process")
      .map(([pid]) => pid),
  );

  const screenshots = windowed
    .filter(
      (event) =>
        event.name === "Screenshot" &&
        typeof nested(event.args, "snapshot") === "string",
    )
    .map((event) => String(nested(event.args, "snapshot")));

  return {
    metrics: {
      flingMs: round((end.ts - start.ts) / 1000, 0),
      framesPresented: presented,
      framesPartial: partial,
      framesDropped: dropped,
      droppedPercent: counted === 0 ? 0 : round((dropped / counted) * 100),
      framesCheckerboardedNeedsRecord: count(
        (frame) => frame.checkerboarded_needs_record === true,
      ),
      framesCheckerboardedNeedsRaster: count(
        (frame) => frame.checkerboarded_needs_raster === true,
      ),
      framesMissingContent: count(
        (frame) => frame.has_missing_content === true,
      ),
      framesScrollMainThread: count(
        (frame) => frame.scroll_state === "SCROLL_MAIN_THREAD",
      ),
      framesScrollCompositor: count(
        (frame) => frame.scroll_state === "SCROLL_COMPOSITOR_THREAD",
      ),
      longTaskCount: longTasks.length,
      longTaskMaxMs: round(
        Math.max(0, ...longTasks.map((task) => task.dur / 1000)),
      ),
      mainThreadBusyMs: sum(tasks),
      touchMoveLatencyP50Ms: round(percentile(touchMoves, 50)),
      touchMoveLatencyP95Ms: round(percentile(touchMoves, 95)),
      scrollUpdateLatencyP50Ms: round(percentile(scrollUpdates, 50)),
      scrollUpdateLatencyP95Ms: round(percentile(scrollUpdates, 95)),
      scrollUpdates: scrollUpdates.length,
      inertialScrollUpdates: inertial.length,
      firstScrollUpdateLatencyP50Ms: round(percentile(firstScrollUpdates, 50)),
      firstScrollUpdateLatencyMaxMs: round(Math.max(0, ...firstScrollUpdates)),
      touchBlockingDispatches: queuedTouches.filter(
        (slice) => dispatchType(slice) === 0,
      ).length,
      touchNonBlockingDispatches: queuedTouches.filter(
        (slice) => dispatchType(slice) === 1,
      ).length,
      touchDispatchCount: touchDispatch.length,
      touchDispatchMs: sum(touchDispatch),
      scriptMs: sum(named(onMain, "FunctionCall", "EvaluateScript")),
      styleLayoutMs: sum(named(onMain, "UpdateLayoutTree", "Layout")),
      prePaintMs: sum(named(onMain, "PrePaint")),
      paintMs: sum(named(onMain, "Paint")),
      layerizeMs: sum(named(onMain, "Layerize")),
      commitMs: sum(named(inRenderer, "Commit")),
      rasterMs: sum(named(inRenderer, "RasterTask")),
      gpuProcessMs: sum(
        all.filter(
          (slice) => gpuPids.has(slice.pid) && slice.name === "RunTask",
        ),
      ),
    },
    screenshots,
    rasterEvidence: [
      ...new Set(
        events
          .map((event) => event.name)
          .filter((name) =>
            /RasterBuffer::Playback|SoftwareRenderer::SwapBuffers|SkiaRenderer::SwapBuffers|GpuRaster/.test(
              name,
            ),
          ),
      ),
    ].sort(),
  };
}

const ANALYSE_FRAME = `async ({ dataUrl, region, iconMaxWidth, segmentGap }) => {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const scale = image.naturalWidth / region.viewportWidth;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data, width } = context.getImageData(0, 0, canvas.width, canvas.height);
  const left = Math.round(region.left * scale);
  const right = Math.round(region.right * scale);
  const top = Math.round(region.top * scale);
  const bottom = Math.min(canvas.height, Math.round(region.bottom * scale));
  const ref = (top * width + right - 1) * 4;
  const background = [data[ref], data[ref + 1], data[ref + 2]];
  const ink = (x, y) => {
    const i = (y * width + x) * 4;
    return Math.abs(data[i] - background[0]) + Math.abs(data[i + 1] - background[1]) + Math.abs(data[i + 2] - background[2]) > 120;
  };
  const bands = [];
  let start = -1;
  for (let y = top; y <= bottom; y++) {
    let any = false;
    for (let x = left; y < bottom && x < right && !any; x++) any = ink(x, y);
    if (any && start < 0) start = y;
    if (!any && start >= 0) {
      if (y - start >= 3 * scale) bands.push([start, y]);
      start = -1;
    }
  }
  const rows = bands.slice(1, -1).map(([from, to]) => {
    const segments = [];
    let segment = null;
    let gap = 0;
    for (let x = left; x < right; x++) {
      let any = false;
      for (let y = from; y < to && !any; y++) any = ink(x, y);
      if (any) {
        if (segment === null) segment = { from: x, to: x };
        segment.to = x;
        gap = 0;
      } else if (segment !== null && ++gap > segmentGap * scale) {
        segments.push(segment);
        segment = null;
      }
    }
    if (segment !== null) segments.push(segment);
    const widths = segments.map((s) => (s.to - s.from + 1) / scale);
    return {
      hasIcon: widths.length > 0 && widths[0] <= iconMaxWidth,
      hasName: widths.some((w) => w > iconMaxWidth),
    };
  });
  return {
    rows: rows.length,
    blankNameRows: rows.filter((row) => row.hasIcon && !row.hasName).length,
    missingIconRows: rows.filter((row) => row.hasName && !row.hasIcon).length,
  };
}`;

async function analyseFrames(
  page: Page,
  dir: string,
  files: readonly string[],
  region: Region,
): Promise<FrameAnalysis[]> {
  const results: FrameAnalysis[] = [];
  for (const file of files) {
    const bytes = await readFile(resolve(dir, file));
    const input = {
      dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
      region,
      iconMaxWidth: ICON_MAX_WIDTH,
      segmentGap: SEGMENT_GAP,
    };
    const result = (await page.evaluate(
      `(${ANALYSE_FRAME})(${JSON.stringify(input)})`,
    )) as Omit<FrameAnalysis, "file">;
    results.push({ file, ...result });
  }
  return results;
}

async function treeRegion(page: Page): Promise<Region> {
  return page.evaluate((actionsWidth) => {
    const container = document.querySelector<HTMLElement>(".tree-container");
    if (container === null) throw new Error("Tree not rendered");
    const box = container.getBoundingClientRect();
    return {
      top: box.top,
      bottom: Math.min(box.bottom, window.innerHeight),
      left: box.left,
      right: box.right - actionsWidth,
      viewportWidth: window.innerWidth,
    };
  }, ROW_ACTIONS_WIDTH);
}

async function main(): Promise<void> {
  const { out, runs } = readArgs();
  const port = readPort();
  if (!existsSync(resolve(distDir, "index.html"))) {
    fail(
      `Missing ${distDir}/index.html. Build it first with: limited npm run build:fake`,
    );
  }
  await mkdir(out, { recursive: true });
  const server = await preview({
    root,
    build: { outDir: "dist-fake" },
    preview: { port, strictPort: true },
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const { defaultBrowserType: _, ...pixel7 } = devices["Pixel 7"];
    const context = await browser.newContext({
      ...pixel7,
      baseURL: `http://localhost:${port}`,
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await openNotes(page, { repo: REPO });
    const rows = await expandAll(page);
    const domElements = await page.evaluate(
      () => document.getElementsByTagName("*").length,
    );
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const region = await treeRegion(page);
    const harnessListenersRemoved = await removeHarnessListeners(cdp);
    const listeners = await listEventListeners(cdp);
    const layers = await countLayers(cdp, page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLING });

    const analysisPage = await (await browser.newContext()).newPage();
    const runResults: RunMetrics[] = [];
    const partialFrames: { run: number; frames: FrameAnalysis[] }[] = [];
    const rasterEvidence = new Set<string>();
    for (let run = 1; run <= runs; run++) {
      const runDir = resolve(out, `run-${run}`);
      const screenshotDir = resolve(runDir, "screenshots");
      await mkdir(screenshotDir, { recursive: true });
      await page.evaluate(() => {
        const container =
          document.querySelector<HTMLElement>(".tree-container");
        if (container !== null) container.scrollTop = 0;
      });
      await settle(page);
      await browser.startTracing(page, {
        categories: TRACE_CATEGORIES,
        screenshots: true,
      });
      await page.evaluate((mark) => performance.mark(mark), START_MARK);
      const down = await fling(cdp, page, region, "down");
      await settle(page);
      const up = await fling(cdp, page, region, "up");
      await settle(page);
      await page.evaluate((mark) => performance.mark(mark), END_MARK);
      const buffer = await browser.stopTracing();
      await writeFile(resolve(runDir, "trace.json"), buffer);
      const parsed = JSON.parse(buffer.toString("utf8")) as
        { traceEvents: TraceEvent[] } | TraceEvent[];
      const analysis = analyseTrace(
        Array.isArray(parsed) ? parsed : parsed.traceEvents,
      );
      analysis.rasterEvidence.forEach((name) => rasterEvidence.add(name));
      const files: string[] = [];
      for (const [index, snapshot] of analysis.screenshots.entries()) {
        const file = `${String(index + 1).padStart(4, "0")}.jpg`;
        await writeFile(
          resolve(screenshotDir, file),
          Buffer.from(snapshot, "base64"),
        );
        files.push(file);
      }
      const frames = await analyseFrames(
        analysisPage,
        screenshotDir,
        files,
        region,
      );
      const blank = frames.filter((frame) => frame.blankNameRows > 0);
      const missingIcon = frames.filter((frame) => frame.missingIconRows > 0);
      partialFrames.push({
        run,
        frames: frames.filter(
          (frame) => frame.blankNameRows > 0 || frame.missingIconRows > 0,
        ),
      });
      runResults.push({
        ...analysis.metrics,
        screenshots: files.length,
        blankNameFrames: blank.length,
        missingIconFrames: missingIcon.length,
        minRowsInFrame: Math.min(...frames.map((frame) => frame.rows)),
      });
      console.log(
        `run ${run}: ${down} swipes down, ${up} swipes up, ${files.length} screenshots`,
      );
    }

    const keys = Object.keys(runResults[0]) as (keyof RunMetrics)[];
    const medians = Object.fromEntries(
      keys.map((key) => [key, median(runResults.map((result) => result[key]))]),
    );
    const report = {
      chrome: browser.version(),
      userAgent,
      rasterEvidence: [...rasterEvidence].sort(),
      settings: {
        device: "Pixel 7",
        cpuThrottling: CPU_THROTTLING,
        flingSpeedPxPerS: FLING_SPEED,
        touchIntervalMs: TOUCH_INTERVAL_MS,
        swipeShareOfContainer: SWIPE_SHARE,
        flingCoastMs: FLING_COAST_MS,
        runs,
        port,
        categories: TRACE_CATEGORIES,
      },
      rows,
      domElements,
      layers,
      harnessListenersRemoved,
      listeners,
      medians,
      runs: runResults,
      partiallyPaintedFrames: partialFrames,
    };
    await writeFile(
      resolve(out, "metrics.json"),
      JSON.stringify(report, null, 2),
    );

    console.log(`Chrome ${browser.version()} (${userAgent})`);
    console.log(
      `Raster/compositing events: ${[...rasterEvidence].sort().join(", ")}`,
    );
    console.log(
      `Rows ${rows}, DOM elements ${domElements}, layers ${layers.total} (${layers.drawing} drawing, ${layers.touchHandlerRects} touch handler rects)`,
    );
    console.table(layers.compositingReasons);
    console.table(listeners);
    console.table(
      Object.fromEntries(
        keys.map((key) => [
          key,
          {
            median: medians[key],
            ...Object.fromEntries(
              runResults.map((result, index) => [
                `run ${index + 1}`,
                result[key],
              ]),
            ),
          },
        ]),
      ),
    );
    console.log(`Wrote ${resolve(out, "metrics.json")}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
