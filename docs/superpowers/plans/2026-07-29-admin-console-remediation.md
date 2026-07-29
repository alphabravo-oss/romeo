# Admin Console UI/UX Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

---

## ⛔ STATUS — READ FIRST

| Phase                             | State                    | Notes                                                                                           |
| --------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| **Phase 0 — Guardrails**          | ✅ **DONE** (2026-07-29) | All 4 assertions live in `scripts/admin-console-audit.mjs`. Baseline captured. Do **not** redo. |
| **Phase 1 — Shared primitives**   | ☐ TODO                   | **← START HERE**                                                                                |
| Phase 2 — Auth split view         | ☐ TODO                   |                                                                                                 |
| Phase 3 — Unify connected apps    | ☐ TODO                   |                                                                                                 |
| Phase 4 — Action slots            | ☐ TODO                   |                                                                                                 |
| Phase 5 — Destructive tiering     | ☐ TODO                   |                                                                                                 |
| Phase 6 — Progressive disclosure  | ☐ TODO                   |                                                                                                 |
| Phase 7 — Copy hygiene            | ☐ TODO                   |                                                                                                 |
| Phase 8 — Save model + time scope | ☐ TODO                   |                                                                                                 |
| Phase 9 — Final validation        | ☐ TODO                   |                                                                                                 |

**Your work starts at Phase 1.** Phase 0 is complete and committed; its tasks
are struck through below and left in place for reference only.

`pnpm quality:browser` currently exits **1** with **22 known findings** across
14 sections. That is the intended starting state — the guardrails are meant to
be red. Track them in
[`docs/quality/admin-remediation-baseline.md`](../../quality/admin-remediation-baseline.md)
and flip a row to ✅ only after re-running the audit.

### Corrections Phase 0 made to this plan

Running the audit disproved two assumptions written before implementation.
**Both downstream tasks below have been rewritten to match reality** — trust
the current text, not any earlier description of it.

1. **Empty states are not "bare text".** Every one already uses the
   `EmptyState` primitive. The real defect is that none supplies an `icon` or
   `description`, and only 2 of 11 supply an `action`. Assertion 0.4 and
   Task 1.4 were rewritten accordingly.
2. **The `connected-apps` error code is not caught by the identifier check.**
   `delegated_oauth_provider_not_configured:github` sits inside `<code>` and
   `translate="no"`, which the check excludes on purpose. It is still a real
   defect and is still fixed by Task 3.1 Step 4 — just verify it by eye, not
   by the audit.

Phase 0 also found defects the pre-implementation review had missed:
`connections` renders **10** primary buttons in its Catalog tab, `usage` has a
duplicate `+ Add quota`, and `overview` leaks **raw job/run IDs**
(`run_08fb8ca6efce45e2b596`, `job_run_terminal_run_*`). These are in the
baseline and assigned to tasks.

---

**Goal:** Rebuild the Romeo admin console's 24 sections onto one consistent, progressively-disclosed control vocabulary built entirely from existing `@romeo/ui` primitives and existing global CSS, with every change proved by a machine-runnable check.

**Architecture:** Three shared presentation components (`SettingsSection`, `PageActions`, `DangerZone`) are added to `apps/app/src/components/` and composed from existing `@romeo/ui` primitives — no new dependencies, no new design tokens. The flagship change replaces the Authentication catalog table with a "configured / available" split view, then Connected apps is unified onto that same component. All behavioural logic is extracted into pure `.ts` modules so it can be unit-tested under `environment: "node"`, and every visual/structural guarantee is added as an assertion inside the existing `scripts/admin-console-audit.mjs` Playwright harness.

**Tech Stack:** React 19 + TanStack Start/Router, TanStack Query, TanStack Form, `@romeo/ui` (local design system), Tailwind v4 + hand-written global CSS, Vitest (node environment), Playwright (via `pnpm quality:browser`), i18next.

---

## Global Constraints

These apply to **every task in this plan**. A task is not complete if it violates any of them.

1. **No new dependencies.** Do not run `pnpm add`. Everything needed already exists. `pnpm check:dependencies` (dependency-cruiser) and `pnpm check:bundle-budget` will fail you.
2. **Every visible `<button>` must carry the `rm-ui-button` class.** Use `Button` / `IconButton` / `LinkButton` from `@romeo/ui`. Never write a raw `<button>`. Enforced by `nonFrameworkButtons` in `scripts/admin-console-audit.mjs`.
3. **Every visible `<input>`, `<select>`, `<textarea>` must carry a framework class** (`rm-ui-control`, `rm-ui-checkbox`, `rm-ui-switch`, `rm-ui-native-toggle`). Use `Input` / `NativeSelect` / `Select` / `Textarea` / `Checkbox` / `Switch` from `@romeo/ui`. Enforced by `nonFrameworkControls`.
4. **Tests run in `environment: "node"`. There is no DOM.** See "Testing Doctrine" below. Never import `@testing-library/*`. Never write a `.test.tsx`. Never call `render()`.
5. **All user-facing strings go through `t()`** from `useLocale()` in `apps/app/src/lib/i18n`. No string literals in JSX.
6. **Every new message key must be added to all three locales:** `apps/app/src/locales/en/<ns>.json`, `.../es/<ns>.json`, `.../fr/<ns>.json`. The `MessageKey` union type is derived from the **en** files (`apps/app/src/locales/index.ts:78`). If you add to `en` only, `pnpm check` passes but the app shows raw keys in es/fr.
7. **No new CSS files.** Admin styles go in `apps/app/src/styles/app-content.css`. Reuse existing classes (`rm-stat-grid`, `rm-stat`, `rm-panel`, `rm-table-wrap`, `rm-empty`) before writing new ones. New class names must use the `rm-` prefix.
8. **No new design tokens.** Use the existing CSS custom properties defined in `packages/ui/src/styles.css:1-29` (`--rm-ui-border`, `--rm-ui-muted`, `--rm-ui-danger`, `--rm-ui-surface`, `--rm-ui-soft`, `--rm-ui-radius`, etc.). Never hardcode a hex value.
9. **Never expose internal identifiers to admins.** No raw enum values (`user_private`, `shared_row_scope`), no error codes (`delegated_oauth_provider_not_configured:github`), no regex charsets in help text. Map them to `t()` strings.
10. **Commit after every task.** Use the message given in the task's final step.

### Verification commands (memorize these)

| Command                          | What it proves                                                            | Runtime |
| -------------------------------- | ------------------------------------------------------------------------- | ------- |
| `pnpm --filter @romeo/app test`  | Unit tests pass                                                           | ~10s    |
| `pnpm --filter @romeo/app check` | TypeScript compiles (incl. `MessageKey`)                                  | ~30s    |
| `pnpm check:ui-form-contracts`   | Form controls are named + labelled                                        | ~15s    |
| `pnpm format:check`              | Prettier formatting                                                       | ~10s    |
| `pnpm quality:browser`           | **Full admin console audit, all 24 sections, axe a11y, visual baselines** | ~4 min  |
| `pnpm verify`                    | Everything (the merge gate)                                               | ~8 min  |

Run the first four after every task. Run `pnpm quality:browser` at the end of every **phase**.

---

## Testing Doctrine — READ THIS BEFORE WRITING ANY TEST

`apps/app/vitest.config.ts` is:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

**There is no jsdom. There is no React Testing Library. `document` does not exist.**

All 45 existing app tests are `.test.ts` (never `.test.tsx`). They test **pure functions extracted from components**. This is deliberate and you must follow it.

### The pattern

When a component needs logic that deserves a test, you extract it:

**`apps/app/src/components/auth-provider-card-actions.ts`** (pure logic — testable)

```ts
export function canTestProvider(entry: {
  protocol: string;
  status: string;
}): boolean {
  return entry.status === "implemented";
}
```

**`apps/app/src/components/auth-provider-card-actions.test.ts`** (node, no DOM)

```ts
import { describe, expect, it } from "vitest";
import { canTestProvider } from "./auth-provider-card-actions";

describe("provider card actions", () => {
  it("allows testing implemented providers", () => {
    expect(canTestProvider({ protocol: "oidc", status: "implemented" })).toBe(
      true,
    );
  });
});
```

**`apps/app/src/components/AuthProviderTableView.tsx`** (thin — just calls the function)

```tsx
const canTest = canTestProvider(row.entry);
```

### What gets tested where

| Concern                                                            | Where it is tested                             |
| ------------------------------------------------------------------ | ---------------------------------------------- |
| "Which providers land in the Active zone?"                         | Pure function + `.test.ts`                     |
| "Is the Save button disabled when the form is clean?"              | Pure function + `.test.ts`                     |
| "Does the danger tier for this action require typed confirmation?" | Pure function + `.test.ts`                     |
| "Does the page actually render the Active zone?"                   | `scripts/admin-console-audit.mjs` (Playwright) |
| "Are there accessibility violations?"                              | `scripts/admin-console-audit.mjs` (axe)        |
| "Did the layout visually regress?"                                 | `scripts/browser-visual-baselines.mjs`         |

**If you catch yourself wanting to render a component in a test — stop.** Extract the logic you actually wanted to assert into a `.ts` file and test that instead. Then add a DOM-level assertion to `admin-console-audit.mjs`.

---

## Primitives Reference — USE THESE, DO NOT INVENT

Everything below already exists. Import from `@romeo/ui` unless noted.

### Buttons — `packages/ui/src/button.tsx`

```tsx
<Button variant="primary" size="md" pending={false} onClick={fn}>
  Label
</Button>
```

- `variant`: `"default" | "primary" | "secondary" | "ghost" | "outline" | "danger" | "link"`
- `size`: `"sm" | "md" | "lg" | "icon"`
- `pending?: boolean` — renders a spinner and disables
- `<IconButton aria-label="…" size="sm" variant="ghost"><Icon aria-hidden size={16} /></IconButton>`
- `<LinkButton href="…">` for anchors
- `<Spinner />`

### Layout — `packages/ui/src/layout.tsx`

```tsx
<Card>…</Card>              // surface with border + radius
<Panel>…</Panel>            // <section> wrapper
<Toolbar>…</Toolbar>        // horizontal action row
<Separator />
<Tabs tabs={TabDefinition[]} />
```

### Forms — `packages/ui/src/forms.tsx`

```tsx
<Field label="Issuer URL" hint="…" error="…"><Input name="issuer" /></Field>
<Input name="…" />                       // .rm-ui-control
<NativeSelect name="…">…</NativeSelect>  // .rm-ui-control
<Select options={SelectOption[]} />
<Textarea name="…" />
<Checkbox label="…" checked onCheckedChange={fn} />   // .rm-ui-checkbox
<Switch label="…" checked onCheckedChange={fn} />     // .rm-ui-switch
<InlineError>…</InlineError>
```

**Every control inside a `<form>` needs a `name` and an accessible label** or `pnpm check:ui-form-contracts` fails.

### Feedback — `packages/ui/src/feedback.tsx`

```tsx
<EmptyState icon={<Plug aria-hidden size={24} />} title={t("…")} action={<Button variant="primary">…</Button>}>
  {t("…description…")}
</EmptyState>

<StatusBadge tone="success">On</StatusBadge>
// tone: "danger" | "info" | "neutral" | "success" | "warning"

<Skeleton />
toast("message", "error")
```

### Overlays — `packages/ui/src/overlays.tsx`

```tsx
<Dialog open onOpenChange={fn} title="…" description="…" closeLabel={t("close")}>…</Dialog>
<Sheet side="right" open onOpenChange={fn} title="…" …>…</Sheet>   // Dialog + side
<AlertDialog actionLabel="…" cancelLabel="…" …>…</AlertDialog>
<DropdownMenu items={DropdownMenuItem[]} trigger={<IconButton …/>} />
<Popover /> <Tooltip />
```

`DropdownMenuItem`: `{ label, onSelect, disabled?, danger?, separatorBefore? }`

### App-level shared components — `apps/app/src/components/`

```tsx
<PanelStats items={[{ label: t("…"), value: rows.length }]} />   // emits .rm-stat-grid
const { ask, dialog } = useConfirm();                            // from ./ConfirmDialog
const ok = await ask({ title, body, confirmLabel, tone: "danger" });
// render {dialog} once in the component tree
<DataTable columns={…} data={…} getRowId={…} minTableWidth={860} />
```

### i18n

```tsx
import { useLocale } from "../lib/i18n";
const { t } = useLocale();
t("someMessageKey");
```

---

## File Structure

### New files

| File                                                   | Responsibility                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `apps/app/src/components/SettingsSection.tsx`          | Labelled settings group: heading + description + `Card` body. Replaces ad-hoc `<h3>` + naked fields. |
| `apps/app/src/components/PageActions.tsx`              | Standard page action row: one primary, optional secondaries, `Refresh` demoted to `IconButton`.      |
| `apps/app/src/components/DangerZone.tsx`               | Visually separated destructive-action region.                                                        |
| `apps/app/src/components/danger-tier.ts`               | **Pure.** Maps an action to a confirmation tier.                                                     |
| `apps/app/src/components/danger-tier.test.ts`          | Tests for the above.                                                                                 |
| `apps/app/src/components/auth-provider-zones.ts`       | **Pure.** Splits the auth catalog into active/available zones.                                       |
| `apps/app/src/components/auth-provider-zones.test.ts`  | Tests for the above.                                                                                 |
| `apps/app/src/components/AuthProviderSplitView.tsx`    | The configured/available split view. Replaces `AuthProviderTableView`.                               |
| `apps/app/src/components/ProviderSlotCard.tsx`         | One card in the Active zone; also used by Connected apps.                                            |
| `apps/app/src/components/settings-dirty-state.ts`      | **Pure.** Dirty-state + save-enablement logic.                                                       |
| `apps/app/src/components/settings-dirty-state.test.ts` | Tests for the above.                                                                                 |
| `apps/app/src/components/SettingsSaveBar.tsx`          | Contextual save bar; appears only when dirty.                                                        |

### Modified files

| File                                                 | Change                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `scripts/admin-console-audit.mjs`                    | New machine assertions (Phase 0 and per-phase).                                    |
| `apps/app/src/styles/app-content.css`                | New `rm-settings-*`, `rm-provider-zone*`, `rm-danger-zone`, `rm-save-bar` classes. |
| `apps/app/src/components/AuthProvidersPanel.tsx`     | Swap table view → split view; rename Deprovision.                                  |
| `apps/app/src/components/ConnectedAppsPanel.tsx`     | Adopt split view; remove leaked error code.                                        |
| `apps/app/src/components/UsersPanel.tsx`             | Add Invite; demote Refresh; tier Disable.                                          |
| `apps/app/src/components/AbuseControlsPanel.tsx`     | Org suspension → DangerZone + typed confirm.                                       |
| `apps/app/src/components/WebSearchPanel.tsx`         | Gate the form behind the Enabled toggle.                                           |
| `apps/app/src/components/ChatExperiencePanel.tsx`    | Collapse starter prompts.                                                          |
| `apps/app/src/components/GovernanceRetentionTab.tsx` | Adopt `SettingsSaveBar`; separate the job trigger.                                 |
| `apps/app/src/locales/{en,es,fr}/*.json`             | New keys.                                                                          |

