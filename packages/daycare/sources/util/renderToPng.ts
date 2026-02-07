import { chromium } from "playwright";

export type RenderToPngOptions = {
  width?: number;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Renders SVG markup to PNG using headless Chromium.
 * Expects: svg contains a root <svg> element and optional width is a positive integer.
 */
export async function renderToPng(
  svg: string,
  options: RenderToPngOptions = {}
): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 }
    });

    await page.setContent(
      `<!doctype html><html><body style="margin:0;padding:0;">${svg}</body></html>`,
      { waitUntil: "load" }
    );

    const svgLocator = page.locator("svg").first();
    if ((await svgLocator.count()) === 0) {
      throw new Error("Rendered HTML does not contain an <svg> element.");
    }

    await page.evaluate(async () => {
      const globalObject = globalThis as unknown as {
        document?: { fonts?: { ready?: Promise<unknown> } };
      };
      await globalObject.document?.fonts?.ready;
    });

    if (typeof options.width === "number") {
      await svgLocator.evaluate((node, width) => {
        node.style.width = `${width}px`;
        node.style.height = "auto";
      }, options.width);
    }

    const screenshot = await svgLocator.screenshot({
      type: "png",
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    });
    return screenshot;
  } finally {
    await browser.close();
  }
}
