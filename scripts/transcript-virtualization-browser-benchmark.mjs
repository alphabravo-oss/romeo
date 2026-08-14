import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { chromium, firefox, webkit } from "playwright";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.ROMEO_TRANSCRIPT_BENCHMARK_PORT ?? "12117");
const baseUrl = `http://127.0.0.1:${port}`;
const fixtureUrl = `${baseUrl}/benchmarks/transcript-virtualization.html`;
const evidencePath = resolve(
  root,
  "dist/ci/transcript-virtualization-browser-benchmark.json",
);
const axeSource = await readFile(
  resolve(root, "apps/app/node_modules/axe-core/axe.min.js"),
  "utf8",
);
const allEngines = [
  {
    launchOptions: {
      args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
      headless: true,
    },
    name: "chromium",
    type: chromium,
  },
  { launchOptions: { headless: true }, name: "firefox", type: firefox },
  { launchOptions: { headless: true }, name: "webkit", type: webkit },
];
const allViewports = [
  {
    context: { viewport: { height: 900, width: 1_280 } },
    name: "desktop",
    shortcut: { ctrlKey: true, key: "f" },
  },
  {
    context: {
      deviceScaleFactor: 2,
      hasTouch: true,
      viewport: { height: 844, width: 390 },
    },
    name: "mobile-viewport",
    shortcut: { key: "f", metaKey: true },
  },
];
const engines = selectCases(
  allEngines,
  process.env.ROMEO_TRANSCRIPT_BENCHMARK_ENGINES,
);
const viewports = selectCases(
  allViewports,
  process.env.ROMEO_TRANSCRIPT_BENCHMARK_VIEWPORTS,
);
const server = spawn(
  "corepack",
  [
    "pnpm",
    "--filter",
    "@romeo/app",
    "exec",
    "vite",
    "--config",
    "benchmark.vite.config.ts",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { cwd: root, stdio: ["ignore", "inherit", "inherit"] },
);

try {
  await waitForUrl(fixtureUrl, 30_000);
  const results = [];
  for (const engine of engines) {
    let browser;
    try {
      browser = await engine.type.launch(engine.launchOptions);
      for (const viewport of viewports) {
        try {
          results.push(
            await runCase({
              browser,
              browserName: engine.name,
              browserVersion: browser.version(),
              viewport,
            }),
          );
        } catch (error) {
          results.push({
            browser: { engine: engine.name, version: browser.version() },
            failures: [publicError(error)],
            status: "failed",
            viewport: viewport.name,
          });
        }
      }
    } catch (error) {
      for (const viewport of viewports) {
        results.push({
          browser: { engine: engine.name, version: "unavailable" },
          failures: [publicError(error)],
          status: "failed",
          viewport: viewport.name,
        });
      }
    } finally {
      await browser?.close();
    }
  }

  const failedCases = results.filter((result) => result.status === "failed");
  const evidence = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    status: failedCases.length === 0 ? "passed" : "failed",
    workload: {
      initialMessages: 1_200,
      prependedMessages: 100,
      scrollSteps: 30,
      variableRows: ["prose", "code", "table", "artifact"],
      reducedMotion: true,
    },
    cases: results,
    residuals: [
      "Manual NVDA, JAWS, and VoiceOver sessions are external release evidence.",
      "Mobile cases are browser viewport/touch emulation, not physical-device momentum-scroll certification.",
    ],
  };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    JSON.stringify(
      results.map(({ browser, measurements, status, viewport }) => ({
        browser,
        measurements,
        status,
        viewport,
      })),
      null,
      2,
    ),
  );
  console.log(`Wrote ${evidencePath}`);
  if (failedCases.length > 0) {
    throw new Error(
      failedCases
        .map(
          (result) =>
            `${result.browser.engine}/${result.viewport}: ${result.failures.join(" | ")}`,
        )
        .join("; "),
    );
  }
} finally {
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => server.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function runCase({ browser, browserName, browserVersion, viewport }) {
  const context = await browser.newContext({
    ...viewport.context,
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    const runtimeErrors = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    await page.goto(fixtureUrl, { waitUntil: "networkidle" });
    await page.addScriptTag({ content: axeSource });
    await page.waitForFunction(
      () =>
        window.transcriptBenchmark?.metrics.virtualized &&
        document.querySelectorAll(".rm-message-window-row").length > 0,
    );
    await page.evaluate(() => globalThis.gc?.());
    const baseline = await readMetrics(page);
    const windowedA11yViolations = await auditTranscript(page);
    const reducedMotionMatches = await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    );

    await page.evaluate(async () => {
      const viewport = document.querySelector(".benchmark-viewport");
      if (!(viewport instanceof HTMLElement))
        throw new Error("missing viewport");
      for (let step = 1; step <= 30; step++) {
        viewport.scrollTop = (viewport.scrollHeight * step) / 31;
        await new Promise((resolveFrame) =>
          requestAnimationFrame(resolveFrame),
        );
      }
    });
    await page.waitForTimeout(250);
    const anchorBefore = await firstVisibleAnchor(page);
    await page.evaluate(() => window.transcriptBenchmark.prepend());
    await page.waitForFunction(
      () =>
        document
          .querySelector(".rm-message-list")
          ?.getAttribute("data-message-count") === "1300",
    );
    // Sample after the bounded layout pass and delayed browser-measurement
    // verification used by touch/mobile Chromium.
    await page.waitForTimeout(600);
    const anchorAfter = await messageOffset(page, anchorBefore.id);

    const deepLinkId = "benchmark_1100";
    await page.evaluate((id) => {
      location.hash = `message-${encodeURIComponent(id)}`;
    }, deepLinkId);
    await page.waitForFunction(
      (id) =>
        document.activeElement?.id === `message-${encodeURIComponent(id)}`,
      deepLinkId,
    );
    const deepLinkMounted = await page
      .locator(`#message-${deepLinkId}`)
      .count();
    await page.evaluate(() => {
      const viewport = document.querySelector(".benchmark-viewport");
      if (viewport instanceof HTMLElement) viewport.scrollTop = 0;
    });
    await page.waitForTimeout(150);
    const focusedRowRetained = await page
      .locator(`#message-${deepLinkId}`)
      .count();
    const focusedRowHeavyWorkSuspended = await page
      .locator(`#message-${deepLinkId} [data-heavy-active="false"]`)
      .count();

    await page.evaluate(() => globalThis.gc?.());
    const windowed = await readMetrics(page);
    const longTasksBeforeAccessibleMode = [...windowed.longTasks];

    await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".benchmark-message")];
      const first = rows[0]?.querySelector("p")?.firstChild;
      const last = rows.at(-1)?.querySelector("p")?.firstChild;
      if (first == null || last == null)
        throw new Error("missing selection rows");
      const range = document.createRange();
      range.setStart(first, 0);
      range.setEnd(last, last.textContent?.length ?? 0);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.waitForFunction(
      () => document.querySelectorAll(".benchmark-message").length === 1_300,
    );
    const selectionAccessibleRows = await page
      .locator(".benchmark-message")
      .count();
    await page.getByRole("button", { name: "Use window" }).click();
    await waitForWindow(page);

    await page.locator(".rm-message-list").dispatchEvent("keydown", {
      bubbles: true,
      ...viewport.shortcut,
    });
    await page.waitForFunction(
      () => document.querySelectorAll(".benchmark-message").length === 1_300,
    );
    const accessibleRows = await page.locator(".benchmark-message").count();
    const accessibleA11yViolations = await auditTranscript(page);
    await page.getByRole("button", { name: "Use window" }).click();
    await waitForWindow(page);

    const memoryAvailable = baseline.usedJsHeapBytes > 0;
    const memoryDeltaBytes = memoryAvailable
      ? Math.max(0, windowed.usedJsHeapBytes - baseline.usedJsHeapBytes)
      : undefined;
    const anchorDriftPx = Math.abs(anchorAfter - anchorBefore.offset);
    const failures = [];
    assertBudget(
      baseline.mountedRows > 0 && baseline.mountedRows <= 30,
      `initial mounted rows ${baseline.mountedRows} exceeds 30`,
      failures,
    );
    assertBudget(
      windowed.maxMountedRows <= 36,
      `maximum mounted rows ${windowed.maxMountedRows} exceeds 36`,
      failures,
    );
    assertBudget(
      anchorDriftPx <= 2,
      `prepend anchor drift ${anchorDriftPx.toFixed(2)}px exceeds 2px`,
      failures,
    );
    assertBudget(
      deepLinkMounted === 1,
      "deep-linked row was not mounted",
      failures,
    );
    assertBudget(
      focusedRowRetained === 1,
      "focused/deep-linked row was discarded after scrolling",
      failures,
    );
    assertBudget(
      focusedRowHeavyWorkSuspended === 1,
      "focused offscreen row retained expensive work",
      failures,
    );
    assertBudget(
      windowed.maxActiveHeavyRows <= 18,
      `active heavy rows ${windowed.maxActiveHeavyRows} exceeds 18`,
      failures,
    );
    assertBudget(
      windowed.heavyWorkSuspensions > 0,
      "heavy work was never suspended while scrolling",
      failures,
    );
    assertBudget(
      selectionAccessibleRows === 1_300,
      `multi-row selection rendered ${selectionAccessibleRows}/1300 rows`,
      failures,
    );
    assertBudget(
      accessibleRows === 1_300,
      `keyboard accessible mode rendered ${accessibleRows}/1300 rows`,
      failures,
    );
    if (windowed.supportsLongTasks) {
      assertBudget(
        longTasksBeforeAccessibleMode.filter((duration) => duration > 50)
          .length <= 1,
        "windowed interactions produced repeated >50ms long tasks",
        failures,
      );
    }
    if (memoryAvailable) {
      assertBudget(
        memoryDeltaBytes <= 32 * 1024 * 1024,
        `windowed heap grew by ${memoryDeltaBytes} bytes`,
        failures,
      );
    }
    assertBudget(
      windowed.renderedRows <= 900,
      `windowed interactions invoked ${windowed.renderedRows} row renders`,
      failures,
    );
    assertBudget(
      windowed.commitCount <= 60,
      `windowed interactions committed ${windowed.commitCount} times`,
      failures,
    );
    assertBudget(
      reducedMotionMatches,
      "reduced motion was not active",
      failures,
    );
    assertBudget(
      runtimeErrors.length === 0,
      runtimeErrors.join(" | "),
      failures,
    );
    assertBudget(
      windowedA11yViolations.length === 0,
      `windowed axe: ${windowedA11yViolations.join(", ")}`,
      failures,
    );
    assertBudget(
      accessibleA11yViolations.length === 0,
      `accessible axe: ${accessibleA11yViolations.join(", ")}`,
      failures,
    );

    return {
      status: failures.length === 0 ? "passed" : "failed",
      browser: { engine: browserName, version: browserVersion },
      viewport: viewport.name,
      emulation: {
        ...viewport.context,
        reducedMotion: "reduce",
        shortcut: viewport.shortcut.metaKey ? "Meta+F" : "Control+F",
      },
      budgetApplicability: {
        heap: memoryAvailable,
        longTasks: windowed.supportsLongTasks,
      },
      budgets: {
        initialMountedRowsMax: 30,
        maxMountedRows: 36,
        maxActiveHeavyRows: 18,
        prependAnchorDriftPxMax: 2,
        repeatedLongTasksOver50MsMax: windowed.supportsLongTasks ? 1 : null,
        windowedHeapGrowthBytesMax: memoryAvailable ? 32 * 1024 * 1024 : null,
        renderedRowCallsMax: 900,
        reactCommitCountMax: 60,
      },
      measurements: {
        initialMountedRows: baseline.mountedRows,
        maximumMountedRows: windowed.maxMountedRows,
        prependAnchorDriftPx: anchorDriftPx,
        anchorBefore,
        anchorAfter,
        prependSnapshot: windowed.prependSnapshot ?? null,
        prependSettled: windowed.prependSettled ?? null,
        deepLinkMounted,
        focusedRowRetained,
        focusedRowHeavyWorkSuspended,
        maximumActiveHeavyRows: windowed.maxActiveHeavyRows,
        heavyWorkStarts: windowed.heavyWorkStarts,
        heavyWorkSuspensions: windowed.heavyWorkSuspensions,
        selectionAccessibleRows,
        accessibleRows,
        reducedMotionMatches,
        windowedLongTaskDurationsMs: longTasksBeforeAccessibleMode,
        windowedHeapGrowthBytes: memoryDeltaBytes ?? null,
        reactCommitCount: windowed.commitCount,
        reactCommitDurationMs: windowed.commitDurationMs,
        renderedRowCalls: windowed.renderedRows,
        windowedA11yViolations,
        accessibleA11yViolations,
      },
      failures,
    };
  } finally {
    await context.close();
  }
}

