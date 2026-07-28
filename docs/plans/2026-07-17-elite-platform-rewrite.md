# Romeo Elite Platform Rewrite

Status: implemented and validated; credential-dependent external gates remain environment-bound
Date: 2026-07-18
Scope: API contracts, SDKs, application data access, UI primitives, feature architecture, localization, CSS, managed-model persistence, and quality gates

## Outcome

Romeo will have one authoritative contract layer, generated clients, one real design-system package, feature-oriented React code, and enforceable quality gates. The rewrite is broad, but it will land as green vertical slices so the product remains usable throughout the work.

This is not a compatibility exercise with Open WebUI internals. Romeo keeps Open WebUI's familiar chat experience while using Romeo's governed enterprise domain model.

Non-goals remain explicit:

- No code execution.
- No multi-model comparison.
- No new provider behavior hidden behind UI-only mocks.
- No second design system or parallel API client left behind after migration.

## Current-State Evidence

The audit found structural drift that warrants a rewrite:

- 416 OpenAPI operations across 330 paths and 316 schemas.
- Route coverage passes, but the document has no stable `operationId`, tags, or declared security schemes.
- The checked-in Python SDK is already stale against the current OpenAPI document.
- `packages/core/src/http/openapi/components.ts` is more than 11,000 lines of manually synchronized schema configuration.
- `apps/app/src/api` is roughly 8,300 lines of handwritten fetch functions and duplicate DTOs even though `@romeo/api-client` exists.
- `packages/ui` contains 18 lines and is not consumed by the application.
- `apps/app/src/styles/app.css` is more than 4,000 lines.
- `apps/app/src/lib/i18n.tsx` is more than 7,000 lines.
- Core orchestration and frontend controllers contain files between 1,400 and 3,300 lines.
- The app has a shared overlay shell, but 47 call sites still depend on custom focus, portal, ID, and layering behavior.

These are architecture problems, not formatting problems.

## Completion Evidence

The rewrite was completed as a single greenfield consolidation and validated on
2026-07-18:

- `pnpm quality` passed formatting, architecture and dependency-cycle
  ratchets, UI form contracts, OpenAPI route coverage, Spectral, `oasdiff`,
  generated TypeScript and Python SDK drift, workspace type checks, 1,096
  tests, production builds, manifest-addressed bundle budgets, Chromium,
  Firefox, and WebKit browser quality, and the visual matrix. Four
  PostgreSQL-live tests were intentionally skipped because this environment
  has no `DATABASE_URL`.
- All 402 public `/api/v1` routes are represented by contract descriptors;
  the exported document contains 423 OpenAPI operations and zero uncovered
  routes.
- The architecture ratchet reports zero legacy app/API clients, zero manual
  OpenAPI files, zero raw button/input/select/textarea controls, zero custom
  focus traps, and zero production files over 500 lines. The largest CSS file
  is 983 lines and the largest locale namespace is 147 lines.
- Dependency Cruiser reports an acyclic production graph across 1,121 modules
  and 2,835 dependencies. The UI form gate covers 154 controls in 50 forms
  with zero missing names, accessible labels, or identity-field autocomplete
  declarations.
- `@romeo/api-client` is generated with `@hey-api/openapi-ts`; the checked-in
  Python SDK is generated from the same artifact. Spectral, `oasdiff`, and both
  SDK drift checks pass.
- `@romeo/ui` owns the shared Radix, CVA, Tailwind, TanStack Table, and TanStack
  Virtual primitives. Shared primitive tests cover accessibility, focus
  restoration, keyboard menus/selects, form-safe controls, reduced motion,
  theme, and mobile contracts.
- The expanded chat acceptance passed Markdown, syntax highlighting, code and
  message copy, file/image context, retention, context inspection, search,
  sharing, import/export, temporary chats, queue recovery, image generation,
  localization, keyboard navigation, narrow viewports, provider setup, model
  refresh, diagnostics, and secret non-disclosure.
- The explicit browser matrix passed Chromium 149, Firefox 151, and WebKit 26.5
  with zero axe violations on chat, settings, and provider administration.
- The visual baseline gate passed 24 route scenarios spanning light and dark
  themes, reduced motion, and 375px, 1280px, and 1920px viewports. Bundle
  budgets resolve exact route entries through Vite's manifest rather than
  filename heuristics.