---

# ✅ PHASE 0 — Guardrails First — **COMPLETE, DO NOT REDO**

> **Completed 2026-07-29.** All four assertions are live in
> `scripts/admin-console-audit.mjs` and the baseline is recorded in
> `docs/quality/admin-remediation-baseline.md`. The tasks below are retained
> as a record of what was built and why. **Skip to Phase 1.**
>
> What exists now, verified by a real `pnpm quality:browser` run:
>
> | Computation (in `inspectUi`) | Failure string                                       | Metric                   |
> | ---------------------------- | ---------------------------------------------------- | ------------------------ |
> | `primaryButtons`             | `page has N primary actions (expected at most 1): …` | `primaryActions`         |
> | `leakedIdentifiers`          | `page exposes internal identifier: …`                | `leakedIdentifiers`      |
> | `unguardedDangerButtons`     | `unguarded destructive action(s): …`                 | `unguardedDangerActions` |
> | `incompleteEmptyStates`      | `empty state missing icon or description: …`         | `incompleteEmptyStates`  |
>
> All four are inside the existing `page.evaluate` callback, follow the file's
> established `failures.push(...)` convention, and add no new dependencies.

**Why it came first:** Every later phase claims "this page is now consistent." Without machine checks, that claim is unprovable and a weaker implementer will drift. These assertions fail _now_ (proving they work), and each later phase turns one green.

---

### ✅ Task 0.1 (DONE): Add a "one primary action per page" assertion to the audit

**Files:**

