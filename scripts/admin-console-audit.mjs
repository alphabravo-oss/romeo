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
  ["providers", "AI models"],
  ["chat-experience", "Chat experience"],
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

const routes = [
  ...sections,
  ["usage", "Usage & quotas", "quotas"],
  ["providers", "AI models", "models"],
  ["providers", "AI models", "observability"],
  ["connections", "Connections", "imports"],
  ["connections", "Connections", "catalog"],
  ["connections", "Connections", "tools"],
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

    for (const [section, title, view] of routes) {
      console.log(
        `[admin-console-audit] ${viewport.name} ${section}${view === undefined ? "" : `/${view}`}`,
      );
      routeConsoleErrors = [];
      routePageErrors = [];
      routeResponseFailures = [];
      const startedAt = performance.now();
      const path = `/admin?section=${encodeURIComponent(section)}${
        view === undefined ? "" : `&view=${encodeURIComponent(view)}`
      }`;
      const result = {
        section,
        title,
        ...(view === undefined ? {} : { view }),
        viewport: viewport.name,
        status: "failed",
        path,
      };

      try {
        // Romeo keeps an authenticated EventSource open for live chat-list
        // updates, so a healthy page intentionally never becomes network-idle.
        // The heading and loading-state waits below are the deterministic
        // readiness signals for this SPA.
        await page.goto(`${baseUrl}${path}`, {
          waitUntil: "domcontentloaded",
        });
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
        const tabStates = await inspectTabStates(
          page,
          section,
          title,
          sections.length,
        );
        const axeViolations = viewport.runAxe
          ? await inspectAccessibility(page)
          : [];
        const tablePreferenceFailures =
          viewport.name === "desktop" &&
          section === "users" &&
          view === undefined
            ? await inspectTablePreferencePersistence(page, path, title)
            : [];
        const failures = [
          ...ui.failures,
          ...tablePreferenceFailures,
          ...tabStates.flatMap((tabState) =>
            tabState.failures.map(
              (failure) => `tab:${tabState.label}:${failure}`,
            ),
          ),
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
          tabStates,
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
  routeCount: routes.length,
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
  `Romeo admin console audit passed for ${routes.length} routes across ${viewports.length} viewports.`,
);
console.log(`Wrote metadata-only evidence to ${evidencePath}`);

async function inspectTablePreferencePersistence(page, path, title) {
  const table = page.locator(".rm-table-block").first();
  if ((await table.count()) === 0) {
    return ["table preference audit could not find a framework table"];
  }
  const serverPaginated =
    (await table.getAttribute("data-server-paginated")) === "true";
  await table.getByRole("button", { name: "Table options" }).click();
  await page.getByRole("button", { name: "Compact" }).click();
  if (!serverPaginated) {
    await page.getByLabel("Rows per page").selectOption("10");
  }
  await page.goto(`${baseUrl}/admin?section=overview`, {
    waitUntil: "domcontentloaded",
  });
  await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  await page
    .locator("#console-content h2")
    .filter({ hasText: title })
    .first()
    .waitFor();
  const restored = await page
    .locator(".rm-table-block")
    .first()
    .evaluate(
      (block, isServerPaginated) =>
        (isServerPaginated || block.dataset.pageSize === "10") &&
        block.querySelector(".rm-table-wrap")?.classList.contains("compact"),
      serverPaginated,
    );
  await page
    .locator(".rm-table-block")
    .first()
    .getByRole("button", { name: "Table options" })
    .click();
  await page.getByRole("button", { name: "Reset table view" }).click();
  return restored ? [] : ["table preferences did not survive navigation"];
}

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

async function inspectTabStates(
  page,
  expectedSection,
  expectedTitle,
  expectedNavigationItems,
) {
  const tabs = page.locator('button[role="tab"]:visible');
  const count = await tabs.count();
  const states = [];
  for (let index = 0; index < count; index += 1) {
    const tab = tabs.nth(index);
    const label = (await tab.innerText()).trim() || `tab-${index + 1}`;
    await tab.click();
    await page
      .locator(".rm-empty")
      .filter({ hasText: /Loading(?: section)?/u })
      .waitFor({ state: "hidden" })
      .catch(() => {});
    const ui = await inspectUi(
      page,
      expectedSection,
      expectedTitle,
      expectedNavigationItems,
    );
    states.push({ label, failures: ui.failures, metrics: ui.metrics });
  }
  return states;
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
          control.getAttribute("aria-hidden") !== "true" &&
          control.getAttribute("type") !== "hidden" &&
          control.getAttribute("type") !== "file",
      );
      const duplicateIds = [...document.querySelectorAll("[id]")]
        .map((element) => element.id)
        .filter((id, index, ids) => id.length > 0 && ids.indexOf(id) !== index);
      // --- Admin remediation guardrails (see docs/superpowers/plans/
      // 2026-07-29-admin-console-remediation.md, Phase 0) ---
      // A page has one job. More than one primary action means the admin has
      // to guess which one they came here for.
      const primaryButtons = visibleButtons.filter((button) =>
        button.classList.contains("rm-ui-button--primary"),
      );
      // Internal identifiers must never reach an admin's screen. Matches
      // snake_case tokens of 2+ segments and colon-suffixed error codes.
      // `translate="no"` marks intentional proper nouns (provider slugs).
      const identifierPattern =
        /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}(?::[a-z0-9_-]+)?\b/gu;
      const identifierAllowlist = new Set([
        "romeo_local",
        "org_default",
        "agent_default",
        "group_admins",
      ]);
      const leakedIdentifiers = [
        ...document.querySelectorAll("#console-content *"),
      ]
        .filter(
          (element) =>
            visible(element) &&
            element.children.length === 0 &&
            element.closest('[translate="no"]') === null &&
            element.closest("code") === null &&
            element.closest("pre") === null &&
            element.closest("input") === null,
        )
        .flatMap((element) => [
          ...(element.textContent ?? "").matchAll(identifierPattern),
        ])
        .map((match) => match[0])
        .filter((token) => !identifierAllowlist.has(token));
      // A danger-styled control must either open a confirmation or live in an
      // explicit danger zone. A bare danger button wired straight to a
      // mutation is an accidental-destruction risk.
      const dangerButtons = visibleButtons.filter((button) =>
        button.classList.contains("rm-ui-button--danger"),
      );
      const unguardedDangerButtons = dangerButtons.filter(
        (button) =>
          button.closest(".rm-danger-zone") === null &&
          button.getAttribute("aria-haspopup") !== "dialog" &&
          button.dataset.confirms !== "true",
      );
      // An empty state is an invitation to act, not a dead end. The
      // EmptyState primitive is already in use everywhere, but a title alone
      // ("No connectors yet.") tells the admin nothing about what a connector
      // is or how to get one. Require an icon and an explanatory description;
      // the action slot is optional because some lists (impersonation
      // requests) are populated by users, not admins.
      const incompleteEmptyStates = [
        ...document.querySelectorAll(".rm-ui-empty"),
      ]
        .filter(visible)
        .filter(
          (element) =>
            element.querySelector(".rm-ui-empty__icon") === null ||
            element.querySelector(".rm-ui-empty__description") === null,
        );
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
      const tableBlocks = [
        ...document.querySelectorAll(".rm-table-block"),
      ].filter(visible);
      const tableCapabilityFailures = tableBlocks.flatMap((block, index) => {
        const rowCount = Number(block.dataset.rowCount);
        const pageSize = Number(block.dataset.pageSize);
        const virtualized = block.dataset.virtualized === "true";
        const serverPaginated = block.dataset.serverPaginated === "true";
        const blockFailures = [];
        if (
          Number.isFinite(rowCount) &&
          rowCount > 1 &&
          block.querySelector(".rm-th-sortable") === null
        )
          blockFailures.push("sorting");
        if (
          Number.isFinite(rowCount) &&
          rowCount > 8 &&
          block.querySelector(".rm-table-search") === null &&
          block.closest("section")?.querySelector(".rm-model-search") === null
        )
          blockFailures.push("search");
        if (
          Number.isFinite(rowCount) &&
          rowCount > 8 &&
          block.querySelector(".rm-table-view") === null
        )
          blockFailures.push("column/density controls");
        if (
          Number.isFinite(rowCount) &&
          Number.isFinite(pageSize) &&
          rowCount > pageSize &&
          !virtualized &&
          !serverPaginated &&
          block.querySelector(".rm-table-pager") === null
        )
          blockFailures.push("pagination");
        return blockFailures.map(
          (capability) => `table ${index + 1} missing ${capability}`,
        );
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
      const overflowingStatValues = [
        ...document.querySelectorAll(".rm-stat-value"),
      ]
        .filter(visible)
        .filter((value) => {
          const card = value.closest(".rm-stat");
          if (card === null) return false;
          const cardStyle = getComputedStyle(card);
          const contentRight =
            card.getBoundingClientRect().right -
            Number.parseFloat(cardStyle.paddingRight);
          return (
            value.scrollWidth > value.clientWidth + 1 ||
            [...value.children].some(
              (child) => child.getBoundingClientRect().right > contentRight + 1,
            )
          );
        });
      const overflowingCardText = [
        ...document.querySelectorAll(
          ".rm-card-title, .rm-card p, .rm-card li, .rm-card dd, .rm-panel dd, .rm-status",
        ),
      ]
        .filter(visible)
        .filter((element) => {
          if (element.scrollWidth <= element.clientWidth + 1) return false;
          const style = getComputedStyle(element);
          return (
            style.textOverflow !== "ellipsis" &&
            !["auto", "scroll"].includes(style.overflowX)
          );
        });
      const partialPanelHeaderDividers = [
        ...document.querySelectorAll(".rm-panel"),
      ]
        .filter(visible)
        .filter((panel) => {
          const first = panel.firstElementChild;
          if (first === null) return false;
          if (first.matches(".rm-ui-tabs")) {
            const tabList = first.querySelector(":scope > .rm-ui-tabs__list");
            return (
              tabList === null ||
              Number.parseFloat(getComputedStyle(tabList).borderBottomWidth) <
                1 ||
              tabList.getBoundingClientRect().width <
                first.getBoundingClientRect().width - 2
            );
          }
          const title = first.matches(".rm-card-title")
            ? first
            : (first.querySelector(":scope > .rm-card-title") ??
              first.querySelector(":scope > div > .rm-card-title"));
          if (title === null) return false;
          const panelStyle = getComputedStyle(panel);
          const contentWidth =
            panel.clientWidth -
            Number.parseFloat(panelStyle.paddingLeft) -
            Number.parseFloat(panelStyle.paddingRight);
          const divider = [first, title].find(
            (element) =>
              Number.parseFloat(getComputedStyle(element).borderBottomWidth) >=
              1,
          );
          return (
            divider === undefined ||
            divider.getBoundingClientRect().width < contentWidth - 2
          );
        });

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
      failures.push(...tableCapabilityFailures);
      if (tablesEscapingContainers.length > 0)
        failures.push(
          `${tablesEscapingContainers.length} table container(s) escape the viewport`,
        );
      if (imagesWithoutDimensions.length > 0)
        failures.push(
          `${imagesWithoutDimensions.length} visible image(s) lack dimensions`,
        );
      if (overflowingStatValues.length > 0)
        failures.push(
          `stat values overflow cards: ${overflowingStatValues
            .slice(0, 5)
            .map((value) => value.textContent?.trim())
            .join(", ")}`,
        );
      if (overflowingCardText.length > 0)
        failures.push(
          `card text overflows: ${overflowingCardText
            .slice(0, 5)
            .map((value) => value.textContent?.trim())
            .join(", ")}`,
        );
      if (partialPanelHeaderDividers.length > 0)
        failures.push(
          `${partialPanelHeaderDividers.length} panel header divider(s) are not full width`,
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
      if (primaryButtons.length > 1)
        failures.push(
          `page has ${primaryButtons.length} primary actions (expected at most 1): ${primaryButtons
            .map((button) => button.innerText.trim().replace(/\s+/gu, " "))
            .join(" | ")}`,
        );
      if (leakedIdentifiers.length > 0)
        failures.push(
          `page exposes internal identifier: ${[...new Set(leakedIdentifiers)].join(", ")}`,
        );
      if (unguardedDangerButtons.length > 0)
        failures.push(
          `unguarded destructive action(s): ${unguardedDangerButtons
            .map((button) => button.innerText.trim().replace(/\s+/gu, " "))
            .join(" | ")}`,
        );
      if (incompleteEmptyStates.length > 0)
        failures.push(
          `empty state missing icon or description: ${incompleteEmptyStates
            .map((element) =>
              (
                element.querySelector(".rm-ui-empty__title")?.textContent ?? ""
              ).trim(),
            )
            .join(" | ")}`,
        );
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
      const locationView = new URLSearchParams(location.search).get("view");
      if (
        (expectedSection === "analytics" ||
          expectedSection === "audit" ||
          (expectedSection === "usage" && locationView !== "quotas")) &&
        !visibleButtons.some((button) =>
          /\bexport\b/iu.test(button.textContent ?? ""),
        )
      )
        failures.push("export-capable dataset is missing its export action");
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
          incompleteEmptyStates: incompleteEmptyStates.length,
          emptyStates: [...document.querySelectorAll(".rm-empty")].filter(
            visible,
          ).length,
          leakedIdentifiers: new Set(leakedIdentifiers).size,
          primaryActions: primaryButtons.length,
          unguardedDangerActions: unguardedDangerButtons.length,
          formControls: visibleFormControls.length,
          frameworkButtons: visibleButtons.length - nonFrameworkButtons.length,
          frameworkControls:
            visibleFormControls.length - nonFrameworkControls.length,
          overflowingCardText: overflowingCardText.length,
          overflowingStatValues: overflowingStatValues.length,
          partialPanelHeaderDividers: partialPanelHeaderDividers.length,
          tableRows,
          tableCapabilityFailures: tableCapabilityFailures.length,
          tableFrameworkBlocks: tableBlocks.length,
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