- Localization now keeps only `core` eager. `i18next-resources-to-backend`
  and Vite lazy modules load the remaining namespaces at chat, workspace,
  settings, and administration route boundaries while parity tests validate
  every English, Spanish, and French namespace.
- Strict greenfield-baseline review, repository conformance (257 repository
  methods), and the 20-case tenant-isolation negative suite passed.
- Live Ollama acceptance passed against the locally available endpoint,
  including discovery, streaming, tools, vision, usage, and OpenAI-compatible
  behavior. Controlled Anthropic `/v1/messages` streaming acceptance passed for
  system prompts, vision, tools, and usage.
- The qualified integration register and architecture policy prefer official,
  maintained SDKs. Provider transport is owned by `openai`,
  `@anthropic-ai/sdk`, and `ollama`; narrow custom-transport exceptions are
  documented and ratcheted.

Credentialed OpenAI-cloud, Anthropic-cloud, and live PostgreSQL conformance were
not run because this workstation does not provide those credentials or a
`DATABASE_URL`. Their protocol, contract, generated-client, repository, and
controlled-fixture coverage is green; the credentialed commands remain release
environment gates rather than being represented as local passes.

## Architectural Decisions

### 1. Contract-first HTTP

Create `@romeo/contracts` as the only handwritten HTTP contract package.

It owns:

- Strict Zod request, path, query, response, event, and error schemas.
- Hono `createRoute` descriptors.
- Stable `operationId`, tags, security requirements, summaries, and descriptions.
- Shared envelope, pagination, cursor, problem/error, and SSE event contracts.
- Public-versus-authenticated route metadata.

Core handlers use `app.openapi(route, handler)` from `@hono/zod-openapi`. OpenAPI is generated from the exact schemas used to validate requests and type handlers. Manual path and component mirrors are deleted as each domain migrates.

Rules:

- Every object schema is strict unless the field is intentionally extensible and documented.
- Every successful and error response is declared.
- Every operation has a stable domain-oriented ID such as `managedModels.getPreferences`.
- Every authenticated operation declares session-cookie and bearer alternatives.
- Every collection uses the shared cursor/page contract; no one-off pagination shapes.
- Every mutation documents idempotency and conflict behavior where applicable.
- Redirect/callback operations declare `3xx` as successful behavior.

### 2. Generated clients

Replace handwritten endpoint clients with generated artifacts.

- TypeScript: `@hey-api/openapi-ts`, fetch client, tree-shakeable SDK functions, Zod request validation, and TanStack Query option generation.
- Python: `openapi-python-client` from the same checked-in OpenAPI artifact.
- Breaking-change detection: `oasdiff` in CI.
- Contract style and completeness: Spectral with a Romeo ruleset.

`@romeo/api-client` remains the public package name, but its structure becomes:

```text
packages/api-client/src/
  generated/       # never edited by hand
  runtime/          # auth, base URL, tracing, errors, SSE, upload transport
  index.ts          # curated public exports
```

The runtime adapter owns same-origin cookies, bearer auth, request/trace IDs, 401 navigation hooks, stable error conversion, streaming, uploads, and abort signals. It contains no domain DTOs.

The app may define query composition and view models, but may not define endpoint paths or duplicate API response types.

### 3. A real `@romeo/ui`

Build the design system on established primitives instead of maintaining accessibility mechanics by hand:

- Radix Primitives for dialog, alert dialog, dropdown menu, popover, select, tabs, tooltip, checkbox, switch, and scroll area.
- Class Variance Authority for typed visual variants.
- Tailwind CSS v4 and semantic Romeo tokens for layout and styling.
- TanStack Table and Virtual for tables and long lists.
- TanStack Form plus contract Zod schemas for forms.

The package owns:

```text
Button, IconButton, LinkButton
Input, Textarea, Select, Checkbox, Switch, Field
Dialog, AlertDialog, Sheet, Popover, DropdownMenu, Tooltip
Tabs, Card, Panel, Toolbar, Separator
DataTable, Pagination, EmptyState, Skeleton, Spinner
Toast, InlineError, StatusBadge
AppShell, SidebarFrame, Topbar
```

Application components compose these primitives. They do not recreate focus traps, portals, overlay stacks, button variants, field labels, or loading/error states.

