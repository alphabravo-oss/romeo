# Console conformance — consolidated remediation plan

74 verified defects collapse to **19 root causes**. 8 of them are single-line edits in shared primitives that clear ~40 of the reported symptoms. Do those first; the per-page conversion sweep is last and mechanical.

---

## P0 — functional breakage

### 1. Audit log never renders (infinite refetch loop)

**Cause:** `new Date()` in the render body flows into the react-query key.
**Route:** `/admin?section=audit`
**Fix:** `apps/app/src/components/AuditPanel.tsx:114`

```ts
// round the instant so the key is stable across renders
const bounds = useMemo(
  () => rangeToBounds(range, roundToMinute(new Date())),
  [range],
);
```

Add `roundToMinute` (floor to 60*000 ms) to `apps/app/src/components/date-range.ts` and apply it inside `rangeToBounds` so \_every* caller (Analytics, Usage) is protected, not just Audit. Verify: ≤ 12 requests to `/api/v1/audit-logs` on load, table renders 50 rows.

---

## P1 — shared-primitive bugs visible on every page

### 2. `default`/`outline` buttons have a transparent border (invisible in light theme)

**Cause:** `packages/ui/src/styles.css:52` `border: 1px solid transparent` (0,1,0) beats the `:where(...)` rule at :86 (0,0,0). The `box-shadow` from the same block lands, proving only `border-color` loses.
**Routes:** every console route — billing (`Add quota`, `Apply plan`), usage/analytics (`Export CSV`), voice (`Sync`), evals (`Run suite`), collaboration (`Share` ×3), agents (`New custom model`, `Support`/`Research`/`Operations`), curated (`Review model`).
**Fix:** `packages/ui/src/styles.css:86` — drop the `:where()`:

```css
.rm-ui-button--default,
.rm-ui-button--outline {
  border-color: var(--rm-ui-border);
  box-shadow: 0 1px 2px #0000000f;
}
```

Then delete the per-component workaround at `apps/app/src/styles/app-navigation.css:213` (`.rm-theme-toggle { border: … }`) — it exists only to route around this bug.

### 3. Rail nav rows inherit the `--default` drop shadow

**Cause:** `.rm-ui-button.rm-console-item` (`app-content.css:150`) resets `border` and `background` but not `box-shadow`; every other de-chroming rule in that file (`:236`, `:388`, `:1012`, `:1050`) pairs them.
**Routes:** all console + workspace routes (shared `ConsoleLayout`).
**Fix:** `apps/app/src/components/ConsoleLayout.tsx:115` — pass `variant="ghost"` to the rail `Button`. (Belt-and-braces: add `box-shadow: none;` at `app-content.css:150`.) Note this becomes _more_ visible after fix #2, so ship both together.

### 4. `.rm-ui-control` base style leaks into toolbars and rows

**Cause:** `packages/ui/src/styles.css:140-150` — `width: 100%`, `min-height: 2.375rem` (38px, above the entire 30/34/36 button scale), and a `background:` **shorthand** that wipes the native-select chevron `background-image`.
**Symptoms merged (7 defects):** full-bleed `DateRangeSelect` on audit; wrapped 2-row action clusters on analytics + usage; 54px table search on curated; 38/39 vs 36px mismatch on workspace-members; missing select chevron; 41px search on users; 213px table search everywhere.
**Fix — `packages/ui/src/styles.css`:**

```css
.rm-ui-control {
  min-height: 2.25rem; /* 36px — matches .rm-ui-button */
  background-color: var(
    --rm-ui-surface
  ); /* was `background:` — stop wiping background-image */
  /* width: 100% removed from the base */
}
.rm-ui-field .rm-ui-control,
.cs-fields .rm-ui-control {
  width: 100%;
} /* full width only inside a field stack */
```

Then `apps/app/src/styles/app-content.css:1251` (`.rm-table-search input`) add `min-height: 0; padding: 0;` — mirroring the already-correct `app-sidebar-controls.css:20-24` fix. And give the search wrapper a real measure: `.rm-table-search { width: 100%; max-width: var(--rm-measure-search); }` (`app-content.css:1239`), replacing the inert hard-coded `280px`.
Re-audit `NativeSelect` call sites after removing `width:100%` — a few (`AuditPanel.tsx:211/220/238`) carry `style={{maxWidth:…}}` hacks that can then be deleted.

