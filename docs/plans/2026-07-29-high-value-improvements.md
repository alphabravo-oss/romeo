# Romeo High-Value Improvement Program

Date: 2026-07-29  
Branch at audit: `agent/frontend-remediation`  
Starting commit: `641ae9d`

## Objective

Implement exactly 20 high-value improvements across release correctness, automated quality
enforcement, runtime resilience, chat usability, performance, accessibility, code quality, and
enterprise data presentation. Every improvement must be implemented in production code, covered
by the strongest practical automated test, and verified by the repository's full quality gates.

This plan is both the implementation specification and the completion ledger. An item is not done
because code exists; it is done only when its acceptance criteria and named verification evidence
pass against the final worktree.

## Audit baseline

The findings below were derived from the current repository rather than the older remediation
plans:

- `pnpm quality` currently fails at `check:sdk-drift`; the Python SDK does not contain the latest
  chat-experience operations.
- 14 workspace packages use `vitest run --passWithNoTests`, which can turn accidental test
  deletion into a green build.
- The architecture ratchet catches raw controls and several framework bypasses but does not
  enforce the remaining interface-guideline hazards.
- Two Playwright gates wait for `networkidle` even though the authenticated application maintains
  an EventSource connection.
- The canonical quality runner omits the comprehensive chat acceptance and 60-variant admin audit.
- TanStack Query has no shared retry classifier, so permanent 4xx failures use the same retry
  behavior as transient network/server failures.
- There is no application-level `unhandledrejection` reporting surface.
- The UI provides no explicit offline or chat-event reconnect state.
- `CommandPalette` calls `useWorkspaceData(undefined)` from the root, activating agents, chats,
  models, providers, operational-summary, and chat-experience queries merely to read `isAdmin`.
- Root-level command and shortcut overlays are eagerly imported and mounted.
- Chat search changes its query key on every keystroke after the second character.
- Sidebar search/tag/folder queries use `data ?? []`, making a failed request look like a valid
  empty result.
- Portable chat import accepts arbitrarily large files, silently drops all invalid messages, and
  does not enforce title, attachment, or aggregate payload limits.
- Blob download code is duplicated across six call sites and revokes object URLs immediately after
  `click()`, which is brittle across browser engines.
- Clipboard writes are duplicated and several are fire-and-forget, producing no usable failure
  feedback.
- `PanelState` contains hardcoded English fallback, retry, and empty-state copy.
- A pending design-system button renders a separately named `"Loading"` status inside an already
  named button, creating redundant accessible output and bypassing localization.
- `packages/ui/src/advanced-data-table.tsx` is the sole remaining Lucide barrel import.
- Data-table density, column visibility, and page size reset whenever a panel remounts.
- The shared TanStack table has sorting, pagination, selection, and virtualization, but lacks a
  page-size chooser, consistent CSV export, reset control, and a live result summary.

## Global implementation rules

1. Preserve the contract-first API boundary: generated SDK calls remain behind feature modules.
2. Continue using TanStack Query, TanStack Table, TanStack Router, TanStack Form, Radix primitives,
   and `@romeo/ui`; do not introduce parallel presentation frameworks.
3. Add every user-facing string to English, Spanish, and French in the same change.
4. Use direct Lucide icon paths outside an explicit vendor adapter.
5. Do not weaken authentication, authorization, destructive-action confirmation, tenant isolation,
   or release evidence.
6. Treat loading, empty, error, offline, reconnecting, and success paths as part of each feature.
7. Keep production TypeScript files below the existing 500-line architecture limit.
8. Use `apply_patch` for source edits, generated tools for generated artifacts, and never hand-edit
   generated SDK output.
9. After each implementation wave, run its targeted tests and typechecks. At completion, run the
   full verification matrix in the final section.

## Implementation waves