### 4. Feature-oriented React

Move from large route/controller components to vertical feature modules:

```text
apps/app/src/features/
  auth/
  chat/
  managed-models/
  providers/
  files/
  knowledge/
  personalization/
  admin/
```

Each feature may contain:

```text
components/
queries.ts          # generated query options composed for the feature
mutations.ts
route.tsx
view-model.ts       # UI-only derived data; never API DTO duplication
test/
```

Rules:

- Route files assemble features; they do not contain domain logic.
- Server state stays in TanStack Query.
- Shareable UI state belongs in TanStack Router search parameters.
- Ephemeral local state stays close to the component that owns it.
- Independent queries start together; avoid request waterfalls.
- Heavy renderers such as Mermaid and KaTeX load only when content requires them.
- Direct icon imports remain mandatory.
- Files target 300 lines and must justify exceeding 500 lines.

### 5. Namespaced localization

Replace the custom 7,000-line dictionary/provider with `i18next` and `react-i18next`.

```text
apps/app/src/locales/
  en/common.json
  en/chat.json
  en/admin.json
  en/managed-models.json
  es/...
  fr/...
```

Namespaces load with their route/feature. CI verifies key parity, interpolation variables, and no untranslated user-facing literals in migrated features.

### 6. First-class managed-model persistence

Move governed-model policy and preferences out of generic system-setting keys.

Add repositories and tables:

```text
managed_model_customization_policies
  org_id, agent_id, six allow_* flags, created_at, updated_at

managed_model_preferences
  org_id, agent_id, principal_type, principal_id,
  communication_style, response_length, language,
  encrypted_custom_instructions, personal_memory_enabled,
  voice_profile_id, created_at, updated_at
```

Requirements:

- Foreign keys and tenant-scoped unique constraints.
- Cascade cleanup when an agent or principal is deleted.
- Repository methods, not string-composed setting keys.
- Encryption at rest for custom instructions where the deployment key is configured.
- Policy changes that disable a field purge or tombstone the corresponding stored preference according to an explicit retention rule.
- Voice IDs are validated for visibility at write time.
- All changes are audited without private preference values.
- Prompt precedence and personal-memory double opt-in remain enforced server-side.

### 7. SDK-first integrations

Romeo uses an official, well-supported SDK whenever one exists and satisfies the
product's security, runtime, and compatibility requirements. The SDK owns the
provider wire protocol; Romeo owns validation, governance, observability, and
normalization into stable internal types.

The initial provider baseline is `openai`, `@anthropic-ai/sdk`, and `ollama` for
model discovery, chat, streaming, tool calls, vision, embeddings, usage, and
Ollama model pulls. Raw provider endpoint implementations are prohibited by the
architecture ratchet. Exceptions require an architectural decision explaining
why no suitable SDK exists.

This is a hard completion gate for the rewrite:

- Every external integration is present in the qualified integration register.
- Official SDKs own authentication, endpoint construction, serialization,
  pagination, streaming, response parsing, and documented provider errors.
- Romeo owns only policy, credential resolution, governed transport hooks,
  telemetry, limits, retries where the SDK cannot enforce product policy, and
  normalization into internal contracts.
- A custom transport requires a narrow recorded exception, contract coverage,
  and an architecture ratchet preventing the exception from spreading.
- Provider SDK types never leak into domain services, public contracts, or UI.
- Redundant cross-provider wrapper SDKs are not introduced when Romeo's
  existing internal adapter contract already supplies normalization.

## Migration Program

### Phase 0 — Freeze the Baseline

Deliverables:

- Record the current OpenAPI artifact as the compatibility baseline.
- Make pnpm/Corepack bootstrap deterministic in local development and CI.
- Add one command, `pnpm quality`, that runs formatting, type checks, unit/integration tests, contract lint, SDK drift, bundle budget, and browser checks.
- Add architecture rules that prohibit new imports from legacy API/type modules and prohibit new raw overlay/button/form implementations.
- Preserve the current 12040 development entry point and seeded-login workflow.

Exit gate:

- Baseline passes or every existing failure is documented with an owner and deletion phase.

### Phase 1 — Contract Foundation

Deliverables:

- Create `@romeo/contracts`.
- Define common envelopes, errors, pagination, auth schemes, and SSE events.
- Add Spectral and `oasdiff` checks.
- Configure generated TypeScript and Python clients.
- Add generated-file drift checks that fail CI.
- Migrate health, bootstrap/me, auth session, and interface-preference routes first.

Exit gate:

- The first migrated routes have no manual OpenAPI mirror, no handwritten DTO, and pass server/client round-trip tests.

### Phase 2 — UI Foundation

Deliverables:

- Replace the placeholder `@romeo/ui` with the Radix/CVA/Tailwind primitive set.
- Define semantic color, typography, spacing, radius, elevation, motion, and z-index tokens.
- Replace custom overlay/focus-trap code with Dialog, AlertDialog, Sheet, DropdownMenu, and Popover primitives.
- Add Storybook or Ladle-style isolated primitive examples only if it does not introduce a second build system; otherwise use a development `/ui` route.
- Add axe, keyboard-navigation, dark/light, reduced-motion, and mobile viewport tests for primitives.

Exit gate:

- All new UI uses `@romeo/ui`; no new `.rm-button`, raw modal, or one-off form-control CSS is accepted.

### Phase 3 — Managed Models Vertical Slice

Migrate end to end:

- Provider model discovery.
- Managed-model CRUD, cloning, publishing, access grants, and versions.
- Customization policy and per-user preferences.
- Model selector and personalization UI.
- TTS voice resolution and context inspection.

Delete after migration:

- Handwritten agent/model app clients and duplicate types.
- Manual managed-model OpenAPI paths/components.
- Generic system-setting persistence for managed-model configuration.
- Custom managed-model form and modal classes superseded by primitives.

Exit gate:

- Admin can configure and publish a managed model.
- A regular user sees only authorized managed models and only exposed preferences.
- The context inspector and actual provider request agree.
- Memory requires admin permission plus user opt-in.
- Generated TypeScript and Python clients cover every operation.

### Phase 4 — Chat, Runs, Files & Knowledge

Migrate end to end:

- Chats, folders/tags, temporary chats, import/export/share/search.
- Messages, feedback, citations, retained attachments, queueing, recovery, and streaming.
- Files, resumable uploads, reusable library, source viewer, OCR, and retention.
- Knowledge bases, retrieval, URL ingestion, and governed web search.

Refactor core orchestration:

```text
run-service.ts ->
  run-context-builder.ts
  run-command-service.ts
  run-recovery-service.ts
  run-stream-service.ts
  run-tool-service.ts
  run-terminal-effects.ts
```

Exit gate:

- One canonical context builder serves preview and execution.
- Streaming reconnect and queued-turn recovery pass browser acceptance tests.
- File/knowledge isolation passes cross-tenant negative tests.
- Markdown, syntax highlighting, copy, citations, vision, and uploads pass desktop/mobile browser tests.

### Phase 5 — Providers & Runtime

Migrate end to end:

- Ollama discovery/pull/delete and model refresh.
- OpenAI-compatible and Responses-compatible endpoints.
- Anthropic Messages, streaming, usage, vision, and tool serialization.
- Connection presets, secret references, diagnostics, routing, and failover.

Exit gate:

- Credentialed live tests pass for configured providers.
- Protocol tests run without secrets in CI.
- Provider errors map to stable actionable API errors and UI messages.

### Phase 6 — Administration & Governance

Migrate remaining domains by coherent slices:

- Users, groups, organizations, service accounts, API keys, and sessions.
- Audit, usage, quotas, billing, analytics, and abuse controls.
- Tools, workflows, connectors, webhooks, notifications, and evaluations.
- SSO, SCIM, directory sync, delegated OAuth, and impersonation.

Each slice must remove its legacy client, types, OpenAPI mirror, and raw UI primitives before the next slice begins.

Exit gate:

- No app feature imports a legacy endpoint client or duplicate API DTO.
- All destructive actions use a shared alert-dialog flow.
- All list views use the shared table/pagination/empty/loading/error primitives.

### Phase 7 — Localization, CSS & Legacy Deletion

Deliverables:

- Finish namespaced i18n migration.
- Reduce `app.css` to tokens, layout foundations, markdown/content rendering, and narrowly scoped feature CSS.
- Delete legacy API clients/types, manual OpenAPI path/component files, custom focus trap, and compatibility adapters.
- Split remaining oversized files.
- Remove packages that became unused.