async function waitForWindow(page) {
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".rm-message-window-row").length > 0 &&
      document.querySelectorAll(".rm-message-window-row").length < 40,
  );
}

async function readMetrics(page) {
  return page.evaluate(() => ({
    ...window.transcriptBenchmark.metrics,
    longTasks: [...window.transcriptBenchmark.metrics.longTasks],
    mountedRows: document.querySelectorAll(".rm-message-window-row").length,
    usedJsHeapBytes: performance.memory?.usedJSHeapSize ?? 0,
  }));
}

async function auditTranscript(page) {
  return page.evaluate(async () => {
    const result = await window.axe.run(
      document.querySelector(".benchmark-viewport"),
      {
        runOnly: {
          type: "rule",
          values: [
            "aria-allowed-attr",
            "aria-required-attr",
            "aria-roles",
            "aria-valid-attr",
            "duplicate-id",
            "heading-order",
          ],
        },
      },
    );
    return result.violations.map((violation) => violation.id);
  });
}

async function firstVisibleAnchor(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector(".benchmark-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("missing viewport");
    const viewportTop = viewport.getBoundingClientRect().top;
    const row = [...document.querySelectorAll("[data-message-id]")].find(
      (candidate) => candidate.getBoundingClientRect().bottom > viewportTop,
    );
    if (!(row instanceof HTMLElement)) throw new Error("missing anchor row");
    return {
      id: row.dataset.messageId,
      offset: row.getBoundingClientRect().top - viewportTop,
    };
  });
}

async function messageOffset(page, id) {
  return page.evaluate((messageId) => {
    const viewport = document.querySelector(".benchmark-viewport");
    const row = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!(viewport instanceof HTMLElement) || !(row instanceof HTMLElement)) {
      throw new Error(`anchor row ${messageId} was not retained`);
    }
    return (
      row.getBoundingClientRect().top - viewport.getBoundingClientRect().top
    );
  }, id);
}

function assertBudget(condition, failure, failures) {
  if (!condition) failures.push(failure);
}

function publicError(error) {
  return error instanceof Error ? error.message : "Unknown browser failure";
}

function selectCases(cases, configuredNames) {
  if (configuredNames === undefined) return cases;
  const names = new Set(configuredNames.split(","));
  return cases.filter(({ name }) => names.has(name));
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Benchmark server exited with ${server.exitCode}.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