| Wave | Items         | Purpose                                              |
| ---- | ------------- | ---------------------------------------------------- |
| A    | HVI-01–HVI-04 | Repair and strengthen release/quality evidence       |
| B    | HVI-05–HVI-10 | Runtime resilience and root performance              |
| C    | HVI-11–HVI-15 | Chat navigation, portability, and browser operations |
| D    | HVI-16–HVI-20 | Accessibility and enterprise presentation            |
| E    | all           | Full completion audit and release verification       |

---

## HVI-01 — Synchronize the Python SDK with the OpenAPI contract

**Value:** A stale published SDK is a release correctness defect: Python consumers cannot discover
or call the governed chat-experience and title-generation operations represented by the server.

**Current evidence:** `pnpm quality` fails in `scripts/check-python-sdk-drift.mjs`, reporting changes
to `README.md` and `romeo_client/openapi.py`.

**Implementation:**

1. Run the repository generator (`pnpm sdk:python`) against the generated canonical OpenAPI
   document; do not hand-edit generated Python.
2. Inspect the generated diff to ensure it contains only deterministic contract additions and
   metadata changes expected from the current document.
3. Preserve the generated package layout and existing formatter behavior.

**Tests and acceptance:**

- `pnpm check:sdk-drift` passes from a clean worktree.
- The generated Python operation inventory contains GET/PUT chat-experience and POST chat-title
  generation operations.
- `git diff --check` reports no generated whitespace defects.

## HVI-02 — Make package test commands fail when tests disappear

**Value:** `--passWithNoTests` can conceal accidental deletion, glob breakage, or configuration
regressions in packages that currently do have tests.

**Current evidence:** 14 package manifests contain `vitest run --passWithNoTests`; every one of
those packages currently owns at least one test file.

**Implementation:**

1. Replace `vitest run --passWithNoTests` with `vitest run` in every package that has tests.
2. Add a repository contract check that compares package test scripts with test-file inventory and
   fails if a tested package opts into no-test success.
3. Wire the contract check into `pnpm quality` before the test phase.

**Tests and acceptance:**

- The new contract test passes for every workspace package.
- Temporarily pointing the checker at a synthetic manifest using `--passWithNoTests` produces a
  deterministic failure in its unit/contract smoke.
- `pnpm test` passes without any no-test bypass.

## HVI-03 — Enforce current web-interface standards in the architecture gate

**Value:** The current ratchet prevents raw controls but can still regress on unlabeled icon
actions, hardcoded accessible labels, blocking paste, disabled zoom, or unfocused interactive
elements.

**Current evidence:** Four production notification controls contain hardcoded English
`aria-label`s, and the design-system pending spinner hardcodes `"Loading"`.

**Implementation:**

1. Localize the remaining production hardcoded accessible names in all three locales.
2. Extend the architecture checker with production-only forbidden patterns for:
   - literal `aria-label` strings outside tests/dev gallery,
   - `user-scalable=no` or `maximum-scale=1`,
   - paste prevention,
   - `transition: all`,
   - raw clickable `div`/`span` patterns,
   - Lucide barrel imports anywhere in application/design-system production code.
3. Record structured failures in the architecture evidence output.
4. Add checker fixtures or a contract smoke proving every rule rejects a representative violation.

**Tests and acceptance:**

- `pnpm check:architecture` passes on the final tree.
- The evidence lists the added required/forbidden rule inventory.
- English, Spanish, and French locale parity tests pass.

## HVI-04 — Make browser quality SSE-safe and representative

**Value:** A quality gate that hangs on an intentional EventSource or samples only three pages can
miss user-visible failures while wasting CI time.

**Current evidence:** `browser-engine-matrix.mjs` and `browser-visual-baselines.mjs` use
`waitUntil: "networkidle"`. The canonical browser runner omits `browser-chat-acceptance.mjs` and
`admin-console-audit.mjs`. Visual coverage includes only chat, login, providers, and the dev
gallery.

**Implementation:**

1. Navigate with `domcontentloaded`, then wait for route-specific semantic readiness.
2. Add bounded loading/error waits so early navigation does not weaken assertions.
3. Run the comprehensive chat acceptance and admin audit from the canonical browser quality
   runner against the isolated quality server.
