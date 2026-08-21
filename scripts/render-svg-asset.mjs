import { readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const [inputPath, outputPath, rawWidth, rawHeight] = process.argv.slice(2);
const width = Number(rawWidth);
const height = Number(rawHeight);

if (!inputPath || !outputPath || !Number.isInteger(width) || !Number.isInteger(height)) {
  throw new Error("Usage: node scripts/render-svg-asset.mjs <input.svg> <output.png> <width> <height>");
}

const source = await readFile(resolve(inputPath), "utf8");
await mkdir(dirname(resolve(outputPath)), { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { width, height },
  });
  await page.setContent(`<!doctype html>
    <html><head><meta charset="utf-8"><style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
      svg { display: block; width: 100%; height: 100%; }
    </style></head><body>${source}</body></html>`);
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    omitBackground: true,
    path: resolve(outputPath),
    type: "png",
  });
} finally {
  await browser.close();
}
