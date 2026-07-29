import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const baseUrl = process.env.ROMEO_BASE_URL ?? "http://127.0.0.1:3000";
const contractPath = resolve(
  root,
  "docs/quality/browser-visual-baseline-contract.json",
);
const artifactDirectory = resolve(root, "dist/ci/browser-visual-baselines");
const evidencePath = resolve(root, "dist/ci/browser-visual-baselines.json");
const contract = JSON.parse(await readFile(contractPath, "utf8"));
const browser = await chromium.launch({ headless: true });
const browserVersion = browser.version();
const results = [];

try {
  for (const viewport of contract.viewports) {
    for (const theme of contract.themes) {
      for (const route of contract.routes) {
        results.push(await captureScenario({ route, theme, viewport }));
      }
    }
  }
} finally {
  await browser.close();
}

const failures = results.filter((result) => result.status !== "passed");
const evidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: failures.length === 0 ? "passed" : "failed",
  contract: {
    path: "docs/quality/browser-visual-baseline-contract.json",
    schemaVersion: contract.schemaVersion,
  },
  browser: { engine: "chromium", version: browserVersion },
  baseUrl: new URL(baseUrl).origin,
  scenarios: results,
};
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

if (failures.length > 0) {
  throw new Error(
    `Visual baseline failures: ${failures
      .map((failure) => `${failure.id}: ${failure.failure}`)
      .join("; ")}`,
  );
}
console.log(
  `Romeo visual baselines passed for ${results.length} light/dark viewport-route scenarios.`,
);
console.log(`Wrote visual baseline evidence to ${evidencePath}`);

async function captureScenario({ route, theme, viewport }) {
  const id = `${route.name}-${viewport.name}-${theme}`;
  const screenshotPath = resolve(artifactDirectory, `${id}.png`);
  const context = await browser.newContext({
    colorScheme: theme,
    reducedMotion: contract.reducedMotion,
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    if (/hydration|did not match|server rendered/iu.test(text)) {
      runtimeErrors.push(text);
    }
  });
  try {
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem("theme", selectedTheme);
    }, theme);
    await page.goto(`${baseUrl}${route.path}`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator(route.requiredSelector).first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({
      content:
        "*,*::before,*::after{animation-duration:0.001ms!important;animation-delay:0ms!important;transition-duration:0.001ms!important;caret-color:transparent!important}",
    });
    const metrics = await page.evaluate((requiredSelector) => {
      const required = document.querySelector(requiredSelector);
      const rect = required?.getBoundingClientRect();
      const rootStyle = getComputedStyle(document.documentElement);
      const bodyStyle = getComputedStyle(document.body);
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        requiredElement: {
          height: rect?.height ?? 0,
          width: rect?.width ?? 0,
        },
        rootClasses: [...document.documentElement.classList].sort(),
        backgroundColor: bodyStyle.backgroundColor,
        foregroundColor: bodyStyle.color,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        colorScheme: rootStyle.colorScheme,
      };
    }, route.requiredSelector);
    assert(runtimeErrors.length === 0, runtimeErrors.join(" | "));
    assert(
      metrics.documentWidth - metrics.viewportWidth <=
        contract.maxHorizontalOverflowPx,
      `horizontal overflow ${metrics.documentWidth - metrics.viewportWidth}px`,
    );
    assert(
      metrics.requiredElement.width > 0 && metrics.requiredElement.height > 0,
      `required visual surface ${route.requiredSelector} has no dimensions`,
    );
    assert(
      metrics.rootClasses.includes(theme),
      `${theme} theme was not applied`,
    );
    assert(metrics.reducedMotion, "reduced-motion preference was not applied");
    await mkdir(artifactDirectory, { recursive: true });
    await page.screenshot({
      animations: "disabled",
      fullPage: false,
      path: screenshotPath,
    });
    const screenshot = await readFile(screenshotPath);
    return {
      id,
      status: "passed",
      route: route.path,
      theme,
      viewport,
      metrics,
      screenshot: {
        bytes: screenshot.byteLength,
        path: `dist/ci/browser-visual-baselines/${id}.png`,
        sha256: createHash("sha256").update(screenshot).digest("hex"),
      },
    };
  } catch (error) {
    return {
      id,
      status: "failed",
      route: route.path,
      theme,
      viewport,
      failure: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await context.close();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
