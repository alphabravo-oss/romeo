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
const engineProfiles = {
  chromium: { colorScheme: "light", locale: "en" },
  firefox: { colorScheme: "dark", locale: "es" },
  webkit: { colorScheme: "dark", locale: "fr" },
};

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
      colorScheme: engineProfiles[name].colorScheme,
      reducedMotion: "reduce",
      viewport: result.viewport,
    });
    await context.addInitScript(({ colorScheme }) => {
      localStorage.setItem("theme", colorScheme);
    }, engineProfiles[name]);
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const pageErrors = [];
    const hydrationErrors = [];
    const moduleFailures = [];
    const pendingModuleRequests = new Set();
    page.on("pageerror", (error) =>
      pageErrors.push(`[${new URL(page.url()).pathname}] ${error.message}`),
    );
    page.on("console", (message) => {
      const text = message.text();
      if (/hydration|did not match|server rendered/iu.test(text)) {
        hydrationErrors.push(`[${new URL(page.url()).pathname}] ${text}`);
      }
    });
    page.on("request", (request) => {
      if (request.resourceType() === "script") {
        pendingModuleRequests.add(request);
      }
    });
    page.on("requestfinished", (request) => {
      pendingModuleRequests.delete(request);
    });
    page.on("requestfailed", (request) => {
      pendingModuleRequests.delete(request);
      if (request.resourceType() !== "script") return;
      moduleFailures.push(
        `[${new URL(page.url()).pathname}] script ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? "failed"}`,
      );
    });
    page.on("response", (response) => {
      if (
        response.request().resourceType() === "script" &&
        response.status() >= 400
      ) {
        moduleFailures.push(
          `[${new URL(page.url()).pathname}] script ${new URL(response.url()).pathname} HTTP ${response.status()}`,
        );
      }
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "New chat", exact: true }).waitFor();
    await assertCoreChat(page, name);
    result.routes.push(await auditRoute(page, "chat", "/"));
    await waitForModuleGraphIdle(pendingModuleRequests);
    assertNoRuntimeErrors(pageErrors, hydrationErrors, moduleFailures, "chat");

    await page.keyboard.press("Control+K");
    await page.getByRole("dialog").waitFor();
    const commandInput = page.getByRole("combobox");
    await commandInput.fill("settings");
    await page.keyboard.press("ArrowDown");
    result.routes.push(await auditRoute(page, "command-palette", "/"));
    await page.keyboard.press("Escape");
    await waitForModuleGraphIdle(pendingModuleRequests);
    assertNoRuntimeErrors(
      pageErrors,
      hydrationErrors,
      moduleFailures,
      "command-palette",
    );

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
    await waitForModuleGraphIdle(pendingModuleRequests);
    assertNoRuntimeErrors(
      pageErrors,
      hydrationErrors,
      moduleFailures,
      "settings-interface",
    );

    await page.goto(`${baseUrl}/admin?section=providers`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("heading", { name: "AI models" }).waitFor();
    result.routes.push(
      await auditRoute(page, "admin-providers", "/admin?section=providers"),
    );
    await waitForModuleGraphIdle(pendingModuleRequests);
    assertNoRuntimeErrors(
      pageErrors,
      hydrationErrors,
      moduleFailures,
      "admin-providers",
    );

    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 2 }).waitFor();
    result.routes.push(await auditRoute(page, "login", "/login"));
    await waitForModuleGraphIdle(pendingModuleRequests);
    assertNoRuntimeErrors(pageErrors, hydrationErrors, moduleFailures, "login");

    await page.evaluate(({ locale }) => {
      localStorage.setItem("romeo:locale", locale);
      document.documentElement.style.zoom = "200%";
    }, engineProfiles[name]);
    await page.reload({ waitUntil: "domcontentloaded" });
    result.routes.push(
      await auditRoute(
        page,
        `login-${engineProfiles[name].locale}-zoom-200`,
        "/login",
      ),
    );
    await context.close();

    const mobileContext = await browser.newContext({
      colorScheme: engineProfiles[name].colorScheme,
      hasTouch: true,
      locale: engineProfiles[name].locale,
      reducedMotion: "reduce",
      viewport: { height: 844, width: 390 },
    });
    await mobileContext.addInitScript(({ colorScheme, locale }) => {
      localStorage.setItem("theme", colorScheme);
      localStorage.setItem("romeo:locale", locale);
    }, engineProfiles[name]);
    const mobilePage = await mobileContext.newPage();
    mobilePage.setDefaultTimeout(10_000);
    await mobilePage.goto(`${baseUrl}/login`, {
      waitUntil: "domcontentloaded",
    });
    result.routes.push(await auditRoute(mobilePage, "login-mobile", "/login"));
    const email = mobilePage.locator('input[name="email"]');
    assert(
      !(await email.evaluate((node) => node === document.activeElement)),
      "mobile login must not summon the keyboard with autofocus",
    );
    await mobilePage.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await mobilePage.locator("#prompt").waitFor();
    result.routes.push(await auditRoute(mobilePage, "chat-mobile", "/"));
    await mobileContext.close();
    result.status = "passed";
    result.completedAt = new Date().toISOString();
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

  const modelSelector = page.locator(".rm-composer-model-select");
  await modelSelector.click();
  const modelListbox = page.getByRole("listbox");
  await modelListbox.waitFor();
  await modelListbox.getByRole("option").first().waitFor();
  assert(
    (await modelListbox.getByRole("option").count()) > 0,
    "model selector has no agent options",
  );
  await modelSelector.click();
  await modelListbox.waitFor({ state: "hidden" });
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

function assertNoRuntimeErrors(
  pageErrors,
  hydrationErrors,
  moduleFailures,
  route,
) {
  assert(
    pageErrors.length === 0 &&
      hydrationErrors.length === 0 &&
      moduleFailures.length === 0,
    `${route} runtime errors: ${[
      ...pageErrors,
      ...hydrationErrors,
      ...moduleFailures,
    ].join(" | ")}`,
  );
  pageErrors.length = 0;
  hydrationErrors.length = 0;
  moduleFailures.length = 0;
}

async function waitForModuleGraphIdle(pendingRequests, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let idleSince;
  while (Date.now() < deadline) {
    if (pendingRequests.size === 0) {
      idleSince ??= Date.now();
      if (Date.now() - idleSince >= 100) return;
    } else {
      idleSince = undefined;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  const paths = [...pendingRequests]
    .slice(0, 10)
    .map((request) => new URL(request.url()).pathname)
    .join(", ");
  throw new Error(`module graph did not become idle: ${paths}`);
}

function sanitizeFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s)]+/giu, "[url]")
    .replace(/[\r\n]+/gu, " ")
    .slice(0, 3_000);
}
