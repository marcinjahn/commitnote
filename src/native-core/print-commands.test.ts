import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRINT_IMAGE_UNAVAILABLE_TEXT } from "../print/print-nodes";
import type { NativeCoreHandle } from "./api";
import { PRINT_STYLE } from "./print-document";
import {
  createCoreTestContext,
  type CoreTestContext,
} from "./testing/core-test-harness";

let ctx: CoreTestContext;

beforeEach(async () => {
  ctx = await createCoreTestContext();
});

afterEach(() => {
  ctx.dispose();
});

function png(): Uint8Array {
  const out = new Uint8Array(29);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(out.buffer);
  view.setUint32(8, 13);
  out.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, 40);
  view.setUint32(20, 30);
  out.set([8, 6, 0, 0, 0], 24);
  return out;
}

async function started(): Promise<NativeCoreHandle> {
  const core = ctx.startCore();
  await ctx.logIn(core);
  return core;
}

const UNKNOWN_ID = "a".repeat(26);

describe("print.render", () => {
  it("requires a running app", async () => {
    const core = ctx.startCore();
    await expect(
      ctx.call(core, "print.render", { name: "N", text: "x" }),
    ).rejects.toBeDefined();
  });

  it("builds a standalone document with the style and embedded images", async () => {
    const core = await started();
    const { references } = await ctx.call(core, "image.insert", {
      inputs: [ctx.host.stageInput(png(), "image/png")],
    });
    const text = `# Heading\n\n${references[0]}\n\n![](image:${UNKNOWN_ID}#4x3)\n`;

    const { html } = await ctx.call(core, "print.render", {
      name: "Trip",
      text,
    });

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(PRINT_STYLE);
    expect(html).toContain('class="print-view"');
    expect(html).toMatch(/src="data:image\/webp;base64,[A-Za-z0-9+/=]+"/);
    expect(html).toContain(PRINT_IMAGE_UNAVAILABLE_TEXT);
  });

  it("shows the escaped title only when the note does not start with it", async () => {
    const core = await started();
    const name = 'A <b>&" name';

    const shown = await ctx.call(core, "print.render", {
      name,
      text: "Body text",
    });
    expect(shown.html).toContain(
      '<h1 class="print-title">A &lt;b&gt;&amp;&quot; name</h1>',
    );
    expect(shown.html).toContain("<title>A &lt;b&gt;&amp;&quot; name</title>");

    const hidden = await ctx.call(core, "print.render", {
      name: "Trip",
      text: "# Trip\n\nBody",
    });
    expect(hidden.html).not.toContain('class="print-title"');
  });

  it("escapes markup from the note text", async () => {
    const core = await started();
    const { html } = await ctx.call(core, "print.render", {
      name: "Trip",
      text: "<script>alert(1)</script>\n\nhello",
    });
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script");
  });
});