4. Expand the visual contract with high-risk admin audit, posture, access, and settings-security
   views while retaining all themes and viewports.
5. Keep evidence metadata-only and ensure acceptance-created chats are cleaned up.

**Tests and acceptance:**

- `pnpm quality:browser` completes without a network-idle timeout.
- Chromium, Firefox, and WebKit matrix checks pass.
- Chat acceptance passes and leaves zero acceptance chats.
- All admin route/viewport checks pass.
- Every configured visual scenario has nonzero dimensions, zero horizontal overflow, and a
  screenshot hash.

## HVI-05 — Add an explicit TanStack Query retry policy

**Value:** Retrying validation, authorization, and not-found responses adds latency and server load;
not retrying transient failures reduces resilience.

**Current evidence:** `AppProviders` configures stale time and focus behavior only.

**Implementation:**

1. Add a pure `shouldRetryQuery(failureCount, error)` classifier.
2. Extract status codes from generated client errors without coupling to a single error class.
3. Never retry aborts or deterministic 400/401/403/404/409/422 responses.
4. Retry network errors, 408, 425, 429, and 5xx responses with a bounded attempt count.
5. Add capped exponential `retryDelay` with no unbounded timers.
6. Configure the shared `QueryClient` with both functions.

**Tests and acceptance:**

- Unit tests cover abort, each permanent status class, rate limiting, server error, unknown network
  error, attempt exhaustion, and delay cap.
- App typecheck passes with generated error shapes.

## HVI-06 — Surface otherwise unhandled asynchronous failures

**Value:** React error boundaries do not catch rejected event-handler promises. Silent failures make
administrative actions appear successful.

**Current evidence:** There is no `unhandledrejection` listener; at least one mutation is invoked
with `void mutateAsync()` and no catch.

**Implementation:**

1. Add a root-scoped asynchronous error reporter inside the locale and toast providers.
2. Listen for `unhandledrejection`, normalize/redact the displayed message, prevent duplicate
   notifications for the same rejection, and emit a localized actionable toast.
3. Do not expose response bodies, secrets, stacks, or raw server payloads in production.
4. Fix known fire-and-forget mutations so expected failures remain handled locally; the root
   listener is a safety net, not normal control flow.

**Tests and acceptance:**

- Pure tests cover error normalization/redaction and duplicate keys.
- Browser test dispatches a safe synthetic rejection and observes exactly one localized alert.
- No unhandled promise rejection appears during chat/admin browser suites.

## HVI-07 — Add explicit offline/reconnected UX and query recovery

**Value:** Without network state, a disconnected session looks like a broken or empty product.

**Current evidence:** No online/offline listener or persistent connectivity notice exists.

**Implementation:**

1. Add a small root connectivity component using `useSyncExternalStore` over browser online/offline
   events.
2. Show an accessible, nonmodal offline banner with localized recovery guidance.
3. On reconnect, show a short success notice and ask TanStack Query to resume/refetch stale active
   queries.
4. Honor safe areas, mobile layout, reduced motion, and dark theme tokens.

**Tests and acceptance:**

- Pure/store tests cover server snapshot, transition order, and cleanup.
- Browser test toggles offline/online context and verifies banner visibility and accessible copy.
- Reconnection triggers active-query recovery without a page refresh.

## HVI-08 — Expose chat-event stream health and add a bounded fallback

**Value:** Native EventSource reconnects, but users and the query cache currently receive no signal
when the stream is down; live sidebar updates may remain stale indefinitely behind a broken proxy.

**Current evidence:** `subscribeToChatEvents` listens only for `chats:changed`.

**Implementation:**

1. Extend the subscription adapter with typed `open` and `error` status callbacks.
2. Track `connecting`, `connected`, and `degraded` state in `WorkspaceProvider`.
3. While degraded and online, invalidate the active workspace chat query on a bounded interval;
   stop the interval immediately after reconnection or workspace change.
