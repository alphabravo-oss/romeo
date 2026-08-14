/**
 * Console design-conformance audit.
 *
 * Measures rendered pages against the console design system and prints
 * machine-checkable deviations, so a review reports facts rather than
 * impressions. Run against a dev server:
 *
 *   node scripts/console-audit.mjs "/admin?section=users" "/workspace?section=tools"
 *
 * Env: BASE (default http://localhost:30000), THEME (dark|light), WIDTH.
 *
 * With --fail-on=kind[,kind] the process exits non-zero when those kinds are
 * found, so a class of defect can be gated in CI once it reaches zero:
 *
 *   node scripts/console-audit.mjs --fail-on=duplicate-title,clipped-descender "/admin" …
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:30000";
const THEME = process.env.THEME ?? "dark";
const WIDTH = Number(process.env.WIDTH ?? 1512);

// The design's allowed values. Anything outside these is a deviation.
const TYPE_SCALE = [10.5, 11, 11.5, 12, 12.5, 13, 14, 14.5, 15, 19, 20, 22];
const RADII = [0, 4, 6, 7, 8, 9, 10, 12, 999];
const CONTROL_HEIGHTS = [26, 28, 30, 32, 36, 38];
const LEGACY_CLASSES = [
  "rm-card-title",
  "rm-card-header",
  "rm-settings-section",
  "rm-console-page",
  "rm-console-toolbar",
  "rm-panel",
  "rm-managed-model-section",
  "rm-provider-zone",
  "rm-admin-disclosure",
];

const argv = process.argv.slice(2);
const failOnArg = argv.find((a) => a.startsWith("--fail-on="));
const failOn = failOnArg
  ? failOnArg.slice("--fail-on=".length).split(",").filter(Boolean)
  : [];
const routes = argv.filter((a) => !a.startsWith("--"));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  colorScheme: THEME,
  viewport: { width: WIDTH, height: 1000 },
});
const page = await context.newPage();
const runtimeErrors = [];
page.on("pageerror", (error) =>
  runtimeErrors.push(error.message.slice(0, 160)),
);
await page.addInitScript((theme) => {
  localStorage.setItem("theme", theme);
}, THEME);

const report = [];
for (const route of routes) {
  runtimeErrors.length = 0;
  try {
    await page.goto(`${BASE}${route}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2200);
  } catch (error) {
    report.push({ route, fatal: String(error).slice(0, 160) });
    continue;
  }
  const findings = await page.evaluate(
    ({ typeScale, radii, controlHeights, legacyClasses }) => {
      const out = [];
      const add = (kind, detail, sample) =>
        out.push({ kind, detail, sample: sample?.slice(0, 90) });
      const label = (el) => {
        const cls = typeof el.className === "string" ? el.className.trim() : "";
        return `${el.tagName.toLowerCase()}${cls ? "." + cls.split(/\s+/).slice(0, 3).join(".") : ""}`;
      };

      const inner = document.querySelector(".rm-console-inner");
      if (!inner) return [{ kind: "shell", detail: "no .rm-console-inner" }];
      const col = inner.getBoundingClientRect();

      // 1. Horizontal overflow beyond the page column.
      for (const el of inner.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.right > col.right + 2)
          add(
            "overflow",
            `${Math.round(r.right - col.right)}px past column`,
            label(el),
          );
      }

      // 2. Legacy structural classes still rendering.
      for (const cls of legacyClasses) {
        const n = document.querySelectorAll(`.${cls}`).length;
        if (n > 0) add("legacy-class", `${cls} x${n}`);
      }

      // 3. Ad-hoc spacing utilities inside the console.
      const margins = [
        ...inner.querySelectorAll(
          '[class*="mt-"],[class*="mb-"],[class*="my-"]',
        ),
      ];
      if (margins.length)
        add(
          "adhoc-margin",
          `${margins.length} element(s)`,
          margins.map(label).slice(0, 4).join(" "),
        );

      // 4. Form controls: the "random half-width box" complaint. A control is
      //    suspicious when it is neither ~full width of its parent nor at one
      //    of the design measures.
      const measures = [280, 288, 480, 512, 704, 44 * 16];
      for (const el of inner.querySelectorAll("input,select,textarea")) {
        if (
          el.type === "checkbox" ||
          el.type === "radio" ||
          el.type === "hidden"
        )
          continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const parent = el.parentElement?.getBoundingClientRect();
        const fillsParent = parent && r.width >= parent.width - 4;
        const onMeasure = measures.some((m) => Math.abs(r.width - m) <= 8);
        if (!fillsParent && !onMeasure)
          add("control-width", `${Math.round(r.width)}px`, label(el));
        const h = Math.round(r.height);
        if (
          el.tagName !== "TEXTAREA" &&
          !controlHeights.some((c) => Math.abs(h - c) <= 1)
        )
          add("control-height", `${h}px`, label(el));
      }

      // 5. Type scale and radius conformance on visible chrome.
      const seenType = new Set();
      const seenRadius = new Set();
      for (const el of inner.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = getComputedStyle(el);
        if (el.childElementCount === 0 && el.textContent?.trim()) {
          const fs = Math.round(parseFloat(cs.fontSize) * 2) / 2;
          if (!typeScale.includes(fs) && !seenType.has(fs)) {
            seenType.add(fs);
            add("type-scale", `${fs}px`, label(el));
          }
        }
        const br = Math.round(parseFloat(cs.borderTopLeftRadius));
        if (br > 0 && !radii.includes(br) && !seenRadius.has(br)) {
          seenRadius.add(br);
          add("radius", `${br}px`, label(el));
        }
      }

      // 6. Duplicate heading: the page title restated anywhere in the body —
      //    as a section title, a tab label, or a hand-rolled muted div. Any
      //    short leaf whose text equals the page title is a restatement.
      const pageTitle = document
        .querySelector(".cs-page__title")
        ?.textContent?.trim();
      if (pageTitle) {
        for (const el of inner.querySelectorAll("*")) {
          if (el.closest(".cs-page__head")) continue;
          if (el.childElementCount > 0) continue;
          const text = el.textContent?.trim();
          if (text !== pageTitle) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          add("duplicate-title", pageTitle, label(el));
        }
      }

      // 7. Tables must live in the card wrapper.
      for (const t of inner.querySelectorAll("table")) {
        if (!t.closest(".rm-table-wrap"))
          add("bare-table", "table outside .rm-table-wrap");
      }

      // 8. Empty states must use the shared treatment.
      for (const el of inner.querySelectorAll(".rm-empty")) {
        add(
          "legacy-empty",
          "uses .rm-empty not .rm-ui-empty/.cs-empty",
          label(el),
        );
      }

      return out;
    },
    {
      typeScale: TYPE_SCALE,
      radii: RADII,
      controlHeights: CONTROL_HEIGHTS,
      legacyClasses: LEGACY_CLASSES,
    },
  );

  // 9. Clipped descenders, checked across the whole document rather than just
  //    the content column, because the rail is where this bites.
  //    `overflow: hidden` (needed for ellipsis truncation) turns the line box
  //    into a hard clip, so a line-height under ~1.25em severs the tails of
  //    g/y/p/&. Inter needs about 1.28em to clear ascender plus descent.
  const clipped = await page.evaluate(() => {
    const out = new Set();
    for (const el of document.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (cs.overflow === "visible" && cs.overflowY !== "hidden") continue;
      if (!el.textContent?.trim() || el.childElementCount > 0) continue;
      const fs = parseFloat(cs.fontSize);
      const lh =
        cs.lineHeight === "normal" ? fs * 1.2 : parseFloat(cs.lineHeight);
      if (lh < fs * 1.25) {
        const cls =
          typeof el.className === "string"
            ? el.className.trim().split(/\s+/)[0]
            : "";
        out.add(
          `${el.tagName.toLowerCase()}.${cls} fs=${fs} lh=${Math.round(lh)}`,
        );
      }
    }
    return [...out];
  });
  for (const c of clipped)
    findings.push({ kind: "clipped-descender", detail: c });

  report.push({
    route,
    findings,
    ...(runtimeErrors.length
      ? { runtimeErrors: [...new Set(runtimeErrors)] }
      : {}),
  });
}
await browser.close();

for (const entry of report) {
  const count = entry.fatal ? "FATAL" : entry.findings.length;
  console.log(`\n=== ${entry.route}  (${count}) ===`);
  if (entry.fatal) {
    console.log("  " + entry.fatal);
    continue;
  }
  if (entry.runtimeErrors) {
    for (const e of entry.runtimeErrors) console.log(`  ! runtime: ${e}`);
  }
  const grouped = new Map();
  for (const f of entry.findings) {
    const key = `${f.kind}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(f);
  }
  for (const [kind, list] of grouped) {
    const shown = list.slice(0, 6);
    console.log(`  ${kind} (${list.length}):`);
    for (const f of shown)
      console.log(`     ${f.detail ?? ""} ${f.sample ? "— " + f.sample : ""}`);
    if (list.length > shown.length)
      console.log(`     …${list.length - shown.length} more`);
  }
}

if (failOn.length > 0) {
  const offenders = report.flatMap((entry) =>
    (entry.findings ?? [])
      .filter((f) => failOn.includes(f.kind))
      .map(
        (f) => `${entry.route}: ${f.kind} ${f.detail ?? ""} ${f.sample ?? ""}`,
      ),
  );
  if (offenders.length > 0) {
    console.error(
      `\nFAIL: ${offenders.length} gated finding(s) [${failOn.join(", ")}]`,
    );
    for (const o of offenders) console.error("  " + o);
    process.exit(1);
  }
  console.log(
    `\nPASS: no gated findings [${failOn.join(", ")}] across ${routes.length} route(s)`,
  );
}