### 5. Buttons/pills stretch because they are grid items

**Cause:** no rule keeps intrinsic-width controls intrinsic inside `display: grid` parents; `inline-flex` blockifies.
**Symptoms merged (7 defects):** `Save configuration` 704px (chat-experience), `Add quota`/`Apply plan` 704px (billing), `Run test` 886px (capabilities), `Compare` 886px (versions), `Export`/`Archive workspace` 1162px (governance lifecycle), status pills stretched to 128px (providers Catalog column), read/run/write checkboxes spread over 886px (agents access).
**Fix — `packages/ui/src/styles.css`:**

```css
.rm-ui-button,
.rm-ui-status-badge,
.rm-ui-check-label {
  justify-self: start;
} /* no-op in flex/block, decisive in grid */
```

Plus two container fixes that `justify-self` won't cover:

- `apps/app/src/components/WorkspaceLifecyclePanel.tsx:71` and `ChatLifecyclePanel.tsx:99` — change the bare `<div className="mt-4 grid gap-2 …">` to `<div className="cs-fields grid gap-2 …">` so they pick up the 44rem cap like `DataDeletionPanel`.
- `apps/app/src/components/AgentAccessPanel.tsx:324` — `grid grid-cols-3 gap-2` → `flex flex-wrap gap-4`.

### 6. `.rm-ui-field` stretches its rows, so neighbouring inputs differ in height

**Cause:** `packages/ui/src/styles.css:128-131` — `display: grid` with no `align-content`, so a taller sibling column inflates the short one's control row.
**Routes:** `/admin?section=rag` (topK 45.5 vs 39), `/workspace?section=agents` (Photo URL 45.5 vs Icon 39).
**Fix:** one line — `.rm-ui-field { align-content: start; }`. Verified counterfactual: both pairs snap to 39px, identical tops.

### 7. `Section` drops `description`, and emits an empty header for `null` actions

**Cause:** `apps/app/src/components/console/Section.tsx:26` — `hasHead` ignores `description` and tests `!== undefined` (so a `null` action still renders a 0-height header row that eats a 16px grid gap).
**Routes:** `/admin?section=workspace-members` (help copy never renders at all), `/admin?section=prompt-templates` (empty header band).
**Fix:**

```ts
const hasHead = title != null || actions != null || description != null;
```

and change the three inner `=== undefined` guards to `== null`.

### 8. Sortable table headers lose the header-band typography

**Cause:** `packages/ui/src/data-table-grid.tsx:131-141` wraps the label in `<Button variant="ghost" className="rm-th-sort-btn">`; **`.rm-th-sort-btn` has no CSS rule anywhere in the repo**, so `.rm-ui-button { font-weight: 540; color: var(--rm-ui-fg) }` plus the UA `button { text-transform: none }` defeat `.rm-table thead th`.
**Routes:** analytics, providers base-models, providers curated, observability, agents knowledge/tools/access, workspace tools/voice/knowledge — every table in the product.
**Fix:** add next to `apps/app/src/styles/app-content.css:850`:

```css
.rm-table thead th .rm-th-sort-btn {
  min-height: 0;
  padding: 0;
  color: inherit;
  font: inherit;
  font-weight: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  background: none;
}
.rm-table thead th:hover .rm-th-sort-btn {
  color: var(--rm-text);
}
```

The last line revives the dead `.rm-th-sortable:hover` affordance at `:871` (delete that rule).

### 9. Table pager overlaps the card; sticky actions cell punches a white notch

**Cause:** `apps/app/src/styles/app-content.css:1274` `margin-top: -16px` against a 10px `.rm-table-block` gap = 6px overlap; the `position: sticky; background: var(--rm-surface)` actions cell paints over the footer band.
**Routes:** every table with row actions; measured on `/admin?section=users`.
**Fix:** `margin-top: -10px` (true flush). Restores the wrap's bottom border and removes the 172×5px notch.

---

## P2 — one page, one shape: heading and section structure

### 10. Duplicate headings (page title repeated by section title, tab label, or a bare div)

**Cause:** panels pass a `title` the page header already renders, or hand-roll a heading div. `Section.tsx:21` already documents the rule.
**Routes & exact edits (delete the title / delete the div):**