4. Surface a compact localized “Reconnecting live updates” state distinct from full offline mode.
5. Keep one EventSource per active workspace and clean up every listener/timer.

**Tests and acceptance:**

- Adapter tests with a fake EventSource prove listener registration and cleanup.
- Pure interval policy tests cover offline, connected, degraded, and workspace-switch cases.
- Browser acceptance proves created/deleted chats reconcile without refresh after a simulated
  stream error/recovery.

## HVI-09 — Make workspace bootstrap context the single source of truth

**Value:** Re-reading bootstrap in descendant hooks is redundant and encourages data ownership
drift.

**Current evidence:** `WorkspaceProvider` owns `["bootstrap"]`, while `useWorkspaceData` also calls
the same query to retrieve `subject`.

**Implementation:**

1. Expose subject, bootstrap status, and bootstrap retry through `WorkspaceContext`.
2. Remove the duplicate bootstrap hook from `useWorkspaceData`.
3. Update consumers to read subject from the context.
4. Preserve persisted workspace validation and tenant-access checks.

**Tests and acceptance:**

- Context decision tests continue to reject stale/tampered workspace IDs.
- Browser request instrumentation observes one bootstrap request on initial load.
- Workspace switching and admin visibility still work.

## HVI-10 — Defer global command/shortcut overlays until invocation

**Value:** Root-level eager overlay code increases the already tight route-shell bundle and performs
work for users who never invoke it.

**Current evidence:** The route-shell bundle is 237,159 bytes against a 250,000-byte budget;
`CommandPalette` and `ShortcutsModal` are eagerly imported and mounted.

**Implementation:**

1. Replace eager root imports with a lightweight keyboard/event launcher.
2. Dynamically import the command palette on Cmd/Ctrl+K and shortcuts on `?` or
   `rm-shortcuts`.
3. Preserve the initiating event so the requested overlay opens on first use, not only subsequent
   uses.
4. Preload the relevant chunk on idle and on an explicit help trigger where supported, without
   blocking hydration.
5. Keep Escape, focus restoration, and command execution semantics unchanged.

**Tests and acceptance:**

- Browser test opens each overlay on its first keyboard invocation and verifies focus/escape.
- Build manifest places overlays outside the initial route-shell chunk.
- Tighten the route-shell byte budget to retain meaningful headroom after measuring the final
  artifact.

## HVI-11 — Debounce server-backed chat search

**Value:** Querying on every keystroke produces avoidable work, response races, and visible result
churn.

**Current evidence:** `normalizedSearch` changes immediately and enters the TanStack query key once
it reaches two characters.

**Implementation:**

1. Add a reusable SSR-safe debounced-value hook with cancellation on change/unmount.
2. Keep the input immediate while applying a 250 ms delay to the normalized server query.
3. Preserve the two-character threshold and reset pagination only after the debounced query
   changes.
4. Show a subtle pending state while typed and committed queries differ.

**Tests and acceptance:**

- Fake-timer tests cover coalescing, cancellation, trimming, and empty queries.
- Browser request counting proves a fast multi-character entry produces one final search request.
- Search remains keyboard-accessible and results do not flash stale empty content.

## HVI-12 — Represent sidebar query loading and failure states honestly

**Value:** Treating request failure as an empty array falsely tells users there are no tags,
folders, or results.

**Current evidence:** Sidebar search, tag, folder, favorite, and folder-item reads repeatedly use
`query.data ?? []`.

**Implementation:**

1. Add a compact sidebar query-state presentation using design-system feedback controls.
2. Show loading only where it changes interpretation; preserve already cached data during
   background refresh.
3. Render localized inline failures with a retry action for search/filter metadata.
4. Disable dependent filter actions while required metadata is unavailable.
5. Ensure selection remains valid if a refreshed tag/folder disappears.

**Tests and acceptance:**

- Pure state tests cover pending/no-cache, error/no-cache, error/with-cache, refreshing, and success.
- Browser route interception verifies a failed search is not presented as “No matching chats” and
  Retry recovers.

