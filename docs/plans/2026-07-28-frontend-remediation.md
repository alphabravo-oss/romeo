# Frontend Remediation Plan — 45 audited defects

Source: multi-agent static audit of `apps/app/src`, 2026-07-28. 48 raw findings, adversarially
verified; 45 confirmed, 3 refuted and dropped. Severity: 5 × P0, 16 × P1, 24 × P2.

This document is the complete work order. It is written to be executed by an AI agent with no
prior context on this repository. Read §1 and §2 in full before touching any file.

---

## 0. How to use this document

1. Read §1 (ground truth) and §2 (global rules). They are not optional context; several rules
   invalidate the "obvious" implementation of later work packages.
2. Work packages (§4) are ordered. WP1 and WP2 are release blockers. Do not reorder them to
   pick off easy wins first — WP1's four sub-tasks share one fix shape and one review.
3. Each work package is self-contained: findings covered, why it matters, exact current code,
   exact target code, new i18n keys with all three translations, the test to write, and the
   verification command. Execute a package end to end, run its gate, commit, then move on.
4. §5 maps all 45 findings to their work package, so nothing is silently dropped.
5. §6 is the definition of done for the whole effort.

**If a target snippet below does not match the file you open**, the file has changed since the
audit. Stop, re-read the surrounding function, and adapt — do not force the patch. Line numbers
are from 2026-07-28 and will drift as you edit; treat them as hints, and locate code by symbol
name.

---

## 1. Ground truth

### 1.1 Stack

| Concern         | Choice                                                   | Notes                                                                                    |
| --------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Framework       | TanStack Start + TanStack Router v1                      | file routes in `apps/app/src/routes/`                                                    |
| UI runtime      | React 19.2                                               |                                                                                          |
| Language        | TypeScript 6                                             | `strict`; `exactOptionalPropertyTypes` is on — see §2.4                                  |
| Data            | TanStack Query v5                                        | `useQuery` / `useMutation`, no suspense                                                  |
| Forms           | TanStack **react-form** v1.33                            | `useForm`, `form.Field`, `form.Subscribe`, `useStore(form.store, sel)`                   |
| Tables          | TanStack Table v8 via local `./DataTable`                | `createColumnHelper` re-exported                                                         |
| Styling         | Tailwind v4 + hand-written CSS in `apps/app/src/styles/` | `--rm-*` design tokens                                                                   |
| Design system   | `@romeo/ui` (workspace package)                          | `Button`, `Input`, `Textarea`, `Select`, `NativeSelect`, `Field`, `AlertDialog`, `toast` |
| i18n            | i18next + react-i18next, 33 namespaces × 3 locales       | `apps/app/src/locales/{en,es,fr}/*.json`                                                 |
| Icons           | `lucide-react`, imported by deep path                    | `import X from "lucide-react/dist/esm/icons/x.mjs"` — never barrel-import                |
| Package manager | pnpm workspaces                                          | `pnpm --filter @romeo/app <script>`                                                      |

Do **not** add a dependency to complete any work package in this document. Every fix here is
achievable with what is already installed. If you believe otherwise, stop and report it.

### 1.2 Commands

```bash
# From the repo root.
pnpm --filter @romeo/app check     # tsc -p tsconfig.json --noEmit    <- primary gate
pnpm --filter @romeo/app test      # vitest run
pnpm --filter @romeo/app dev       # vite dev, serves on :3000  (NOT 5173)
pnpm check:ui-form-contracts       # AST scan: named + labelled controls inside <form>
pnpm format                        # prettier --write .
pnpm format:check                  # prettier --check .   <- CI gate
```

`check` and `test` must both pass at the end of every work package. `format` must be run before
every commit; the repo is Prettier-formatted with zero exceptions.

The dev server runs on **port 3000**. Port 5173 belongs to an unrelated application on this
machine. Never assume 5173.

### 1.3 Testing — read this before writing any test

`apps/app/vitest.config.ts` is:

```ts
export default defineConfig({
  test: { environment: "node", passWithNoTests: true },
});
```

**There is no jsdom. There is no `@testing-library/react`. There is no `happy-dom`.** React
components cannot be rendered in a test in this repository, and adding the ability to is out of
scope for this plan.

The established pattern — used by `chat-selection.ts`/`chat-selection.test.ts`,
`catalog-page.ts`/`catalog-page.test.ts`, `retention.ts`/`retention.test.ts`,
`auth-navigation.ts`/`auth-navigation.test.ts` — is:

> Extract the **decision** into a pure, import-free `.ts` module colocated with the component.
> Unit-test that module in node. Leave the component as thin wiring that calls it.

`apps/app/src/components/chat-selection.ts` is the reference implementation. Note its house
style: a long header comment explaining _why the logic is subtle_, an exported interface
describing the inputs, and a single exported predicate. Match it.

Every work package below specifies which pure module to create or extend. **Do not write a test
that renders a component. Do not add a test environment.** If a change genuinely has no
extractable decision (a pure rename, a CSS token swap, a translated string), it gets no unit
test — the typecheck and the i18n parity test cover it. That is stated explicitly per package.

### 1.4 Conventions you must follow

**SDK access.** No component calls the generated SDK directly. Each feature area has
`apps/app/src/features/<area>/{queries,mutations,types}.ts` re-exported through `index.ts`.
Wrappers follow exactly this shape:

```ts
export async function setLocalPassword(
  input: SetLocalPasswordRequest,
): Promise<LocalAuthStatus> {
  configureBrowserApiClients();
  const response = await localAuthSetPassword({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}
```

`configureBrowserApiClients()` first, `throwOnError: true` always, unwrap `response.data.data`.
The double `.data` is the HTTP envelope plus the API's `{ data: ... }` envelope; it is correct.

**Confirmation dialogs.** `useConfirm()` from `./ConfirmDialog`:

```tsx
const { ask, dialog } = useConfirm();

async function handleDelete(id: string) {
  if (
    !(await ask({
      title: t("deleteSourceTitle"),
      body: t("deleteSourceBody"),
      confirmLabel: t("delete"),
      tone: "danger", // renders the confirm button variant="danger"
    }))
  )
    return;
  await deleteMutation.mutateAsync(id);
}

return <section>…{dialog}</section>; // the dialog node MUST be rendered
```

Forgetting to render `{dialog}` makes `ask()` hang forever with no visible dialog. It is the
single most common mistake with this hook.

**Query state.** `PanelState` from `../lib/panel-state` renders loading / error / empty / data
for a `UseQueryResult` uniformly. Any table or list fed from a query must go through it —
consuming `query.data ?? []` raw renders a _confident empty state_ when the request failed,
which is finding P2-7 in this very audit. Do not introduce new instances of it.

```tsx
<PanelState query={requestsQuery} empty={t("noPendingRequests")}>
  {(requests) => <DataTable columns={columns} data={requests} />}
</PanelState>
```

**Toasts.** `toast(message, "success" | "error")` from `../lib/toast`.

**Inline errors.** The class is `.rm-composer-error`; it uses `var(--rm-danger)` (4.83:1 on
white) and must carry `role="alert"`. Never hand-roll an error colour, and never use Tailwind's
`text-red-300` (1.92:1 — a WCAG failure that appears three times in this audit).

**Form labels.** `Field` from `@romeo/ui` renders a real `<label htmlFor>` bound to the control:

```tsx
<Field label={t("limit")}>
  <Input name="limit" value={…} onChange={…} />
</Field>
```

Prefer `Field` over `aria-label` everywhere. `aria-label` is a fallback for controls with no
visible label, and it must still be translated — several findings here are `aria-label` strings
hardcoded in English, one of which uses an _example value_ ("to@example.com") as the accessible
name, which changes when a sibling select changes.

**Design tokens.** Status colours live in `apps/app/src/styles/app-foundation.css` as
`--rm-success` / `--rm-warning` / `--rm-danger`, defined once for light and once for
`html.dark`. Light values are the Tailwind 700 ramp because they carry text and must clear
4.5:1; dark values are the 400 ramp. Never hardcode a hex for status.

### 1.5 i18n — the rules that will fail your build

- `useLocale()` returns `{ locale, setLocale, t }` where `t: (key: MessageKey) => string`.
- `MessageKey` is **derived from the JSON files**, so a key that does not exist in
  `en/*.json` is a compile error. This is a feature: add the key first, then use it.
- Namespaces are lazy. `useLocaleNamespaces(localeNamespaceGroups.settings)` at the top of a
  route loads that group. `core` is always bundled.
- `apps/app/src/lib/i18n.test.ts` enforces, for **all 33 namespaces**:
  1. `es` and `fr` key sets are exactly equal to `en`'s;
  2. no value is empty or whitespace;
  3. interpolation variables (`{{name}}`) match across locales.
- Therefore: **every key you add must be added to all three locales in the same commit**, with
  a real translation. Do not paste the English string into `es`/`fr` — the parity test will pass
  but the product ships wrong. Translations are supplied verbatim in this document for every key
  it introduces; use them.
- Keep each JSON file sorted case-insensitively by key. The files are currently sorted; a
  reviewer diffing an unsorted file cannot see what changed.

### 1.6 What has already been fixed — do not re-report or redo

A prior session in this repo completed the following. Treat them as done:

- Sidebar row geometry unified (`--rm-row-h: 32px`, `--rm-row-px: 8px`); the `@romeo/ui`
  `.rm-ui-button` base leak (`min-height: 2.25rem`, `justify-content: center`) is reset once in
  `app-navigation.css` under the "Sidebar row contract" block. **If a newly composed control
  comes out the wrong height or centred, that base is why** — add it to the reset selector list,
  do not patch geometry at the call site.
- `--rm-success` / `--rm-warning` / `--rm-danger` defined and WCAG-verified for both themes.
- Route error boundaries: `RouteErrorBoundary` + `RouteNotFound` wired as router defaults in
  `router.tsx`.
- `theme-color` meta split by colour scheme in `__root.tsx`.
- Top-bar workspace switcher made conditional on `workspaces.length > 1`.
- Composer model picker shows the model name, `max-width: 15rem`.
- The managed-model → **assistant** vocabulary rename across 16 keys × 3 locales.

The user-facing noun for a `ManagedModel` is **"assistant"**. `export type Agent =
GeneratedManagedModel` — backend says ManagedModel, frontend type says Agent, UI says Assistant.
Do not "fix" this by renaming things; just never surface "managed model" to a user.

---

## 2. Global rules

### 2.1 Scope discipline

Fix what each package specifies. Do not opportunistically refactor adjacent code. If you find a
new defect, add it to §7 (Discovered during work) with file:line and keep going.

### 2.2 Commit granularity

One commit per work package, message `fix(<area>): <what>`, body listing the finding IDs closed.
WP1 is the exception: commit each of WP1.1–WP1.4 separately, since they touch unrelated panels
and a bisect should be able to isolate them.

### 2.3 The failure path is part of the feature

The single largest theme in this audit (7 findings) is unhandled, invisible failure. There is
**no** `unhandledrejection` listener, **no** `MutationCache.onError`, and an error boundary
cannot catch a rejected promise. So a `void somethingAsync()` with no `.catch` is a silent
failure, always.

Every mutation you touch gets, at minimum:

```ts
try {
  await mutation.mutateAsync(input);
  toast(t("thingSaved"), "success");
} catch {
  toast(t("thingCouldNotSave"), "error");
}
```

If the control is optimistic or server-driven (a checkbox reflecting server state), the catch
must also restore the previous UI state, not just toast.

### 2.4 `exactOptionalPropertyTypes` is on

`{ code: string | undefined }` is **not** assignable to `{ code?: string }`. The repo's idiom is
conditional spread:

```ts
body: code === undefined ? {} : { code },
// or
...(value === undefined ? {} : { key: value }),
```

Use it. Do not reach for `as` or `!` to silence the resulting error.

### 2.5 Never widen a permission to fix a UI bug

Two findings involve a control appearing where it should not (`Deprovision` on every auth
provider) or a panel being admin-gated when it is self-scoped (`DeviceTokensPanel`). Fix the
**placement and the guard**. Do not touch server-side authorization. If a fix appears to require
a backend authz change, stop and report.

### 2.6 Deleting is a valid fix

Three findings are dead or stub code shipped as working UI (`ToolConnectorPanel`'s three stub
buttons, `RagGovernancePanel`'s orphaned imports, `ToolTracePanel`'s 78 unreferenced lines).
Where this document says delete, delete. A stub button that destroys config is strictly worse
than no button.

---

## 3. Execution order and gates

| #   | Package                      | Blocking?           | Findings       | Est. files    |
| --- | ---------------------------- | ------------------- | -------------- | ------------- |
| WP1 | Destructive writes           | **Release blocker** | 4 × P0, 2 × P1 | 8             |
| WP2 | MFA recovery-code lockout    | **Release blocker** | 1 × P0         | 4             |
| WP3 | Chat turn lifecycle          | High                | 6 (1 P1 + 5)   | 6             |
| WP4 | Identity & credential panels | High                | 6 × P1         | 7             |
| WP5 | Error-handling sweep         | High                | 5              | 7             |
| WP6 | i18n integrity               | Medium              | 8              | ~15 + locales |
| WP7 | Theme coherence              | Medium              | 3              | 3             |
| WP8 | Reachability & dead UI       | Medium              | 8              | ~12           |
| WP9 | Accessibility & polish       | Low                 | 5              | 6             |

**Gate after every package** (all must pass):

```bash
pnpm --filter @romeo/app check
pnpm --filter @romeo/app test
pnpm check:ui-form-contracts
pnpm format:check
```

---

## 4. Work packages

---

### WP1 — Destructive writes built from state the user never chose

**Findings:** P0-1 KnowledgePanel reindex · P0-2 BillingPanel plan · P0-3 ToolConnectorPanel
allowlist · P0-4 AgentStudioPanel publish · P1-13 DataConnectorPanel KB binding · P1-4
AuthProviderConfigureDialog newline split (moved to WP4 — it shares the root cause but lives in
the identity sweep).