| Route                                   | Edit                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `?section=billing`                      | `BillingPanel.tsx:108` remove `title={t("billing")}`                                              |
| `?section=organizations`                | `OrganizationsPanel.tsx:228` remove `title`                                                       |
| `?section=workflows`                    | `WorkflowsPanel.tsx:253` remove `title`                                                           |
| `?section=webhooks`                     | `WebhooksPanel.tsx:295` remove `title`                                                            |
| `?section=connected-apps`               | `ConnectedAppsPanel.tsx:177` remove `title`                                                       |
| `?section=audit`                        | `AuditPanel.tsx:189` remove `title`                                                               |
| `?section=web-search`                   | `WebSearchPanel.tsx:115` remove `title`                                                           |
| `?section=posture`                      | `OperationsPosturePanel.tsx:45` delete the `<div className="mb-3 text-sm text-muted">`            |
| `?section=analytics`                    | `AnalyticsPanel.tsx:124` delete the muted "Analytics" div                                         |
| `?section=usage`                        | `UsagePanel.tsx:189` delete the muted "Usage" div                                                 |
| `?section=governance`                   | `GovernancePanel.tsx:52` delete the `.rm-card-title` div                                          |
| `?section=access`                       | `routes/admin.tsx:465` change tab label `t("navAccessKeys")` → `t("apiKeys")`                     |
| `?section=access&view=service-accounts` | `ServiceAccountPanel.tsx:231` remove `title`                                                      |
| `providers&view=observability`          | `ProviderObservabilityPanel.tsx:171` delete the `.rm-card-title` div                              |
| `providers&view=curated`                | `ManagedModelAdminPanel.tsx:325` heading == tab label; drop it in the conversion (#12)            |
| `connections&view=tools`                | `ToolConnectorPanel.tsx:229` drop it in the conversion (#12)                                      |
| `connections&view=imports`              | `DataConnectorImportsTab.tsx:61` delete the `.rm-card-title` div                                  |
| `connections` (sources)                 | `DataConnectorPanel.tsx:197` delete the `.rm-card-title` div                                      |
| `agents&tab=access`                     | `AgentAccessPanel.tsx:288` `<h3>{t("agentAccess")}</h3>` → expand to "Access & sharing" or delete |
| `agents&tab=versions`                   | `AgentVersionPanel.tsx:122` delete the muted "Versions" div                                       |
| `analytics`                             | `AnalyticsPanel.tsx:313` delete the duplicate "Needs attention" label above the callout           |

**Guard:** wire `scripts/console-audit.mjs` `duplicate-title` into CI over the full admin+workspace route list so this cannot regress.

### 11. No sub-section primitive → six pages fake headings with muted 12px divs + `mt-3/mb-2`

**Cause:** the console system has `Section` and nothing between it and body content, so panels invent labels and own their own margins — which `console/index.ts` explicitly forbids.
**Routes:** analytics (6 labels), usage (3), connected-apps (3), agents versions/behavior/capabilities, billing, impersonation, notification-channels, providers ×3 views, rag.
**Fix — add the missing primitive** in `apps/app/src/components/console/Section.tsx` + `styles/console.css`:

```tsx
export function Subsection({ title, actions, children }: {...}) {
  return (
    <div className="cs-subsection">
      <div className="cs-subsection__head"><h4 className="cs-subsection__title">{title}</h4>{actions}</div>
      {children}
    </div>
  );
}
```

```css
.cs-subsection {
  display: grid;
  gap: 10px;
  min-width: 0;
}
.cs-subsection__title {
  margin: 0;
  color: var(--rm-text);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
}
```

Then convert and **delete every margin utility** at: `AnalyticsPanel.tsx:313,331,339,348,369,384`; `UsagePanel.tsx:228,238,246`; `ConnectedAppsPanel.tsx:179,251,359`; `AgentVersionPanel.tsx:121,122,130`; `BillingPanel.tsx:110` (→ `Section description` prop), `:427`; `ProviderObservabilityPanel.tsx:172,200,209`; `ModelCatalogPanel.tsx:315`; `ManagedModelAdminPanel.tsx:359`; `ImpersonationPanel.tsx:285`; `NotificationChannelPanel.tsx:424`; `ConnectedAppsPanel.tsx:233`; `AgentTestConsole.tsx:96` and `ManagedModelCustomizationPanel.tsx:53` (also drop their `border-t` — it double-rules against the tab strip 40px above).

### 12. Legacy conversion debt — one cause, N call sites

**Cause:** panels never converted to `Page`/`Section`/`EmptyState`/`Disclosure`. The repo already names it: `app-content.css:227-229, 336-342` ("remaining conversion debt, not a design decision").
**Fix:** convert each call site to `<Section>` (or `Subsection` from #11), delete the legacy class, then delete the corresponding compensating selector from `app-content.css`. Order by visibility:

| Legacy class                                     | Call sites                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.rm-panel` + `.rm-card-header`/`.rm-card-title` | `ManagedModelAdminPanel.tsx:322-326`, `ModelCatalogPanel.tsx:310-313`, `ToolConnectorPanel.tsx:227-229`, `AbuseControlsPanel.tsx:105,106,290,314,387`, `RagPolicyTab.tsx:62-64`, `ChatExperiencePanel.tsx:103`, `ImpersonationPanel.tsx:285-292`, `AgentStudioPanel.tsx:272,279`, `EvalPanel.tsx`           |
| `.rm-console-page` / `.rm-console-toolbar`       | `KnowledgeCatalogPage.tsx:87,90`, `VoicePanel.tsx:149,150`, `EvalPanel.tsx:169,170` — replace with `<Section actions={…}>`; the lone right-floating `Sync`/`New suite` button belongs in the section action slot                                                                                            |
| `.rm-managed-model-section`                      | `ManagedModelToolPanel.tsx:125`, `ManagedModelKnowledgePanel.tsx:113`, `AgentAccessPanel.tsx:283`, `AgentStudioPanel.tsx:339,360` — 15px/600 headings → `.cs-section__title`                                                                                                                                |
| `.rm-admin-disclosure`                           | `AdminDisclosure.tsx` — retarget the component's internals to `.cs-disclosure` markup rather than editing 6 call sites (`AdminOverview`, `RagPolicyTab:441`, `GovernancePanel:77`, `WebSearchPanel`, `AgentDraftForm` ×3); then delete `admin.css:2-83` and the `admin.css` import at `routes/admin.tsx:58` |
| `.rm-empty`                                      | fix the shared helper `apps/app/src/lib/panel-state.tsx:18` → render `EmptyState` (covers 12 sites incl. `ChatExperiencePanel.tsx:122`); delete `app-foundation.css:730-734`                                                                                                                                |
| `.rm-provider-zone`                              | `ConnectedAppsPanel.tsx:279,318,340` — the wrapper `grid gap-4` already spaces them; delete `admin.css:346 margin-block-start`                                                                                                                                                                              |
| `.rm-danger-zone`                                | `DangerZone.tsx:11` → `<Section tone="danger">`; delete `admin.css:317-336`                                                                                                                                                                                                                                 |

### 13. Catalog tiles have no container

**Cause:** `DataConnectorCatalog.tsx:116` uses `.rm-panel` for _grid tiles_, and `app-content.css:232` flattens `.rm-panel` to nothing.
**Route:** `?section=connections&view=catalog`
**Fix:** replace `className="rm-panel"` + inline `padding:14` with a real tile class in `console.css`: `border: 1px solid var(--rm-border); border-radius: 12px; background: var(--rm-surface); padding: 14px;`. While there, fix the ragged CTAs: the card becomes `display:grid; grid-template-rows: auto 1fr auto` so the button bottom-anchors, and add `white-space: nowrap` to `.rm-status` (`app-content.css:552`) so "Setup needed" stops wrapping.

### 14. Ad-hoc bordered form boxes (`rounded-md border`) instead of flat sections

**Cause:** no field-group primitive; panels hand-roll Tailwind.
**Routes:** `?section=rag` (`RagPolicyTab.tsx:221,258,342,394`), `?section=abuse` (`IdListEditor.tsx:37` raw `<fieldset>/<legend>` with UA notch rendering), `?section=connected-apps` (`ConnectedAppsPanel.tsx:233`).
**Fix:** use `Subsection` from #11 (flat, hairline, no radius-6 box). For `IdListEditor` keep `<fieldset>/<legend>` for a11y but strip `rounded-md border border-border p-3` and style the legend as `.cs-subsection__title`.

### 15. Billing data card capped at the 44rem form measure

**Cause:** `console.css:185` `.cs-section__body :where(.cs-fields, form) { max-width: 44rem }` catches a `<form>` that wraps a `DataTable`.
**Route:** `?section=billing` (704px table in a 1188px column).
**Fix:** narrow the selector to `.cs-fields` only, and add `className="cs-fields"` to the form elements that legitimately want the cap (`BillingPanel.tsx:359` keeps the cap on its field rows but wraps the `DataTable` outside the form, or moves the table into a sibling `Section`). Prefer the explicit opt-in — the bare `form` selector will keep catching future data tables.

### 16. Model-catalog toolbar 444px trough

**Cause:** `app-foundation.css:612` `minmax(12rem,1fr)` gives column 1 all slack while `app-content.css:689` caps the control at 320px.
**Route:** `?section=providers&view=base-models`
**Fix:** move the cap to the track — `grid-template-columns: var(--rm-measure-search) minmax(10rem,14rem) minmax(10rem,12rem); justify-content: start;` and drop `max-width` from the control.

---

## P3 — action/CTA conventions and copy

### 17. Primary-action conventions

One rule, six symptoms. **Enforce: exactly one filled primary per section; header action hidden while the list is empty.**

- `EvalPanel.tsx:172` + `:351` → guard header button on `suites.length > 0` (two primaries on screen).
- `CollaborationPanel.tsx:385` → same guard (two "New folder" primaries).
- `ServiceAccountPanel.tsx:223,243` → `<Button variant="secondary">+ …</Button>` → `<AddButton>` (gets `variant="primary"` + `Plus` icon).
- `CreateManagedModelDialog.tsx:105` → default trigger `<Button variant="primary">`.
- `BillingPanel.tsx:102` → pass `primary={<AddButton>{t("addQuota")}</AddButton>}` to `PageActions`; `:433/:459` become `variant="secondary"`/`variant="primary"` respectively, wrapped in `<div className="flex gap-2">`.
- `QuotaPanel.tsx:133` → add `variant="danger"` to Delete (the dead rule at `app-content.css:1023` exists for exactly this).
- `WorkflowsPanel.tsx:243` → the 36px `Button` next to the 32px `.cs-icon-button`: set `.cs-icon-button { width: 36px; height: 36px }` in `console.css:397` so the console icon button matches the `@romeo/ui` scale (also resolves the 32-vs-34 toolbar mismatch complaint).

### 18. i18n / copy defects

- **Raw keys rendered as headers** (`tools`, `status`, `risk`): `apps/app/src/lib/i18n.tsx:52-67` — the `workspace` namespace group omits `chat-supplement` and `security`. Fix at the call sites instead (cheaper, no bundle growth): `ToolPanel.tsx:45,61` and `ManagedModelToolPanel.tsx:58` → `t("workspaceTools")` / `t("toolStatus")`; `workspace-capability.json:24` `"workspaceToolRisk": "risk"` → `"Risk"`.
- **"1 results"**: `packages/ui/src/data-table-controls.tsx:85` and `advanced-data-table.tsx:374` — take `labels.results` as `(n: number) => string` from `DataTable.tsx:34` using `Intl.PluralRules`; add `tableResult`/`tableResults` keys in en/es/fr; update `advanced-data-table.test.tsx:75`.
- **Switch label repeats its own column header**: `AuthProviderSplitView.tsx:140`, `ManagedModelKnowledgePanel.tsx:100`, `ProviderModelsTable.tsx:110`, `ModelCatalogPanel.tsx:230` — replace `label={…}` with `aria-label={…}` on the `Switch` (add `aria-label` passthrough in `packages/ui/src/forms.tsx:186` if absent). Also kills the "10 off toggles all captioned Enabled" defect.
- **Unlabelled principal picker**: `ResourceGrantEditor.tsx:73` — wrap in `<Field label={t("personOrGroup")}>` and pass `placeholder={t("selectShareTarget")}`, matching `CollaborationPanel.tsx:254`.
- **Audit section description describes a body control**: `AuditPanel.tsx:188` — move `auditIncludeBackgroundHelp` to the `Checkbox` at `:245` as its `description`, off the `Section`.
- **Unlabelled 44-row access table** under the retention danger block: `GovernanceRetentionTab.tsx:278` — wrap in `<Subsection title={t("govAccessGrants")}>`.
- **Unlabelled prompt-preset buttons**: `AgentDraftForm.tsx:321` — add a `Subsection` label ("Start from a preset"); needs one new i18n key.
- **Quota raw values**: `QuotaPanel.tsx:103` wrap in `<LocalizedNumber>`; `:110` `t(row.resetPeriod)` — the `monthly` key already exists.

### 19. Empty states are bare

**Cause:** callers don't pass `emptyIcon`/`emptyDescription` (supported at `panel-state.tsx:27-31`).
**Routes:** evals, tools, collaboration, prompt-templates.
**Fix:** give `PanelState` a default icon in `apps/app/src/lib/panel-state.tsx` (an `Inbox` glyph) so every call site gets the 40px tile for free; add descriptions only where the empty state has an action. Also `packages/ui/src/feedback.tsx:22` — `<h2 className="rm-ui-empty__title">` → `<h3>`; it currently sits inside an `h3` section and reopens page level.

### 20. Circular kebab leaking from the chat composer

**Cause:** `apps/app/src/styles/app-conversation.css:553` styles `.rm-icon-button` globally with `border-radius: 9999px` under a comment scoping it to the composer.
**Fix:** scope it — `.rm-composer .rm-icon-button, .rm-send-button { border-radius: 9999px }` — and delete the counter-override at `app-content.css:1396`.

---

## Not worth fixing

| Defect                                                                                | Why                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.rm-panel` on the agents editor shell (`AgentStudioPanel.tsx:272`)                   | Measured `padding 0, border 0, radius 0, background transparent, shadow none` — the flattening rule already neutralizes it. Zero visual delta. Rename during the #12 sweep, never as its own ticket.                                  |
| Readiness-checklist rows ragged by 31px (`admin.css:805`)                             | Needs `subgrid` or a fixed label track across independent `<details>` elements. If you touch it at all, change `minmax(7rem, auto)` → `9rem` and move on; otherwise skip — it is inside a collapsed disclosure most users never open. |
| Single-metric stat band on `?section=groups`                                          | `.cs-stats` auto-fit behaving correctly with one item. Either add a second metric (active/total) as a product decision or leave it. Not a CSS bug.                                                                                    |
| Inline row actions vs overflow menu on `providers&view=curated`                       | Inline actions appear in many panels app-wide; there is no design-system rule setting an action-count threshold. Cosmetic inconsistency, not a violation. Defer until a rule exists.                                                  |
| Icon-button 32 vs 34px across _separated_ rows (workspace tools)                      | Below perceptual threshold when the controls are 500px apart. Fix #17's `.cs-icon-button → 36px` incidentally resolves the adjacent-row case; don't chase the rest.                                                                   |
| Kebab radius 9999px on a _ghost_ button                                               | Invisible at rest (transparent background); only shows on hover. Fixed for free by #20 — do not file separately.                                                                                                                      |
| "Ad-hoc margin" on `NotificationChannelPanel.tsx:424` framed as "Section owns rhythm" | The header is four levels deep inside a tab panel, not a Section child. Just delete `mt-4` as part of #11; the framing in the report is wrong and shouldn't drive a Section change.                                                   |

---

## Execution order

1. **Batch A (one PR, ~10 lines):** #2, #3, #5, #6, #7, #9 — six shared-primitive one-liners. Re-run `console-audit.mjs` across all routes before/after; expect the largest single drop in findings.
2. **Batch B:** #1 (audit loop), #4 (`.rm-ui-control` scoping — needs a call-site sweep of `NativeSelect`/`Input` after removing `width:100%`), #8 (`.rm-th-sort-btn`).
3. **Batch C:** #10 duplicate headings (mechanical, ~20 one-line deletes) + CI gate.
4. **Batch D:** #11 `Subsection` primitive, then #12 conversion sweep, deleting each compensating selector in `app-content.css` as its call sites convert. Target state: `LEGACY_CLASSES` in `console-audit.mjs` reports zero, and `admin.css` can be dropped from `routes/admin.tsx:58`.
5. **Batch E:** #13-#20 (layout one-offs, CTA conventions, copy/i18n).
