import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, firefox, webkit } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.ROMEO_BASE_URL ?? "http://127.0.0.1:3000";
const evidencePath = resolve(root, "dist/ci/browser-engine-matrix.json");
const axeSource = await readFile(
  resolve(root, "apps/app/node_modules/axe-core/axe.min.js"),
  "utf8",
);
const configuredEngines = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
];
const requestedEngines = new Set(
  (process.env.ROMEO_BROWSER_ENGINES ?? "chromium,firefox,webkit")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const engines = configuredEngines.filter(([name]) =>
  requestedEngines.has(name),
);
assert(engines.length > 0, "No supported browser engines were selected");
const results = [];

for (const [name, browserType] of engines) {
  const startedAt = new Date().toISOString();
  const result = {
    engine: name,
    startedAt,
    status: "failed",
    viewport: { width: 1440, height: 900 },
    routes: [],
  };
  let browser;
  try {
    browser = await browserType.launch({ headless: true });
    result.version = browser.version();
    const context = await browser.newContext({
      reducedMotion: "reduce",
      viewport: result.viewport,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const pageErrors = [];
    const hydrationErrors = [];
    page.on("pageerror", (error) =>
      pageErrors.push(`[${new URL(page.url()).pathname}] ${error.message}`),
    );
    page.on("console", (message) => {
      const text = message.text();
      if (/hydration|did not match|server rendered/iu.test(text)) {
        hydrationErrors.push(`[${new URL(page.url()).pathname}] ${text}`);
      }
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "New chat", exact: true }).waitFor();
    await assertCoreChat(page, name);
    result.routes.push(await auditRoute(page, "chat", "/"));
    assertNoRuntimeErrors(pageErrors, hydrationErrors, "chat");

    await page.goto(`${baseUrl}/settings?section=interface`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByText("Appearance", { exact: true }).first().waitFor();
    result.routes.push(
      await auditRoute(
        page,
        "settings-interface",
        "/settings?section=interface",
      ),
    );
    assertNoRuntimeErrors(pageErrors, hydrationErrors, "settings-interface");

    await page.goto(`${baseUrl}/admin?section=providers`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("heading", { name: "AI models" }).waitFor();
    result.routes.push(
      await auditRoute(page, "admin-providers", "/admin?section=providers"),
    );
    assertNoRuntimeErrors(pageErrors, hydrationErrors, "admin-providers");
    result.status = "passed";
    result.completedAt = new Date().toISOString();
    await context.close();
  } catch (error) {
    result.completedAt = new Date().toISOString();
    result.failure = sanitizeFailure(error);
  } finally {
    await browser?.close();
    results.push(result);
  }
}

const evidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baseUrl: new URL(baseUrl).origin,
  nodeVersion: process.version,
  results,
};
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

const failures = results.filter((result) => result.status !== "passed");
if (failures.length > 0) {
  throw new Error(
    `Browser engine matrix failed: ${failures.map((result) => `${result.engine}: ${result.failure}`).join("; ")}`,
  );
}
console.log(
  `Romeo desktop browser matrix passed for ${results.map((result) => `${result.engine} ${result.version}`).join(", ")}.`,
);
console.log(`Wrote metadata-only evidence to ${evidencePath}`);

async function assertCoreChat(page, engine) {
  const skipLink = page.locator(".rm-skip-link");
  assert(
    (await skipLink.getAttribute("href")) === "#main-content",
    "skip link target is incorrect",
  );
  await page.keyboard.press(engine === "webkit" ? "Alt+Tab" : "Tab");
  assert(
    await skipLink.evaluate((node) => node === document.activeElement),
    "skip link is not first in focus order",
  );
  await page.keyboard.press("Enter");
  assert(
    await page
      .locator("#main-content")
      .evaluate((node) => node === document.activeElement),
    "skip link did not focus the chat surface",
  );

  const modelSelector = page.locator(".rm-model-select");
  await modelSelector.click();
  await page.getByRole("menu").waitFor();
  await page.getByRole("menuitemradio").first().waitFor();
  assert(
    (await page.getByRole("menuitemradio").count()) > 0,
    "model selector has no agent options",
  );
  await modelSelector.click();
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await page.locator("#prompt").waitFor();
  await page.getByRole("button", { name: "Send message" }).waitFor();

  assert(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    "reduced-motion preference was not applied",
  );
}

async function auditRoute(page, name, path) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const report = await window.axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
    return report.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    }));
  });
  assert(
    violations.length === 0,
    `${name} axe violations: ${JSON.stringify(violations)}`,
  );
  return { name, path, axeViolations: violations.length };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoRuntimeErrors(pageErrors, hydrationErrors, route) {
  assert(
    pageErrors.length === 0 && hydrationErrors.length === 0,
    `${route} runtime errors: ${[...pageErrors, ...hydrationErrors].join(" | ")}`,
  );
  pageErrors.length = 0;
  hydrationErrors.length = 0;
}

function sanitizeFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s)]+/giu, "[url]")
    .replace(/[\r\n]+/gu, " ")
    .slice(0, 3_000);
}
