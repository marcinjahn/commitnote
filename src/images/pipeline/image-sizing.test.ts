import { describe, expect, it } from "vitest";
import { fitWithin } from "./image-sizing";

describe("fitWithin", () => {
  it("never upscales", () => {
    expect(fitWithin(800, 600, 2560)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(2560, 100, 2560)).toEqual({ width: 2560, height: 100 });
  });

  it("scales landscape images to the long edge", () => {
    expect(fitWithin(3000, 2000, 2560)).toEqual({ width: 2560, height: 1707 });
  });

  it("scales portrait images to the long edge", () => {
    expect(fitWithin(2000, 3000, 2560)).toEqual({ width: 1707, height: 2560 });
  });

  it("scales square images", () => {
    expect(fitWithin(4000, 4000, 1920)).toEqual({ width: 1920, height: 1920 });
  });

  it("rounds the short side", () => {
    expect(fitWithin(5000, 3333, 1920)).toEqual({ width: 1920, height: 1280 });
  });

  it("keeps the short side at least 1", () => {
    expect(fitWithin(10000, 1, 2560)).toEqual({ width: 2560, height: 1 });
  });
});