Exit gate:

- No dual implementation remains.
- A repository search proves the legacy import patterns and CSS classes are gone.

### Phase 8 — Release Proof

Run the complete production proof:

- Full type check, tests, migrations, SDK generation, and drift checks.
- PostgreSQL repository conformance and tenant-isolation suites.
- OpenAPI lint and breaking-change report.
- Browser tests in Chromium, Firefox, and WebKit.
- Axe with zero critical or serious violations.
- Keyboard-only chat, admin, dialog, menu, upload, and model-selection flows.
- Light/dark, reduced-motion, 375px mobile, 1280px desktop, and 1920px desktop visual baselines.
- Bundle budget and route-level chunk report.
- Live Ollama, OpenAI-compatible, and Anthropic acceptance where credentials/endpoints are supplied.

## Vertical-Slice Pull Request Contract

Every migration PR must include all of the following:

1. Contract schemas and route descriptor.
2. Core handler/service/repository behavior.
3. OpenAPI output and generated clients.
4. App query/mutation integration.
5. UI built from `@romeo/ui` primitives.
6. Unit, repository, API, and browser tests proportional to risk.
7. Deletion of the replaced legacy path in the same PR.
8. Updated architecture inventory and zero new drift.

A PR that adds the new path but leaves the old implementation active is incomplete.

## Hard Quality Gates

The rewrite is complete only when these are true:

### API

- 100% of public routes originate from contract descriptors.
- 100% have stable `operationId`, tags, auth metadata, declared success responses, and shared error responses.
- Zero route/OpenAPI drift.
- Zero generated SDK drift.
- Zero duplicate DTO definitions in the app.
- Zero handwritten endpoint URL strings outside generated/runtime code and test fixtures.
- OpenAPI breaking changes require an explicit reviewed approval.

### UI

- 100% of buttons, fields, dialogs, menus, popovers, tabs, tables, toasts, and empty/loading/error states use `@romeo/ui`.
- Zero custom focus traps or modal portals in feature code.
- Zero critical/serious axe violations.
- All icon-only actions have accessible names.
- All forms have labels, names, appropriate autocomplete, inline errors, pending state, and keyboard submission.
- All destructive actions require confirmation or provide undo.
- All animations honor reduced motion.
- Long lists are virtualized or use `content-visibility`.

### Structure

- No production source file exceeds 500 lines without a documented exception.
- No global stylesheet exceeds 1,000 lines.
- No translation namespace exceeds 500 keys.
- No feature imports core repositories or database types directly.
- Circular dependency check passes.
- Package boundaries are enforced in CI.

### Product behavior

- Regular users interact with governed managed models, not raw provider configuration.
- Admin exposure controls are locked by default and enforced on the server.
- Context preview and actual provider payload share one builder.
- Attachments, memory, knowledge, citations, and token estimates remain consistent across turns.
- Existing non-goals—code execution and multi-model comparison—remain absent.

## Risk Controls

- Use a strangler migration by domain; never maintain two writable sources of truth.
- Keep compatibility adapters read-only and temporary; attach a deletion phase when introduced.
- Snapshot the OpenAPI contract before each slice and block accidental breaking changes.
- Use expand/migrate/contract database migrations; do not combine destructive schema contraction with the first deployment.
- Keep feature flags only for operational rollout, not permanent architecture forks.
- Preserve the current working tree and do not rewrite unrelated user changes.

## First Execution Tranche

Start with these commits in order:

1. Deterministic toolchain plus `pnpm quality` and architecture guard scripts.
2. `@romeo/contracts` foundation with shared auth/error/envelope/pagination schemas.
3. OpenAPI lint, stable operation IDs/tags/security, `oasdiff`, and generated SDK pipelines.
4. `@romeo/ui` foundation using Radix and CVA.
5. Managed-model database tables/repositories and data migration from system settings.
6. Managed-model routes moved to contract descriptors.
7. Generated managed-model client and TanStack Query bindings.
8. Managed-model admin/user UI rebuilt from `@romeo/ui`.
9. Delete the replaced agent/model handwritten clients, duplicate types, OpenAPI mirror, and custom modal code.
10. Run the Phase 3 exit gate before moving to chat and runs.

That first tranche proves the architecture on the exact enterprise feature currently under active development and establishes the template for every remaining domain.