**Why these are one package.** All four P0s are the same bug in four costumes: a write is
assembled from whatever state was lexically nearest instead of the state the user acted on. In
every case the backend **replaces rather than merges**, there is no confirmation, the target is
never displayed, and there is no UI path to restore. Fixing them together means one review of
one pattern rather than four.

**The pattern to apply everywhere in this package:**

1. Derive the payload from the row/entity the control belongs to, or from live query data.
2. Seed form defaults from the server, and re-seed when the server value changes — the repo's
   idiom for this is a `key` prop, e.g. `key={plan?.updatedAt}` on the form's wrapper, which
   remounts the form when the underlying entity changes.
3. Show the target in the confirm copy, so the user can see what is about to change.
4. Gate with `useConfirm({ tone: "danger" })`.

---

#### WP1.1 — `KnowledgePanel.tsx` reindex reads the wrong textarea

**File:** `apps/app/src/components/KnowledgePanel.tsx` (~line 198)

**Current:**

```ts
async function handleReindexSource(sourceId: string) {
  if (!activeKnowledgeBase) return;
  const content = SourceForm.state.values.sourceContent.trim();
  if (content.length === 0) return;

  try {
    const source = await reindexSourceMutation.mutateAsync({
      knowledgeBaseId: activeKnowledgeBase.id,
      sourceId,
      content,
      sizeBytes: content.length,
    });
    …
```

`SourceForm` is the **Add-Source dialog's** form. Its `sourceContent` field holds whatever the
admin last typed or last file they picked (see `handleSourceFileChange`, which writes
`file.text()` into it). So:

- With the Add-Source form untouched, `content` is `""` and the button silently `return`s —
  Reindex is dead in the normal flow.
- After adding source B, clicking Reindex on row A **overwrites A's stored object and chunks
  with B's text**. The server re-chunks in a transaction; there is no soft delete and no undo.
  Retrieval then returns B's content under A's citation.

**Target.** Reindex must not take content from the client at all — the source's content already
exists server-side. Check the mutation's contract first:

```bash
grep -rn "reindexSource" apps/app/src/features/knowledge/
grep -rn "reindex" packages/contracts/src/knowledge*.ts
```

Two cases:

- **If `content` is optional in the contract** (server re-reads the stored blob when omitted):
  drop it from the call entirely. This is the correct fix and the smallest diff.

  ```ts
  async function handleReindexSource(sourceId: string) {
    if (!activeKnowledgeBase) return;
    const source = sources.find((item) => item.id === sourceId);
    if (!source) return;
    if (!(await ask({
      title: t("knowledgeReindexTitle"),
      body: t("knowledgeReindexBody").replace("{name}", source.fileName ?? sourceId),
      confirmLabel: t("knowledgeReindex"),
    }))) return;
    try {
      const reindexed = await reindexSourceMutation.mutateAsync({
        knowledgeBaseId: activeKnowledgeBase.id,
        sourceId,
      });
      …unchanged…
  ```

- **If `content` is required by the contract**: do not fabricate it and do not reuse the dialog's
  value. Instead open a per-row dialog seeded from that row, so the content shown is the content
  sent. Add local state `const [reindexing, setReindexing] = useState<KnowledgeSource>()`, render
  a `FormDialog` seeded with `reindexing`, and submit from there. Report in your summary that the
  contract forced the heavier fix.

In both cases **the Add-Source form's state must not be read by this handler.** That is the
defect.

**Confirm copy** (new keys, §WP1 i18n table below): `knowledgeReindexTitle`,
`knowledgeReindexBody`.

**Test.** Create `apps/app/src/components/knowledge-reindex.ts`:

```ts
// Pure guard for the knowledge reindex action. Extracted because the original
// handler sourced its payload from the Add-Source dialog's form state, which
// meant reindexing row A shipped row B's text -- the row identity and the
// content identity had drifted apart with nothing asserting they matched.

export interface ReindexRequest {
  /** The row whose Reindex button was pressed. */
  sourceId: string;
  /** The id the payload was actually built from. */
  payloadSourceId: string | undefined;
}

/** True only when the payload provably describes the row that was clicked. */
export function isReindexPayloadCoherent(request: ReindexRequest): boolean {
  return (
    request.payloadSourceId !== undefined &&
    request.payloadSourceId === request.sourceId
  );
}
```

and `knowledge-reindex.test.ts` asserting: matching ids → true; mismatched ids → false;
`undefined` payload id → false. Wire the component to call it before dispatching, so the
regression cannot return silently.

---

#### WP1.2 — `BillingPanel.tsx` plan form is hardcoded, and the write replaces

**File:** `apps/app/src/components/BillingPanel.tsx` (lines 53–87)

**Current:**

```ts
const plan = planQuery.data ?? null;

const planForm = useForm({
  defaultValues: {
    code: "pro",
    name: "Pro",
    status: "active" as BillingPlanStatus,
    metric: "tool.call" as BillingPlanQuotaTemplate["metric"],
    limit: 1000,
    resetInterval: "monthly" as BillingPlanQuotaTemplate["resetInterval"],
  },
  onSubmit: async ({ value }) => {
    await applyMutation.mutateAsync({
      code: value.code,
      name: value.name,
      status: value.status,
      source: "manual",
      quotaTemplates: [
        { metric: value.metric, limit: value.limit, resetInterval: value.resetInterval },
      ],
    });
```

Note `plan` is computed and then **never used to seed the form**. So an admin who opens Billing
to flip status to `past_due` submits `code:"pro"`, `name:"Pro"`, `source:"manual"` and a
single-element `quotaTemplates`. `packages/core/src/services/billing-service.ts:410` _replaces_
`quotaTemplates` rather than merging, so every quota tier but one is deleted. The write also
drops `externalCustomerId` / `externalSubscriptionId` (severing Stripe linkage) and wipes
`billingLifecycle` metadata. This panel is the only writer of `quotaTemplates` in the app, so
there is no UI recovery.

**Target.**

1. Seed from the server and re-seed on change. Read the current plan shape first:

   ```bash
   grep -rn -A25 "BillingPlanSchema = " packages/contracts/src/billing.ts
   ```

2. Replace `defaultValues` with a builder that takes the loaded plan:

   ```ts
   function buildPlanDefaults(plan: BillingPlan | null) {
     return {
       code: plan?.code ?? "",
       name: plan?.name ?? "",
       status: plan?.status ?? ("active" as BillingPlanStatus),
       quotaTemplates: plan?.quotaTemplates ?? [],
     };
   }

   const planForm = useForm({ defaultValues: buildPlanDefaults(plan), onSubmit: … });
   ```

3. Remount the form when the server value changes, so a background refetch does not leave stale
   defaults. Wrap the `<form>` in a keyed fragment:

   ```tsx
   <div key={plan?.updatedAt ?? "new"}>…form…</div>
   ```

   `GovernanceRetentionTab.tsx:103` already uses this idiom — copy it rather than inventing a
   `useEffect` reset.

4. **Preserve every field the form does not edit.** Spread the loaded plan into the payload:

   ```ts
   await applyMutation.mutateAsync({
     ...plan, // preserves externalCustomerId, billingLifecycle, source…
     code: value.code,
     name: value.name,
     status: value.status,
     quotaTemplates: value.quotaTemplates,
   });
   ```

   If the request type is narrower than `BillingPlan`, pick the preserved fields explicitly with
   conditional spreads (§2.4) rather than casting.

5. **`source: "manual"` must not be hardcoded.** Send `plan?.source ?? "manual"`, so a
   Stripe-sourced plan is not silently relabelled as hand-managed.

6. **Quota templates must be editable as a list**, not a single row. Render the existing
   `quotaTemplates` in the `DataTable` already present in this file (`columns` at line 112) with
   an add/remove control per row, bound to `planForm`'s `quotaTemplates` array field. TanStack
   Form supports array fields via `<planForm.Field name="quotaTemplates" mode="array">`.

7. Gate submit with `useConfirm`, and show what changes:

   ```ts
   if (
     !(await ask({
       title: t("billingApplyPlanTitle"),
       body: t("billingApplyPlanBody"),
       confirmLabel: t("billingApplyPlan"),
       tone: "danger",
     }))
   )
     return;
   ```

**Test.** Create `apps/app/src/components/billing-plan-payload.ts` exporting
`buildPlanDefaults(plan)` and `buildApplyPayload(plan, formValue)`; test in
`billing-plan-payload.test.ts`:

- `buildPlanDefaults(null)` returns empty strings and an empty template list, never `"pro"`.
- `buildPlanDefaults(plan)` round-trips code/name/status/quotaTemplates.
- `buildApplyPayload(plan, { status: "past_due" })` preserves `externalCustomerId`,
  `externalSubscriptionId`, `billingLifecycle` and `source` from `plan`.
- `buildApplyPayload` with a 3-tier `quotaTemplates` returns all 3 — the regression assertion.

---

#### WP1.3 — `ToolConnectorPanel.tsx` ships three stub buttons that destroy config

**File:** `apps/app/src/components/ToolConnectorPanel.tsx` (lines 67–136)

Three handlers write invented values:

