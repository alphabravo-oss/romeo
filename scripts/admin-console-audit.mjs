import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.ROMEO_BASE_URL ?? "http://127.0.0.1:3000";
const evidencePath = resolve(root, "dist/ci/admin-console-audit.json");
const axeSource = await readFile(
  resolve(root, "apps/app/node_modules/axe-core/axe.min.js"),
  "utf8",
);

const sections = [
  ["overview", "Overview"],
  ["usage", "Usage & quotas"],
  ["analytics", "Analytics"],
  ["audit", "Audit log"],
  ["posture", "System posture"],
  ["providers", "Providers"],
  ["connections", "Connections"],
  ["governance", "Governance"],
  ["rag", "RAG governance"],
  ["abuse", "Abuse & security"],
  ["billing", "Billing"],
  ["prompt-templates", "Prompt templates"],
  ["web-search", "Web search"],
  ["access", "Access & keys"],
  ["users", "Users"],
  ["groups", "Groups"],
  ["organizations", "Organizations"],
  ["impersonation", "Impersonation"],
  ["auth-providers", "Authentication"],
  ["workflows", "Workflows"],
  ["webhooks", "Webhooks"],
  ["notification-channels", "Notifications"],
  ["connected-apps", "Connected apps"],
];

const viewports = [
  { name: "desktop", width: 1440, height: 1000, runAxe: true },
  { name: "mobile", width: 390, height: 844, runAxe: false },
];

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      colorScheme: "dark",
      reducedMotion: "reduce",
      viewport,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);

    let routeConsoleErrors = [];
    let routePageErrors = [];
    let routeResponseFailures = [];
    page.on("console", (message) => {
      if (message.type() === "error") routeConsoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => routePageErrors.push(error.message));
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (
        url.origin === new URL(baseUrl).origin &&
        response.status() >= 400 &&
        !url.pathname.endsWith("/favicon.ico")
      ) {
        routeResponseFailures.push({
          method: response.request().method(),
          path: url.pathname,
          status: response.status(),
        });
      }
    });

    for (const [section, title] of sections) {
      routeConsoleErrors = [];
      routePageErrors = [];
      routeResponseFailures = [];
      const startedAt = performance.now();
      const path = `/admin?section=${encodeURIComponent(section)}`;
      const result = {
        section,
        title,
        viewport: viewport.name,
        status: "failed",
        path,
      };

      try {
        await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
        await page
          .locator("#console-content h2")
          .filter({ hasText: title })
          .first()
          .waitFor();
        await page
          .locator(".rm-empty")
          .filter({ hasText: /Loading(?: section)?/u })
          .waitFor({ state: "hidden" })
          .catch(() => {});

        const ui = await inspectUi(page, section, title, sections.length);
        const axeViolations = viewport.runAxe
          ? await inspectAccessibility(page)
          : [];
        const failures = [
          ...ui.failures,
          ...axeViolations.map(
            (violation) =>
              `axe:${violation.id} (${violation.nodes.length} node(s))`,
          ),
          ...routeConsoleErrors.map((error) => `console:${sanitize(error)}`),
          ...routePageErrors.map((error) => `page:${sanitize(error)}`),
          ...routeResponseFailures.map(
            (failure) =>
              `response:${failure.method} ${failure.path} ${failure.status}`,
          ),
        ];

        Object.assign(result, {
          durationMs: Math.round(performance.now() - startedAt),
          metrics: ui.metrics,
          axeViolations,
          responseFailures: routeResponseFailures,
          failures,
          status: failures.length === 0 ? "passed" : "failed",
        });
      } catch (error) {
        result.durationMs = Math.round(performance.now() - startedAt);
        result.failures = [sanitize(error)];
      }

      results.push(result);
    }

    await context.close();
  }
} finally {
  await browser.close();
}

const evidence = {
  schemaVersion: "romeo.admin-console-audit.v1",
  generatedAt: new Date().toISOString(),
  baseUrl: new URL(baseUrl).origin,
  sectionCount: sections.length,
  viewports: viewports.map(({ name, width, height }) => ({
    name,
    width,
    height,
  })),
  results,
  status: results.every((result) => result.status === "passed")
    ? "passed"
    : "failed",
};

await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