## HVI-13 — Harden portable chat imports

**Value:** Imports cross a trust boundary and can allocate large strings/attachments or silently
create meaningless conversations.

**Current evidence:** `parsePortableChat` calls `file.text()` and `JSON.parse()` without file-size,
message-count, title, base64, or aggregate attachment limits.

**Implementation:**

1. Define documented import limits aligned with server contract limits.
2. Reject oversized files before reading.
3. Validate the envelope, nonempty normalized title, supported roles, message count/content length,
   ISO dates, citation fields, attachment count/size, MIME/file-name shape, and base64 length.
4. Reject a document with zero valid messages instead of silently importing an empty chat.
5. Return typed, localized-safe error codes; map codes to user-facing copy at the component.
6. Continue accepting Romeo's current exported envelope and supported legacy flat shape.

**Tests and acceptance:**

- Unit tests cover valid current/legacy files and every limit/error code.
- Browser chat acceptance imports a valid file and rejects an oversized/malformed file without a
  network create request.

## HVI-14 — Centralize reliable browser downloads

**Value:** Duplicated object-URL logic diverges and immediate URL revocation can cancel downloads in
some engines.

**Current evidence:** Blob download logic appears in CSV, chat Markdown, workspace export, recovery
codes, and code-block downloads.

**Implementation:**

1. Add one SSR-safe download utility supporting text/blob input, MIME type, and sanitized filename.
2. Append a hidden anchor, click it, remove it, and revoke the object URL on a later task.
3. Reuse the utility at every existing object-URL download call site.
4. Keep attachment preview URL lifecycle separate because previews intentionally remain live.

**Tests and acceptance:**

- Utility tests assert filename normalization and lifecycle scheduling with mocked browser APIs.
- Static scan finds no ad hoc object-URL download implementation outside the utility and attachment
  preview lifecycle.
- Chromium, Firefox, and WebKit acceptance downloads remain nonempty.

## HVI-15 — Centralize clipboard writes with usable failure feedback

**Value:** Clipboard permission/secure-context failures currently fail silently in several
high-value secret, recovery-code, message, and code-block actions.

**Current evidence:** Five direct `navigator.clipboard.writeText` call sites use inconsistent
feedback, including fire-and-forget calls.

**Implementation:**

1. Add an async clipboard adapter with capability detection and a safe legacy text-copy fallback.
2. Never copy automatically; keep every call behind the existing user gesture.
3. Return a typed result so callers can display localized success/error feedback.
4. Replace every direct clipboard call, including secret and MFA recovery paths.
5. Do not log copied content.

**Tests and acceptance:**

- Tests cover modern success, modern rejection plus fallback success, total failure, and SSR.
- Static scan finds no direct application clipboard writes outside the adapter.
- Browser test verifies visible success and simulated failure feedback.

## HVI-16 — Localize and strengthen shared query-state presentation

**Value:** A shared framework component should not bypass the product's locale or accessibility
contracts.

**Current evidence:** `PanelState` defaults to `"Nothing here yet."` and renders a hardcoded
`"Retry"` button.

**Implementation:**

1. Move all default loading, empty, failure, and retry copy into locale files.
2. Render design-system skeleton/empty/inline-error primitives.
3. Mark loading with a localized status, errors with an assertive alert, and background refresh
   without replacing usable data.
4. Preserve caller-specific empty messages/actions.
5. Remove inline layout styles in favor of shared CSS classes.

**Tests and acceptance:**

- Locale parity/interpolation tests pass.
- UI accessibility test finds no axe violations in pending/error/empty compositions.
- Browser admin audit confirms retry controls and empty states do not overflow.

## HVI-17 — Correct pending-button accessible semantics

**Value:** Pending actions need a stable accessible name and state without a redundant nested
`"Loading"` announcement.

**Current evidence:** `Button pending` adds a `Spinner aria-label="Loading"` inside the named button.

**Implementation:**