```ts
handleSetAuthRef   → secretRef: `vault://tools/${connectorId}/api-key`         // line 73
handleSetOAuthRef  → secretRef: `vault://tools/${connectorId}/oauth-client`    // line 91
handleAllowExampleHost → allowedHosts: ["api.example.com"]                      // line 126
```

`handleAllowExampleHost` sits behind a button labelled generically "Allow host" and toasts
success. It replaces the connector's real egress allowlist with a literal example domain, and
because `allowedHosts` is sent without `allowPrivateNetwork`, the schema default resets that to
`false` as a side effect. Tool dispatch and OAuth token fetch then fail with
`tool_operation_host_not_allowed`. This file is the only reader of `allowedHosts` in the app, so
there is no restore path.

**Target — delete first, build second.**

1. **Delete all three handlers and their buttons now.** They are development stubs. A control
   that silently destroys production config is worse than a missing control. Remove any locale
   keys that become unreferenced (`toolApiKeyRefSet`, `toolOAuthRefSet`, and the network-policy
   toast keys **only if** nothing else uses them — check with
   `grep -rn "toolApiKeyRefSet" apps/app/src` before deleting from all three locale files).
2. Then build the real controls as a follow-up, out of scope for this package unless the rest of
   WP1 lands early:
   - a `FormDialog` with a `Textarea` for hosts, one per line — **and it must use a real newline
     split, see WP4.1, which is the same bug in a sibling dialog**;
   - the dialog must be seeded from the connector's current `allowedHosts`, must render
     `allowPrivateNetwork` as an explicit checkbox rather than letting the schema default it,
     and must confirm with `tone: "danger"` showing the host list being replaced;
   - secret refs must be typed by the admin, never templated from an id.

Record in your summary that steps under (2) were deferred, if they were.

**Test.** No unit test — this is a deletion. The gate is `pnpm --filter @romeo/app check` (proves
nothing referenced the removed handlers) plus `pnpm --filter @romeo/app test` (proves no locale
key parity break from the key removals).

---

#### WP1.4 — `AgentStudioPanel.tsx` Publish ships stale config and erases the form

**Files:** `apps/app/src/components/AgentStudioPanel.tsx` (line 87),
`apps/app/src/components/AgentDraftForm.tsx` (lines 174–182)

**Current — the panel:**

```ts
async function handlePublish() {
  if (!activeAgent) return;
  try {
    const version = await publishMutation.mutateAsync(activeAgent.id);
    …
    await invalidateAgentData(activeAgent.id);
    toast(t("agentPublishedToast"), "success");
```

**Current — the form:**

```ts
useEffect(() => {
  form.reset(buildDefaults(activeAgent));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [
  activeAgent?.id,
  activeAgent?.systemPrompt,
  activeAgent?.baseModelId,
  activeAgent?.updatedAt,
]);
```

Publish takes only an id — it publishes the **persisted draft**, not what is on screen. Then
`invalidateAgentData` refetches, `activeAgent.updatedAt` changes, and the effect fires
`form.reset(...)`, wiping every unsaved character across all 8 fields. The Publish button is
`variant="primary"` and sits directly under the form, immediately below the `Save draft` submit
button. So the natural gesture — type a new system prompt, click the prominent blue button —
publishes the _old_ prompt, shows a green success toast, and destroys the new one. There is no
`isDirty` check anywhere in the app and no `beforeunload` handler. Rollback has the same shape.

**Target.**

1. **Surface dirtiness from the form.** `AgentDraftForm` already imports `useStore` from
   `@tanstack/react-store` (line 2) and uses it for `baseModelId` and `memoryMode`. Add:

   ```ts
   const isDirty = useStore(form.store, (state) => state.isDirty);

   useEffect(() => {
     onDirtyChange(isDirty);
   }, [isDirty, onDirtyChange]);
   ```

   with a new required prop `onDirtyChange: (dirty: boolean) => void` on `AgentDraftFormProps`.

2. **Guard the reset effect.** A refetch must never clobber unsaved edits:

   ```ts
   useEffect(() => {
     // Re-seeding from the server is correct when the user switches assistants,
     // and destructive when they are mid-edit: publish/rollback both bump
     // updatedAt, which used to fire this reset and wipe the open form.
     if (form.state.isDirty) return;
     form.reset(buildDefaults(activeAgent));
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [
     activeAgent?.id,
     activeAgent?.systemPrompt,
     activeAgent?.baseModelId,
     activeAgent?.updatedAt,
   ]);
   ```

   Switching to a **different** assistant must still reset unconditionally, otherwise a dirty
   form leaks across assistants. Split the effect: one keyed on `activeAgent?.id` that always
   resets, one keyed on the content fields that bails when dirty.

3. **Block Publish and Rollback while dirty.** In `AgentStudioPanel`:

   ```tsx
   const [isDraftDirty, setIsDraftDirty] = useState(false);
   …
   <AgentDraftForm … onDirtyChange={setIsDraftDirty} />
   …
   <Button
     disabled={!activeAgent || publishMutation.isPending || isDraftDirty}
     onClick={() => void handlePublish()}
     pending={publishMutation.isPending}
     variant="primary"
     title={isDraftDirty ? t("agentPublishBlockedByDraft") : undefined}
   >
     {t("agentPublish")}
   </Button>
   {isDraftDirty ? (
     <div className="text-xs text-muted" role="status">
       {t("agentPublishBlockedByDraft")}
     </div>
   ) : null}
   ```

   Disabling alone is a silent no-op — the hint text is required so the admin knows _why_.

4. **Confirm the publish**, naming the version being shipped:

   ```ts
   if (
     !(await ask({
       title: t("agentPublishTitle"),
       body: t("agentPublishBody"),
       confirmLabel: t("agentPublish"),
     }))
   )
     return;
   ```

   `AgentStudioPanel` does not yet use `useConfirm` (Delete uses a declarative `AlertDialog`).
   Add the hook and render `{dialog}` inside the returned `<section>`.

**Test.** Create `apps/app/src/components/agent-publish-gate.ts`:

```ts
// Publish takes only an assistant id -- it ships the PERSISTED draft. When the
// on-screen form is dirty, the config the admin is looking at and the config
// that would be published are different objects, and the post-publish refetch
// then resets the form and destroys the difference. Publishing is therefore
// only meaningful when the form is clean.

export interface PublishGateState {
  hasActiveAgent: boolean;
  isDraftDirty: boolean;
  isPublishing: boolean;
}

export function canPublishAgent(state: PublishGateState): boolean {
  return state.hasActiveAgent && !state.isDraftDirty && !state.isPublishing;
}

/** True when a server re-seed of the draft form would destroy unsaved edits. */
export function shouldResetDraftForm(input: {
  isDirty: boolean;
  agentChanged: boolean;
}): boolean {
  return input.agentChanged || !input.isDirty;
}
```

`agent-publish-gate.test.ts` must cover: clean + agent → publishable; **dirty → not publishable**
(the regression); no agent → not publishable; publishing → not publishable; and for
`shouldResetDraftForm`, that switching assistants resets even when dirty, while a same-assistant
refetch does not.

---

#### WP1.5 — `DataConnectorPanel.tsx` binds every connector to `knowledgeBases[0]`

**File:** `apps/app/src/components/DataConnectorPanel.tsx` (~line 99). Same pattern at
`CollaborationPanel.tsx:63`.

Every connector is created against `knowledgeBasesQuery.data?.[0]` with no picker, no display of
the binding in the dialog, and no column for it in the table. Knowledge bases sort `asc(name)`,
so creating a KB named "Archive" silently re-points all future connectors away from
"Production". Ingested documents land in the wrong corpus and become retrievable by agents bound
to it. The SDK exposes no update or delete for the binding, so it is permanent. In a workspace
with zero KBs (workspaces ship without a default), the Create button is disabled with no
explanation.

**Target.**

1. Add a required `knowledgeBaseId` `Select` to the create dialog, sourced from
   `knowledgeBasesQuery.data`, with no default selection — force an explicit choice.
2. Wrap it in `<Field label={t("knowledgeBase")}>`.
3. Add a `knowledgeBase` column to the connectors `DataTable` so the binding is visible after
   creation.
4. When the KB list is empty, replace the disabled button with `PanelState`'s `emptyAction`
   pointing at knowledge-base creation, and copy explaining why (`t("dataConnectorNeedsKb")`).
5. Apply the identical fix to `CollaborationPanel.tsx:63`.

**Test.** Extend `billing-plan-payload.test.ts`'s sibling pattern with
`apps/app/src/components/data-connector-binding.ts`:

```ts
export function resolveKnowledgeBaseBinding(input: {
  selectedKnowledgeBaseId: string | undefined;
  availableIds: readonly string[];
}):
  | { ok: true; knowledgeBaseId: string }
  | { ok: false; reason: "none-selected" | "no-bases" } {
  if (input.availableIds.length === 0) return { ok: false, reason: "no-bases" };
  if (input.selectedKnowledgeBaseId === undefined)
    return { ok: false, reason: "none-selected" };
  return { ok: true, knowledgeBaseId: input.selectedKnowledgeBaseId };
}
```

Test that it **never** falls back to `availableIds[0]` — that is the defect, and an explicit
assertion prevents a future "helpful" default from reintroducing it.

---

#### WP1 — new i18n keys

Add to `apps/app/src/locales/{en,es,fr}/knowledge-workspace.json`,
`billing-admin.json`, `agent-studio.json` respectively, keeping each file sorted.

| Key                          | Namespace              | en                                                                           | es                                                                                            | fr                                                                                                    |
| ---------------------------- | ---------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `knowledgeReindexTitle`      | knowledge-workspace    | Reindex this source?                                                         | ¿Reindexar esta fuente?                                                                       | Réindexer cette source ?                                                                              |
| `knowledgeReindexBody`       | knowledge-workspace    | Its stored chunks will be rebuilt. Retrieval results may change.             | Sus fragmentos almacenados se reconstruirán. Los resultados de recuperación pueden cambiar.   | Ses fragments stockés seront reconstruits. Les résultats de recherche peuvent changer.                |
| `billingApplyPlanTitle`      | billing-admin          | Apply plan changes?                                                          | ¿Aplicar los cambios del plan?                                                                | Appliquer les modifications du forfait ?                                                              |
| `billingApplyPlanBody`       | billing-admin          | This replaces the plan's quota tiers with the list shown above.              | Esto reemplaza los niveles de cuota del plan por la lista mostrada arriba.                    | Cela remplace les paliers de quota du forfait par la liste affichée ci-dessus.                        |
| `billingApplyPlan`           | billing-admin          | Apply plan                                                                   | Aplicar plan                                                                                  | Appliquer le forfait                                                                                  |
| `agentPublishTitle`          | agent-studio           | Publish this assistant?                                                      | ¿Publicar este asistente?                                                                     | Publier cet assistant ?                                                                               |
| `agentPublishBody`           | agent-studio           | The saved draft becomes the live version for everyone in this workspace.     | El borrador guardado se convierte en la versión activa para todos en este espacio de trabajo. | Le brouillon enregistré devient la version active pour tout le monde dans cet espace de travail.      |
| `agentPublishBlockedByDraft` | agent-studio           | Save your draft before publishing — publishing ships the last saved version. | Guarda tu borrador antes de publicar: se publica la última versión guardada.                  | Enregistrez votre brouillon avant de publier : c'est la dernière version enregistrée qui est publiée. |
| `dataConnectorNeedsKb`       | integration-automation | Create a knowledge base before adding a data connector.                      | Crea una base de conocimiento antes de añadir un conector de datos.                           | Créez une base de connaissances avant d'ajouter un connecteur de données.                             |
| `knowledgeBase`              | integration-automation | Knowledge base                                                               | Base de conocimiento                                                                          | Base de connaissances                                                                                 |

Check each key does not already exist before adding: `grep -rn '"knowledgeBase"' apps/app/src/locales/en/`.

**WP1 gate:** the four commands in §3, plus manually exercise on `:3000`: create source B, then
Reindex source A, and confirm A's content is unchanged.

---

### WP2 — MFA enrollment is a one-way lockout

**Finding:** P0-5.

**Files:** `apps/app/src/features/auth/mutations.ts`,
`apps/app/src/components/AccountSecurityPanel.tsx`, `apps/app/src/routes/login.tsx`,
locale files.

**Why this is a P0.** `packages/contracts/src/local-auth.ts:152` defines
`generateRecoveryCodesRoute`, the service implements it, and
`packages/api-client/src/generated/sdk/sdk.gen.ts:11399` exports
`localAuthGenerateRecoveryCodes`. But `apps/app/src` has **zero references** to it — there is no
wrapper in `features/auth/mutations.ts`, so it is unreachable from the app. Meanwhile
`login.tsx:285` unconditionally offers "Use a recovery code" for codes the user was never
issued. And the escape hatch is broken too: `AccountSecurityPanel.tsx:105` calls
`disableMutation.mutateAsync({ factorId })` with no `code`, which
`packages/core/src/services/local-mfa-service.ts:227` rejects with `local_mfa_code_required`.

Net effect: a user who loses their authenticator cannot get back in through any UI, and no admin
can unlock them. Recovery requires editing the database.

**Verified API shape** (do not guess — this is read from the generated types):

```ts
// packages/api-client/src/generated/sdk/types.gen.ts
export type RecoveryCodesGenerateRequest = { totpCode: string }; // /^\d{6}$/
export type LocalMfaRecoveryCodes = {
  factor: LocalMfaFactorSummary;
  codes: Array<string>; // exactly 10, /^rmfa-[a-f0-9]{4}(-[a-f0-9]{4}){3}$/
  recoveryCodeRemainingCount: number;
};
export type LocalMfaFactorSummary = {
  id: string;
  type: "recovery_codes" | "totp";
  name: string;
  status: "pending" | "active" | "disabled";
  createdAt: string;
  confirmedAt?: string;
  disabledAt?: string;
  lastUsedAt?: string;
  recoveryCodeRemainingCount?: number;
};
```

Two consequences that are easy to miss:

- Generating recovery codes **requires a fresh 6-digit TOTP code**. The flow is therefore
  enroll → confirm with code → _generate with another code_. You must prompt for it; you cannot
  reuse the enrollment code.
- The remaining count lives on the **factor**, not on `LocalAuthStatus`. Find it with
  `status.factors.find((f) => f.type === "recovery_codes")?.recoveryCodeRemainingCount`.

**Step 1 — add the wrapper.** In `apps/app/src/features/auth/mutations.ts`, matching the file's
existing shape exactly:

```ts
import {
  …,
  localAuthGenerateRecoveryCodes,
  type LocalMfaRecoveryCodes,
  type RecoveryCodesGenerateRequest,
} from "@romeo/api-client/generated/sdk";

export async function generateRecoveryCodes(
  input: RecoveryCodesGenerateRequest,
): Promise<LocalMfaRecoveryCodes> {
  configureBrowserApiClients();
  const response = await localAuthGenerateRecoveryCodes({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}
```

The route returns **201**, not 200. Verify `response.data.data` still unwraps correctly by
typechecking; if the generated client narrows 201 differently, follow the type rather than
casting.

**Step 2 — make code generation a mandatory step of enrollment.**
In `AccountSecurityPanel.tsx`, `handleConfirmEnrollment` currently ends by clearing state:

```ts
await refresh();
toast(t("authenticatorEnabled"), "success");
setEnrollment(undefined);
setTotpCode("");
```

Change it to move into a recovery-codes step instead of dismissing:

```ts
await refresh();
toast(t("authenticatorEnabled"), "success");
setTotpCode("");
setRecoveryStep("awaiting-code"); // new state; keep `enrollment` set for context
```

Render that step as a blocking panel — not a dismissible aside — containing:

- explanatory copy (`t("recoveryCodesWhy")`);
- a 6-digit `Input` for a fresh TOTP code, wrapped in `<Field label={t("verificationCode")}>`;
- a `Generate recovery codes` primary button calling `generateRecoveryCodes({ totpCode })`.

On success, render the 10 codes with:

- a **Copy all** button (`navigator.clipboard.writeText(codes.join("\n"))`, with a
  `document.execCommand` fallback omitted — modern browsers only, note it in a comment);
- a **Download** link — build a Blob URL, `revokeObjectURL` on unmount;
- a "shown once" warning styled with `.rm-composer-error` semantics but `role="status"`;
- an explicit **I have saved these codes** button that is the only way to dismiss the step.

**Step 3 — surface the remaining count** in the factor list, next to the TOTP factor:

```tsx
{
  status.factors.find((factor) => factor.type === "recovery_codes")
    ?.recoveryCodeRemainingCount;
}
```

with copy `t("recoveryCodesRemaining")`. When the count is 0 or the factor is absent while
`status.mfaEnabled` is true, render a warning and a **Regenerate recovery codes** action — that
is exactly the lockout state, and it must be visible.

Note the existing factor list filters `status.factors.filter((f) => f.disabledAt === undefined)`
and will now render the `recovery_codes` factor as a row. Exclude it from that list explicitly
(`.filter((f) => f.type === "totp")`) so it appears only in its own section.

**Step 4 — fix the disable path.** `handleDisableFactor` must collect the TOTP code the service
requires. Replace the plain `ask()` with a `FormDialog` containing a code input, then:

```ts
await disableMutation.mutateAsync({ factorId, code });
```

The wrapper already accepts `code?: string` and spreads it conditionally, so no change is needed
in `features/auth/mutations.ts` for this.

**Step 5 — make the login recovery option honest.** `login.tsx:285-292` offers "Use a recovery
code" unconditionally. Leave the option (a user _may_ have codes) but ensure the failure copy
distinguishes "wrong code" from "you have no codes" if the API response allows it. Do not remove
the option — that would remove the only escape hatch.

**Test.** Create `apps/app/src/components/mfa-recovery.ts`:

```ts
// Recovery-code state derived from the local auth status. Extracted because the
// lockout condition -- MFA enabled with no usable recovery codes -- is invisible
// in the raw status object: the count lives on a sibling factor, not on the
// status, and its absence is indistinguishable from zero unless you look for
// the factor first.

export interface MfaFactorLike {
  type: "recovery_codes" | "totp";
  status: "pending" | "active" | "disabled";
  disabledAt?: string;
  recoveryCodeRemainingCount?: number;
}

export interface MfaRecoveryState {
  mfaEnabled: boolean;
  factors: readonly MfaFactorLike[];
}

export function recoveryCodesRemaining(state: MfaRecoveryState): number {
  const factor = state.factors.find(
    (item) => item.type === "recovery_codes" && item.disabledAt === undefined,
  );
  return factor?.recoveryCodeRemainingCount ?? 0;
}

/** True when the account can be permanently locked out by losing one device. */
export function isLockoutRisk(state: MfaRecoveryState): boolean {
  return state.mfaEnabled && recoveryCodesRemaining(state) === 0;
}
```

`mfa-recovery.test.ts` must cover: MFA off → not at risk; MFA on with 10 codes → not at risk;
**MFA on with no recovery factor → at risk** (the P0); MFA on with count 0 → at risk; a disabled
recovery factor is ignored.

**WP2 new i18n keys** — namespace `security.json`. Check for pre-existing keys first; the audit
found `security.mfa` and `verificationCode` already exist but are unreferenced (see WP8.4), so
**reuse `verificationCode` rather than adding a duplicate.**

| Key                               | en                                                                                           | es                                                                                     | fr                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `recoveryCodes`                   | Recovery codes                                                                               | Códigos de recuperación                                                                | Codes de récupération                                                                                            |
| `recoveryCodesWhy`                | Save these now. They are the only way back into your account if you lose your authenticator. | Guárdalos ahora. Son la única forma de recuperar tu cuenta si pierdes tu autenticador. | Enregistrez-les maintenant. C'est le seul moyen de récupérer votre compte si vous perdez votre authentificateur. |
| `recoveryCodesShownOnce`          | These codes are shown once and cannot be retrieved later.                                    | Estos códigos se muestran una sola vez y no se pueden recuperar después.               | Ces codes ne s'affichent qu'une fois et ne peuvent pas être récupérés ensuite.                                   |
| `recoveryCodesGenerate`           | Generate recovery codes                                                                      | Generar códigos de recuperación                                                        | Générer des codes de récupération                                                                                |
| `recoveryCodesRegenerate`         | Regenerate recovery codes                                                                    | Regenerar códigos de recuperación                                                      | Regénérer les codes de récupération                                                                              |
| `recoveryCodesRemaining`          | Recovery codes remaining                                                                     | Códigos de recuperación restantes                                                      | Codes de récupération restants                                                                                   |
| `recoveryCodesNone`               | No recovery codes. You will be locked out if you lose your authenticator.                    | Sin códigos de recuperación. Perderás el acceso si pierdes tu autenticador.            | Aucun code de récupération. Vous perdrez l'accès si vous perdez votre authentificateur.                          |
| `recoveryCodesSaved`              | I have saved these codes                                                                     | He guardado estos códigos                                                              | J'ai enregistré ces codes                                                                                        |
| `recoveryCodesCopyAll`            | Copy all                                                                                     | Copiar todo                                                                            | Tout copier                                                                                                      |
| `recoveryCodesDownload`           | Download                                                                                     | Descargar                                                                              | Télécharger                                                                                                      |
| `recoveryCodesFailed`             | Could not generate recovery codes                                                            | No se pudieron generar los códigos de recuperación                                     | Impossible de générer les codes de récupération                                                                  |
| `removeAuthenticatorCodeRequired` | Enter a code from your authenticator to remove it.                                           | Introduce un código de tu autenticador para eliminarlo.                                | Saisissez un code de votre authentificateur pour le supprimer.                                                   |

**WP2 gate:** the four commands in §3. Then manually on `:3000`: enroll TOTP, confirm, verify the
recovery-code step blocks dismissal, and verify the count appears afterwards.

---

### WP3 — Chat turn lifecycle

**Findings:** P1-1 optimistic turn not rolled back · P1-2 silent no-ops during streaming ·
P1-3 hardcoded transcript strings · P2-1 stuck drag overlay · P2-2 hardcoded activity labels ·
P2-3 rating buttons expose no pressed state.

**Why one package.** All six live in the same four files and the same mental model — what
happens to the UI between "user pressed send" and "server confirmed". Fixing them in one pass
means one manual QA pass on the chat surface.

---

#### WP3.1 — Roll back the optimistic turn when the run fails

**File:** `apps/app/src/components/useWorkspaceTurnActions.ts` (lines ~145–207)

**Current:**

```ts
options.setError(undefined);
options.setDraft("");                    // draft gone
options.clearPendingAttachments();       // attachments gone
options.resetRunPresentation();
try {
  const chat = …;
  …
  appendOptimisticTurn(chat.id, content, images, documents);   // phantom bubbles appended
  const run = await startRunMutation.mutateAsync({ … });       // <- can reject
  …
} catch (caught) {
  options.setError(…);
  options.setActiveRunId(undefined);      // rolls back nothing
} finally {
  images.forEach((a) => URL.revokeObjectURL(a.previewUrl));   // previews dead either way
}
```

`startRun` rejects on reachable conditions — `packages/core/src/services/run-start-service.ts:164`
throws 409 when images are attached to a non-vision model. When it does:

- the typed prompt is gone (`setDraft("")` already ran);
- all attachments are gone and their blob URLs are revoked, so previews are broken images;
- `appendOptimisticTurn` left a user bubble **and** an empty assistant bubble
  (`options.appendMessage(chatId, "assistant", "")`) in the transcript;
- the assistant bubble renders the full Copy / Rate / Branch / Delete toolbar, and because
  `appendMessage` assigns `clientMessageId()` — a client-side UUID with no server row — every one
  of those controls 404s.

Its two siblings, `regenerateLast` (line ~263) and `handleEditAndResend` (line ~369), await
before mutating state. This is the lone inverted path.

**Target.**

1. **Capture a rollback snapshot before mutating anything:**

   ```ts
   const previousDraft = options.draft;
   const previousMessages = options.messages;
   ```

2. **Append the optimistic turn only after the run is accepted.** Move
   `appendOptimisticTurn(...)` to immediately after `startRunMutation.mutateAsync` resolves. The
   perceived latency cost is one round trip on the _start_ call, not the stream, and it removes
   the entire phantom-bubble class of bug. If a truly optimistic bubble is wanted for
   responsiveness, it must be tagged (`pending: true`) and the toolbar suppressed for pending
   messages — but the simple ordering fix is what this package requires.

3. **Restore on failure:**

   ```ts
   } catch (caught) {
     options.setError(caught instanceof Error ? caught.message : options.t("unableStartRun"));
     options.setActiveRunId(undefined);
     options.setDraft(previousDraft);
     options.restoreMessages(previousMessages);
     options.restorePendingAttachments(images, documents);
   }
   ```

   `restoreMessages` and `restorePendingAttachments` do not exist yet. Add them to
   `useChatMessageState.ts` and `useWorkspaceAttachments.ts` respectively as thin setters, and
   thread them through `WorkspaceTurnActionsOptions`.

4. **Only revoke blob URLs on success.** Move the `URL.revokeObjectURL` loop out of `finally`
   into the success path; on failure the previews must keep working because the attachments are
   coming back:

   ```ts
   // Revoked on the success path only: on failure the attachments are restored to
   // the composer, and a revoked object URL renders as a broken image.
   ```

**Test.** Create `apps/app/src/components/turn-rollback.ts`:

```ts
export interface TurnSnapshot<TMessage> {
  draft: string;
  messages: readonly TMessage[];
}

export interface TurnOutcome<TMessage> {
  draft: string;
  messages: readonly TMessage[];
  revokePreviews: boolean;
}

/** What the composer and transcript must look like after a send attempt. */
export function resolveTurnOutcome<TMessage>(input: {
  snapshot: TurnSnapshot<TMessage>;
  accepted: boolean;
}): TurnOutcome<TMessage> {
  return input.accepted
    ? { draft: "", messages: input.snapshot.messages, revokePreviews: true }
    : {
        draft: input.snapshot.draft,
        messages: input.snapshot.messages,
        revokePreviews: false,
      };
}
```

`turn-rollback.test.ts`: accepted → draft cleared, previews revoked; **rejected → draft restored
verbatim, message list identical to the snapshot, previews NOT revoked** (the regression).

---

#### WP3.2 — Stop silently discarding actions during streaming

**Files:** `apps/app/src/components/ChatMessages.tsx` (~line 132),
`apps/app/src/components/useChatMessageState.ts` (lines 84, 101),
`apps/app/src/components/useWorkspaceTurnActions.ts` (line ~323)

Four handlers early-return when `isStreaming`, with no `disabled` on the control that triggers
them:

| Handler                     | File:line                        | Symptom                                       |
| --------------------------- | -------------------------------- | --------------------------------------------- |
| `handleEditAndResend`       | `useWorkspaceTurnActions.ts:369` | rewritten prompt silently discarded           |
| `handleDeleteMessage`       | `useChatMessageState.ts:84`      | Delete does nothing                           |
| `handleAttachmentRetention` | `useChatMessageState.ts:101`     | "Keep in context" checkbox visibly snaps back |
| `handleBranchFromMessage`   | `useWorkspaceTurnActions.ts:323` | Branch does nothing                           |

The worst is edit-and-resend. `ChatMessages.tsx:132-142` closes the editor unconditionally:

```tsx
<Button
  className="primary"
  disabled={editValue.trim().length === 0}
  onClick={() => {
    onEditAndResend(message.id, editValue);
    setEditingId(undefined); // <- closes regardless of outcome
  }}
  type="button"
>
  {t("saveSubmit")}
</Button>
```

Reopening the pencil re-seeds `editValue` from `message.content`, so the rewrite is
unrecoverable. Note `isStreaming` is already destructured at `ChatMessages.tsx:38` and simply
never used here. Only Read-aloud currently passes `disabled`.

**Target.**

1. Pass `disabled={isStreaming}` to the Edit (pencil), Branch, Delete controls and the retention
   checkbox in `ChatMessages.tsx`. A disabled control is an honest control.
2. Add `title={isStreaming ? t("waitForResponse") : undefined}` so the reason is discoverable.
3. Keep the editor open on failure — make the handler async and only close on success:

   ```tsx
   onClick={() => {
     void (async () => {
       const ok = await onEditAndResend(message.id, editValue);
       if (ok) setEditingId(undefined);
     })();
   }}
   ```

   which requires `onEditAndResend` to return `Promise<boolean>`. Change the signature in
   `useWorkspaceTurnActions.ts` (return `false` on the `isStreaming` guard and in `catch`,
   `true` after success) and thread the new type through `ChatPanel.tsx` and
   `WorkspaceShell.tsx:220`.

**Test.** Add to `apps/app/src/components/turn-rollback.ts` (same module, related concern):

```ts
/** Message-level actions are unavailable while a run is streaming. */
export function isMessageActionEnabled(input: {
  isStreaming: boolean;
  hasActiveChat: boolean;
}): boolean {
  return !input.isStreaming && input.hasActiveChat;
}
```

Test all four combinations. This is the assertion that keeps `disabled` and the handler guard in
agreement — they drifted apart once already.

---

#### WP3.3 — Localize the two strings written into the transcript

**File:** `apps/app/src/components/useWorkspaceTurnActions.ts` lines 76 and 407

```ts
? "Review the attached file(s)."      // line 76
await submitTurn("Continue from where you stopped.");   // line 407
```

Neither string exists in any locale file. Both become **the user's own visible message** and are
sent to the model in every locale, while the button that triggers the second one
(`ChatMessages.tsx:313`) _is_ translated. Worse, line 154 titles new chats from
`content.slice(0, 80)`, so an es/fr user who starts a chat by dropping a file gets a sidebar
entry permanently named "Review the attached file(s)."

`t` is already a parameter of this hook (`options.t`), used elsewhere in the same file.

**Target:** `options.t("chatReviewAttachments")` and `options.t("chatContinueResponse")`.

| Key                     | Namespace | en                               | es                                 | fr                                     |
| ----------------------- | --------- | -------------------------------- | ---------------------------------- | -------------------------------------- |
| `chatReviewAttachments` | core      | Review the attached file(s).     | Revisa los archivos adjuntos.      | Examinez les fichiers joints.          |
| `chatContinueResponse`  | core      | Continue from where you stopped. | Continúa desde donde te detuviste. | Continuez là où vous vous êtes arrêté. |
| `waitForResponse`       | core      | Wait for the response to finish. | Espera a que termine la respuesta. | Attendez la fin de la réponse.         |

---

#### WP3.4 — Localize the streaming activity labels

**File:** `apps/app/src/components/useChatRunStream.ts` (~line 242)

Ten English literals in the `definitions` map inside `activityFromEvent`: "Generating response",
"Sources retrieved", "Running tool", "Tool approval required", "Tool completed", "Response
failed", and four more. They render raw inside `ChatMessageMetadata.tsx:13-18`, which is an
`aria-live="polite"` region — so a screen reader in Spanish announces English status text. `t` is
already a parameter of this hook and used four lines above.

**Target:** replace each literal with a `t()` call. Add ten keys to `core.json` × 3 locales. Read
the exact current strings from the file before writing the table — do not work from this
document's abbreviated list.

---

#### WP3.5 — Rating buttons need `aria-pressed`

**File:** `apps/app/src/components/ChatMessages.tsx` (~line 251, `Action` component at ~462)

`Action` consumes `active` only as `className={\`rm-message-tool ${active ? "active" : ""}\`}`,
with a static `aria-label`and`title`. `app-navigation.css:847-850`differentiates`.active`by
colour and background alone — no icon change, no border change — and there are no`forced-colors`rules anywhere. So un-rating is perceptually identical to rating, for sighted
users in high-contrast mode and for screen-reader users alike.`ChatComposer.tsx:351` does this
correctly 30 lines away.

**Target:**

```tsx
aria-pressed={active || undefined}
```

**Only on the two rating buttons.** A blanket add on `Action` would mislabel Copy, Branch and
Delete as toggles, which is a worse a11y outcome than the current state. `|| undefined` omits the
attribute rather than emitting `aria-pressed="false"` on non-toggles.

Also add a non-colour affordance in `app-navigation.css`:

```css
.rm-message-tool.active {
  /* Colour alone fails 1.4.1 and vanishes entirely in forced-colors mode. */
  outline: 1px solid currentColor;
  outline-offset: -1px;
}
```

---

#### WP3.6 — Drag overlay gets stuck

**File:** `apps/app/src/components/ChatPanel.tsx` (~line 175)

```tsx
onDragLeave={(event) => {
  if (event.currentTarget === event.target) setDragActive(false);
}}
```

The grid children tile the section, so `event.target` is always a child and the condition is
unreachable. Aborting a drag (Escape, or dropping outside the window) leaves a 90%-opaque
overlay covering the conversation until a drop or a reload. A repo-wide grep for
`dragend|onDragEnd|dragleave|dragActive` hits only this file — there is no window-level listener
anywhere.

**Target:** the standard depth-counter, because dragenter/dragleave fire per descendant:

```tsx
const dragDepth = useRef(0);

onDragEnter={() => { dragDepth.current += 1; setDragActive(true); }}
onDragLeave={() => { dragDepth.current -= 1; if (dragDepth.current <= 0) setDragActive(false); }}
onDrop={() => { dragDepth.current = 0; setDragActive(false); /* …existing…*/ }}
```

plus a window-level `dragend` reset, because a drag aborted outside the window fires no
`dragleave` on the element at all:

```tsx
useEffect(() => {
  const reset = () => {
    dragDepth.current = 0;
    setDragActive(false);
  };
  window.addEventListener("dragend", reset);
  window.addEventListener("drop", reset);
  return () => {
    window.removeEventListener("dragend", reset);
    window.removeEventListener("drop", reset);
  };
}, []);
```

**Test.** `apps/app/src/components/drag-depth.ts` with `nextDragDepth(depth, event)` returning
the new depth, and `isDragOverlayVisible(depth)`. Test: enter/enter/leave → still visible;
enter/enter/leave/leave → hidden; `dragend` → hidden regardless of depth; depth never goes
negative.

**WP3 gate:** the four commands in §3, plus `pnpm test:browser:chat` (the existing browser
acceptance harness at `scripts/browser-chat-acceptance.mjs`) against a running dev server.

---

### WP4 — Identity and credential panels

**Findings:** P1-4 newline split · P1-5 swapped guards · P1-6 API token display · P1-7 sessions
identity · P1-8 group member picker · P2-8 impersonation approve.

Highest defect density in the app, and all of them small. Do them together.

---

#### WP4.1 — `linesToArray` splits on the literal characters `\n`

**File:** `apps/app/src/components/AuthProviderConfigureDialog.tsx` line 16

```ts
function linesToArray(value: string): string[] {
  return value
    .split("\\n") // <- two characters: backslash, n
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
```

The textareas it feeds are seeded with `.join("\n")` (a real newline) and labelled "(one per
line)". So a two-line input returns a single element containing an embedded newline.

Consequences, verified against the server:

- `oidc.adminGroups` and `oauth2.scopes` have **no server-side newline guard**, so two admin
  groups collapse into one entry that matches nothing — **nobody gets admin via OIDC**. It fails
  closed, which is why it has gone unnoticed.
- The other six fields hit the normalizer and **400**. Which means any provider configured with
  2+ allowed email domains can never be saved from this dialog again — not even to change its
  display name — and the only feedback is a generic error toast.

**Target — one character:**

```ts
    .split("\n")
```

**Test.** `apps/app/src/components/auth-provider-lines.ts` exporting `linesToArray`, imported by
the dialog. `auth-provider-lines.test.ts`:

- `"a\nb"` → `["a", "b"]` (the regression — under the bug this returned `["a\nb"]`);
- `"a\r\nb"` → `["a", "b"]` (Windows paste);
- `" a \n\n b "` → `["a", "b"]` (trim + drop empties);
- `""` → `[]`;
- round-trip: `linesToArray(arr.join("\n"))` deep-equals `arr`. This last one is the assertion
  that binds the split to the join and stops the pair drifting again.

Use `.split(/\r?\n/u)` to satisfy the CRLF case.

---

#### WP4.2 — The Test and Deprovision guards are swapped

**File:** `apps/app/src/components/AuthProvidersPanel.tsx` lines 260–261 and 388–405

```ts
const canTest = !planned;
const canDeprovision = !planned && entry.protocol === "oidc";
```

```tsx
{canDeprovision ? ( …the TEST button… ) : null}
{canTest ? ( …the DEPROVISION button, variant="danger"… ) : null}
```

All 11 catalog entries are `status: "implemented"`, so `planned` is always false and `canTest` is
always true. Result: a red **Deprovision** button renders on every provider card **including
`local`** — the one that must never be deprovisioned, because it is the fallback login — while
**Test** renders only on the 6 OIDC cards. SAML, LDAP and OAuth2 connection testing is
implemented and smoke-tested server-side (`pnpm smoke:auth-providers:acceptance-contract`) and
is unreachable from the UI.

**Target:** swap the two guards, and exclude `local` from deprovisioning:

```ts
const canTest = !planned;
const canDeprovision =
  !planned && entry.protocol === "oidc" && entry.id !== "local";
```

```tsx
{canTest ? ( …TEST… ) : null}
{canDeprovision ? ( …DEPROVISION… ) : null}
```

**Test.** `apps/app/src/components/auth-provider-actions.ts` — note a file named
`apps/app/src/api/auth-provider-actions.test.ts` already exists; use a distinct name such as
`auth-provider-card-actions.ts` to avoid confusion.

```ts
export interface ProviderCardEntry {
  id: string;
  protocol: "oidc" | "oauth2" | "saml" | "ldap" | "local";
  status: "implemented" | "planned";
}

export function canTestProvider(entry: ProviderCardEntry): boolean {
  return entry.status !== "planned";
}

export function canDeprovisionProvider(entry: ProviderCardEntry): boolean {
  return (
    entry.status !== "planned" &&
    entry.protocol === "oidc" &&
    entry.id !== "local"
  );
}
```

Assert explicitly that `local` is testable but **not** deprovisionable, and that a SAML provider
**is** testable — both are the exact inversions the bug produced.

---

#### WP4.3 — A freshly minted API token is unrecoverable and undismissable

**Files:** `apps/app/src/components/ApiKeyPanel.tsx` (~line 208),
`apps/app/src/components/ServiceAccountPanel.tsx` (~line 89)

```tsx
{
  createdToken ? (
    <div className="mt-3 rounded-md border border-border p-2 text-sm">
      <div className="text-muted">{t("token")}</div>
      <div className="break-all font-mono">{createdToken}</div>
    </div>
  ) : null;
}
```

Two bare divs. No copy button, no dismiss, no "shown once" warning. Only the hash is persisted
(`packages/core/src/services/api-key-service.ts:22`), so the token is genuinely unrecoverable.
It stays on screen for the whole section visit, must be hand-selected, and a second "Create key"
click clobbers the first — and because every key is named `${account.name} key`, the orphaned
one is unidentifiable in the list. This fires on **100% of key creations**.

Additionally `ServiceAccountPanel.tsx:89` re-mints a token from an **unconfirmed** OverflowMenu
item — a menu click issues a live credential with no dialog.

**Target.** Extract a shared component `apps/app/src/components/SecretRevealCard.tsx`:

```tsx
export function SecretRevealCard({
  label,
  secret,
  onDismiss,
}: {
  label: string;
  secret: string;
  onDismiss: () => void;
}) {
  const { t } = useLocale();
  return (
    <div
      className="mt-3 rounded-md border border-border p-3 text-sm"
      role="status"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-muted">{label}</div>
        <div className="flex gap-2">
          <Button
            onClick={() => void navigator.clipboard.writeText(secret)}
            type="button"
          >
            {t("copy")}
          </Button>
          <Button onClick={onDismiss} type="button">
            {t("dismiss")}
          </Button>
        </div>
      </div>
      <div className="break-all font-mono mt-2">{secret}</div>
      <div className="rm-composer-error mt-2" role="alert">
        {t("secretShownOnce")}
      </div>
    </div>
  );
}
```

Use it in both panels. Add `useConfirm` to the `ServiceAccountPanel` regenerate action with
`tone: "danger"` — regenerating invalidates the live credential.

New keys (namespace `access-credential.json`): `secretShownOnce` — en "Copy this now. It cannot
be shown again." / es "Cópialo ahora. No se podrá volver a mostrar." / fr "Copiez-le maintenant.
Il ne pourra plus être affiché." Check whether `copy` and `dismiss` already exist in `core.json`
before adding.

**Test.** No unit test — this is presentational. The gate is `check` + `check:ui-form-contracts`.

---

#### WP4.4 — The sessions table cannot identify the current session

**Files:** `apps/app/src/components/SessionsPanel.tsx` (~line 124),
`packages/contracts/src/sessions.ts` (`UserSessionSchema`, ~line 11)

`UserSessionSchema` is a `strictObject` with no `current` flag, and no column derives one. Grep
for `isCurrent|currentSession` across `apps/` and `packages/` returns zero hits. Session names
are per-auth-method constants ("Local password login", "GitHub browser login"), so **every row
renders identical text**. Revoke is enabled on all of them.

Revoking your own session succeeds — `SessionService.revoke` has no self-guard, unlike
`revokeOthers()` which explicitly skips `subject.sessionId`. The follow-up refetch then 401s and
`packages/api-client/src/runtime/browser.ts:41` hard-navigates to `/login` with no explanation.
The user experiences a random sign-out.

`AuthSubject.sessionId` is already present in the bootstrap query rendered on the same page.

**Target.**

1. Add `current: z.boolean()` to `UserSessionSchema` and populate it server-side by comparing to
   the requesting session id. This is a contract change: regenerate the SDK afterwards with
   `pnpm sdk:typescript`, and expect `pnpm contract:breaking` to flag an additive field — additive
   is fine, but confirm oasdiff agrees before proceeding.
2. Render a `This device` badge on the current row.
3. Either disable Revoke on the current row and point at Sign out, or confirm it explicitly:

   ```ts
   if (
     session.current &&
     !(await ask({
       title: t("revokeCurrentSessionTitle"),
       body: t("revokeCurrentSessionBody"),
       confirmLabel: t("revoke"),
       tone: "danger",
     }))
   )
     return;
   ```

   Prefer the confirm — revoking the current session is a legitimate "sign out everywhere else,
   including here" action.

**If the contract change is rejected in review**, the fallback is entirely client-side: compare
each row's id to `subject.sessionId` from the bootstrap query already on the page. That is
strictly worse (it relies on the id being exposed) but it closes the P1 without touching
contracts. Note which route you took.

**Test.** `apps/app/src/components/session-rows.ts`:

```ts
export function decorateSessions<T extends { id: string }>(
  sessions: readonly T[],
  currentSessionId: string | undefined,
): Array<T & { current: boolean }> {
  return sessions.map((session) => ({
    ...session,
    current: session.id === currentSessionId,
  }));
}
```

Test: exactly one row is marked current; `undefined` current id marks none; an unmatched id marks
none. The "exactly one" assertion is the one that catches a future id-format change.

---

#### WP4.5 — Group membership requires a user id no screen displays

**File:** `apps/app/src/components/GroupsPanel.tsx` (~line 252)

Add-member is a free-text `userId` `Input`. The backend resolves it strictly
(`packages/core/src/services/in-memory-identity.ts:17`), so an email or a name 404s. But **no
console surface renders `user.id`** — `UsersPanel` columns are name/email/role/status, and the
Manage dialog shows only email. The only place a member's id ever appears is the members table of
a group they already belong to. The feature is uncompletable in-product.

**Target.** `listShareTargets` already returns labelled principals and drives exactly this
picker at `AgentAccessPanel.tsx:107-121`. Reuse it:

```tsx
const shareTargetsQuery = useQuery({
  queryKey: ["shareTargets", workspaceId],
  queryFn: () => listShareTargets(workspaceId),
});
…
<Field label={t("addMember")}>
  <Select
    name="memberId"
    options={(shareTargetsQuery.data ?? [])
      .filter((target) => target.type === "user")
      .map((target) => ({ label: target.label, value: target.id }))}
    onValueChange={setMemberId}
    value={memberId}
  />
</Field>
```

Copy the exact call shape from `AgentAccessPanel.tsx:107-121` rather than reconstructing it.

**Test.** No unit test — this is a control swap. Gate is `check` + `check:ui-form-contracts`
(which will now find a labelled control where there was a bare input).

---

#### WP4.6 — Impersonation approve has no confirmation

**File:** `apps/app/src/components/ImpersonationPanel.tsx` (~line 99, and ~line 235)

Approve mints a **live impersonation session** with no confirmation, while the safer Revoke at
line 201 is gated with `tone: "danger"`. Both use the default button variant and sit adjacent to
Reject, so the destructive action is the one that is easier to hit by accident. `useConfirm()` is
already destructured at line 27. The target is shown only as a raw `targetUserId`.

Separately, line 235 consumes `requestsQuery.data ?? []` raw, so an endpoint-scoped failure
renders a confident "No pending impersonation requests", and with no loading branch that false
statement flashes on every mount. `PanelState` is imported in this very file and used for the
sessions table 18 lines below.

**Target.**

1. Gate Approve:

   ```ts
   if (
     !(await ask({
       title: t("approveImpersonationTitle"),
       body: t("approveImpersonationBody"),
       confirmLabel: t("approve"),
       tone: "danger",
     }))
   )
     return;
   ```

2. Resolve `targetUserId` to a name/email for the confirm copy and the table column, via the
   same `listShareTargets` or users query used elsewhere.
3. Wrap the pending-requests table in `PanelState`.

Two claims from the original finding were refuted during verification and must **not** be
actioned: there is no missing TTL or ticket column (both exist), and the `["auditLogs"]`
invalidation is not missing (the panels are mutually exclusive lazy mounts with a 10s
`staleTime`).

New keys, namespace `device-impersonation.json`:

| Key                         | en                                                          | es                                                                     | fr                                                                       |
| --------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `approveImpersonationTitle` | Approve impersonation?                                      | ¿Aprobar la suplantación?                                              | Approuver l'usurpation d'identité ?                                      |
| `approveImpersonationBody`  | This immediately grants a live session acting as that user. | Esto concede de inmediato una sesión activa actuando como ese usuario. | Cela accorde immédiatement une session active au nom de cet utilisateur. |

**WP4 gate:** the four commands in §3, plus `pnpm smoke:auth-providers:acceptance-contract` if a
backend is available.

---

### WP5 — Error-handling sweep

**Findings:** P1-12 PersonalContentPanel · P2-6 ProviderPanel switch · P2-12 export failure
contrast · P1-11 KnowledgeSourceList delete · (P2-7 ImpersonationPanel `PanelState` is handled in
WP4.6).

Mechanical. Do them in one commit.

---

#### WP5.1 — `PersonalContentPanel` swallows every failure

**File:** `apps/app/src/components/PersonalContentPanel.tsx` (lines ~103–120, call sites 177,
184, 192, 203)

```ts
async function patch(item: WorkspaceContentItem, update: { enabled?: boolean; pinned?: boolean }) {
  await updateWorkspaceContent(kind, item.id, update);      // no try/catch
  await queryClient.invalidateQueries({ queryKey: [kind, workspaceId] });
}

async function remove(item: WorkspaceContentItem) {
  if (!(await ask({ … }))) return;
  await deleteWorkspaceContent(kind, item.id);              // no try/catch
```

Call sites discard the rejection with `void`. Mutations use `throwOnError: true`, so a rejection
is guaranteed on any non-2xx. Only 401 is handled (by the global redirect); 403, 409, 5xx and
offline are **fully silent**.

The `enabled` checkbox is server-controlled, so a failed PATCH snaps it back with no message.
Delete is worse: the confirm dialog closes, the row stays, nothing is said — on a panel whose own
copy promises _"Every item remains visible and reversible."_ The `save` handler in the same file
surfaces both outcomes correctly; copy its shape.

**Target:** wrap both in try/catch with `toast(..., "error")`, and for `patch`, invalidate on
failure too so the control re-syncs to server truth rather than sitting in a lie.

---

#### WP5.2 — `ProviderPanel` enable/disable switch fails silently

**Files:** `apps/app/src/components/ProviderPanel.tsx` (~line 308),
`apps/app/src/components/useAdminController.ts` (lines 189–233)

The Switch does `void onUpdateProvider(...)`. `useAdminController` has no try/catch and calls
`setError(undefined)` **first**, so a 403 or timeout clears the previous error and shows nothing
new. The Switch is controlled, so nothing visually flips either — the admin sees an unexplained
no-op. Every sibling handler in that controller catches and rethrows.

**Target:** add try/catch to the `useAdminController` handler matching its siblings; move
`setError(undefined)` to after the await, or restore the prior error in the catch.

---

#### WP5.3 — CSV export failures are invisible

**Files:** `apps/app/src/components/AuditPanel.tsx` (~line 145),
`UsagePanel.tsx` (~185), `AnalyticsPanel.tsx` (~110)

Export failure renders as Tailwind `text-red-300` = `#ffa2a2` on `#ffffff` — **1.92:1**, far
below the 4.5:1 minimum — with no `role="alert"` and no toast. It is the sole signal that a
**compliance export** was rejected.

These same components already render query errors correctly through `PanelState`, which uses
`.rm-composer-error` (`var(--rm-danger)`, 4.83:1, `role="alert"`).

**Target:** replace the `text-red-300` block with

```tsx
<div className="rm-composer-error" role="alert">
  {exportError}
</div>
```

and add `toast(t("exportFailed"), "error")` in the catch. Grep for other `text-red-` usages while
you are here and report any you find; do not fix them in this package unless they are also error
surfaces.

---

#### WP5.4 — Knowledge source delete has no confirmation

**File:** `apps/app/src/components/KnowledgeSourceList.tsx` (~line 76)

```tsx
<Button
  disabled={isDeleting}
  onClick={() => onDelete(c.row.original.id)}
  type="button"
>
  {t("knowledgeDelete")}
</Button>
```

No `useConfirm`, no `variant="danger"`, and it sits directly beside Reindex and Extract with
identical default styling. One misclick permanently deletes an indexed document —
`packages/core/src/services/knowledge-source-service.ts:71-84` deletes the external vectors and
the object-store blob **before** the transaction opens, so the original upload is gone even if
the transaction later fails, and `knowledge-repository.ts:149` is a hard delete with no
`deletedAt`. About 20 components import `useConfirm`; this one does not.

**Target:** `variant="danger"` plus a confirm naming the file:

```ts
if (
  !(await ask({
    title: t("knowledgeDeleteTitle"),
    body: t("knowledgeDeleteBody"),
    confirmLabel: t("knowledgeDelete"),
    tone: "danger",
  }))
)
  return;
```

The `ask`/`dialog` pair belongs in the **parent** (`KnowledgePanel.tsx`), which owns
`handleDeleteSource` and already renders a section — `KnowledgeSourceList` is a column-definition
component and rendering `{dialog}` from inside a table cell is fragile.

New keys, `knowledge-workspace.json`:

| Key                    | en                                                                    | es                                                                                | fr                                                                              |
| ---------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `knowledgeDeleteTitle` | Delete this source?                                                   | ¿Eliminar esta fuente?                                                            | Supprimer cette source ?                                                        |
| `knowledgeDeleteBody`  | The document, its chunks and its stored file are removed permanently. | El documento, sus fragmentos y su archivo almacenado se eliminan permanentemente. | Le document, ses fragments et son fichier stocké sont supprimés définitivement. |

---

### WP6 — i18n integrity

**Findings:** P1-16 login route · P2-15 `fallbackNS` collisions · P2-16 ThemeToggle labels ·
P2-14 raw enum `<option>` text · P2-13 missing `<Field>` labels · P2-2/P1-3 (done in WP3) ·
P2-21 dead keys.

**The framing that matters.** The parity test enforces 2149 keys × 3 locales. It measures the
_completeness of strings that already reached the locale files_. Nothing measures whether strings
reach them at all. That is the gap this package closes — the individual strings are symptoms.

---

#### WP6.1 — The login route has zero `t()` calls

**File:** `apps/app/src/routes/login.tsx` (~line 203 onward)

No `useLocale` import. ~20 hardcoded English literals including the MFA challenge (lines
263–269), the password field, and the `errorMessage` fallback (line 402). There is no `auth`
locale namespace at all.

This is the app's front door **and** the sign-out destination. `__root.tsx:92` already sets
`document.documentElement.lang` from `romeo:locale`, and `LocaleProvider` already wraps login —
so an es/fr user gets `lang="es"` on a 100% English page. That is a WCAG 3.1.1 (Language of Page)
violation, in a product that otherwise holds strict three-locale parity. Every sibling route
calls `t()`.

**Target.**

1. Create the namespace: `apps/app/src/locales/{en,es,fr}/auth.json`.
2. Register it in `apps/app/src/locales/index.ts` — add `"auth"` to `namespaceNames` **in
   alphabetical position** (first, before `"abuse-control"`? No — after: the list is
   alphabetical, so `auth` goes between `admin-section` and `agent-studio`... verify the exact
   ordering in the file and match it). Add the loader entry alongside.
3. Add `auth` to the relevant group in `localeNamespaceGroups` in `lib/i18n.tsx`, or call
   `useLocaleNamespaces(["auth"])` in the login route.
4. Extract every literal. Read the file and enumerate them — do not work from this document's
   count.

Because login renders before the app shell, confirm the namespace actually loads there. If lazy
loading proves unreliable on the login route, put the keys in `core` instead (always bundled) and
note the deviation.

---

#### WP6.2 — `fallbackNS` spans all 33 namespaces

**File:** `apps/app/src/lib/i18n.tsx` line 117

```ts
fallbackNS: [...namespaceNames],
```

with `defaultNS: "core"`. `namespaceNames` is alphabetical, so an unresolved key falls back
through all 33 namespaces in alphabetical order and resolves to whichever defines it first. There
are **13 duplicate keys, 4 with conflicting values**. Confirmed examples:

- `t("connectorSyncFailed")` resolves to `integration-automation`'s "Failed" / "Fallida" /
  "Échouée" instead of the intended "Could not sync connector";
- `t("sources")` in `RagGovernancePanel` resolves to `core`'s lowercase fragment.

`lib/i18n.test.ts` iterates _per namespace_ and so cannot structurally detect this.

**Target.**

1. Scope the fallback:

   ```ts
   fallbackNS: ["core"],
   ```

2. **This will break any component using a key from a lazily-loaded namespace without declaring
   it.** Before changing it, enumerate the risk:

   ```bash
   grep -rn "useLocaleNamespaces" apps/app/src/routes/
   ```

   Every route must declare the namespace group it needs. Add missing declarations first, change
   `fallbackNS` second, then walk every route in the browser and watch for keys rendering as raw
   key names.

3. **Add the collision assertion** — this is the higher-value half of the fix, because it
   prevents regrowth:

   ```ts
   it("has no key defined in more than one namespace with conflicting values", async () => {
     const byKey = new Map<string, Map<string, string>>();
     for (const namespace of namespaceNames) {
       const catalog = await loadLocaleNamespace("en", namespace);
       for (const [key, value] of Object.entries(catalog)) {
         const seen = byKey.get(key) ?? new Map<string, string>();
         seen.set(namespace, value);
         byKey.set(key, seen);
       }
     }
     const conflicts = [...byKey.entries()]
       .filter(([, seen]) => new Set(seen.values()).size > 1)
       .map(([key, seen]) => `${key}: ${[...seen.keys()].join(", ")}`);
     expect(conflicts, "duplicate keys with conflicting values").toEqual([]);
   });
   ```

   Run it **before** fixing anything to get the real list of 4 conflicts, then resolve each by
   renaming the key in the namespace that is wrong for the call site.

---

#### WP6.3 — `ThemeToggle` accessible name is hardcoded

**File:** `apps/app/src/components/ThemeToggle.tsx` line 31

```ts
const label = dark ? "Use light theme" : "Use dark theme";
```

The icons are `aria-hidden`, so this is the **only** accessible name on a control present in both
top bars for the entire session.

**The translations already exist** as `switchToDark` / `switchToLight` in
`shared-control.json:26-27`, already used by `CommandPalette.tsx:92,99`. Just use them:

```ts
const { t } = useLocale();
const label = dark ? t("switchToLight") : t("switchToDark");
```

Confirm the key names by reading `shared-control.json` — do not trust this document's line
numbers.

---

#### WP6.4 — Raw enum tokens in `<option>` text

**Files:** `QuotaPanel.tsx:217,271` · `BillingPanel.tsx:210,231,341` ·
`NotificationChannelPanel.tsx:242` · `ManagedModelPersonalization.tsx:222,273`

Options render raw tokens (`past_due`, `api_key`, `mobile_push`, `image.cost.micro_usd`) or
`option.charAt(0).toUpperCase() + …`, untranslated in all locales — often directly beneath
correctly-translated siblings in the same dialog (`QuotaPanel.tsx:306-308` uses
`t("noReset")`/`t("daily")`/`t("monthly")`).

`ManagedModelPersonalization.tsx:222` additionally hardcodes **"Managed model default"**, which
contradicts the assistant rename in its own description string on the same screen.

**The in-repo pattern to copy** is the `roleKey` / `visibilityKey` helper used by
`UsersPanel.tsx:273` and `PromptTemplatePanel.tsx:490`: a small exhaustive mapping function from
enum value to `MessageKey`, so an unhandled variant is a compile error.

```ts
function planStatusKey(status: BillingPlanStatus): MessageKey {
  switch (status) {
    case "active":
      return "billingStatusActive";
    case "canceled":
      return "billingStatusCanceled";
    case "past_due":
      return "billingStatusPastDue";
    case "trialing":
      return "billingStatusTrialing";
  }
}
```

**Important correction from verification:** the original finding listed 10 sites and **half were
wrong**. `PromptTemplatePanel.tsx:270,466`, `UsersPanel.tsx:220` and `InterfaceSettings.tsx:77`
already translate correctly — do not touch them. And there is no `tokens_in`/`tokens_out` metric;
do not invent keys for it. Enumerate the actual enum members from the contracts before writing
the key tables.

---

#### WP6.5 — Admin create dialogs skip `<Field>`

**Files:** `QuotaPanel.tsx:207` · `NotificationChannelPanel.tsx:277` ·
`BillingPanel.tsx:200,221,241,256,331` · `PromptTemplatePanel.tsx:260,456` ·
`WorkflowsPanel.tsx:281`

`@romeo/ui`'s `Field` is imported in only 9 of 123 files. These dialogs have no visible `<label>`
and their accessible name is a hardcoded English `aria-label`. In `NotificationChannelPanel` the
name is an **example value** ("to@example.com", "https://…") that _mutates when the Type select
changes_ — so the accessible name of a field changes based on an unrelated control.

`scripts/check-ui-form-contracts.mjs` asserts only that `aria-label` is _present_, never that it
is a _name_, which is why this passed CI.

**Target.** Wrap each control in `<Field label={t(...)}>`. The strings (`limit`, `metric`,
`quotaScope`, `reset`) already exist in en/es/fr — check before adding. Note `QuotaPanel`'s own
**edit** dialog does this correctly at lines 418 and 436; copy from there.

Do this in the same edit as WP6.4 where the files overlap.

---

#### WP6.6 — Delete the 31 dead locale keys and stop the set growing

**Finding:** P2-21. 31 English keys (93 strings across locales) have zero references — 13 of them
in `model-admin.json` (28% of that file), plus `security.mfa` / `verificationCode` and
`provider.verifyConnection`. There are no dynamic ``t(`...`)`` call sites, so a static scan is
sound.

**Order matters:** WP2 will start _using_ `verificationCode`. Do this package **after** WP2, and
re-run the scan rather than trusting the audit's list.

**Target.**

1. Write the scan as a test in `lib/i18n.test.ts` so it cannot regrow:

   ```ts
   it("ships no unreferenced message keys", async () => {
     const sources = await readAllSourceText("apps/app/src"); // .ts/.tsx, excluding locales/
     const unused: string[] = [];
     for (const namespace of namespaceNames) {
       const catalog = await loadLocaleNamespace("en", namespace);
       for (const key of Object.keys(catalog)) {
         if (!sources.includes(`"${key}"`) && !sources.includes(`'${key}'`))
           unused.push(key);
       }
     }
     expect(unused).toEqual([]);
   });
   ```

   Substring matching is deliberately crude and will produce false negatives (a key that is a
   substring of another string counts as used). That is the right trade: false negatives leave a
   dead key, false positives break the build on a live key. Note the limitation in a comment.

2. Delete the keys the scan reports, from all three locales.

**WP6 gate:** the four commands in §3, plus a manual walk of `/`, `/login`, `/settings`,
`/admin`, `/workspace` in all three locales watching for raw key names.

---

### WP7 — Theme coherence

**Findings:** P1-15 toggle does not persist · P2-19 `applyTheme` does not subscribe · (the
`.rm-connection-result` hardcoded hexes are in WP9.3).

---

#### WP7.1 — The toggle never writes through to the server

**Files:** `apps/app/src/components/ThemeToggle.tsx` line 26,
`apps/app/src/components/InterfaceSettings.tsx` lines 34–38 and 49–53

```ts
function toggleTheme() {
  const next = !dark;
  setTheme(next ? "dark" : "light"); // localStorage + classes only
}
```

`updateServerInterfacePreferences` has exactly one caller — `InterfaceSettings.tsx:49-53`. And
`InterfaceSettings.tsx:34-38` unconditionally overwrites local state from the query cache **on
every mount**.

So: toggle dark in the top bar, later open Settings → Interface (the _default_ section, and the
toggle is in the same top bar), and the theme snaps back to the server value — `"system"` for
anyone who never used the dropdown. It reads as the app changing theme by itself. The toggle also
never syncs across devices, unlike every other control on that panel.

**Target.**

1. Extract a shared hook `apps/app/src/lib/use-theme-preference.ts` that does both the local
   apply and the server write, and use it from both `ThemeToggle` and `InterfaceSettings`.
2. Gate the `InterfaceSettings` seed to first load only, so a background refetch cannot stomp a
   local change:

   ```ts
   const seeded = useRef(false);
   useEffect(() => {
     if (seeded.current || preferencesQuery.data === undefined) return;
     seeded.current = true;
     setSelection(preferencesQuery.data.theme);
   }, [preferencesQuery.data]);
   ```

**Test.** `apps/app/src/lib/theme-preference.ts`:

```ts
export function resolveThemeSelection(input: {
  serverTheme: Theme | undefined;
  localTheme: Theme;
  hasSeeded: boolean;
}): Theme {
  return !input.hasSeeded && input.serverTheme !== undefined
    ? input.serverTheme
    : input.localTheme;
}
```

Test: first load takes the server value; after seeding, a changed server value does **not**
override the local one (the regression); an undefined server value never clobbers local.

---

#### WP7.2 — "System" theme never reacts to an OS change

**File:** `apps/app/src/lib/theme.ts` line 15

```ts
export function applyTheme(theme: Theme): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  …
}
```

Sampled once per call; nothing subscribes. `"system"` is the out-of-the-box default and there are
**zero** `@media (prefers-color-scheme)` rules in any stylesheet — the theme is entirely
class-driven — so an OS light/dark flip has no path to the page until a reload.

**Target:** subscribe once at app start.

```ts
/** Re-applies on OS scheme change. Only meaningful for theme === "system"; the
 *  explicit themes ignore the media query, so re-running applyTheme is a no-op. */
export function watchSystemTheme(): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => applyTheme(getStoredTheme());
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
```

Call it from a `useEffect` in `__root.tsx`. Guard `typeof window === "undefined"` for SSR —
`applyTheme` already does.

**Note the refuted claim:** the original finding also alleged the toggle shows the _wrong glyph_
after an OS change. That is wrong — the icon and the surface go stale together, so they stay
consistent with each other. Do not "fix" the icon.

---

### WP8 — Reachability and dead UI

**Findings:** P2-5 `validateSearch` · P1-9 EvalPanel · P1-10 AgentVersionDiffSummary · P1-14
RagGovernancePanel · P2-9 truncated grant lists · P2-10 PromptTemplatePanel fields · P2-11
DeviceTokensPanel placement · P2-20 ToolTracePanel.

---

#### WP8.1 — Unknown `?section=` throws instead of falling back

**Files:** `routes/workspace.tsx:30`, `routes/admin.tsx:161`, `routes/settings.tsx:26`

All three are identical:

```ts
validateSearch: (search: Record<string, unknown>): { section?: string } =>
  typeof search.section === "string" ? { section: search.section } : {},
```

Any string is accepted, and then `META[section]!` throws. `/admin?section=models` renders the
error boundary. Note `settings.tsx` was **not** in the original finding — it was found during
verification and has the same defect.

**Target — one line per route**, and prefer rejecting at the boundary over patching the lookup:

```ts
validateSearch: (search: Record<string, unknown>): { section?: string } =>
  typeof search.section === "string" && search.section in META
    ? { section: search.section }
    : {},
```

If `META` is declared after the route in the file, use the `META[section] ?? META.<default>`
form at the lookup site instead. Either closes it; do not do both.

**Test.** `apps/app/src/lib/catalog-page.ts` already exists and is tested — check whether section
resolution belongs there before creating a new module.

---

#### WP8.2 — `EvalPanel` can only ever run the first suite

**File:** `apps/app/src/components/EvalPanel.tsx` (~line 61)

```ts
const activeSuite = suites[0];
const activeResult = resultsQuery.data?.[0];
```

Lists are hard-sliced to 3 non-interactive `<div>`s, and no `selectedSuiteId` state exists.
`PanelStats` shows "Total suites: 5" beside 3 unclickable rows. Suites 2..N can never be run.
Worse, suites are ordered `createdAt DESC`, so the unlabelled Run button **silently re-targets**
whenever anyone adds a suite. Multi-case suites (API- or import-created, up to 100 cases) can only
ever have `result[0]` rated, and older runs are permanently hidden.

**Target.**

1. Add `const [selectedSuiteId, setSelectedSuiteId] = useState<string>()`; derive
   `activeSuite = suites.find((s) => s.id === selectedSuiteId) ?? suites[0]`.
2. Make the suite rows real `<button>`s with `aria-current`, remove the `.slice(0, 3)`, and let
   the container scroll.
3. Same for results: a selectable list, not `[0]`.
4. Label the Run button with the suite it will run: `t("evalRunSuite")` + the suite name.

**Test.** `apps/app/src/components/eval-selection.ts` with
`resolveActiveSuite(suites, selectedId)`. Assert: explicit selection wins; no selection falls
back to `suites[0]`; **a selection that is still present survives a list reorder** — that is the
silent-retarget regression.

---

#### WP8.3 — The version diff renders one side of the diff

**File:** `apps/app/src/components/AgentVersionDiffSummary.tsx` (25 lines, full text in §1 of the
audit)

```tsx
<div className="font-medium">{change.field}</div>
<div className="break-words text-muted">{formatValue(change.right)}</div>
```

`change.left` is **required** by the contract
(`packages/contracts/src/managed-model-schemas.ts:242-261`) and never read. Comparing v3 to v7
shows one unlabelled blob with no way to tell whether it is the before or the after value, keyed
by the raw camelCase field name (`systemPrompt`) in all three locales. The two feeding `<Select>`s
at `AgentVersionPanel.tsx:119-134` have no label and no `aria-label`, so a screen reader
encounters two anonymous comboboxes. This panel is **not** admin-gated — any workspace user
reaches it.

**Target.**

1. Render both sides with explicit labels:

   ```tsx
   <div className="rounded-md border border-border p-2" key={change.field}>
     <div className="font-medium">{t(agentDiffFieldKey(change.field))}</div>
     <div className="grid gap-1 sm:grid-cols-2">
       <div>
         <div className="text-xs text-muted">{t("agentDiffBefore")}</div>
         <div className="break-words">{formatValue(change.left)}</div>
       </div>
       <div>
         <div className="text-xs text-muted">{t("agentDiffAfter")}</div>
         <div className="break-words">{formatValue(change.right)}</div>
       </div>
     </div>
   </div>
   ```

2. Map `change.field` to a translated label with an exhaustive switch (same pattern as WP6.4).
   Enumerate the fields from the contract.
3. Add `<Field label={t("agentDiffLeftVersion")}>` / `t("agentDiffRightVersion")` to the two
   selects in `AgentVersionPanel.tsx`.

New keys, `agent-studio.json`:

| Key                     | en           | es             | fr              |
| ----------------------- | ------------ | -------------- | --------------- |
| `agentDiffBefore`       | Before       | Antes          | Avant           |
| `agentDiffAfter`        | After        | Después        | Après           |
| `agentDiffLeftVersion`  | Compare from | Comparar desde | Comparer depuis |
| `agentDiffRightVersion` | Compare to   | Comparar con   | Comparer avec   |

---

#### WP8.4 — `RagGovernancePanel` has six dead imports and an unreachable tab

**File:** `apps/app/src/components/RagGovernancePanel.tsx` line 7

Imports `createRagPolicyChangeRequest`, `ragPolicyChangeJustificationCodes`, two types, plus
unused `Input`/`Textarea` — the residue of a "propose change" form that was removed. The "Change
requests" tab can therefore only ever render "No change request on record", and the
approve/reject/justification machinery behind it is unreachable dead code. The route and service
exist server-side.

**Report this without the four-eyes-bypass framing.** Verification established that
`RagPolicyService.update` never required a change request, so nothing is being circumvented. It
is an unfinished feature, not a control bypass.

**Target — decide, then act.** Either:

- **Finish it:** rebuild the propose-change form using the already-imported
  `createRagPolicyChangeRequest` and `ragPolicyChangeJustificationCodes` (a `Select` of
  justification codes plus a `Textarea` reason), which makes the whole tab live; or
- **Remove it:** delete the tab, the six imports, and the now-unreferenced locale keys.

Prefer finishing — the backend is complete and the imports tell you the intended shape. If you
remove instead, say so explicitly in the commit body.

---

#### WP8.5 — Grant lists silently truncate at 6

**Files:** `apps/app/src/components/AgentAccessPanel.tsx` (~line 155),
`apps/app/src/components/GovernanceRetentionTab.tsx` (~line 223)

Both `.slice(0, 6)` a **fully fetched**, security-relevant list with no count, no "+N more", and
no pagination. An admin reviewing who has access to an assistant sees a partial list with zero
signal that it is partial.

**Target:** render the count (`t("showingOfTotal")` with interpolation), and either paginate or
scroll. Do not silently truncate a permissions list.

`AgentAccessPanel` additionally has **no revoke path at all** — the SDK has no unshare operation
for agents (`deleteResourceGrant` is wired only for chats). That needs a backend endpoint first;
**note it and move on**, do not attempt it here.

---

#### WP8.6 — Prompt template tags and description are unreachable

**File:** `apps/app/src/components/PromptTemplatePanel.tsx` (~line 105; create at 201–276, edit at
397–472)

Tags and Description columns are rendered but **neither** the create nor the edit dialog exposes
the fields, though the API accepts both. UI-authored templates show permanently blank cells. And
`packages/core/src/services/prompt-template-service.ts:391` builds its search haystack from
`[name, description, ...tags]` — so two of three search dimensions are always empty for anything
created in-product.

**Target:** add a `description` `Textarea` and a `tags` input (comma- or newline-separated —
if newline, reuse the fixed `linesToArray` from WP4.1) to both dialogs, wrapped in `<Field>`.

---

#### WP8.7 — `DeviceTokensPanel` is in the wrong route

**File:** `apps/app/src/routes/admin.tsx` line 473

The panel is **self-scoped** — it queries `(subject.orgId, subject.id)` with no admin widening —
but is mounted only behind the `isAdmin` gate at `admin.tsx:331`. A member who minted a device
token via the CLI has no web surface to list or revoke it.

Verification confirmed this is **placement, not an authz hole**: `romeo devices list|revoke` is a
working fallback, and `packages/core/src/services/auth-subject.ts` `localUserScopes` shows the
regular user already holds the scope.

**Target:** move the `DeviceTokensPanel` mount from `admin.tsx` into `settings.tsx` as a section.
Add the section to `settings.tsx`'s `META` and its nav list.

**Leave `ConnectedAppsPanel` in admin** — it _is_ org-wide for admins. Only `DeviceTokensPanel`
moves.

---

#### WP8.8 — `ToolTracePanel` is fully dead

**File:** `apps/app/src/components/ToolTracePanel.tsx` (78 lines)

Zero references repo-wide — the only unreferenced component of 110. Its `listToolCalls` wrapper
(`features/tools/queries.ts:28`) and 21 locale entries (`workspace-capability.json:99-105` × 3
locales) are transitively dead. The **backend is complete and live**
(`packages/core/src/routes/tools.ts:38`, `run-repository.ts:166`).

This is an unmounted feature, not litter. **Decide: mount it or delete the stack.** Mounting it
in the workspace tools section is the higher-value call given the backend already ships the data.
If you delete, remove the component, the query wrapper, and all 21 locale keys × 3 locales in the
same commit.

---

### WP9 — Accessibility and polish

**Findings:** P2-4 slash menu keyboard · P2-17 Providers/Connections label collision ·
P2-18 hardcoded status hexes · plus the two a11y items folded into WP3 (rating buttons) and WP8
(diff selects).

---

#### WP9.1 — The "/" template menu is not keyboard operable

**File:** `apps/app/src/components/ChatComposer.tsx` (~line 120)

`handleDraftKeyDown` returns early for every key that is not Enter, so ArrowDown/ArrowUp/Escape
never reach a handler. On Enter it calls `requestSubmit()` — **sending the literal `/summary` to
the model**. There is no `combobox` role, no `aria-activedescendant`, no `aria-expanded`.

It also renders an empty bordered popup, because the inner filter uses untrimmed `draft.slice(1)`
against a trimmed server query.

**`ComposerModelSelect.tsx:102-130` implements the whole pattern correctly, in the same
directory.** Port it: `handleModelMenuKeyDown` there handles Escape, ArrowDown, ArrowUp, Home and
End over `[role="option"]` elements, skipping disabled ones and wrapping at both ends. Copy that
function's structure, and fix the filter to trim.

---

#### WP9.2 — "Connections" means two different things

**File:** `apps/app/src/components/ProviderPanel.tsx` (~line 109)

The Providers page card is titled `t("connections")` = "Connections" with a "+ Add connection"
button — which is the **exact label of the sibling nav item** where data and tool connectors
live. The collision reproduces in es and fr. The actual Connections section never calls its
objects "connections" ("Tool connectors", "Data connectors"), so the countable noun exists only
on the wrong page.

Same vocabulary-collision class as the managed-model → assistant rename already done.

**Target:** rename the Providers card to the thing it holds. Providers hold **model provider
credentials**, so `t("providerCredentials")` / "+ Add provider". Add new keys rather than
repurposing `connections`, which the nav still needs.

| Key                   | Namespace | en                   | es                         | fr                          |
| --------------------- | --------- | -------------------- | -------------------------- | --------------------------- |
| `providerCredentials` | provider  | Provider credentials | Credenciales del proveedor | Identifiants du fournisseur |
| `addProvider`         | provider  | Add provider         | Añadir proveedor           | Ajouter un fournisseur      |

---

#### WP9.3 — Hardcoded status hexes next to tokens that already exist

**Files:** `apps/app/src/styles/app-foundation.css` line ~546, plus
`app-conversation.css:852` and `login.css:212-224,418-421`

`.rm-connection-result.success` / `.error` use four hardcoded hexes plus a hand-rolled `html.dark`
block, when `--rm-success` / `--rm-danger` are defined at lines 81-83 / 122-124 and used in 13
other places.

The visible symptom: `.rm-connection-checks` is a **direct child** that _does_ consume the
tokens, so a failed connection test paints the summary `#b91c1c` and the check line directly
beneath it `#dc2626` — two different reds in one box.

**Target:** replace the hexes with `var(--rm-danger)` / `var(--rm-success)` and delete the
hand-rolled dark block (the tokens already invert). Do the same at the two other sites.

While in `login.css`: it uses `:focus` rather than `:focus-visible`, which puts a focus ring on
mouse clicks. Change to `:focus-visible`. (Known-open item from a prior session, folded in here
since you are already in the file.)

---

## 5. Finding index — all 45

Every confirmed finding maps to exactly one work package. Nothing is dropped.

| #   | Sev | File:line                                                              | Finding                                               | WP    |
| --- | --- | ---------------------------------------------------------------------- | ----------------------------------------------------- | ----- |
| 1   | P0  | `KnowledgePanel.tsx:200`                                               | Reindex reads the Add-Source textarea                 | WP1.1 |
| 2   | P0  | `BillingPanel.tsx:69`                                                  | Plan defaults hardcoded; write replaces quota tiers   | WP1.2 |
| 3   | P0  | `ToolConnectorPanel.tsx:126`                                           | "Allow host" writes `api.example.com`                 | WP1.3 |
| 4   | P0  | `AgentStudioPanel.tsx:190`                                             | Publish ships stale config and wipes the form         | WP1.4 |
| 5   | P0  | `AccountSecurityPanel.tsx:152`                                         | No recovery codes → one-way MFA lockout               | WP2   |
| 6   | P1  | `useWorkspaceTurnActions.ts:198`                                       | No rollback on failed send                            | WP3.1 |
| 7   | P1  | `ChatMessages.tsx:136`                                                 | Four handlers silently no-op while streaming          | WP3.2 |
| 8   | P1  | `useWorkspaceTurnActions.ts:407,76`                                    | Hardcoded English in the transcript                   | WP3.3 |
| 9   | P1  | `AuthProviderConfigureDialog.tsx:18`                                   | `split("\\n")` breaks every multi-line field          | WP4.1 |
| 10  | P1  | `AuthProvidersPanel.tsx:388`                                           | Test/Deprovision guards swapped                       | WP4.2 |
| 11  | P1  | `ApiKeyPanel.tsx:208`                                                  | Plaintext token, no copy/dismiss/warning              | WP4.3 |
| 12  | P1  | `SessionsPanel.tsx:124`                                                | No current-session flag; Revoke is a coin flip        | WP4.4 |
| 13  | P1  | `GroupsPanel.tsx:252`                                                  | Add-member needs an id no screen shows                | WP4.5 |
| 14  | P1  | `EvalPanel.tsx:61`                                                     | Only `suites[0]` is ever runnable                     | WP8.2 |
| 15  | P1  | `AgentVersionDiffSummary.tsx:16`                                       | `change.left` never rendered                          | WP8.3 |
| 16  | P1  | `KnowledgeSourceList.tsx:76`                                           | Unconfirmed hard delete of an indexed doc             | WP5.4 |
| 17  | P1  | `PersonalContentPanel.tsx:103`                                         | `patch`/`remove` swallow every failure                | WP5.1 |
| 18  | P1  | `DataConnectorPanel.tsx:99`                                            | Every connector bound to `knowledgeBases[0]`          | WP1.5 |
| 19  | P1  | `RagGovernancePanel.tsx:7`                                             | Six dead imports; unreachable change-request tab      | WP8.4 |
| 20  | P1  | `ThemeToggle.tsx:26`                                                   | Toggle never persists; Settings snaps it back         | WP7.1 |
| 21  | P1  | `routes/login.tsx:203`                                                 | Entire route hardcoded English                        | WP6.1 |
| 22  | P2  | `ChatPanel.tsx:175`                                                    | Drag overlay gets stuck                               | WP3.6 |
| 23  | P2  | `useChatRunStream.ts:242`                                              | 10 activity labels hardcoded, in `aria-live`          | WP3.4 |
| 24  | P2  | `ChatMessages.tsx:251`                                                 | Rating buttons have no pressed state                  | WP3.5 |
| 25  | P2  | `ChatComposer.tsx:120`                                                 | "/" menu not keyboard operable; Enter sends raw text  | WP9.1 |
| 26  | P2  | `workspace.tsx:147`, `admin.tsx:161`, `settings.tsx:90`                | Unknown `?section=` throws                            | WP8.1 |
| 27  | P2  | `ProviderPanel.tsx:308`                                                | Enable/disable switch fails silently                  | WP5.2 |
| 28  | P2  | `ImpersonationPanel.tsx:235`                                           | Raw `?? []` renders a confident false empty           | WP4.6 |
| 29  | P2  | `ImpersonationPanel.tsx:99`                                            | Approve mints a live session with no confirm          | WP4.6 |
| 30  | P2  | `AgentAccessPanel.tsx:155` + `GovernanceRetentionTab.tsx:223`          | Silent `.slice(0,6)` on a grant list                  | WP8.5 |
| 31  | P2  | `PromptTemplatePanel.tsx:105`                                          | Tags/description columns with no inputs               | WP8.6 |
| 32  | P2  | `admin.tsx:473`                                                        | `DeviceTokensPanel` self-scoped but admin-gated       | WP8.7 |
| 33  | P2  | `AuditPanel.tsx:145` + `UsagePanel.tsx:185` + `AnalyticsPanel.tsx:110` | Export failure at 1.92:1, no alert                    | WP5.3 |
| 34  | P2  | `QuotaPanel.tsx:207` + `NotificationChannelPanel.tsx:277` + 3 more     | Create dialogs skip `<Field>`                         | WP6.5 |
| 35  | P2  | `QuotaPanel.tsx:217` + `BillingPanel.tsx:210` + 4 more                 | Raw enum tokens in `<option>`                         | WP6.4 |
| 36  | P2  | `lib/i18n.tsx:117`                                                     | `fallbackNS` spans 33 namespaces; 4 wrong resolutions | WP6.2 |
| 37  | P2  | `ThemeToggle.tsx:31`                                                   | Accessible name hardcoded; translations already exist | WP6.3 |
| 38  | P2  | `lib/theme.ts:15`                                                      | "system" never reacts to an OS scheme change          | WP7.2 |
| 39  | P2  | `ProviderPanel.tsx:109`                                                | "Connections" collides with the nav item              | WP9.2 |
| 40  | P2  | `app-foundation.css:546`                                               | Hardcoded status hexes beside the tokens              | WP9.3 |
| 41  | P2  | `ToolTracePanel.tsx:11`                                                | 78 lines, zero references, live backend               | WP8.8 |
| 42  | P2  | `locales/en/model-admin.json`                                          | 31 unreferenced keys × 3 locales                      | WP6.6 |
| 43  | P2  | `ManagedModelPersonalization.tsx:222`                                  | "Managed model default" contradicts its own copy      | WP6.4 |
| 44  | P2  | `AgentVersionPanel.tsx:119-134`                                        | Two unlabelled `<Select>`s                            | WP8.3 |
| 45  | P2  | `login.css:212-224`                                                    | `:focus` instead of `:focus-visible`                  | WP9.3 |

### Refuted — do not action

Three claims were killed under adversarial verification. They are listed so nobody re-raises them:

1. **"Regenerate and Edit-and-Resend drop document attachments."** False.
   `RunStartService.prepare()` (`packages/core/src/services/run-start-service.ts:95-132`) calls
   `resolveRetainedMessageContext({ messages: chatMessages })` against the chat's **full
   persisted message list**, deliberately re-deriving document context server-side regardless of
   the client payload.
2. **"Impersonation approve exposes no TTL or ticket."** False — both are columns. And the
   `["auditLogs"]` invalidation is not missing; the panels are mutually exclusive lazy mounts
   with a 10s `staleTime`.
3. **"ThemeToggle shows the wrong glyph after an OS theme change."** False — the icon and the
   page surface go stale together, so they remain mutually consistent.

Additionally, roughly half of finding 35's original site list was wrong:
`PromptTemplatePanel.tsx:270,466`, `UsersPanel.tsx:220` and `InterfaceSettings.tsx:77` already
translate correctly, and no `tokens_in`/`tokens_out` metric exists. Verify each site before
editing.

---

## 6. Definition of done

The effort is complete when all of the following hold.

**Automated:**

```bash
pnpm --filter @romeo/app check          # 0 errors
pnpm --filter @romeo/app test           # all pass, including the new pure-logic suites
pnpm check:ui-form-contracts            # 0 findings
pnpm format:check                       # clean
pnpm --filter @romeo/app build          # succeeds
pnpm check:bundle-budget                # within budget (new components add weight)
```

**New tests that must exist and pass:**

| Module                                          | Asserts                                                         |
| ----------------------------------------------- | --------------------------------------------------------------- |
| `components/knowledge-reindex.test.ts`          | payload id always matches the clicked row                       |
| `components/billing-plan-payload.test.ts`       | defaults seeded from server; all quota tiers preserved          |
| `components/agent-publish-gate.test.ts`         | dirty form blocks publish; assistant switch still resets        |
| `components/data-connector-binding.test.ts`     | never falls back to `knowledgeBases[0]`                         |
| `components/mfa-recovery.test.ts`               | MFA enabled with no recovery factor = lockout risk              |
| `components/turn-rollback.test.ts`              | rejected send restores draft and does not revoke previews       |
| `components/drag-depth.test.ts`                 | nested dragleave does not hide the overlay; dragend always does |
| `components/auth-provider-lines.test.ts`        | `"a\nb"` → `["a","b"]`; join/split round-trips                  |
| `components/auth-provider-card-actions.test.ts` | `local` testable but not deprovisionable                        |
| `components/session-rows.test.ts`               | exactly one row flagged current                                 |
| `components/eval-selection.test.ts`             | selection survives a list reorder                               |
| `lib/theme-preference.test.ts`                  | server value does not override local after first seed           |
| `lib/i18n.test.ts` (extended)                   | no cross-namespace value conflicts; no unreferenced keys        |

**Manual, against `pnpm --filter @romeo/app dev` on `:3000`:**

1. Add knowledge source B, then Reindex source A → A's content unchanged.
2. Open Billing, change only status → quota tiers and external ids intact after save.
3. Edit an assistant's system prompt, click Publish → blocked with a visible reason; Save draft
   then Publish → succeeds and the prompt survives.
4. Enroll TOTP → recovery codes step is unskippable, codes copyable, count visible afterwards.
5. Attach an image to a non-vision model and send → error shown, prompt and attachment restored,
   no phantom bubbles.
6. Start a drag over the chat, press Escape → overlay clears.
7. Configure an OIDC provider with two allowed domains → saves; reopen → both domains present.
8. Switch locale to es and fr → walk `/login`, `/`, `/settings`, `/admin`, `/workspace`; no
   English literals, no raw key names.
9. Toggle theme in the top bar, open Settings → Interface → theme does not snap back.
10. `/admin?section=doesnotexist` → falls back to a real section, no error boundary.

Also run `pnpm test:browser:chat` (`scripts/browser-chat-acceptance.mjs`) against the running dev
server.

**Reporting.** State plainly which items were completed, which were deferred (WP1.3 step 2, the
`AgentAccessPanel` revoke endpoint, and either branch of the WP8.4 / WP8.8 mount-or-delete
decisions are all legitimate deferrals), and anything discovered that is not in this document.

---

## 7. Discovered during work

Append here as you go. Format: `file:line — what — severity — whether you fixed it`.

- `apps/app/src/components/PersonalContentPanel.tsx` — save mutation had no
  error callback despite the audit describing that path as handled — P1 —
  fixed with the same visible error toast as the adjacent patch/delete paths.
- `apps/app/src/components/ToolConnectorPanel.tsx:201`,
  `DataConnectorSyncHistory.tsx:76-80`, and `ToolOperationList.tsx:255` —
  additional hardcoded Tailwind red error surfaces found by the WP5.3-required
  grep — P2 — reported but not changed because WP5.3 scopes implementation to
  the three compliance-export surfaces.
- `apps/app/src/components/ConsoleLayout.tsx` — Settings and Workspace rendered
  raw `skipToContent` and `adminBackToChat` keys because their scoped locale
  groups omitted `admin-navigation` — P1 — fixed by loading that namespace for
  both route groups.
