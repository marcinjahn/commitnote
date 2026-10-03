import { describe, expect, it } from "vitest";
import {
  nearestPaletteColor,
  parseCssColor,
  resolveSystemAccent,
  type PaletteColorId,
} from "./accent-snap";

function nearest(hex: string): PaletteColorId {
  const rgb = parseCssColor(hex);
  if (rgb === null) throw new Error(`unparsable test color ${hex}`);
  return nearestPaletteColor(rgb);
}

describe("nearestPaletteColor", () => {
  it.each([
    ["blue", "#3584e4", "blue"],
    ["teal", "#2190a4", "teal"],
    ["green", "#3a944a", "green"],
    ["yellow", "#c88800", "amber"],
    ["orange", "#ed5b00", "orange"],
    ["red", "#e62d42", "red"],
    ["pink", "#d56199", "pink"],
    ["purple", "#9141ac", "violet"],
    ["slate", "#6f8396", "slate"],
  ])("maps the GNOME %s accent %s to %s", (_name, hex, expected) => {
    expect(nearest(hex)).toBe(expected);
  });

  it.each([
    ["blue", "#007aff", "blue"],
    ["purple", "#953d96", "violet"],
    ["pink", "#f74f9e", "pink"],
    ["red", "#e0383e", "red"],
    ["orange", "#f7821b", "orange"],
    ["yellow", "#ffc600", "amber"],
    ["green", "#62ba46", "green"],
    ["graphite", "#989898", "slate"],
  ])("maps the macOS %s accent %s to %s", (_name, hex, expected) => {
    expect(nearest(hex)).toBe(expected);
  });

  it.each([
    ["Chrome's fixed accent", "#0075ff", "blue"],
    ["muted dusty rose", "#b07a8c", "pink"],
    ["muted sage", "#7f9a7a", "green"],
    ["very dark navy", "#101c46", "blue"],
    ["very dark maroon", "#3d0a0a", "red"],
    ["near-gray with a blue cast", "#7d828a", "slate"],
    ["white", "#ffffff", "slate"],
    ["black", "#000000", "slate"],
    ["indigo between blue and violet", "#5b4fd6", "blue"],
    ["magenta between violet and pink", "#c040c0", "violet"],
    ["olive between amber and green", "#8a8a20", "amber"],
    ["cyan between teal and blue", "#00a8c8", "teal"],
  ])("maps %s %s to %s", (_name, hex, expected) => {
    expect(nearest(hex)).toBe(expected);
  });
});

describe("parseCssColor", () => {
  it("parses the formats getComputedStyle returns", () => {
    expect(parseCssColor("rgb(230, 45, 66)")).toEqual({ r: 230, g: 45, b: 66 });
    expect(parseCssColor("rgba(230, 45, 66, 0.5)")).toEqual({
      r: 230,
      g: 45,
      b: 66,
    });
    expect(parseCssColor("rgb(230 45 66 / 50%)")).toEqual({
      r: 230,
      g: 45,
      b: 66,
    });
    expect(parseCssColor("color(srgb 1 0 0.5)")).toEqual({
      r: 255,
      g: 0,
      b: 127.5,
    });
    expect(parseCssColor("#E62D42")).toEqual({ r: 230, g: 45, b: 66 });
  });

  it("rejects anything else", () => {
    expect(parseCssColor("")).toBeNull();
    expect(parseCssColor("AccentColor")).toBeNull();
    expect(parseCssColor("oklch(0.6 0.2 25)")).toBeNull();
    expect(parseCssColor("rgb(1, 2)")).toBeNull();
  });
});

describe("resolveSystemAccent", () => {
  it("snaps an sRGB color() value, as color-mix in srgb serializes", () => {
    expect(resolveSystemAccent("color(srgb 0.568627 0.254902 0.67451)")).toEqual({
      id: "violet",
      fromOs: true,
    });
  });

  it("snaps a reported OS accent to the nearest palette color", () => {
    expect(resolveSystemAccent("rgb(230, 45, 66)")).toEqual({
      id: "red",
      fromOs: true,
    });
  });

  it("falls back to blue when the browser has no OS accent", () => {
    expect(resolveSystemAccent(null)).toEqual({ id: "blue", fromOs: false });
  });

  it("falls back to blue when the reported accent can't be parsed", () => {
    expect(resolveSystemAccent("AccentColor")).toEqual({
      id: "blue",
      fromOs: false,
    });
  });
});
