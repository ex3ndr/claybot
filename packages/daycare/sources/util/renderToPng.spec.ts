import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launch: vi.fn()
}));

vi.mock("playwright", () => ({
  chromium: {
    launch: mocks.launch
  }
}));

import { renderToPng } from "./renderToPng.js";

describe("renderToPng", () => {
  beforeEach(() => {
    mocks.launch.mockReset();
  });

  it("renders png bytes and closes browser", async () => {
    const screenshot = Buffer.from("png");
    const locator = {
      count: vi.fn(async () => 1),
      evaluate: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => screenshot)
    };
    const page = {
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => undefined),
      locator: vi.fn(() => ({
        first: () => locator
      }))
    };
    const browser = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined)
    };
    mocks.launch.mockResolvedValue(browser);

    const result = await renderToPng("<svg></svg>", { width: 800 });

    expect(result).toBe(screenshot);
    expect(locator.evaluate).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("closes browser when svg element is missing", async () => {
    const locator = {
      count: vi.fn(async () => 0),
      evaluate: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => Buffer.from("png"))
    };
    const page = {
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => undefined),
      locator: vi.fn(() => ({
        first: () => locator
      }))
    };
    const browser = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined)
    };
    mocks.launch.mockResolvedValue(browser);

    await expect(renderToPng("<div></div>")).rejects.toThrow("does not contain an <svg>");
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
