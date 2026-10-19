// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interceptExternalLinks } from "./external-links";

function click(el: Element): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

describe("interceptExternalLinks", () => {
  let open: ReturnType<typeof vi.fn<(url: string) => void>>;
  let stop: () => void;

  beforeEach(() => {
    document.body.innerHTML = "";
    open = vi.fn();
    stop = interceptExternalLinks(document, open);
  });

  afterEach(() => stop());

  function anchor(href: string, target?: string): HTMLAnchorElement {
    const a = document.createElement("a");
    a.href = href;
    if (target) a.target = target;
    a.innerHTML = "<span>label</span>";
    document.body.append(a);
    return a;
  }

  it("routes https links opened in a new tab", () => {
    const event = click(anchor("https://example.com/x", "_blank"));
    expect(open).toHaveBeenCalledWith("https://example.com/x");
    expect(event.defaultPrevented).toBe(true);
  });

  it("routes mailto links", () => {
    const event = click(anchor("mailto:a@b.test", "_blank"));
    expect(open).toHaveBeenCalledWith("mailto:a@b.test");
    expect(event.defaultPrevented).toBe(true);
  });

  it("routes clicks on a child of the anchor", () => {
    const a = anchor("https://example.com/", "_blank");
    const event = click(a.querySelector("span")!);
    expect(open).toHaveBeenCalledWith("https://example.com/");
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves same-tab links alone", () => {
    const event = click(anchor("https://example.com/"));
    expect(open).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it.each(["javascript:void(0)", "ftp://example.com/f", "file:///etc/passwd"])(
    "leaves %s untouched",
    (href) => {
      const event = click(anchor(href, "_blank"));
      expect(open).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    },
  );

  it("ignores non-primary buttons", () => {
    const a = anchor("https://example.com/", "_blank");
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    a.dispatchEvent(event);
    expect(open).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops intercepting once removed", () => {
    const a = anchor("https://example.com/", "_blank");
    stop();
    const event = click(a);
    expect(open).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