1. Make the decorative pending spinner `aria-hidden` when nested in a button.
2. Keep `aria-busy=true`, disabled behavior, visible label, and button accessible name stable.
3. Allow standalone `Spinner` to require/provide its own accessible label.
4. Add a data attribute/class for pending layout without changing button width unexpectedly.

**Tests and acceptance:**

- UI tests assert the pending button has one accessible name, `aria-busy`, and disabled state.
- Standalone spinner remains discoverable by role/status.
- Axe primitive composition passes.

## HVI-18 — Eliminate the remaining Lucide barrel import

**Value:** Direct icon imports reduce module-graph work and enforce the bundle discipline already
used throughout the app.

**Current evidence:** `packages/ui/src/advanced-data-table.tsx` imports seven icons from
`lucide-react`; it is the sole production barrel import.

**Implementation:**

1. Replace each icon with the package's direct ESM path.
2. Expand the existing Lucide architecture rule to application and design-system sources.
3. Keep icon typing and rendered output unchanged.

**Tests and acceptance:**

- Static scan finds zero Lucide barrel imports in production sources.
- UI tests and build pass.
- Bundle manifest does not regress relevant route budgets.

## HVI-19 — Persist TanStack table view preferences

**Value:** Administrators repeatedly tune dense tables; losing density, page size, and hidden-column
choices on every navigation makes the console feel disposable rather than enterprise-grade.

**Current evidence:** `DataTable` stores density and column visibility only in component state.

**Implementation:**

1. Define a versioned, SSR-safe table preference schema.
2. Derive a stable table identity from route/section plus ordered data-column IDs, with an explicit
   override available for ambiguous cases.
3. Persist density, page size, and column visibility; validate all stored data and ignore unknown
   columns.
4. Add a “Reset table view” action.
5. Handle blocked/quota-exceeded storage without breaking table rendering.

**Tests and acceptance:**

- Unit/UI tests cover valid restore, malformed storage, schema version mismatch, removed columns,
  storage failure, and reset.
- Browser admin test changes a table view, navigates away/back, and observes restoration.

## HVI-20 — Complete the enterprise table toolbar

**Value:** The shared table already provides framework-backed sorting and pagination, but
administrators need consistent control over page size, export, and result context.

**Current evidence:** There is no page-size chooser, common export action, reset control, or live
summary; export behavior is panel-specific.

**Implementation:**

1. Add a page-size selector (10/25/50/100) when client pagination applies.
2. Add CSV export of the current filtered/sorted result set, excluding selection/action-only
   display columns and using safe scalar serialization.
3. Generate a contextual sanitized filename in the application wrapper and allow per-table
   override/disable.
4. Add a polite live summary for filtered count, total count, page position, and selected count.
5. Keep server-pagination export explicit: export only loaded rows unless a panel supplies its
   existing server export.
6. Put density, columns, page size, export, and reset in the existing TanStack/Radix toolbar rather
   than adding bespoke panel controls.
7. Localize every label in English, Spanish, and French.

**Tests and acceptance:**

- UI tests exercise sorting, filtering, page size, pagination, column visibility, persistence,
  export serialization, reset, and live summary.
- CSV tests cover commas, quotes, line breaks, nulls, booleans, numbers, dates/strings, and formula
  injection protection.
- Full admin audit finds framework-backed tables, no raw table controls, no overflow, and no axe
  violations.

---

## Final verification matrix

All commands below must pass against the final worktree:

```bash
pnpm format:check
pnpm check:architecture
pnpm check:dependencies
pnpm check:ui-form-contracts
pnpm check:openapi-route-coverage
pnpm contract:lint
pnpm contract:breaking
pnpm check:sdk-typescript-drift
pnpm check:sdk-drift
pnpm check
pnpm test
pnpm build
pnpm check:bundle-budget
pnpm quality:browser
git diff --check
```

The completion audit must additionally prove:

1. This file still contains exactly 20 HVI sections.
2. Every section's implementation bullets are represented in the final source.
3. Every named test/acceptance criterion has direct passing evidence or an equally strong
   replacement documented in the completion notes.