const failed = results.filter((result) => result.status !== "passed");
if (failed.length > 0) {
  throw new Error(
    `Admin console audit failed for ${failed.length}/${results.length} route/viewport checks: ${failed
      .map(
        (result) =>
          `${result.section}/${result.viewport}: ${result.failures.join(", ")}`,
      )
      .join("; ")}`,
  );
}

console.log(
  `Romeo admin console audit passed for ${sections.length} sections across ${viewports.length} viewports.`,
);
console.log(`Wrote metadata-only evidence to ${evidencePath}`);

async function inspectAccessibility(page) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const report = await window.axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
    return report.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.slice(0, 5).map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    }));
  });
}

async function inspectUi(
  page,
  expectedSection,
  expectedTitle,
  expectedNavigationItems,
) {
  return page.evaluate(
    ({ expectedNavigationItems, expectedSection, expectedTitle }) => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      };
      const failures = [];
      const bodyText = document.body.innerText;
      const heading = document.querySelector("#console-content h2");
      const description = heading?.nextElementSibling;
      const navItems = [
        ...document.querySelectorAll(".rm-console-item"),
      ].filter(visible);
      const allNavItems = [...document.querySelectorAll(".rm-console-item")];
      const activeNavItems = allNavItems.filter((item) =>
        item.classList.contains("active"),
      );
      const tables = [...document.querySelectorAll("table")].filter(visible);
      const tableRows = tables.reduce(
        (total, table) => total + table.querySelectorAll("tbody tr").length,
        0,
      );
      const statValues = [...document.querySelectorAll(".rm-stat-value")]
        .filter(visible)
        .map((stat) => Number(stat.textContent?.replace(/[^\d.-]/gu, "")));
      const visibleButtons = [...document.querySelectorAll("button")].filter(
        visible,
      );
      const visibleFormControls = [
        ...document.querySelectorAll("input, select, textarea"),
      ].filter(
        (control) =>
          visible(control) &&
          control.getAttribute("type") !== "hidden" &&
          control.getAttribute("type") !== "file",
      );
      const duplicateIds = [...document.querySelectorAll("[id]")]
        .map((element) => element.id)
        .filter((id, index, ids) => id.length > 0 && ids.indexOf(id) !== index);
      const nonFrameworkButtons = visibleButtons.filter(
        (button) =>
          ![
            "rm-ui-button",
            "rm-ui-checkbox",
            "rm-ui-control",
            "rm-ui-menu__item",
            "rm-ui-switch",
            "rm-ui-tabs__trigger",
          ].some((className) => button.classList.contains(className)),
      );
      const nonFrameworkControls = visibleFormControls.filter(
        (control) =>
          ![
            "rm-ui-checkbox",
            "rm-ui-control",
            "rm-ui-native-toggle",
            "rm-ui-switch",
          ].some((className) => control.classList.contains(className)),
      );
      const invalidTables = tables.filter((table) => {
        if (
          !table.closest(".rm-table-wrap") &&
          !table.closest(".rm-ui-table-wrap")
        ) {
          return true;
        }
        const headerCount = table.querySelectorAll("thead th").length;
        return [...table.querySelectorAll("tbody tr")].some((row) => {
          const cells = row.querySelectorAll("td");
          return (
            cells.length > 0 &&
            ![...cells].some((cell) => cell.hasAttribute("colspan")) &&
            cells.length !== headerCount
          );
        });
      });
      const tablesEscapingContainers = tables.filter((table) => {
        const container =
          table.closest(".rm-table-wrap") ?? table.closest(".rm-ui-table-wrap");
        return (
          container !== null &&
          container.getBoundingClientRect().right >
            document.documentElement.clientWidth + 1
        );
      });
      const imagesWithoutDimensions = [...document.querySelectorAll("img")]
        .filter(visible)
        .filter(
          (image) =>
            !image.hasAttribute("width") || !image.hasAttribute("height"),
        );

      if (heading?.textContent?.trim() !== expectedTitle)
        failures.push("page heading does not match route metadata");
      if (!description?.textContent?.trim())
        failures.push("page description is missing");
      if (document.querySelector("#console-content") === null)
        failures.push("main console landmark is missing");
      if (
        document.querySelector('.rm-skip-link[href="#console-content"]') ===
        null
      )
        failures.push("console skip link is missing or incorrect");
      if (allNavItems.length !== expectedNavigationItems)
        failures.push(
          `navigation has ${allNavItems.length}/${expectedNavigationItems} items`,
        );
      if (activeNavItems.length !== 1)
        failures.push(`navigation has ${activeNavItems.length} active items`);
      if (allNavItems.some((item) => item.tagName !== "A"))
        failures.push("console navigation actions are not semantic links");
      if (
        navItems.some(
          (item) =>
            getComputedStyle(item).justifyContent !== "flex-start" ||
            getComputedStyle(item).textAlign !== "left",
        )
      )
        failures.push("visible console navigation is not left-aligned");
      if (
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
      )
        failures.push("page content overflows the viewport horizontally");
      if (duplicateIds.length > 0)
        failures.push(
          `duplicate ids: ${[...new Set(duplicateIds)].join(", ")}`,
        );
      if (nonFrameworkButtons.length > 0)
        failures.push(
          `non-framework buttons: ${nonFrameworkButtons
            .slice(0, 5)
            .map(
              (button) =>
                button.getAttribute("aria-label") ??
                button.textContent?.trim() ??
                button.className,
            )
            .join(", ")}`,
        );
      if (nonFrameworkControls.length > 0)
        failures.push(
          `non-framework controls: ${nonFrameworkControls
            .slice(0, 5)
            .map(
              (control) =>
                control.getAttribute("aria-label") ??
                control.getAttribute("name") ??
                control.tagName,
            )
            .join(", ")}`,
        );
      if (invalidTables.length > 0)
        failures.push(`${invalidTables.length} malformed/uncontained table(s)`);
      if (tablesEscapingContainers.length > 0)
        failures.push(
          `${tablesEscapingContainers.length} table container(s) escape the viewport`,
        );
      if (imagesWithoutDimensions.length > 0)
        failures.push(
          `${imagesWithoutDimensions.length} visible image(s) lack dimensions`,
        );
      if (
        /\b(?:undefined|NaN|Invalid Date|\[object Object\])\b/u.test(bodyText)
      )
        failures.push("rendered output contains an invalid data token");
      if (
        [...document.querySelectorAll(".rm-composer-error, [role=alert]")]
          .filter(visible)
          .some((element) => element.textContent?.trim())
      )
        failures.push("page rendered a visible application error");
      if (
        expectedSection === "audit" &&
        (() => {
          const auditData = document.querySelector("[data-audit-event-count]");
          const eventCount = Number(auditData?.dataset.auditEventCount);
          const failureCount = Number(auditData?.dataset.auditFailureCount);
          const accessibleRowCount =
            Number(tables[0]?.getAttribute("aria-rowcount")) - 1;
          return (
            statValues.length < 2 ||
            !Number.isFinite(eventCount) ||
            !Number.isFinite(failureCount) ||
            statValues[0] !== eventCount ||
            statValues[1] !== failureCount ||
            accessibleRowCount !== eventCount
          );
        })()
      )
        failures.push("audit summary does not match the rendered event data");
      if (expectedSection === "overview") {
        const readinessPanel = [...document.querySelectorAll(".rm-panel")].find(
          (panel) =>
            panel.querySelector(".rm-card-title")?.textContent?.trim() ===
            "Readiness",
        );
        const readinessCounts = [
          ...(readinessPanel?.querySelectorAll(".rm-stat-value") ?? []),
        ].map((stat) => Number(stat.textContent?.replace(/[^\d.-]/gu, "")));
        const readinessRows =
          readinessPanel?.querySelectorAll("tbody tr").length ?? 0;
        if (
          readinessCounts.length !== 3 ||
          readinessCounts.some((count) => !Number.isFinite(count)) ||
          readinessCounts.reduce((total, count) => total + count, 0) !==
            readinessRows
        )
          failures.push(
            "readiness status breakdown does not match the rendered checks",
          );
      }

      return {
        failures,
        metrics: {
          buttons: visibleButtons.length,
          emptyStates: [...document.querySelectorAll(".rm-empty")].filter(
            visible,
          ).length,
          formControls: visibleFormControls.length,
          frameworkButtons: visibleButtons.length - nonFrameworkButtons.length,
          frameworkControls:
            visibleFormControls.length - nonFrameworkControls.length,
          tableRows,
          tables: tables.length,
        },
      };
    },
    { expectedNavigationItems, expectedSection, expectedTitle },
  );
}

function sanitize(value) {
  return String(value)
    .replace(/https?:\/\/[^\s)]+/giu, "[url]")
    .replace(/[\r\n]+/gu, " ")
    .slice(0, 1_000);
}
