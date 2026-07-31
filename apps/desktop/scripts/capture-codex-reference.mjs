import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..", "..", "..");
const referenceRoot = path.join(
  repoRoot,
  ".omx",
  "artifacts",
  "visual-ralph",
  "codex-settings",
);
const referenceUrl = pathToFileURL(path.join(referenceRoot, "reference.html")).href;
const executablePath = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((candidate) => fs.existsSync(candidate));

if (!executablePath) {
  throw new Error("Chrome or Microsoft Edge is required to capture the design reference.");
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--disable-gpu"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(referenceUrl);
  await page.screenshot({
    path: path.join(referenceRoot, "reference-settings.png"),
    fullPage: true,
  });

  await page.goto(`${referenceUrl}?modal=1`);
  await page.screenshot({
    path: path.join(referenceRoot, "reference-oauth.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(referenceUrl);
  await page.screenshot({
    path: path.join(referenceRoot, "reference-settings-1024.png"),
    fullPage: true,
  });

  const layout = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    clippedTexts: [...document.querySelectorAll("button, strong, span")]
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => element.textContent?.trim())
      .filter(Boolean),
  }));
  if (layout.bodyWidth > layout.viewportWidth || layout.clippedTexts.length > 0) {
    throw new Error(`Reference layout failed: ${JSON.stringify(layout)}`);
  }
} finally {
  await browser.close();
}