4. Generated artifacts match the canonical OpenAPI document.
5. No acceptance fixture chats or temporary browser state remain in the development repository.
6. The worktree contains no unrelated user changes.

## Completion ledger

| Item   | Implementation                                              | Targeted tests                               | Final evidence |
| ------ | ----------------------------------------------------------- | -------------------------------------------- | -------------- |
| HVI-01 | Complete — generated Python SDK synchronized                | Python SDK drift                             | Passed         |
| HVI-02 | Complete — strict workspace test contracts                  | Test-contract self-tests and all packages    | Passed         |
| HVI-03 | Complete — interface guideline architecture gate            | Ratchet self-tests, locale parity, browser   | Passed         |
| HVI-04 | Complete — representative SSE-safe browser gate             | Chat, 3 engines, 30 admin routes, 48 visuals | Passed         |
| HVI-05 | Complete — bounded status-aware query retries               | `query-policy.test.ts`                       | Passed         |
| HVI-06 | Complete — deduplicated metadata-only async reporter        | `async-error.test.ts`                        | Passed         |
| HVI-07 | Complete — offline/reconnected application UX               | Connectivity logic plus browser matrix       | Passed         |
| HVI-08 | Complete — typed chat stream health and fallback sync       | `events.test.ts`, `chat-sync.test.ts`        | Passed         |
| HVI-09 | Complete — one workspace bootstrap source                   | App type checks, unit suite, browser chat    | Passed         |
| HVI-10 | Complete — deferred global overlays and tighter JS budget   | Production manifest and bundle budget        | Passed         |
| HVI-11 | Complete — debounced immediate-feedback chat search         | `debounce.test.ts`, browser chat             | Passed         |
| HVI-12 | Complete — truthful sidebar loading/error/refresh states    | `sidebar-query-state.test.ts`, browser chat  | Passed         |
| HVI-13 | Complete — bounded schema-validating portable imports       | Portability unit and browser import tests    | Passed         |
| HVI-14 | Complete — centralized safe browser downloads               | `download.test.ts`, CSV browser action       | Passed         |
| HVI-15 | Complete — resilient centralized clipboard adapter          | `clipboard.test.ts`, app suite               | Passed         |
| HVI-16 | Complete — localized design-system query states             | App/UI tests, axe, admin audit               | Passed         |
| HVI-17 | Complete — stable pending-button accessibility semantics    | UI primitive tests and axe                   | Passed         |
| HVI-18 | Complete — direct Lucide imports with enforced ratchet      | Architecture scan and production build       | Passed         |
| HVI-19 | Complete — versioned table preference persistence           | Preference/UI tests and navigation restore   | Passed         |
| HVI-20 | Complete — shared table page size/export/reset/live summary | Table UI/CSV tests and 60 admin checks       | Passed         |

## Completion notes

- The final source still contains exactly 20 `HVI-##` implementation sections.
- All 16 Vitest workspaces passed: 1,234 tests passed and 4 database tests were intentionally
  skipped.
- Browser acceptance passed the expanded chat workflow, Chromium/Firefox/WebKit, 30 admin routes at
  desktop and mobile widths, and 48 light/dark viewport-route visual scenarios.
- The admin audit now changes table density and page size, navigates away and back, proves the view
  was restored, and resets the preference.
- The final client assets remain within enforced budgets. The route-shell ceiling was tightened
  from 250,000 to 245,000 bytes; the application CSS ceiling was recalibrated from 80,000 to 81,000
  bytes for the connectivity, query-state, and enterprise-table controls, with the built asset at
  80,304 bytes.
- Architecture, dependency, UI form, OpenAPI route coverage, contract lint/breaking, TypeScript SDK
  drift, Python SDK drift, formatting, build, and whitespace gates all passed.
- Browser fixture cleanup removed every chat created by the acceptance run; browser table
  preferences are reset before the audit exits.