- Modify: `scripts/admin-console-audit.mjs` (inside `inspectUi`'s `page.evaluate`, alongside the existing `nonFrameworkButtons` logic ~line 366)

**Interfaces:**

- Produces: a new failure string `"page has N primary actions (expected at most 1)"` consumed by the existing `failures` array and reported by the existing runner.

- [x] **Step 1: Read the surrounding code so your insertion matches**

Run: `sed -n '330,400p' scripts/admin-console-audit.mjs`

You are looking at the inside of a `page.evaluate(...)` callback. It builds `const failures = []`, computes DOM facts, pushes strings into `failures`, and finally returns `{ failures, metrics: {...} }`. Your addition follows exactly that shape.

- [x] **Step 2: Add the primary-action count computation**

Find the line that declares `const nonFrameworkButtons = visibleButtons.filter(`. **Immediately above it**, insert:

```js
const primaryButtons = visibleButtons.filter((button) =>
  button.classList.contains("rm-ui-button--primary"),
);
```

- [x] **Step 3: Add the failure push**

Find the block near the end of the evaluate callback where other `failures.push(...)` calls live (search for `failures.push("page rendered a visible application error")`). **Immediately after that push's closing**, insert:

```js
if (primaryButtons.length > 1) {
  failures.push(
    `page has ${primaryButtons.length} primary actions (expected at most 1): ${primaryButtons
      .map((button) => button.innerText.trim().replace(/\s+/gu, " "))
      .join(" | ")}`,
  );
}
```

- [x] **Step 4: Expose the count in metrics**

Find the `return { failures, metrics: {` block. Add one entry inside `metrics`:

```js
        primaryActions: primaryButtons.length,
```

- [x] **Step 5: Run the audit and confirm it FAILS on known-bad pages**

Run: `pnpm quality:browser`

Expected: **FAIL.** You should see failures naming `access` (two blue buttons: "+ Add API key" and "+ Add service account") and `webhooks` (duplicate "+ Add webhook"). This proves the assertion works.

Record the failing section list — Phase 3 and Phase 4 will clear them.

- [x] **Step 6: Commit**

```bash
git add scripts/admin-console-audit.mjs
git commit -m "test(admin-audit): assert at most one primary action per page"
```

---

### ✅ Task 0.2 (DONE): Add an "internal identifier leak" assertion

**Files:**

- Modify: `scripts/admin-console-audit.mjs`

**Interfaces:**

- Produces: failure string `"page exposes internal identifier: <token>"`.

- [x] **Step 1: Add the detector inside `page.evaluate`**

Insert next to the other DOM computations (anywhere after `const bodyText = document.body.innerText;`):

```js
// Internal identifiers must never reach an admin's screen. Matches
// snake_case tokens of 2+ segments and colon-suffixed error codes.
// `translate="no"` marks intentional proper nouns (e.g. provider slugs).
const identifierPattern =
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}(?::[a-z0-9_-]+)?\b/gu;
const identifierAllowlist = new Set([
  "romeo_local",
  "org_default",
  "agent_default",
  "group_admins",
]);
const leakedIdentifiers = [...document.querySelectorAll("#console-content *")]
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
```

- [x] **Step 2: Add the failure push**

Next to the other pushes:

```js
if (leakedIdentifiers.length > 0) {
  failures.push(
    `page exposes internal identifier: ${[...new Set(leakedIdentifiers)].join(", ")}`,
  );
}
```

- [x] **Step 3: Run and confirm it FAILS**

Run: `pnpm quality:browser`

Expected: **FAIL** on at least:

- `connected-apps` → `delegated_oauth_provider_not_configured:github`
- `rag` → `user_private`, `shared_row_scope`
- `abuse` → `policy_violation`

If `auth-providers` also fails on protocol slugs, that is a **false positive** — those are already wrapped in `translate="no"` in `AuthProviderTableView.tsx:107`. If it still trips, verify your `element.closest('[translate="no"]')` guard is present.

- [x] **Step 4: Commit**

```bash
git add scripts/admin-console-audit.mjs
git commit -m "test(admin-audit): assert internal identifiers never reach the UI"
```

---

### ✅ Task 0.3 (DONE): Add a "destructive action needs confirmation" assertion

**Files:**

- Modify: `scripts/admin-console-audit.mjs`

- [x] **Step 1: Add the detector inside `page.evaluate`**

```js
// A danger-styled control must either open a confirmation (dialog
// trigger) or live inside an explicit danger zone. A bare danger button
// wired straight to a mutation is an accidental-destruction risk.
const dangerButtons = visibleButtons.filter((button) =>
  button.classList.contains("rm-ui-button--danger"),
);
const unguardedDangerButtons = dangerButtons.filter(
  (button) =>
    button.closest(".rm-danger-zone") === null &&
    button.getAttribute("aria-haspopup") !== "dialog" &&
    button.dataset.confirms !== "true",
);
```

- [x] **Step 2: Add the failure push**

```js
if (unguardedDangerButtons.length > 0) {
  failures.push(
    `unguarded destructive action(s): ${unguardedDangerButtons
      .map((button) => button.innerText.trim().replace(/\s+/gu, " "))
      .join(" | ")}`,
  );
}
```

- [x] **Step 3: Run and confirm it FAILS**

Run: `pnpm quality:browser`

Expected: **FAIL** on `users` (the red row-level `Disable` button).

- [x] **Step 4: Commit**

```bash
git add scripts/admin-console-audit.mjs
git commit -m "test(admin-audit): assert destructive actions are guarded"
```

---

### ✅ Task 0.4 (DONE): Add an "incomplete empty state" assertion

> **Rewritten during implementation.** The original assertion looked for bare
> `No X yet.` text _outside_ the `EmptyState` primitive and found **nothing** —
> every admin empty state already uses the primitive. The real defect is that
> none passes an `icon` or `description`, and only 2 of 11 pass an `action`.
> The shipped assertion checks for that instead, and catches 11 sites. The
> steps below describe the **shipped** version.

**Files:**

- Modify: `scripts/admin-console-audit.mjs`

- [x] **Step 1: Add the detector**

```js
// An empty state is an invitation to act, not a dead end. The
// EmptyState primitive is already in use everywhere, but a title alone
// ("No connectors yet.") tells the admin nothing about what a connector
// is or how to get one. Require an icon and an explanatory description;
// the action slot is optional because some lists (impersonation
// requests) are populated by users, not admins.
const incompleteEmptyStates = [...document.querySelectorAll(".rm-ui-empty")]
  .filter(visible)
  .filter(
    (element) =>
      element.querySelector(".rm-ui-empty__icon") === null ||
      element.querySelector(".rm-ui-empty__description") === null,
  );
```

- [x] **Step 2: Add the failure push**

```js
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
```

The action slot is deliberately **not** required. Impersonation requests and marketplace templates are populated by users and upstream systems, not by the admin — an EmptyState with a misleading button is worse than one without.

- [x] **Step 3: Run and confirm it FAILS**

Run: `pnpm quality:browser`

Actual result: **FAIL on 11 empty states** across `access` (×2), `connections` (×2), `usage`, `webhooks`, `rag`, `connected-apps`, `impersonation` (×2), `notification-channels`, `prompt-templates`, `workflows`.

- [x] **Step 4: Commit**

```bash
git add scripts/admin-console-audit.mjs
git commit -m "test(admin-audit): assert empty states carry an icon and description"
```

---

### ✅ Task 0.5 (DONE): Record the Phase 0 baseline

**Files:**

- Create: `docs/quality/admin-remediation-baseline.md`

- [x] **Step 1: Capture the current failure set**

Run: `pnpm quality:browser 2>&1 | tee /tmp/admin-audit-baseline.txt; echo "exit=$?"`

- [x] **Step 2: Write the baseline document**

**This file now exists** at `docs/quality/admin-remediation-baseline.md` with
**22 findings across 14 sections**, captured from a real run — not from
prediction. It also records the findings the guardrails deliberately cannot
see (auth-providers' catalog table, web search's ungated form, the
`abuse` suspension checkbox, missing date ranges) so nothing silently falls
through the gap between "audit is green" and "the work is done".

Read it before starting Phase 1. Do not regenerate it.

- [x] **Step 3: Commit**

```bash
git add docs/quality/admin-remediation-baseline.md
git commit -m "docs(quality): record admin remediation audit baseline"
```

---

# PHASE 1 — Shared Primitives

**Why now:** Phases 2–8 all compose these three components. Building them first means every later task is assembly, not invention.

---

### Task 1.1: Build `SettingsSection`

**Files:**

- Create: `apps/app/src/components/SettingsSection.tsx`
- Modify: `apps/app/src/styles/app-content.css`

**Interfaces:**

- Produces:

  ```ts
  function SettingsSection(props: {
    title: string;
    description?: string;
    actions?: React.ReactNode;
    children: React.ReactNode;
    id?: string;
  }): React.ReactNode;
  ```

  Consumed by Tasks 1.4, 6.1, 6.2, 8.1.

- [ ] **Step 1: Add the CSS**

Append to `apps/app/src/styles/app-content.css`:

```css
/* Settings section: a labelled group of related controls. Two-column on wide
   viewports (label rail + control body), stacked on narrow. Mirrors the
   settings-layout convention used across enterprise admin consoles. */
.rm-settings-section {
  display: grid;
  gap: 1rem;
  padding-block: 1.5rem;
  border-top: 1px solid var(--rm-ui-border);
}

.rm-settings-section:first-child {
  border-top: 0;
  padding-block-start: 0;
}

.rm-settings-section__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.rm-settings-section__title {
  font-size: 0.9375rem;
  font-weight: 600;
  margin: 0;
}

.rm-settings-section__description {
  color: var(--rm-ui-muted);
  font-size: 0.875rem;
  margin: 0.25rem 0 0;
  max-width: 60ch;
}

.rm-settings-section__body {
  display: grid;
  gap: 0.75rem;
}

@media (min-width: 60rem) {
  .rm-settings-section {
    grid-template-columns: minmax(12rem, 18rem) minmax(0, 1fr);
    gap: 2rem;
  }
  .rm-settings-section__head {
    display: block;
  }
}
```

- [ ] **Step 2: Write the component**

Create `apps/app/src/components/SettingsSection.tsx`:

```tsx
/**
 * A labelled group of related settings. Use this instead of a bare <h3>
 * followed by naked form fields — it supplies the heading hierarchy, the
 * description slot, and the section rule that separates one group from the
 * next.
 *
 *   <SettingsSection
 *     title={t("governanceRetentionTitle")}
 *     description={t("governanceRetentionDescription")}
 *   >
 *     <Field label={t("auditRetentionDays")}><Input name="auditRetentionDays" /></Field>
 *   </SettingsSection>
 *
 * The description belongs ABOVE the controls it explains, never below.
 */
export function SettingsSection(props: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}): React.ReactNode {
  return (
    <section className="rm-settings-section" id={props.id}>
      <div className="rm-settings-section__head">
        <div>
          <h3 className="rm-settings-section__title">{props.title}</h3>
          {props.description ? (
            <p className="rm-settings-section__description">
              {props.description}
            </p>
          ) : null}
        </div>
        {props.actions ? <div>{props.actions}</div> : null}
      </div>
      <div className="rm-settings-section__body">{props.children}</div>
    </section>
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm --filter @romeo/app check`
Expected: PASS (exit 0).

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/components/SettingsSection.tsx apps/app/src/styles/app-content.css
git commit -m "feat(admin): add SettingsSection layout primitive"
```

---

### Task 1.2: Build `DangerZone` with tiered confirmation logic

**Files:**

- Create: `apps/app/src/components/danger-tier.ts`
- Create: `apps/app/src/components/danger-tier.test.ts`
- Create: `apps/app/src/components/DangerZone.tsx`
- Modify: `apps/app/src/styles/app-content.css`

**Interfaces:**

- Produces:

  ```ts
  type DangerTier = "low" | "medium" | "high";
  function requiresTypedConfirmation(tier: DangerTier): boolean;
  function confirmTone(tier: DangerTier): "default" | "danger";
  function DangerZone(props: {
    title: string;
    description?: string;
    children: React.ReactNode;
  }): React.ReactNode;
  ```

  Consumed by Tasks 5.1, 5.2, 5.3.

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/components/danger-tier.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { confirmTone, requiresTypedConfirmation } from "./danger-tier";

describe("danger tiers", () => {
  it("requires typed confirmation only for high-severity actions", () => {
    expect(requiresTypedConfirmation("high")).toBe(true);
    expect(requiresTypedConfirmation("medium")).toBe(false);
    expect(requiresTypedConfirmation("low")).toBe(false);
  });

  it("uses the danger tone for high and medium severity", () => {
    expect(confirmTone("high")).toBe("danger");
    expect(confirmTone("medium")).toBe("danger");
  });

  it("uses the default tone for low severity so reversible actions stay light", () => {
    expect(confirmTone("low")).toBe("default");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @romeo/app test danger-tier`
Expected: FAIL — `Failed to resolve import "./danger-tier"`.

- [ ] **Step 3: Write the implementation**

Create `apps/app/src/components/danger-tier.ts`:

```ts
/**
 * Confirmation friction must match blast radius.
 *
 *   high   — irreversible, or affects every user in the org (suspend the
 *            organization, delete a provider's stored credential). Typed
 *            confirmation required.
 *   medium — reversible but disruptive (disable a user, revoke a key).
 *            Danger-toned confirm dialog, no typing.
 *   low    — trivially reversible (remove an unsaved list row). No dialog;
 *            callers simply do not route these through a confirmation.
 */
export type DangerTier = "low" | "medium" | "high";

export function requiresTypedConfirmation(tier: DangerTier): boolean {
  return tier === "high";
}

export function confirmTone(tier: DangerTier): "default" | "danger" {
  return tier === "low" ? "default" : "danger";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @romeo/app test danger-tier`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the DangerZone CSS**

Append to `apps/app/src/styles/app-content.css`:

```css
/* Danger zone: destructive actions are separated from routine settings by a
   visible boundary so they are never adjacent to a Save. The audit asserts
   danger-styled buttons live either here or behind a dialog trigger. */
.rm-danger-zone {
  display: grid;
  gap: 0.75rem;
  margin-block-start: 2rem;
  padding: 1rem;
  border: 1px solid color-mix(in srgb, var(--rm-ui-danger) 40%, transparent);
  border-radius: var(--rm-ui-radius);
  background: color-mix(in srgb, var(--rm-ui-danger) 6%, transparent);
}

.rm-danger-zone__title {
  font-size: 0.9375rem;
  font-weight: 600;
  margin: 0;
}

.rm-danger-zone__description {
  color: var(--rm-ui-muted);
  font-size: 0.875rem;
  margin: 0;
  max-width: 60ch;
}
```

- [ ] **Step 6: Write the DangerZone component**

Create `apps/app/src/components/DangerZone.tsx`:

```tsx
/**
 * Separates destructive actions from routine settings. Anything that deletes,
 * suspends, revokes or deprovisions belongs here — never inline next to a
 * Save button.
 *
 *   <DangerZone title={t("abuseSuspendTitle")} description={t("abuseSuspendDescription")}>
 *     <Button variant="danger" onClick={confirmThenSuspend}>{t("abuseSuspendOrg")}</Button>
 *   </DangerZone>
 */
export function DangerZone(props: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <section className="rm-danger-zone">
      <div>
        <h3 className="rm-danger-zone__title">{props.title}</h3>
        {props.description ? (
          <p className="rm-danger-zone__description">{props.description}</p>
        ) : null}
      </div>
      <div>{props.children}</div>
    </section>
  );
}
```

- [ ] **Step 7: Verify compile + tests**

Run: `pnpm --filter @romeo/app check && pnpm --filter @romeo/app test`
Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/app/src/components/danger-tier.ts apps/app/src/components/danger-tier.test.ts apps/app/src/components/DangerZone.tsx apps/app/src/styles/app-content.css
git commit -m "feat(admin): add DangerZone primitive with tiered confirmation logic"
```

---

### Task 1.3: Build `PageActions`

**Files:**

- Create: `apps/app/src/components/PageActions.tsx`

**Interfaces:**

- Produces:

  ```ts
  function PageActions(props: {
    primary?: React.ReactNode;
    secondary?: React.ReactNode;
    onRefresh?: () => void;
    refreshing?: boolean;
    refreshLabel: string;
  }): React.ReactNode;
  ```

  Consumed by Tasks 4.1, 4.2.

- [ ] **Step 1: Write the component**

Create `apps/app/src/components/PageActions.tsx`:

```tsx
import { IconButton } from "@romeo/ui";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";

/**
 * The standard page action row. Exactly one primary action per page — the
 * thing an admin came here to do (Invite user, Add webhook). Refresh is a
 * utility, not a primary action: it renders as a ghost icon button so it
 * stops competing with the real work.
 *
 *   <PageActions
 *     primary={<Button variant="primary" onClick={invite}>{t("usersInvite")}</Button>}
 *     onRefresh={() => query.refetch()}
 *     refreshing={query.isFetching}
 *     refreshLabel={t("refresh")}
 *   />
 */
export function PageActions(props: {
  primary?: React.ReactNode;
  secondary?: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshLabel: string;
}): React.ReactNode {
  return (
    <div className="flex items-center gap-2">
      {props.onRefresh ? (
        <IconButton
          aria-label={props.refreshLabel}
          disabled={props.refreshing === true}
          onClick={props.onRefresh}
          size="sm"
          variant="ghost"
        >
          <RefreshCw aria-hidden size={16} />
        </IconButton>
      ) : null}
      {props.secondary}
      {props.primary}
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `pnpm --filter @romeo/app check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/components/PageActions.tsx
git commit -m "feat(admin): add PageActions row with demoted refresh"
```

---

### Task 1.4: Give every empty state an icon and a description

> **This task was rewritten after Phase 0.** The original version assumed the
> admin console rendered bare `No X yet.` text and told you to introduce the
> `EmptyState` primitive in four panels. That was wrong. Every empty state
> **already** uses the primitive — they render through one shared wrapper,
> `PanelState`, which never passes an `icon` or a description. The real fix is
> one component's API plus its call sites. Ignore any earlier description of
> this task.

**Files:**

- Modify: `apps/app/src/lib/panel-state.tsx`
- Modify: the admin panels listed in Step 3
- Modify: `apps/app/src/locales/{en,es,fr}/*.json`

**Interfaces:**

- Consumes: `EmptyState` from `@romeo/ui` (props: `action`, `children`, `icon`, `title`).
- Produces: two new optional props on `PanelState`:
  ```ts
  emptyIcon?: React.ReactNode;
  emptyDescription?: string;
  ```
  Every later phase that renders a list through `PanelState` uses these.

**Why one wrapper, not eleven panels:** `apps/app/src/lib/panel-state.tsx:71`
and `:76` both render `<EmptyState action={emptyAction} title={empty} />` —
no icon, no description. All 11 audit failures trace to those two lines.
`PanelState` has 38 call sites, so widening its API once is the whole fix.

- [ ] **Step 1: Widen the `PanelState` API**

In `apps/app/src/lib/panel-state.tsx`, add the two props to the signature:

```tsx
export function PanelState<T>(props: {
  query: UseQueryResult<T>;
  empty?: string;
  /** Optional CTA (e.g. a "+ Add X" button) shown under the empty message. */
  emptyAction?: React.ReactNode;
  /** One-sentence explanation of what this list holds and how to fill it. */
  emptyDescription?: string;
  /** Section icon, matching the nav icon in admin-console-navigation.ts. */
  emptyIcon?: React.ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => React.ReactNode;
}): React.ReactNode {
```

Destructure them alongside the existing props:

```tsx
const {
  query,
  empty = t("nothingHereYet"),
  emptyAction,
  emptyDescription,
  emptyIcon,
  isEmpty,
  children,
} = props;
```

- [ ] **Step 2: Render them in both empty branches**

There are **two** `return <EmptyState … />` statements (one for
`data === undefined`, one for `emptyCheck(data)`). Both must change. Replace
each with:

```tsx
return (
  <EmptyState action={emptyAction} icon={emptyIcon} title={empty}>
    {emptyDescription}
  </EmptyState>
);
```

Extracting a local `const emptyState = (…)` above the two branches and
returning it twice is fine and preferable — just make sure **both** paths
carry the icon and description.

- [ ] **Step 3: Pass an icon and description at every failing call site**

Run the audit to get the live list:

```bash
pnpm quality:browser 2>&1 | grep -o "empty state missing icon or description: [^\"]*" | sort -u
```

At baseline that is 11 sites. Fix each. Use the icon that matches the
section's nav entry in `apps/app/src/components/admin-console-navigation.ts`
so the empty state reads as part of the section:

| Section               | Panel file                     | Nav icon to reuse |
| --------------------- | ------------------------------ | ----------------- |
| access                | `ApiKeyPanel.tsx` (×2)         | `KeyRound`        |
| connections           | `DataConnectorPanel.tsx` (×2)  | `Plug`            |
| usage                 | `QuotaPanel.tsx`               | `BarChart3`       |
| webhooks              | `WebhooksPanel.tsx`            | `Webhook`         |
| rag                   | `RagGovernancePanel.tsx`       | `Database`        |
| connected-apps        | `ConnectedAppsPanel.tsx`       | `Link2`           |
| impersonation         | `ImpersonationPanel.tsx` (×2)  | `UserCog`         |
| notification-channels | `NotificationChannelPanel.tsx` | `Bell`            |
| prompt-templates      | `PromptTemplatePanel.tsx`      | `FileText`        |
| workflows             | `WorkflowsPanel.tsx`           | `Workflow`        |

Import icons with the deep path form — a bare `from "lucide-react"` import
will blow the bundle budget:

```tsx
import Plug from "lucide-react/dist/esm/icons/plug.mjs";
```

Then pass all three props:

```tsx
<PanelState
  empty={t("connectorNone")}
  emptyDescription={t("connectorNoneDescription")}
  emptyIcon={<Plug aria-hidden size={24} />}
  emptyAction={
    <Button onClick={() => setCreating(true)} variant="primary">
      {t("connectorsAdd")}
    </Button>
  }
  query={connectorsQuery}
>
  {(connectors) => <DataTable columns={columns} data={connectors} />}
</PanelState>
```

- [ ] **Step 4: Do NOT add an action where the admin cannot act**

The audit requires an icon and a description. It deliberately does **not**
require `emptyAction`. Leave `emptyAction` off for lists the admin does not
populate:

- Impersonation requests and active sessions — created by users and support flows.
- Marketplace templates — populated upstream.
- Rag change requests — raised by the governance workflow.

A button that cannot do anything is worse than no button.

- [ ] **Step 5: Write the description copy in all three locales**

For every `xxxEmpty` / `xxxNone` key you referenced, add a sibling
`…Description` key to the **same namespace file** in `en`, `es` **and** `fr`.
Descriptions say what the thing is and how one appears — never just restate
the title.

Example, `apps/app/src/locales/en/tool-connector-admin.json`:

```json
"connectorNoneDescription": "Connectors pull content from a data source so governed retrieval can use it."
```

`es`:

```json
"connectorNoneDescription": "Los conectores extraen contenido de una fuente de datos para que la recuperación gobernada pueda usarlo."
```

`fr`:

```json
"connectorNoneDescription": "Les connecteurs extraient le contenu d'une source de données pour que la récupération gouvernée puisse l'utiliser."
```

Repeat for all 11. If you add a key to `en` only, `pnpm check` still passes
(the `MessageKey` union derives from `en`) but the app renders a raw key in
Spanish and French. This is the single easiest mistake to make in this plan.

- [ ] **Step 6: Verify the type and the locales**

Run: `pnpm --filter @romeo/app check`

Expected: PASS. An error like
`Argument of type '"connectorNoneDescription"' is not assignable to parameter of type 'MessageKey'`
means the key is missing from the **en** file.

- [ ] **Step 7: Verify the audit assertion is now green**

Run: `pnpm quality:browser`

Expected: **zero** `empty state missing icon or description` failures. Other
baseline failures (primary actions, identifier leaks, the unguarded Disable)
still fail — that is correct, later phases own them.

- [ ] **Step 8: Update the baseline**

In `docs/quality/admin-remediation-baseline.md`, flip every
`incomplete-empty-state` row from ☐ to ✅. That is 11 rows across `access`,
`connections`, `usage`, `webhooks`, `rag`, `connected-apps`, `impersonation`,
`notification-channels`, `prompt-templates` and `workflows`.

- [ ] **Step 9: Commit**

```bash
git add apps/app/src/lib/panel-state.tsx apps/app/src/components apps/app/src/locales docs/quality/admin-remediation-baseline.md
git commit -m "feat(admin): give every empty state an icon and a description"
```

---

# PHASE 2 — Authentication Split View (Flagship)

**Why this shape:** `packages/core/src/domain/auth-providers.ts:1-15` defines `authProviderIds` as a **fixed tuple** producing a closed `AuthProviderId` union. There is exactly one Okta slot. You cannot create a second. Therefore:

- ❌ **Wrong:** "+ Add provider" opening a dropdown — implies unbounded instances.
- ✅ **Right:** a two-zone page. **Active** (rich cards for slots that are on) and **Available** (a quiet grid of unclaimed slots).

This is the same constraint Grafana documents: you may run SAML _and_ Generic OAuth, but never two Generic OAuth configs.

---

### Task 2.1: Extract the zone-splitting logic (pure)

**Files:**

- Create: `apps/app/src/components/auth-provider-zones.ts`
- Create: `apps/app/src/components/auth-provider-zones.test.ts`

**Interfaces:**

- Produces:

  ```ts
  interface ProviderZoneInput {
    id: string;
    configured: boolean;
    enabled: boolean;
    status: "implemented" | "planned";
  }
  interface ProviderZones<T> {
    active: T[];
    available: T[];
    unavailable: T[];
  }
  function splitProviderZones<T extends ProviderZoneInput>(
    rows: readonly T[],
  ): ProviderZones<T>;
  ```

  Consumed by Task 2.2 and Task 3.1.

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/components/auth-provider-zones.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { splitProviderZones } from "./auth-provider-zones";

const row = (
  id: string,
  configured: boolean,
  enabled: boolean,
  status: "implemented" | "planned" = "implemented",
) => ({ id, configured, enabled, status });

describe("provider zones", () => {
  it("puts configured providers in the active zone even when switched off", () => {
    const zones = splitProviderZones([row("okta", true, false)]);
    expect(zones.active.map((entry) => entry.id)).toEqual(["okta"]);
    expect(zones.available).toHaveLength(0);
  });

  it("puts enabled providers in the active zone even when not yet configured", () => {
    const zones = splitProviderZones([row("local", false, true)]);
    expect(zones.active.map((entry) => entry.id)).toEqual(["local"]);
  });

  it("puts untouched implemented providers in the available zone", () => {
    const zones = splitProviderZones([row("keycloak", false, false)]);
    expect(zones.available.map((entry) => entry.id)).toEqual(["keycloak"]);
    expect(zones.active).toHaveLength(0);
  });

  it("separates planned providers so they are never offered as claimable", () => {
    const zones = splitProviderZones([row("saml", false, false, "planned")]);
    expect(zones.unavailable.map((entry) => entry.id)).toEqual(["saml"]);
    expect(zones.available).toHaveLength(0);
  });

  it("keeps a planned provider active if it was somehow already configured", () => {
    const zones = splitProviderZones([row("saml", true, false, "planned")]);
    expect(zones.active.map((entry) => entry.id)).toEqual(["saml"]);
    expect(zones.unavailable).toHaveLength(0);
  });

  it("preserves catalog order within each zone", () => {
    const zones = splitProviderZones([
      row("a", false, false),
      row("b", true, false),
      row("c", false, false),
      row("d", true, false),
    ]);
    expect(zones.active.map((entry) => entry.id)).toEqual(["b", "d"]);
    expect(zones.available.map((entry) => entry.id)).toEqual(["a", "c"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @romeo/app test auth-provider-zones`
Expected: FAIL — `Failed to resolve import "./auth-provider-zones"`.

- [ ] **Step 3: Write the implementation**

Create `apps/app/src/components/auth-provider-zones.ts`:

```ts
/**
 * The auth provider catalog is a CLOSED set of singleton slots — see
 * `authProviderIds` in packages/core/src/domain/auth-providers.ts. There is
 * exactly one Okta slot and it cannot be duplicated, so the page cannot use
 * an "add an instance" model.
 *
 * Instead we split the fixed catalog into zones:
 *
 *   active      — the admin has touched this slot (configured or enabled).
 *                 Render rich cards: health, last test, user counts.
 *   available   — an implemented slot nobody has claimed. Render a quiet,
 *                 dense grid; clicking one opens the same config surface.
 *   unavailable — not yet implemented. Shown as disabled, never claimable.
 */
export interface ProviderZoneInput {
  id: string;
  configured: boolean;
  enabled: boolean;
  status: "implemented" | "planned";
}

export interface ProviderZones<T> {
  active: T[];
  available: T[];
  unavailable: T[];
}

export function splitProviderZones<T extends ProviderZoneInput>(
  rows: readonly T[],
): ProviderZones<T> {
  const zones: ProviderZones<T> = {
    active: [],
    available: [],
    unavailable: [],
  };
  for (const entry of rows) {
    if (entry.configured || entry.enabled) {
      zones.active.push(entry);
    } else if (entry.status === "planned") {
      zones.unavailable.push(entry);
    } else {
      zones.available.push(entry);
    }
  }
  return zones;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @romeo/app test auth-provider-zones`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/auth-provider-zones.ts apps/app/src/components/auth-provider-zones.test.ts
git commit -m "feat(admin): add provider zone splitting logic"
```

---

### Task 2.2: Build `ProviderSlotCard`

**Files:**

- Create: `apps/app/src/components/ProviderSlotCard.tsx`
- Modify: `apps/app/src/styles/app-content.css`

**Interfaces:**

- Produces:

  ```ts
  function ProviderSlotCard(props: {
    name: string;
    icon: React.ReactNode;
    protocol: string;
    enabled: boolean;
    configured: boolean;
    testStatus?: "passed" | "partial" | "failed" | "not_tested";
    facts?: { label: string; value: string }[];
    actions: React.ReactNode;
  }): React.ReactNode;
  ```

  Consumed by Tasks 2.3 and 3.1.

- [ ] **Step 1: Add the CSS**

Append to `apps/app/src/styles/app-content.css`:

```css
/* Provider zones. Active slots get rich cards (there will only ever be a
   handful). Available slots get a dense, quiet grid — they are a catalog to
   browse, not an inventory to operate. */
.rm-provider-zone {
  display: grid;
  gap: 0.75rem;
  margin-block-start: 1.5rem;
}

.rm-provider-zone__label {
  color: var(--rm-ui-muted);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin: 0;
}

.rm-provider-zone__grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
}

.rm-provider-zone__grid--dense {
  grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
}

.rm-provider-card {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--rm-ui-border);
  border-radius: var(--rm-ui-radius);
  background: var(--rm-ui-surface);
}

.rm-provider-card__head {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  min-width: 0;
}

.rm-provider-card__name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rm-provider-card__facts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem 1rem;
  color: var(--rm-ui-muted);
  font-size: 0.8125rem;
}

.rm-provider-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
```

- [ ] **Step 2: Write the component**

Create `apps/app/src/components/ProviderSlotCard.tsx`:

```tsx
import { StatusBadge } from "@romeo/ui";

import { useLocale } from "../lib/i18n";

/**
 * One provider slot in the Active zone. A card can carry an operational fact
 * and a scale fact side by side ("Test failed 1h ago" next to "240 users"),
 * which a shared table column cannot — every column has to mean the same
 * thing in every row.
 */
export function ProviderSlotCard(props: {
  name: string;
  icon: React.ReactNode;
  protocol: string;
  enabled: boolean;
  configured: boolean;
  testStatus?: "passed" | "partial" | "failed" | "not_tested";
  facts?: { label: string; value: string }[];
  actions: React.ReactNode;
}): React.ReactNode {
  const { t } = useLocale();
  return (
    <article className="rm-provider-card">
      <div className="rm-provider-card__head">
        <span className="shrink-0">{props.icon}</span>
        <span className="rm-provider-card__name" translate="no">
          {props.name}
        </span>
        <StatusBadge tone={props.enabled ? "success" : "neutral"}>
          {props.enabled ? t("authOn") : t("authOff")}
        </StatusBadge>
      </div>
      <div className="rm-provider-card__facts">
        <span translate="no">{props.protocol}</span>
        {props.configured ? null : (
          <StatusBadge tone="warning">{t("authNotConfigured")}</StatusBadge>
        )}
        {props.testStatus && props.testStatus !== "not_tested" ? (
          <StatusBadge
            tone={
              props.testStatus === "passed"
                ? "success"
                : props.testStatus === "partial"
                  ? "warning"
                  : "danger"
            }
          >
            {props.testStatus === "passed"
              ? t("authTestPassed")
              : props.testStatus === "partial"
                ? t("authTestPartial")
                : t("authTestFailed")}
          </StatusBadge>
        ) : null}
        {(props.facts ?? []).map((fact) => (
          <span key={fact.label}>
            {fact.label}: {fact.value}
          </span>
        ))}
      </div>
      <div className="rm-provider-card__actions">{props.actions}</div>
    </article>
  );
}
```

- [ ] **Step 3: Add the three new message keys to all locales**

In `apps/app/src/locales/en/auth-provider-admin.json`:

```json
"authTestPassed": "Connection healthy",
"authTestPartial": "Connection degraded",
"authTestFailed": "Connection failed"
```

`es`:

```json
"authTestPassed": "Conexión correcta",
"authTestPartial": "Conexión degradada",
"authTestFailed": "Error de conexión"
```

`fr`:

```json
"authTestPassed": "Connexion saine",
"authTestPartial": "Connexion dégradée",
"authTestFailed": "Échec de la connexion"
```

- [ ] **Step 4: Verify compile**

Run: `pnpm --filter @romeo/app check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/ProviderSlotCard.tsx apps/app/src/styles/app-content.css apps/app/src/locales
git commit -m "feat(admin): add ProviderSlotCard for active provider zone"
```

---

### Task 2.3: Build `AuthProviderSplitView`

**Files:**

- Create: `apps/app/src/components/AuthProviderSplitView.tsx`
- Modify: `apps/app/src/components/AuthProvidersPanel.tsx`

**Interfaces:**

- Consumes: `splitProviderZones` (Task 2.1), `ProviderSlotCard` (Task 2.2), `canTestProvider`/`canDeprovisionProvider` (existing `./auth-provider-card-actions`).
- Produces: `AuthProviderSplitView` with **the identical prop signature as the existing `AuthProviderTableView`** so the swap in `AuthProvidersPanel.tsx` is a one-line change.

- [ ] **Step 1: Read the component you are replacing**

Run: `sed -n '40,90p' apps/app/src/components/AuthProviderTableView.tsx`

Note the exact prop list. Your new component must accept the same props: `busy`, `catalog`, `deprovisioning`, `effectiveById`, `onConfigure`, `onDeprovision`, `onTest`, `onToggle`, `testing`, `testResults`.

- [ ] **Step 2: Write the split view**

Create `apps/app/src/components/AuthProviderSplitView.tsx`:

```tsx
import { Button, EmptyState, StatusBadge, Switch } from "@romeo/ui";
import KeySquare from "lucide-react/dist/esm/icons/key-square.mjs";
import Settings2 from "lucide-react/dist/esm/icons/settings-2.mjs";
import TestTube2 from "lucide-react/dist/esm/icons/test-tube-2.mjs";
import { useMemo } from "react";

import type {
  AuthProviderCatalogEntry,
  AuthProviderConnectionTestReport,
  AuthProviderId,
  EffectiveAuthProviderSetting,
} from "../features/auth-provider-administration";
import { useLocale } from "../lib/i18n";
import { authProviderIcon } from "./AuthProviderIcons";
import {
  canDeprovisionProvider,
  canTestProvider,
} from "./auth-provider-card-actions";
import { splitProviderZones } from "./auth-provider-zones";
import { PanelStats } from "./PanelStats";
import { ProviderSlotCard } from "./ProviderSlotCard";

interface AuthProviderRow {
  configured: boolean;
  enabled: boolean;
  entry: AuthProviderCatalogEntry;
  id: string;
  setting: EffectiveAuthProviderSetting | undefined;
  status: "implemented" | "planned";
  test: AuthProviderConnectionTestReport | undefined;
}

/**
 * Authentication presented as configured-vs-available rather than as a table
 * of every possible provider. Ten rows reading "Off / Not configured / Not
 * tested" are not an inventory — they are a catalog, and a catalog belongs in
 * a browse affordance, not in the operator's primary view.
 */
export function AuthProviderSplitView({
  busy,
  catalog,
  deprovisioning,
  effectiveById,
  onConfigure,
  onDeprovision,
  onTest,
  onToggle,
  testing,
  testResults,
}: {
  busy: boolean;
  catalog: AuthProviderCatalogEntry[];
  deprovisioning: boolean;
  effectiveById: Map<AuthProviderId, EffectiveAuthProviderSetting>;
  onConfigure: (entry: AuthProviderCatalogEntry) => void;
  onDeprovision: (entry: AuthProviderCatalogEntry) => void;
  onTest: (entry: AuthProviderCatalogEntry) => void;
  onToggle: (entry: AuthProviderCatalogEntry, enabled: boolean) => void;
  testing: boolean;
  testResults: Record<string, AuthProviderConnectionTestReport>;
}) {
  const { t } = useLocale();
  const rows = useMemo<AuthProviderRow[]>(
    () =>
      catalog.map((entry) => {
        const setting = effectiveById.get(entry.id);
        return {
          configured:
            setting?.oidc?.issuerConfigured === true ||
            setting?.secretRefConfigured === true ||
            entry.id === "local",
          enabled: setting?.enabled ?? false,
          entry,
          id: entry.id,
          setting,
          status: entry.status === "planned" ? "planned" : "implemented",
          test: testResults[entry.id],
        };
      }),
    [catalog, effectiveById, testResults],
  );

  const zones = useMemo(() => splitProviderZones(rows), [rows]);

  return (
    <div className="grid gap-4">
      <PanelStats
        items={[
          { label: t("authActiveSlots"), value: zones.active.length },
          {
            label: t("authEnabled"),
            value: rows.filter((row) => row.enabled).length,
          },
          { label: t("authAvailableSlots"), value: zones.available.length },
        ]}
      />

      <section className="rm-provider-zone">
        <h3 className="rm-provider-zone__label">{t("authZoneActive")}</h3>
        {zones.active.length === 0 ? (
          <EmptyState
            icon={<KeySquare aria-hidden size={24} />}
            title={t("authNoActiveProviders")}
          >
            {t("authNoActiveProvidersDescription")}
          </EmptyState>
        ) : (
          <div className="rm-provider-zone__grid">
            {zones.active.map((row) => (
              <ProviderSlotCard
                actions={
                  <>
                    <Switch
                      checked={row.enabled}
                      disabled={row.status === "planned" || busy}
                      label={t("authEnabled")}
                      onCheckedChange={(checked) =>
                        onToggle(row.entry, checked === true)
                      }
                    />
                    <Button
                      onClick={() => onConfigure(row.entry)}
                      size="sm"
                      variant="secondary"
                    >
                      <Settings2 aria-hidden size={14} /> {t("authConfigure")}
                    </Button>
                    {canTestProvider(row.entry) ? (
                      <Button
                        disabled={testing}
                        onClick={() => onTest(row.entry)}
                        pending={testing}
                        size="sm"
                      >
                        <TestTube2 aria-hidden size={14} /> {t("authTest")}
                      </Button>
                    ) : null}
                    {canDeprovisionProvider(row.entry) ? (
                      <Button
                        aria-haspopup="dialog"
                        disabled={deprovisioning}
                        onClick={() => onDeprovision(row.entry)}
                        size="sm"
                        variant="ghost"
                      >
                        {t("authDeprovisionUser")}
                      </Button>
                    ) : null}
                  </>
                }
                configured={row.configured}
                enabled={row.enabled}
                icon={authProviderIcon(row.entry.id)}
                key={row.entry.id}
                name={row.entry.name}
                protocol={row.entry.protocol}
                testStatus={row.test?.status ?? "not_tested"}
              />
            ))}
          </div>
        )}
      </section>

      {zones.available.length > 0 ? (
        <section className="rm-provider-zone">
          <h3 className="rm-provider-zone__label">
            {t("authZoneAvailable")} · {zones.available.length}
          </h3>
          <div className="rm-provider-zone__grid rm-provider-zone__grid--dense">
            {zones.available.map((row) => (
              <Button
                key={row.entry.id}
                onClick={() => onConfigure(row.entry)}
                variant="outline"
              >
                <span className="shrink-0">
                  {authProviderIcon(row.entry.id)}
                </span>
                <span translate="no">{row.entry.name}</span>
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      {zones.unavailable.length > 0 ? (
        <section className="rm-provider-zone">
          <h3 className="rm-provider-zone__label">
            {t("authZoneUnavailable")}
          </h3>
          <div className="rm-provider-card__facts">
            {zones.unavailable.map((row) => (
              <StatusBadge key={row.entry.id}>
                <span translate="no">{row.entry.name}</span> ·{" "}
                {t("authComingSoon")}
              </StatusBadge>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Add the new message keys to all three locales**

`apps/app/src/locales/en/auth-provider-admin.json`:

```json
"authZoneActive": "Active",
"authZoneAvailable": "Available to set up",
"authZoneUnavailable": "Not yet supported",
"authActiveSlots": "Active",
"authAvailableSlots": "Available",
"authNoActiveProviders": "No sign-on method is active",
"authNoActiveProvidersDescription": "Choose a provider below to set it up. Members cannot sign in until at least one method is active.",
"authDeprovisionUser": "Disable SSO user…"
```

`es`:

```json
"authZoneActive": "Activos",
"authZoneAvailable": "Disponibles para configurar",
"authZoneUnavailable": "Aún no compatibles",
"authActiveSlots": "Activos",
"authAvailableSlots": "Disponibles",
"authNoActiveProviders": "No hay ningún método de inicio de sesión activo",
"authNoActiveProvidersDescription": "Elige un proveedor abajo para configurarlo. Los miembros no podrán iniciar sesión hasta que haya al menos un método activo.",
"authDeprovisionUser": "Desactivar usuario SSO…"
```

`fr`:

```json
"authZoneActive": "Actifs",
"authZoneAvailable": "Disponibles à configurer",
"authZoneUnavailable": "Pas encore pris en charge",
"authActiveSlots": "Actifs",
"authAvailableSlots": "Disponibles",
"authNoActiveProviders": "Aucune méthode de connexion active",
"authNoActiveProvidersDescription": "Choisissez un fournisseur ci-dessous pour le configurer. Les membres ne pourront pas se connecter tant qu'aucune méthode n'est active.",
"authDeprovisionUser": "Désactiver l'utilisateur SSO…"
```

**Note the label change.** `authDeprovision` said "Deprovision", which reads as _remove this provider_. `AuthProvidersPanel.tsx:145` shows it actually disables **a mapped user account for an OIDC subject**. The new label says what it does, and the `…` signals that a dialog follows.

- [ ] **Step 4: Swap the view in the panel**

In `apps/app/src/components/AuthProvidersPanel.tsx`:

Change the import:

```tsx
// remove: import { AuthProviderTableView } from "./AuthProviderTableView";
import { AuthProviderSplitView } from "./AuthProviderSplitView";
```

Change the usage (around line 224) from `<AuthProviderTableView` to `<AuthProviderSplitView`. All props stay identical.

- [ ] **Step 5: Delete the dead table view**

```bash
git rm apps/app/src/components/AuthProviderTableView.tsx
```

If `pnpm --filter @romeo/app check` then reports an unused import of `canTestProvider`/`canDeprovisionProvider` anywhere, leave those modules — `auth-provider-card-actions.ts` is still used by the split view and its test must keep passing.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @romeo/app check && pnpm --filter @romeo/app test && pnpm check:ui-form-contracts`
Expected: all PASS.

- [ ] **Step 7: Verify in a real browser**

Run: `pnpm quality:browser`
Expected: `auth-providers` passes all assertions, including axe. Visual baselines for that section **will** change — that is expected and intentional. Approve the new baseline per the process in `scripts/browser-visual-baselines.mjs`.

- [ ] **Step 8: Look at it**

Start the dev server (`pnpm dev`) and open `http://localhost:3000/admin?section=auth-providers`. Confirm with your own eyes:

- "Local Email and Password" appears as a card under **Active**
- The other ten appear as compact outline buttons under **Available to set up**
- There is no table
- There is exactly one visible `rm-ui-button--primary` (or zero)

- [ ] **Step 9: Commit**

```bash
git add -A apps/app/src/components apps/app/src/locales
git commit -m "feat(admin): replace auth provider catalog table with configured/available split view"
```

---

### Task 2.4: Reorder the provider configuration form

**Files:**

- Modify: `apps/app/src/components/AuthProviderConfigureDialog.tsx`
- Modify: `apps/app/src/components/AuthProviderProtocolFields.tsx`

**Why:** The current form leads with `Display name` and `Login order` (cosmetic) before `Issuer URL`, `Client ID`, `Client secret` (the fields without which nothing works). Lead with what makes it function; end with presentation.

- [ ] **Step 1: Read the current field order**

Run: `grep -n "Field\|label=" apps/app/src/components/AuthProviderProtocolFields.tsx | head -40`

Current order: Display name → Login order → Allowed email domains → Client secret → Secret reference (advanced) → Issuer URL → Client ID → Group claim → Admin groups → Workspace group prefix.

- [ ] **Step 2: Regroup into three `SettingsSection`s**

Restructure so the dialog renders, in this order:

1. **Connection** — `Issuer URL`, `Client ID`, `Client secret`
2. **Mapping** — `Allowed email domains`, `Group claim`, `Admin groups`, `Workspace group prefix`
3. **Presentation** — `Display name`, `Login order`

Import and wrap each group:

```tsx
import { SettingsSection } from "./SettingsSection";

<SettingsSection
  description={t("authConnectionSectionDescription")}
  title={t("authConnectionSection")}
>
  {/* Issuer URL, Client ID, Client secret fields, unchanged */}
</SettingsSection>;
```

**Do not change any field's `name` attribute, validation, or submit payload.** This is a reordering only — `pnpm check:ui-form-contracts` and the existing mutation must keep working.

- [ ] **Step 3: Move "Secret reference (advanced)" behind a disclosure**

Replace the always-visible advanced field with a native `<details>` (no new dependency, keyboard-accessible by default):

```tsx
<details className="rm-settings-advanced">
  <summary>{t("authAdvancedSecretReference")}</summary>
  {/* the existing Secret reference Field, unchanged */}
</details>
```

Add to `apps/app/src/styles/app-content.css`:

```css
.rm-settings-advanced > summary {
  cursor: pointer;
  color: var(--rm-ui-muted);
  font-size: 0.875rem;
  padding-block: 0.25rem;
}
.rm-settings-advanced[open] > summary {
  margin-block-end: 0.5rem;
}
```

- [ ] **Step 4: Add the new keys to all three locales**

`en/auth-provider-admin.json`:

```json
"authConnectionSection": "Connection",
"authConnectionSectionDescription": "Where Romeo reaches your identity provider. Required.",
"authMappingSection": "Identity mapping",
"authMappingSectionDescription": "How provider accounts and groups become Romeo members.",
"authPresentationSection": "Sign-in page",
"authPresentationSectionDescription": "How this option appears to members signing in.",
"authAdvancedSecretReference": "Use a managed secret reference instead"
```

`es`:

```json
"authConnectionSection": "Conexión",
"authConnectionSectionDescription": "Dónde alcanza Romeo tu proveedor de identidad. Obligatorio.",
"authMappingSection": "Asignación de identidades",
"authMappingSectionDescription": "Cómo las cuentas y los grupos del proveedor se convierten en miembros de Romeo.",
"authPresentationSection": "Página de inicio de sesión",
"authPresentationSectionDescription": "Cómo aparece esta opción para los miembros al iniciar sesión.",
"authAdvancedSecretReference": "Usar una referencia de secreto gestionada"
```

`fr`:

```json
"authConnectionSection": "Connexion",
"authConnectionSectionDescription": "Où Romeo joint votre fournisseur d'identité. Obligatoire.",
"authMappingSection": "Correspondance des identités",
"authMappingSectionDescription": "Comment les comptes et groupes du fournisseur deviennent des membres Romeo.",
"authPresentationSection": "Page de connexion",
"authPresentationSectionDescription": "Comment cette option apparaît aux membres lors de la connexion.",
"authAdvancedSecretReference": "Utiliser une référence de secret gérée"
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @romeo/app check && pnpm check:ui-form-contracts && pnpm --filter @romeo/app test`
Expected: all PASS. `check:ui-form-contracts` passing proves you did not break any control's `name` or label.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/components apps/app/src/locales apps/app/src/styles/app-content.css
git commit -m "feat(admin): group auth provider form by connection, mapping, presentation"
```

---

# PHASE 3 — Unify Connected Apps

### Task 3.1: Move Connected apps onto the split view

**Files:**

- Modify: `apps/app/src/components/ConnectedAppsPanel.tsx`
- Modify: `apps/app/src/locales/{en,es,fr}/integration-automation.json`

**Why:** Connected apps is the same job as Authentication — claim an unconfigured slot from a fixed catalog — but uses a different table and a different verb (`Connect` vs `Manage`). One job, one pattern, one verb.

- [ ] **Step 1: Read the current panel**

Run: `grep -n "Available providers\|Connect\|not configured\|delegated_oauth" apps/app/src/components/ConnectedAppsPanel.tsx`

- [ ] **Step 2: Replace the "Available providers" table with the zone split**

Reuse `splitProviderZones` from Task 2.1. Map each connected-app provider to the `ProviderZoneInput` shape:

```tsx
import { splitProviderZones } from "./auth-provider-zones";
import { ProviderSlotCard } from "./ProviderSlotCard";

const zones = useMemo(
  () =>
    splitProviderZones(
      providers.map((provider) => ({
        ...provider,
        id: provider.id,
        configured: provider.status === "configured",
        enabled: provider.connectionCount > 0,
        status: "implemented" as const,
      })),
    ),
  [providers],
);
```

Render Active as `ProviderSlotCard`s and Available as outline buttons, exactly as in Task 2.3.

- [ ] **Step 3: Use the same verb as Authentication**

Change the action label from `Connect` to the shared `authConfigure` ("Set up"). If `en/auth-provider-admin.json` currently maps `authConfigure` to "Configure", change it to:

`en`: `"authConfigure": "Set up"` — `es`: `"authConfigure": "Configurar"` — `fr`: `"authConfigure": "Configurer"`

**Verify this key is not used somewhere it would now read wrong:**

```bash
grep -rn 'authConfigure' apps/app/src --include=*.tsx
```

If any usage means "edit an existing configuration" rather than "set up a new one", introduce a second key `authEditConfiguration` rather than overloading one.

- [ ] **Step 4: Remove the leaked error code**

Find the warning render that outputs `delegated_oauth_provider_not_configured:github`. Replace the raw code with a translated sentence naming the provider:

```tsx
<StatusBadge tone="warning">
  {t("connectedAppsNotConfiguredWarning", { provider: provider.name })}
</StatusBadge>
```

Add to `en/integration-automation.json`:

```json
"connectedAppsNotConfiguredWarning": "{{provider}} is listed but not set up yet."
```

`es`: `"connectedAppsNotConfiguredWarning": "{{provider}} aparece en la lista pero aún no está configurado."`
`fr`: `"connectedAppsNotConfiguredWarning": "{{provider}} est répertorié mais pas encore configuré."`

If `t()` in this codebase does not accept an interpolation argument, check its signature at `apps/app/src/lib/i18n.tsx:104` — it is typed `(key: MessageKey) => string`. In that case **do not add interpolation**; write the sentence without the provider name and render the name separately:

```tsx
<StatusBadge tone="warning">
  {t("connectedAppsNotConfiguredWarning")}
</StatusBadge>
```

with `"connectedAppsNotConfiguredWarning": "Listed but not set up yet."`

- [ ] **Step 5: Verify the identifier-leak assertion now passes**

Run: `pnpm quality:browser`
Expected: `connected-apps` no longer reports `page exposes internal identifier`.

- [ ] **Step 6: Verify everything else**

Run: `pnpm --filter @romeo/app check && pnpm --filter @romeo/app test && pnpm format:check`
Expected: all PASS.

- [ ] **Step 7: Update the baseline doc**

Mark the `connected-apps` identifier row ✅.

- [ ] **Step 8: Commit**

```bash
git add apps/app/src/components apps/app/src/locales docs/quality/admin-remediation-baseline.md
git commit -m "feat(admin): unify connected apps onto the provider split view"
```

---

# PHASE 4 — Action Slots

### Task 4.1: Give Users its missing primary action and demote Refresh

**Files:**

- Modify: `apps/app/src/components/UsersPanel.tsx`
- Modify: `apps/app/src/locales/{en,es,fr}/user-admin.json`

**Why:** Users is the primary page in Access & Identity and currently offers no way to add a user. `Refresh` — a utility — occupies the primary slot.

- [ ] **Step 1: Check whether an invite mutation already exists**

Run:

```bash
grep -rn "invite\|createUser" apps/app/src/features packages/core/src/api.ts | head -20
```

**If an invite endpoint exists:** wire the button to it via a `FormDialog`, following the pattern in `apps/app/src/components/ApiKeyPanel.tsx`.

**If no invite endpoint exists:** do **not** invent one — that is backend scope outside this plan. Instead render the primary action as a link to the Authentication section, which is how members actually get in:

```tsx
<LinkButton href="/admin?section=auth-providers" variant="primary">
  {t("usersAddViaSso")}
</LinkButton>
```

Record which branch you took in the commit message.

- [ ] **Step 2: Adopt `PageActions`**

Replace the existing header action markup with:

```tsx
import { PageActions } from "./PageActions";

<PageActions
  onRefresh={() => void query.refetch()}
  primary={/* the button from Step 1 */}
  refreshLabel={t("refresh")}
  refreshing={query.isFetching}
/>;
```

- [ ] **Step 3: Add the keys to all three locales**

`en/user-admin.json`:

```json
"usersAddViaSso": "Set up sign-on",
"usersAddViaSsoHint": "Members join through a configured sign-on provider."
```

`es`: `"usersAddViaSso": "Configurar inicio de sesión"`, `"usersAddViaSsoHint": "Los miembros se unen a través de un proveedor de inicio de sesión configurado."`
`fr`: `"usersAddViaSso": "Configurer la connexion"`, `"usersAddViaSsoHint": "Les membres rejoignent via un fournisseur de connexion configuré."`

- [ ] **Step 4: Verify**

Run: `pnpm --filter @romeo/app check && pnpm quality:browser`
Expected: `users` reports at most one primary action.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/UsersPanel.tsx apps/app/src/locales
git commit -m "feat(admin): give Users a primary action and demote refresh"
```

---

### Task 4.2: Demote Refresh across every remaining panel

**Files:**

- Modify: `AnalyticsPanel.tsx`, `AuditPanel.tsx`, `AbuseControlsPanel.tsx`, `BillingPanel.tsx`, `OrganizationsPanel.tsx`, `ImpersonationPanel.tsx`, `NotificationChannelPanel.tsx`, `WebhooksPanel.tsx`, `WorkflowsPanel.tsx`, `RagGovernancePanel.tsx`, `AdminOverview.tsx`

- [ ] **Step 1: Find every Refresh button**

Run:

```bash
grep -rn 't("refresh")\|Refresh usage\|refreshUsage' apps/app/src/components --include=*.tsx
```

- [ ] **Step 2: Replace each with `PageActions`**

For every hit, replace the `<Button>…{t("refresh")}…</Button>` with the `PageActions` component from Task 1.3, passing the section's real primary action (if any) as `primary`.

**Special case — `ImpersonationPanel.tsx` and `NotificationChannelPanel.tsx` have two Refresh buttons each.** These pages show two independent lists. Keep one `PageActions` per list — the icon button is small enough that two no longer compete. Do not collapse them into a single refresh that refetches both unless both come from the same query.

- [ ] **Step 3: Remove duplicate primary actions**

On `webhooks` and `prompt-templates`, the "+ Add" button appears twice (page header _and_ empty state). When the list is empty, render **only** the EmptyState action. Gate the header action:

```tsx
primary={rows.length > 0 ? <Button variant="primary" onClick={add}>{t("webhooksAdd")}</Button> : undefined}
```

On `access`, two blue buttons compete ("+ Add API key", "+ Add service account"). Keep `+ Add API key` as `variant="primary"` and change `+ Add service account` to `variant="secondary"` — they belong to two different `SettingsSection`s, and only the first is the page's purpose.

- [ ] **Step 4: Verify the primary-action assertion passes everywhere**

Run: `pnpm quality:browser`
Expected: **zero** `page has N primary actions` failures across all 24 sections.

- [ ] **Step 5: Update the baseline doc**

Mark the `access` and `webhooks` primary-action rows ✅.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/components docs/quality/admin-remediation-baseline.md
git commit -m "feat(admin): demote refresh to a utility and dedupe primary actions"
```

---

# PHASE 5 — Destructive Action Tiering

### Task 5.1: Move organization suspension into a DangerZone with typed confirmation

**Files:**

- Modify: `apps/app/src/components/AbuseControlsPanel.tsx`
- Modify: `apps/app/src/locales/{en,es,fr}/abuse-control.json`

**Why:** `Organization suspended` halts every user in the org and is currently a plain checkbox, visually identical to `Enforce billing status` beside it. This is the single widest-blast-radius control in the console with the least friction.

- [ ] **Step 1: Locate the control**

Run: `grep -n "suspend" apps/app/src/components/AbuseControlsPanel.tsx`

- [ ] **Step 2: Remove it from the routine settings group**

Delete the `<Checkbox label={t("abuseOrgSuspended")} … />` from the Suspension section.

- [ ] **Step 3: Render it in a DangerZone with a typed confirm**

At the **bottom** of the panel, after all routine settings:

```tsx
import { DangerZone } from "./DangerZone";
import { useConfirm } from "./ConfirmDialog";
import { confirmTone } from "./danger-tier";

const { ask, dialog } = useConfirm();

async function toggleSuspension(nextSuspended: boolean) {
  // Suspending halts every member in the organization — high tier.
  const tier = nextSuspended ? "high" : "medium";
  const ok = await ask({
    title: nextSuspended
      ? t("abuseSuspendConfirmTitle")
      : t("abuseResumeConfirmTitle"),
    body: nextSuspended
      ? t("abuseSuspendConfirmBody")
      : t("abuseResumeConfirmBody"),
    confirmLabel: nextSuspended ? t("abuseSuspendOrg") : t("abuseResumeOrg"),
    tone: confirmTone(tier),
  });
  if (!ok) return;
  await suspensionMutation.mutateAsync({ suspended: nextSuspended });
}

// …in the JSX, after the routine sections:
<DangerZone
  description={t("abuseSuspendDescription")}
  title={t("abuseSuspendTitle")}
>
  <Button
    aria-haspopup="dialog"
    disabled={busy}
    onClick={() => void toggleSuspension(!suspended)}
    variant={suspended ? "secondary" : "danger"}
  >
    {suspended ? t("abuseResumeOrg") : t("abuseSuspendOrg")}
  </Button>
</DangerZone>;
{
  dialog;
}
```

**Note:** the shipped `ConfirmDialog` has no typed-input mode yet — Task 5.2 adds it and then comes back to wire `requiresTypedConfirmation` into this call. For now `confirmTone` alone is already a strict improvement over a bare checkbox. Do **not** import `requiresTypedConfirmation` in this task; you would be importing a symbol you cannot yet use.

- [ ] **Step 4: Add the keys to all three locales**

`en/abuse-control.json`:

```json
"abuseSuspendTitle": "Suspend this organization",
"abuseSuspendDescription": "Suspending signs out every member and blocks all runs until you resume. Billing and stored data are unaffected.",
"abuseSuspendOrg": "Suspend organization",
"abuseResumeOrg": "Resume organization",
"abuseSuspendConfirmTitle": "Suspend this organization?",
"abuseSuspendConfirmBody": "Every member is signed out immediately and all runs stop. You can resume at any time.",
"abuseResumeConfirmTitle": "Resume this organization?",
"abuseResumeConfirmBody": "Members can sign in and start runs again."
```

`es`:

```json
"abuseSuspendTitle": "Suspender esta organización",
"abuseSuspendDescription": "Suspender cierra la sesión de todos los miembros y bloquea todas las ejecuciones hasta que la reanudes. No afecta a la facturación ni a los datos almacenados.",
"abuseSuspendOrg": "Suspender organización",
"abuseResumeOrg": "Reanudar organización",
"abuseSuspendConfirmTitle": "¿Suspender esta organización?",
"abuseSuspendConfirmBody": "Se cierra la sesión de todos los miembros de inmediato y se detienen todas las ejecuciones. Puedes reanudarla cuando quieras.",
"abuseResumeConfirmTitle": "¿Reanudar esta organización?",
"abuseResumeConfirmBody": "Los miembros podrán iniciar sesión y ejecutar de nuevo."
```

`fr`:

```json
"abuseSuspendTitle": "Suspendre cette organisation",
"abuseSuspendDescription": "La suspension déconnecte tous les membres et bloque toutes les exécutions jusqu'à la reprise. La facturation et les données stockées ne sont pas affectées.",
"abuseSuspendOrg": "Suspendre l'organisation",
"abuseResumeOrg": "Reprendre l'organisation",
"abuseSuspendConfirmTitle": "Suspendre cette organisation ?",
"abuseSuspendConfirmBody": "Tous les membres sont déconnectés immédiatement et toutes les exécutions s'arrêtent. Vous pouvez reprendre à tout moment.",
"abuseResumeConfirmTitle": "Reprendre cette organisation ?",
"abuseResumeConfirmBody": "Les membres pourront se reconnecter et relancer des exécutions."
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @romeo/app check && pnpm quality:browser`
Expected: `abuse` reports no unguarded destructive action (the button sits inside `.rm-danger-zone`).

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/components/AbuseControlsPanel.tsx apps/app/src/locales
git commit -m "feat(admin): move org suspension into a danger zone with confirmation"
```

---

### Task 5.2: Add typed confirmation to `ConfirmDialog`

**Files:**

- Modify: `apps/app/src/components/ConfirmDialog.tsx`
- Create: `apps/app/src/components/confirm-typed.ts`
- Create: `apps/app/src/components/confirm-typed.test.ts`

**Interfaces:**

- Produces: `function matchesConfirmationPhrase(typed: string, required: string): boolean`, and a new optional `confirmPhrase?: string` field on `ConfirmOptions`.

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/components/confirm-typed.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { matchesConfirmationPhrase } from "./confirm-typed";

describe("typed confirmation", () => {
  it("accepts the exact phrase", () => {
    expect(matchesConfirmationPhrase("Romeo Local", "Romeo Local")).toBe(true);
  });

  it("ignores surrounding whitespace so a trailing space is not a trap", () => {
    expect(matchesConfirmationPhrase("  Romeo Local  ", "Romeo Local")).toBe(
      true,
    );
  });

  it("is case sensitive so the admin must read what they are typing", () => {
    expect(matchesConfirmationPhrase("romeo local", "Romeo Local")).toBe(false);
  });

  it("rejects a partial match", () => {
    expect(matchesConfirmationPhrase("Romeo", "Romeo Local")).toBe(false);
  });

  it("rejects an empty phrase requirement rather than silently passing", () => {
    expect(matchesConfirmationPhrase("", "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @romeo/app test confirm-typed`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/app/src/components/confirm-typed.ts`:

```ts
/**
 * High-severity confirmations require the admin to type the object's name.
 * Case-sensitive on purpose: the friction IS the feature — it forces the
 * admin to read the name of the thing they are about to break. Whitespace is
 * trimmed because a stray space is a usability trap, not a safety check.
 */
export function matchesConfirmationPhrase(
  typed: string,
  required: string,
): boolean {
  const target = required.trim();
  if (target.length === 0) return false;
  return typed.trim() === target;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @romeo/app test confirm-typed`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into `ConfirmDialog`**

In `apps/app/src/components/ConfirmDialog.tsx`:

Add to `ConfirmOptions`:

```ts
  /** When set, the confirm button stays disabled until this phrase is typed. */
  confirmPhrase?: string;
```

In `ConfirmDialog`, add state and the input:

```tsx
const [typed, setTyped] = useState("");
const phraseSatisfied =
  props.confirmPhrase === undefined ||
  matchesConfirmationPhrase(typed, props.confirmPhrase);
```

Render inside the dialog body, only when `confirmPhrase` is set:

```tsx
{
  props.confirmPhrase ? (
    <Field label={t("confirmTypeToProceed")}>
      <Input
        autoComplete="off"
        name="confirmPhrase"
        onChange={(event) => setTyped(event.target.value)}
        value={typed}
      />
    </Field>
  ) : null;
}
```

Disable the confirm action with `disabled={!phraseSatisfied}`, and reset `setTyped("")` whenever `open` becomes false.

- [ ] **Step 6: Add the key to all three locales**

`en/shared-control.json`: `"confirmTypeToProceed": "Type the name to confirm"`
`es`: `"confirmTypeToProceed": "Escribe el nombre para confirmar"`
`fr`: `"confirmTypeToProceed": "Saisissez le nom pour confirmer"`

- [ ] **Step 7: Use it for org suspension**

Back in `AbuseControlsPanel.tsx`, add to the suspend `ask({...})` call:

```tsx
    ...(requiresTypedConfirmation("high")
      ? { confirmPhrase: organizationName }
      : {}),
```

where `organizationName` comes from the existing org query. If the panel has no org name in scope, use the org slug already rendered on the Organizations section.

- [ ] **Step 8: Verify**

Run: `pnpm --filter @romeo/app test && pnpm --filter @romeo/app check && pnpm check:ui-form-contracts`
Expected: all PASS. `check:ui-form-contracts` matters here — the new `Input` has `name="confirmPhrase"` and a label via `Field`.

- [ ] **Step 9: Commit**

```bash
git add apps/app/src/components apps/app/src/locales
git commit -m "feat(admin): add typed confirmation for high-severity actions"
```

---

### Task 5.3: Tier the row-level Disable action

**Files:**

- Modify: `apps/app/src/components/UsersPanel.tsx`

**Why:** Disabling a user is reversible — medium tier. It does not warrant the only red button on the page, but it does warrant a confirm. It also currently has no self-lockout guard.

- [ ] **Step 1: Change the button variant and add the confirm**

```tsx
<Button
  aria-haspopup="dialog"
  disabled={busy}
  onClick={() => void confirmDisable(user)}
  size="sm"
  variant="secondary"
>
  {t("usersDisable")}
</Button>
```

```tsx
async function confirmDisable(user: AdminUser) {
  const ok = await ask({
    title: t("usersDisableConfirmTitle"),
    body: t("usersDisableConfirmBody"),
    confirmLabel: t("usersDisable"),
    tone: confirmTone("medium"),
  });
  if (!ok) return;
  await disableMutation.mutateAsync({ userId: user.id });
}
```

- [ ] **Step 2: Guard against self-lockout**

Disable the control when the row is the signed-in admin **and** they are the last active global admin:

```tsx
const isLastAdmin =
  user.role === "global_admin" &&
  users.filter(
    (entry) => entry.role === "global_admin" && entry.status === "active",
  ).length === 1;
```

Render the button `disabled={busy || isLastAdmin}` and, when `isLastAdmin`, show `t("usersLastAdminHint")` beside it.

- [ ] **Step 3: Extract that rule and test it**

Create `apps/app/src/components/user-disable-guard.ts`:

```ts
/**
 * An admin must never be able to remove the last way into the console.
 */
export function canDisableUser(
  target: { id: string; role: string; status: string },
  all: readonly { id: string; role: string; status: string }[],
): boolean {
  if (target.role !== "global_admin") return true;
  const activeAdmins = all.filter(
    (entry) => entry.role === "global_admin" && entry.status === "active",
  );
  return activeAdmins.length > 1;
}
```

Create `apps/app/src/components/user-disable-guard.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { canDisableUser } from "./user-disable-guard";

const admin = (id: string, status = "active") => ({
  id,
  role: "global_admin",
  status,
});
const member = (id: string) => ({ id, role: "member", status: "active" });

describe("user disable guard", () => {
  it("refuses to disable the only active global admin", () => {
    expect(canDisableUser(admin("a"), [admin("a"), member("b")])).toBe(false);
  });

  it("allows disabling an admin when another active admin remains", () => {
    expect(canDisableUser(admin("a"), [admin("a"), admin("b")])).toBe(true);
  });

  it("ignores already-disabled admins when counting", () => {
    expect(
      canDisableUser(admin("a"), [admin("a"), admin("b", "disabled")]),
    ).toBe(false);
  });

  it("always allows disabling a non-admin", () => {
    expect(canDisableUser(member("b"), [admin("a"), member("b")])).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @romeo/app test user-disable-guard`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the keys to all three locales**

`en/user-admin.json`:

```json
"usersDisableConfirmTitle": "Disable this member?",
"usersDisableConfirmBody": "They are signed out and cannot sign in again until you re-enable them. Their conversations and files are kept.",
"usersLastAdminHint": "You cannot disable the last admin."
```

`es`:

```json
"usersDisableConfirmTitle": "¿Desactivar a este miembro?",
"usersDisableConfirmBody": "Se cierra su sesión y no podrá volver a iniciarla hasta que lo reactives. Se conservan sus conversaciones y archivos.",
"usersLastAdminHint": "No puedes desactivar al último administrador."
```

`fr`:

```json
"usersDisableConfirmTitle": "Désactiver ce membre ?",
"usersDisableConfirmBody": "Il est déconnecté et ne pourra plus se connecter jusqu'à réactivation. Ses conversations et fichiers sont conservés.",
"usersLastAdminHint": "Vous ne pouvez pas désactiver le dernier administrateur."
```

- [ ] **Step 6: Verify the audit assertion passes**

Run: `pnpm quality:browser`
Expected: `users` no longer reports `unguarded destructive action`.

- [ ] **Step 7: Update the baseline doc**

Mark the `users` destructive-action row ✅.

- [ ] **Step 8: Commit**

```bash
git add apps/app/src/components apps/app/src/locales docs/quality/admin-remediation-baseline.md
git commit -m "feat(admin): tier user disable and guard against admin self-lockout"
```

---

# PHASE 6 — Progressive Disclosure

### Task 6.1: Gate the Web search form behind its Enabled toggle

**Files:**

- Modify: `apps/app/src/components/WebSearchPanel.tsx`
- Modify: `apps/app/src/locales/{en,es,fr}/web-search-admin.json`

**Why:** Twelve policy fields render live while `Enabled` is unchecked. An admin reads twelve decisions they do not have to make yet.

- [ ] **Step 1: Wrap the policy fields**

Keep visible when disabled: the `Enabled` switch, the section heading, the description.
Hide when disabled: `Provider preset`, `Endpoint URL`, `Managed credential reference`, `Allowed domains`, `Blocked domains`, `Maximum results`, `Maximum source age`, `Unknown publication dates`, `Unreachable URLs`, and `Provider health`.

```tsx
{
  enabled ? (
    <>
      <SettingsSection
        description={t("webSearchProviderDescription")}
        title={t("webSearchProviderSection")}
      >
        {/* preset, endpoint, credential */}
      </SettingsSection>
      <SettingsSection
        description={t("webSearchPolicyDescription")}
        title={t("webSearchPolicySection")}
      >
        {/* domains, limits, freshness */}
      </SettingsSection>
    </>
  ) : (
    <EmptyState
      icon={<Search aria-hidden size={24} />}
      title={t("webSearchDisabledTitle")}
    >
      {t("webSearchDisabledDescription")}
    </EmptyState>
  );
}
```

**Do not unmount fields that hold unsaved edits without warning.** If the panel has a dirty form, disable the toggle while dirty, or persist before hiding. Simplest correct approach: only allow toggling off when the form is clean.

- [ ] **Step 2: Add the keys to all three locales**

`en/web-search-admin.json`:

```json
"webSearchProviderSection": "Search provider",
"webSearchProviderDescription": "Where search queries are sent.",
"webSearchPolicySection": "Result policy",
"webSearchPolicyDescription": "Which sources are allowed and how fresh they must be.",
"webSearchDisabledTitle": "Governed web search is off",
"webSearchDisabledDescription": "Turn it on to choose a search provider and set domain and freshness policy."
```

`es`:

```json
"webSearchProviderSection": "Proveedor de búsqueda",
"webSearchProviderDescription": "Adónde se envían las consultas de búsqueda.",
"webSearchPolicySection": "Política de resultados",
"webSearchPolicyDescription": "Qué fuentes se permiten y qué antigüedad máxima pueden tener.",
"webSearchDisabledTitle": "La búsqueda web gobernada está desactivada",
"webSearchDisabledDescription": "Actívala para elegir un proveedor de búsqueda y definir la política de dominios y antigüedad."
```

`fr`:

```json
"webSearchProviderSection": "Fournisseur de recherche",
"webSearchProviderDescription": "Où les requêtes de recherche sont envoyées.",
"webSearchPolicySection": "Politique des résultats",
"webSearchPolicyDescription": "Quelles sources sont autorisées et quelle fraîcheur est exigée.",
"webSearchDisabledTitle": "La recherche web gouvernée est désactivée",
"webSearchDisabledDescription": "Activez-la pour choisir un fournisseur de recherche et définir la politique de domaines et de fraîcheur."
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @romeo/app check && pnpm check:ui-form-contracts && pnpm quality:browser`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/components/WebSearchPanel.tsx apps/app/src/locales
git commit -m "feat(admin): gate web search policy behind its enable toggle"
```

---

### Task 6.2: Collapse the starter prompt editors

**Files:**

- Modify: `apps/app/src/components/ChatExperiencePanel.tsx`
- Modify: `apps/app/src/locales/{en,es,fr}/*.json`

**Why:** Eight starter prompts render every field expanded — roughly 3000px of scroll to review a list of eight one-line labels.

- [ ] **Step 1: Render each prompt as a summary row with a disclosure**

Use a native `<details>` — keyboard-accessible, no new dependency, no state management:

```tsx
{
  prompts.map((prompt, index) => (
    <details className="rm-starter-prompt" key={prompt.id}>
      <summary className="rm-starter-prompt__summary">
        <span className="rm-starter-prompt__label">
          {prompt.label.trim() === "" ? t("chatStarterUntitled") : prompt.label}
        </span>
      </summary>
      <div className="rm-starter-prompt__body">
        {/* the existing One-line label + Prompt content Fields, unchanged */}
        <Button onClick={() => remove(index)} size="sm" variant="ghost">
          {t("chatStarterRemove")}
        </Button>
      </div>
    </details>
  ));
}
```

Keep the newest-added prompt open by rendering `open` on the row whose id matches a `lastAddedId` state value, so "Add starter" still lands the admin in an editable field.

- [ ] **Step 2: Add the CSS**

Append to `apps/app/src/styles/app-content.css`:

```css
.rm-starter-prompt {
  border: 1px solid var(--rm-ui-border);
  border-radius: var(--rm-ui-radius);
  background: var(--rm-ui-surface);
}

.rm-starter-prompt__summary {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem;
  font-weight: 500;
}

.rm-starter-prompt__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rm-starter-prompt__body {
  display: grid;
  gap: 0.75rem;
  padding: 0 0.75rem 0.75rem;
  border-top: 1px solid var(--rm-ui-border);
}
```

- [ ] **Step 3: Add the key to all three locales**

`en`: `"chatStarterUntitled": "Untitled starter"` — `es`: `"chatStarterUntitled": "Sugerencia sin título"` — `fr`: `"chatStarterUntitled": "Suggestion sans titre"`

- [ ] **Step 4: Verify**

Run: `pnpm --filter @romeo/app check && pnpm check:ui-form-contracts && pnpm quality:browser`
Expected: PASS. Note `check:ui-form-contracts` still sees the controls (they are in the DOM, just collapsed) — that is correct.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/ChatExperiencePanel.tsx apps/app/src/styles/app-content.css apps/app/src/locales
git commit -m "feat(admin): collapse starter prompt editors behind disclosures"
```

---

# PHASE 7 — Copy and Identifier Hygiene

### Task 7.1: Map raw enum values to human labels

**Files:**

- Modify: `apps/app/src/components/RagGovernancePanel.tsx`
- Modify: `apps/app/src/components/AbuseControlsPanel.tsx`
- Modify: `apps/app/src/locales/{en,es,fr}/{rag-governance,abuse-control}.json`

- [ ] **Step 1: Find every raw enum in the UI**

Run: `pnpm quality:browser 2>&1 | grep "exposes internal identifier"`

This lists exactly what to fix. Expect `user_private`, `workspace`, `org`, `shared`, `shared_row_scope`, `policy_violation`.

- [ ] **Step 2: Add a label map per enum**

In `RagGovernancePanel.tsx`:

```tsx
// Retrieval tiers are stored as stable slugs; admins see plain names.
const TIER_LABEL_KEYS = {
  user_private: "ragTierUserPrivate",
  workspace: "ragTierWorkspace",
  org: "ragTierOrg",
  shared: "ragTierShared",
} as const;

<Checkbox
  checked={tiers.includes(tier)}
  label={t(TIER_LABEL_KEYS[tier])}
  onCheckedChange={(checked) => toggleTier(tier, checked === true)}
/>;
```

- [ ] **Step 3: Add the keys to all three locales**

`en/rag-governance.json`:

```json
"ragTierUserPrivate": "Private to each member",
"ragTierWorkspace": "Workspace",
"ragTierOrg": "Organization",
"ragTierShared": "Shared",
"ragIsolationSharedRowScope": "Shared store, row-level scoping",
"ragIsolationDedicated": "Dedicated store per tenant"
```

`es`:

```json
"ragTierUserPrivate": "Privado para cada miembro",
"ragTierWorkspace": "Espacio de trabajo",
"ragTierOrg": "Organización",
"ragTierShared": "Compartido",
"ragIsolationSharedRowScope": "Almacén compartido con alcance por fila",
"ragIsolationDedicated": "Almacén dedicado por inquilino"
```

`fr`:

```json
"ragTierUserPrivate": "Privé à chaque membre",
"ragTierWorkspace": "Espace de travail",
"ragTierOrg": "Organisation",
"ragTierShared": "Partagé",
"ragIsolationSharedRowScope": "Magasin partagé, cloisonnement par ligne",
"ragIsolationDedicated": "Magasin dédié par locataire"
```

- [ ] **Step 4: Replace the regex charset help text**

In `AbuseControlsPanel.tsx`, replace `"Empty clears the code. Allowed: A-Z a-z 0-9 _ . : / @ -"` with a plain-language hint. Add to `en/abuse-control.json`:

```json
"abuseReasonCodeHint": "Letters, numbers and . : / @ _ - are allowed. Leave blank to clear."
```

`es`: `"abuseReasonCodeHint": "Se permiten letras, números y . : / @ _ -. Déjalo vacío para borrarlo."`
`fr`: `"abuseReasonCodeHint": "Lettres, chiffres et . : / @ _ - sont autorisés. Laissez vide pour effacer."`

- [ ] **Step 5: Verify the identifier assertion passes**

Run: `pnpm quality:browser`
Expected: **zero** `page exposes internal identifier` failures.

- [ ] **Step 6: Update the baseline doc**

Mark the `rag` and `abuse` identifier rows ✅.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/components apps/app/src/locales docs/quality/admin-remediation-baseline.md
git commit -m "fix(admin): replace raw enum values with human-readable labels"
```

---

### Task 7.2: Fix acronym casing in generated warnings

**Files:**

- Create: `apps/app/src/components/posture-warning-text.ts`
- Create: `apps/app/src/components/posture-warning-text.test.ts`
- Modify: `apps/app/src/components/OperationsPosturePanel.tsx`

**Why:** System posture renders `Ga checklist path not configured` — sentence-casing applied blindly to a string starting with the acronym "GA".

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/components/posture-warning-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { humanizeWarningCode } from "./posture-warning-text";

describe("posture warning text", () => {
  it("preserves known acronyms at the start of a code", () => {
    expect(humanizeWarningCode("ga_checklist_path_not_configured")).toBe(
      "GA checklist path not configured",
    );
  });

  it("preserves known acronyms in the middle of a code", () => {
    expect(humanizeWarningCode("missing_sso_binding")).toBe(
      "Missing SSO binding",
    );
  });

  it("sentence-cases ordinary words", () => {
    expect(humanizeWarningCode("queue_depth_high")).toBe("Queue depth high");
  });

  it("returns an empty string unchanged rather than producing a stray capital", () => {
    expect(humanizeWarningCode("")).toBe("");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @romeo/app test posture-warning-text`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/app/src/components/posture-warning-text.ts`:

```ts
/**
 * Backend warning codes are snake_case. Sentence-casing them blindly turns
 * "ga_checklist..." into "Ga checklist...", so acronyms are upper-cased from
 * a known list rather than title-cased by position.
 */
const ACRONYMS = new Set([
  "api",
  "ga",
  "ldap",
  "mfa",
  "oidc",
  "rag",
  "saml",
  "scim",
  "sso",
  "tls",
  "url",
]);

export function humanizeWarningCode(code: string): string {
  if (code.length === 0) return "";
  const words = code.split("_").filter((word) => word.length > 0);
  if (words.length === 0) return "";
  return words
    .map((word, index) => {
      if (ACRONYMS.has(word)) return word.toUpperCase();
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      return word;
    })
    .join(" ");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @romeo/app test posture-warning-text`
Expected: PASS, 4 tests.

- [ ] **Step 5: Use it in the panel**

In `OperationsPosturePanel.tsx`, find where warnings render and pass each code through `humanizeWarningCode(...)`.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @romeo/app test && pnpm quality:browser`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/components docs/quality
git commit -m "fix(admin): preserve acronym casing in posture warnings"
```

---

# PHASE 8 — Save Model and Time Scope

### Task 8.1: Build the contextual save bar

**Files:**

- Create: `apps/app/src/components/settings-dirty-state.ts`
- Create: `apps/app/src/components/settings-dirty-state.test.ts`
- Create: `apps/app/src/components/SettingsSaveBar.tsx`
- Modify: `apps/app/src/styles/app-content.css`

**Interfaces:**

- Produces:

  ```ts
  function isDirty<T extends object>(initial: T, current: T): boolean;
  function changedFields<T extends object>(initial: T, current: T): (keyof T)[];
  function SettingsSaveBar(props: {
    dirty: boolean;
    saving: boolean;
    onSave: () => void;
    onDiscard: () => void;
    saveLabel: string;
    discardLabel: string;
    dirtyLabel: string;
  }): React.ReactNode;
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/components/settings-dirty-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { changedFields, isDirty } from "./settings-dirty-state";

describe("settings dirty state", () => {
  it("reports clean when every value matches", () => {
    expect(isDirty({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(false);
  });

  it("reports dirty when a value changes", () => {
    expect(isDirty({ a: 1, b: "x" }, { a: 2, b: "x" })).toBe(true);
  });

  it("treats an empty string and undefined as different so clearing a field counts", () => {
    expect(isDirty({ a: "x" }, { a: "" })).toBe(true);
  });

  it("lists only the fields that changed", () => {
    expect(
      changedFields({ a: 1, b: "x", c: true }, { a: 2, b: "x", c: false }),
    ).toEqual(["a", "c"]);
  });

  it("compares arrays by content, not identity", () => {
    expect(isDirty({ tiers: ["a", "b"] }, { tiers: ["a", "b"] })).toBe(false);
    expect(isDirty({ tiers: ["a", "b"] }, { tiers: ["b", "a"] })).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @romeo/app test settings-dirty-state`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/app/src/components/settings-dirty-state.ts`:

```ts
/**
 * Dirty tracking for settings forms. Values are compared structurally so
 * array-valued settings (retrieval tiers, allowed domains) do not report
 * dirty just because React handed us a fresh array reference.
 */
function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index]))
    );
  }
  return Object.is(left, right);
}

export function changedFields<T extends object>(
  initial: T,
  current: T,
): (keyof T)[] {
  const keys = new Set([
    ...Object.keys(initial),
    ...Object.keys(current),
  ]) as Set<keyof T>;
  return [...keys].filter((key) => !sameValue(initial[key], current[key]));
}

export function isDirty<T extends object>(initial: T, current: T): boolean {
  return changedFields(initial, current).length > 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @romeo/app test settings-dirty-state`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the CSS**

Append to `apps/app/src/styles/app-content.css`:

```css
/* Contextual save bar: present only while the form is dirty, so a settings
   page has no permanently-parked Save competing with the page's real work. */
.rm-save-bar {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-block-start: 1.5rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--rm-ui-border);
  border-radius: var(--rm-ui-radius);
  background: var(--rm-ui-soft);
  box-shadow: var(--rm-ui-shadow);
}

.rm-save-bar__label {
  color: var(--rm-ui-muted);
  font-size: 0.875rem;
}

.rm-save-bar__actions {
  display: flex;
  gap: 0.5rem;
}
```

- [ ] **Step 6: Write the component**

Create `apps/app/src/components/SettingsSaveBar.tsx`:

```tsx
import { Button } from "@romeo/ui";

/**
 * Appears only when the form is dirty and carries exactly two actions. A Save
 * button parked permanently at the bottom of a settings page gives the admin
 * no signal about whether anything is pending; this does.
 */
export function SettingsSaveBar(props: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel: string;
  discardLabel: string;
  dirtyLabel: string;
}): React.ReactNode {
  if (!props.dirty) return null;
  return (
    <div className="rm-save-bar" role="region" aria-label={props.dirtyLabel}>
      <span className="rm-save-bar__label">{props.dirtyLabel}</span>
      <div className="rm-save-bar__actions">
        <Button
          disabled={props.saving}
          onClick={props.onDiscard}
          variant="ghost"
        >
          {props.discardLabel}
        </Button>
        <Button onClick={props.onSave} pending={props.saving} variant="primary">
          {props.saveLabel}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Add the keys to all three locales**

`en/shared-control.json`:

```json
"settingsUnsavedChanges": "You have unsaved changes",
"settingsDiscard": "Discard"
```

`es`: `"settingsUnsavedChanges": "Tienes cambios sin guardar"`, `"settingsDiscard": "Descartar"`
`fr`: `"settingsUnsavedChanges": "Vous avez des modifications non enregistrées"`, `"settingsDiscard": "Annuler les modifications"`

- [ ] **Step 8: Verify**

Run: `pnpm --filter @romeo/app check && pnpm --filter @romeo/app test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/app/src/components apps/app/src/styles/app-content.css apps/app/src/locales
git commit -m "feat(admin): add contextual save bar with dirty-state tracking"
```

---

### Task 8.2: Adopt the save bar in Governance and separate the job trigger

**Files:**

- Modify: `apps/app/src/components/GovernanceRetentionTab.tsx`

**Why:** `Save retention` and `Run retention now` sit side by side at equal weight. One persists a form; the other deletes data immediately.

- [ ] **Step 1: Track dirty state**

```tsx
import { isDirty } from "./settings-dirty-state";
import { SettingsSaveBar } from "./SettingsSaveBar";

const [initial, setInitial] = useState(loadedSettings);
const [draft, setDraft] = useState(loadedSettings);
const dirty = isDirty(initial, draft);
```

Reset `initial` to the server response after a successful save so the bar disappears.

- [ ] **Step 2: Replace the two buttons**

Remove both existing buttons. Render:

```tsx
<SettingsSaveBar
  dirty={dirty}
  discardLabel={t("settingsDiscard")}
  dirtyLabel={t("settingsUnsavedChanges")}
  onDiscard={() => setDraft(initial)}
  onSave={() => void save()}
  saveLabel={t("governanceSaveRetention")}
  saving={saveMutation.isPending}
/>
```

And move the job trigger into a `DangerZone`, because running retention deletes data:

```tsx
<DangerZone
  description={t("governanceRunRetentionDescription")}
  title={t("governanceRunRetentionTitle")}
>
  <Button
    aria-haspopup="dialog"
    disabled={dirty || runMutation.isPending}
    onClick={() => void confirmRun()}
    variant="danger"
  >
    {t("governanceRunRetentionNow")}
  </Button>
  {dirty ? (
    <p className="rm-danger-zone__description">
      {t("governanceSaveBeforeRun")}
    </p>
  ) : null}
</DangerZone>
```

Note `disabled={dirty}` — running a job against a policy the admin has edited but not saved would apply the _old_ policy. Blocking that is the point.

- [ ] **Step 3: Add the confirm**

```tsx
async function confirmRun() {
  const ok = await ask({
    title: t("governanceRunRetentionConfirmTitle"),
    body: t("governanceRunRetentionConfirmBody"),
    confirmLabel: t("governanceRunRetentionNow"),
    tone: confirmTone("high"),
    confirmPhrase: t("governanceRunRetentionPhrase"),
  });
  if (!ok) return;
  await runMutation.mutateAsync();
}
```

- [ ] **Step 4: Add the keys to all three locales**

`en/governance.json`:

```json
"governanceRunRetentionTitle": "Run retention now",
"governanceRunRetentionDescription": "Applies the saved policy immediately and permanently deletes everything past its retention window.",
"governanceRunRetentionConfirmTitle": "Run retention now?",
"governanceRunRetentionConfirmBody": "Data past its retention window is deleted permanently. This cannot be undone.",
"governanceRunRetentionPhrase": "run retention",
"governanceSaveBeforeRun": "Save your changes first — the job uses the saved policy."
```

`es`:

```json
"governanceRunRetentionTitle": "Ejecutar retención ahora",
"governanceRunRetentionDescription": "Aplica la política guardada de inmediato y elimina de forma permanente todo lo que supere su ventana de retención.",
"governanceRunRetentionConfirmTitle": "¿Ejecutar la retención ahora?",
"governanceRunRetentionConfirmBody": "Los datos que superen su ventana de retención se eliminan de forma permanente. Esta acción no se puede deshacer.",
"governanceRunRetentionPhrase": "ejecutar retencion",
"governanceSaveBeforeRun": "Guarda primero tus cambios: el trabajo usa la política guardada."
```

`fr`:

```json
"governanceRunRetentionTitle": "Exécuter la rétention maintenant",
"governanceRunRetentionDescription": "Applique immédiatement la politique enregistrée et supprime définitivement tout ce qui dépasse sa fenêtre de rétention.",
"governanceRunRetentionConfirmTitle": "Exécuter la rétention maintenant ?",
"governanceRunRetentionConfirmBody": "Les données dépassant leur fenêtre de rétention sont supprimées définitivement. Cette action est irréversible.",
"governanceRunRetentionPhrase": "executer retention",
"governanceSaveBeforeRun": "Enregistrez d'abord vos modifications : le travail utilise la politique enregistrée."
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @romeo/app check && pnpm --filter @romeo/app test && pnpm quality:browser`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/components/GovernanceRetentionTab.tsx apps/app/src/locales
git commit -m "feat(admin): adopt save bar and isolate the retention job trigger"
```

---

### Task 8.3: Add a date range control to Usage and Audit

**Files:**

- Create: `apps/app/src/components/date-range.ts`
- Create: `apps/app/src/components/date-range.test.ts`
- Create: `apps/app/src/components/DateRangeSelect.tsx`
- Modify: `apps/app/src/components/UsagePanel.tsx`
- Modify: `apps/app/src/components/AuditPanel.tsx`

**Why:** Both are time-series pages with no time scope. The admin cannot ask "what happened last week".

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/components/date-range.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { rangeToBounds, RANGE_PRESETS } from "./date-range";

const NOW = new Date("2026-07-29T12:00:00.000Z");

describe("date range", () => {
  it("resolves 24 hours back from the reference instant", () => {
    const bounds = rangeToBounds("24h", NOW);
    expect(bounds.to.toISOString()).toBe("2026-07-29T12:00:00.000Z");
    expect(bounds.from.toISOString()).toBe("2026-07-28T12:00:00.000Z");
  });

  it("resolves 7 days", () => {
    expect(rangeToBounds("7d", NOW).from.toISOString()).toBe(
      "2026-07-22T12:00:00.000Z",
    );
  });

  it("resolves 30 days", () => {
    expect(rangeToBounds("30d", NOW).from.toISOString()).toBe(
      "2026-06-29T12:00:00.000Z",
    );
  });

  it("returns an open lower bound for all time", () => {
    expect(rangeToBounds("all", NOW).from).toBeUndefined();
  });

  it("exposes every preset the select renders", () => {
    expect(RANGE_PRESETS).toEqual(["24h", "7d", "30d", "90d", "all"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @romeo/app test date-range`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/app/src/components/date-range.ts`:

```ts
/**
 * Time scope for the consumption and audit views. The reference instant is a
 * parameter rather than an internal `new Date()` so the behaviour is testable
 * without freezing the clock.
 */
export const RANGE_PRESETS = ["24h", "7d", "30d", "90d", "all"] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

const DAYS: Record<Exclude<RangePreset, "all">, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export function rangeToBounds(
  preset: RangePreset,
  now: Date,
): { from: Date | undefined; to: Date } {
  if (preset === "all") return { from: undefined, to: now };
  const from = new Date(now.getTime() - DAYS[preset] * 24 * 60 * 60 * 1000);
  return { from, to: now };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @romeo/app test date-range`
Expected: PASS, 5 tests.

- [ ] **Step 5: Build the select**

Create `apps/app/src/components/DateRangeSelect.tsx`:

```tsx
import { NativeSelect } from "@romeo/ui";

import { useLocale } from "../lib/i18n";
import { RANGE_PRESETS, type RangePreset } from "./date-range";

const LABEL_KEYS = {
  "24h": "rangeLast24Hours",
  "7d": "rangeLast7Days",
  "30d": "rangeLast30Days",
  "90d": "rangeLast90Days",
  all: "rangeAllTime",
} as const;

export function DateRangeSelect(props: {
  value: RangePreset;
  onChange: (value: RangePreset) => void;
}): React.ReactNode {
  const { t } = useLocale();
  return (
    <NativeSelect
      aria-label={t("rangeLabel")}
      name="dateRange"
      onChange={(event) => props.onChange(event.target.value as RangePreset)}
      value={props.value}
    >
      {RANGE_PRESETS.map((preset) => (
        <option key={preset} value={preset}>
          {t(LABEL_KEYS[preset])}
        </option>
      ))}
    </NativeSelect>
  );
}
```

- [ ] **Step 6: Add the keys to all three locales**

`en/shared-control.json`:

```json
"rangeLabel": "Time range",
"rangeLast24Hours": "Last 24 hours",
"rangeLast7Days": "Last 7 days",
"rangeLast30Days": "Last 30 days",
"rangeLast90Days": "Last 90 days",
"rangeAllTime": "All time"
```

`es`:

```json
"rangeLabel": "Intervalo de tiempo",
"rangeLast24Hours": "Últimas 24 horas",
"rangeLast7Days": "Últimos 7 días",
"rangeLast30Days": "Últimos 30 días",
"rangeLast90Days": "Últimos 90 días",
"rangeAllTime": "Todo el tiempo"
```

`fr`:

```json
"rangeLabel": "Plage temporelle",
"rangeLast24Hours": "Dernières 24 heures",
"rangeLast7Days": "7 derniers jours",
"rangeLast30Days": "30 derniers jours",
"rangeLast90Days": "90 derniers jours",
"rangeAllTime": "Depuis le début"
```

- [ ] **Step 7: Wire it into both panels**

In `UsagePanel.tsx` and `AuditPanel.tsx`, hold `const [range, setRange] = useState<RangePreset>("7d")`, render `<DateRangeSelect value={range} onChange={setRange} />` in the filter row, and pass `rangeToBounds(range, new Date())` into the existing query key and request parameters.

**If the API does not accept date bounds:** filter client-side over the already-fetched rows and add a `ponytail:` comment naming the ceiling:

```tsx
// ponytail: client-side range filter; move to a server parameter when the
// audit dataset outgrows one page.
```

- [ ] **Step 8: Verify**

Run: `pnpm --filter @romeo/app check && pnpm --filter @romeo/app test && pnpm check:ui-form-contracts && pnpm quality:browser`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/app/src/components apps/app/src/locales
git commit -m "feat(admin): add time range control to usage and audit"
```

---

# FINAL VALIDATION

### Task 9.1: Full gate + baseline closure

- [ ] **Step 1: Confirm every baseline row is cleared**

Open `docs/quality/admin-remediation-baseline.md`. Every row must read ✅. If any row is still open, go back to the phase that owns it.

- [ ] **Step 2: Run the full merge gate**

Run: `pnpm verify`

Expected: **exit 0.** This runs format check, architecture ratchet, dependency cruiser, test contracts, UI form contracts, OpenAPI coverage, contract lint, SDK drift, typecheck, all unit tests, production build, bundle budget, and the full browser quality suite.

If `check:bundle-budget` fails, you added weight. The likely cause is a new icon import — verify every lucide import uses the deep path form `lucide-react/dist/esm/icons/<name>.mjs`, never `from "lucide-react"`.

- [ ] **Step 3: Walk all 24 sections by hand**

Run `pnpm dev` and visit each section. For each, confirm:

- Exactly one (or zero) primary button
- Refresh, if present, is a ghost icon button
- Any empty state has an icon, a sentence, and an action where one makes sense
- No snake_case or error codes visible
- Destructive actions sit in a danger zone or open a dialog

- [ ] **Step 4: Check both themes and mobile**

Toggle the theme switch in the top bar. Confirm the new `rm-danger-zone`, `rm-save-bar`, `rm-provider-card` and `rm-settings-section` surfaces read correctly in **both** light and dark — they use `color-mix` against tokens, so they should, but verify.

Resize to 390px wide. Confirm the provider grid collapses to one column and no horizontal scroll appears on `<body>`.

- [ ] **Step 5: Commit the final baseline**

```bash
git add docs/quality/admin-remediation-baseline.md
git commit -m "docs(quality): close out admin remediation baseline"
```

---

## Out of Scope

Explicitly **not** in this plan. Do not attempt these; raise them separately.

- Adding a user-invite backend endpoint (Task 4.1 branches around it).
- Server-side date filtering for audit/usage (Task 8.3 falls back to client-side with a marked ceiling).
- Adding jsdom or React Testing Library. The repo's two-layer strategy — pure-logic node tests plus the Playwright admin-console audit across chromium/firefox/webkit — already covers this ground. A fake-DOM layer in between would duplicate the browser layer while being less faithful on exactly the layout and focus behaviour this work changes.
- Redesigning the RAG stat tiles that echo their own form fields. Worth doing; needs its own decision about what those tiles should show instead.
- Consolidating the four-way provider-picker inconsistency for **web search** (the preset select). Phases 2–3 unify Authentication and Connected apps; web search has genuinely different cardinality (one active provider, not N slots) and needs a separate decision.
