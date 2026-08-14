# Romeo enterprise deep audit

**Audit date:** 2026-08-13  
**Branch:** `agent/chat-elite-ux`  
**Baseline commit:** `4c2fbf6`  
**Runtime used for authoritative checks:** Node 24.15.0 through `mise`  
**Release posture:** **HOLD FOR EXTERNAL ACCEPTANCE**. The confirmed Critical/High source defects and all local quality-budget failures found in the initial scan have been remediated in this working tree. Live Postgres, real-browser/IdP, external browser-runner, multi-replica, exact-release-image/provenance, and target-cluster evidence is still required before an enterprise release.

## Executive summary

Romeo has unusually broad product coverage and a strong set of repository-level quality gates. The initial audit found two critical deployment-default problems, multiple high-risk concurrency defects in authentication and billing, inconsistent outbound-network enforcement, an unbounded direct-upload path, a non-idempotent billing webhook flow, stale transcript behavior, and failing bundle/architecture budgets. The implementation pass addressed those source-level defects and added product improvements in onboarding, content policy, cost-aware routing, deep research, quality evaluation, knowledge quality, accessibility, and privacy. Six tenant-isolation/contract failures found during the scan were also resolved without weakening authorization.

This pass includes contained fixes plus the required migrations and contract changes:

- disabled the anonymous seeded global administrator by default and made test use explicit;
- bound the supplied Compose application port to loopback by default;
- prevented `.env`, key, credential, test, documentation, and local-agent material from entering the Docker build context;
- updated all known vulnerable production dependencies; `pnpm audit --prod` is now clean;
- fixed cross-tenant OIDC discovery cache reuse and rejected-promise poisoning;
- moved post-claim provider secret resolution inside run execution cleanup;
- isolated unsent drafts by subject/workspace/chat, moved them to expiring session storage, and purged them on logout;
- removed four confirmed dead UI files (669 lines) and taught Knip about one dynamically spawned audit script;
- removed 77 dead locale keys across English, Spanish, and French and eliminated an ambiguous `updated` fallback key;
- replaced handwritten feature transports with generated SDK calls;
- cleared raw button/input and forbidden paste-prevention architecture violations;
- repaired all UI form-contract failures and a stale typed test fixture;
- aligned React Query versions and regenerated the TypeScript and Python SDKs;
- resolved all six tenant-isolation/contract failures without weakening workspace authorization, added a provider-capability regression test, and repaired the stale database migration inventory contract;
- made device refresh, MFA recovery/challenges, password lockout, SAML state, and billing webhook processing atomic/idempotent;
- consolidated outbound network classification and DNS-pinned transport across connectors, webhooks, tools, OAuth, and browser dispatch;
- bounded direct-upload reads, corrected authentication/cookie/request-ID semantics, removed eager runtime startup, and supervised background workers;
- restored transcript convergence, batched streaming deltas, removed root-wide client-only rendering, and hardened avatar/resizer/error/form behavior;
- added organization DLP, capability-safe economy routing, deep research, activation guidance, feedback-derived evals, cost/quality visibility, and release/version consistency.

The remaining hold is environment-specific acceptance and release engineering, not permission to assume production safety. Database races must pass live-Postgres contention tests; browser/SSO and the external automation runner must be exercised end to end; and the exact pushed runtime digest and target Helm rendering must pass scan/sign/provenance and cluster-policy checks. Local architecture and gated console conformance are now green.

## Scope and method

The scan covered:

- application routes, API contracts, generated TypeScript/Python clients, compatibility surfaces, and middleware order;
- authentication, authorization, SSO, MFA, sessions, API/device credentials, tenant boundaries, rate limits, CSRF, cookies, request identity, and secret handling;
- billing, webhooks, files/object storage, knowledge/RAG, connectors, tools/browser egress, workers, run queues, leases, and background jobs;
- React state/data flow, streaming, draft persistence, SSR/hydration, accessibility, forms, localization, bundle composition, CSS, and browser privacy;
- database repository semantics, transaction boundaries, schema artifacts, query scalability, and concurrency tests;
- Compose, Helm, Docker image construction, CI, dependency advisories, release/version metadata, and supply-chain posture;
- dead code, generated drift, duplication, oversized files, legacy styles/components, and test gaps.

Three parallel specialist reviews covered backend/API/data flow, frontend/UI/performance, and security/deployment/supply chain. Follow-up implementation tranches were also delegated by domain, while the primary pass reconciled shared contracts, generated clients, product enhancements, cleanup, and validation under the supported Node runtime.

No local `.env` values were read. No secret was printed. The repository already had a large dirty working tree; unrelated user changes were preserved.

## Severity and status

- **Critical:** direct authorization bypass or likely credential disclosure in common deployment paths.
- **High:** exploitable security/correctness issue, cross-tenant risk, durable-state race, or release-blocking product failure.
- **Medium:** enterprise reliability, privacy, maintainability, scale, or standards gap.
- **Low:** hygiene or defense-in-depth improvement.
- **Fixed:** implemented and validated in this working tree.
- **Partially fixed:** immediate exposure reduced; architectural work remains.
- **Open:** documented only; requires a dedicated change.
- **Needs verification:** source policy is defective, but an external component or production topology must be tested.

## Changes completed in this pass

### FIX-01 — Secure seeded-login default

**Status:** Fixed for default/Compose startup; production invariant enforcement remains in DEP-01.

**Evidence before:**

- `packages/config/src/index.ts` defaulted `DEV_SEEDED_LOGIN` to `true`.
- `packages/core/src/http/request-context.ts` returned `seededSubject` when no credential existed.
- `packages/auth/src/seed.ts` grants that subject all user/admin scopes and `global_admin`.
- `deploy/compose/compose.yml` also defaulted seeded login on and published the application port on all interfaces.

**Fix:** Default is now false. Compose defaults false and binds the app to `127.0.0.1`. Core API tests explicitly opt into the seeded identity through `packages/core/vitest.config.ts` and `src/test-support/env.ts`; secure-mode tests can still override it with false.

**Validation:** Config tests pass; typecheck passes; protected routes now require authentication with an empty/default environment. A deployment-level negative startup invariant remains required.

### FIX-02 — Docker context secret exclusion

**Status:** Fixed in source and locally image-validated.

**Fix:** `.dockerignore` now excludes `.env*` except `.env.example`, private-key formats, credential files, local agent metadata, docs, tests, specs, backups, build output, coverage, and temporary files.

**Fix:** The runtime stage now contains only Nitro output/runtime assets, uses a digest-pinned Node base, and runs non-root. Compose separates the application and operations images.

**Validation:** The full container policy test built/exported a context probe and application image, proved sentinels absent from all layers, and passed the `/app` runtime allowlist. The exact pushed release digest still needs its release-pipeline scan/SBOM/signature/provenance.

### FIX-03 — Production dependency advisories

**Status:** Fixed at audit time.

**Before:** 18 production advisories: 4 high, 12 moderate, 2 low. Vulnerable workspace overrides pinned `brace-expansion`, `js-yaml`, and `postcss`; direct/transitive issues also affected Hono, Undici, Mermaid/DOMPurify, and Nanoid.

**Fix:** Updated vulnerable override/direct versions, including Hono 4.12.34, Mermaid 11.16.1, DOMPurify 3.4.13, Undici 6.28.0, PostCSS 8.5.23, js-yaml 4.3.1, brace-expansion 5.0.9, and the resolved Nanoid chain. React Query was aligned at 5.101.4 across the app and generated client.

**Validation:** `pnpm audit --prod --json` reports 0 critical/high/moderate/low advisories.

### FIX-04 — OIDC cross-tenant cache isolation and recovery

**Status:** Fixed in source; external identity-provider acceptance remains.

**Before:** `packages/core/src/services/oidc-client.ts` keyed discovery only by issuer, although the cached `openid-client` configuration embeds the client ID. Tenants sharing an issuer could reuse another tenant's client configuration. Rejected discovery/JWKS promises were cached forever.

**Fix:** Discovery is keyed by issuer and client ID. Rejected discovery and JWKS promises are evicted.

**Tests:** New tests verify different client IDs cause separate configurations and a transient discovery failure recovers on retry.

**Fix:** Discovery/JWKS caches now have bounded TTLs, unknown-`kid` refresh/cooldown behavior, and rejected-promise eviction.

**Tests:** Issuer/client isolation, transient recovery, cache expiry, and rotated/unknown signing-key refresh behavior.

### FIX-05 — Claimed run cleanup leak

**Status:** Fixed and covered by a focused post-claim cleanup regression.

**Before:** `run-streaming-execution-service.ts` created an active run and heartbeat, then awaited secret resolution before entering `try/finally`. A rejected resolver leaked the active registration and renewed the job lease indefinitely.

**Fix:** All post-claim secret resolution now occurs within the cleanup scope.

**Validation:** Injected secret-resolution failure leaves no active registration, stops heartbeat renewal, and permits the expired lease to be reclaimed.

### FIX-06 — Draft privacy and switching correctness

**Status:** Fixed for browser-local drafts.

**Before:** `useWorkspaceController.ts` persisted plaintext under `localStorage` keys that omitted the user, had no TTL, survived logout, and used independent load/save effects capable of cross-writing during a chat switch.

**Fix:** Drafts use an expiring versioned envelope in `sessionStorage`, keyed by subject, workspace, and chat/new-chat target. One effect atomically handles key changes versus writes. Logout purges all Romeo draft entries.

**Tests:** Subject isolation, expiry/malformed cleanup, targeted purge, and preservation of unrelated session values pass.

**Residual risk:** Any same-origin XSS can still read a current-session plaintext draft. The safest enterprise policy is memory-only or encrypted server-side per-user drafts.

### FIX-07 — Dead code and localization cleanup

**Status:** Fixed for confirmed items.

**Deleted:** `ConsoleSection.tsx`, `ManagedModelPersonalization.tsx`, `ModelSelector.tsx`, and `ModelSelectorMenu.tsx` (669 lines). `scripts/console-audit.mjs` was retained because `console-conformance.mjs` dynamically spawns it; Knip now documents that entry point.

**Localization:** Removed 77 unreferenced keys from all three locale trees. Context-specific keys replaced the ambiguous `updated` key. Locale parity and unused-key tests pass.

### FIX-08 — Generated transport consolidation

**Status:** Fixed for the reported paths.

**Before:** Access sharing, agentic RAG settings, and ingest readiness implemented handwritten `/api/v1` fetch logic inside feature modules despite generated operations existing.

**Fix:** These modules now use generated SDK operations and the standard browser client. TypeScript and Python SDKs were regenerated.

**Validation:** Feature API path-literal architecture violations are zero; generated TypeScript compiles.

### FIX-09 — UI primitives and form contracts

**Status:** Fixed for reported violations.

**Fix:** Raw buttons/inputs were migrated to shared UI primitives; paste prevention was removed; organization fields gained stable names and appropriate autocomplete/spellcheck behavior; RAG tier and residency controls gained explicit labels/associations; unstable memo inputs and lint issues were cleaned.

**Validation:** Lint passes. The UI form contract passes all 58 forms and 168 controls. Architecture raw button/input and paste-prevention counts are zero.

### FIX-10 — Type, fixture, and generated drift

**Status:** Fixed.

**Fix:** Added required `agenticRag` to the queued-turn mapper fixture, repaired expired legal-hold test data, removed an unused provider type import, and regenerated both SDKs.

## Product enhancements implemented during remediation

The audit was also used as a product-improvement pass. These additions are deliberately tied to measurable user or operator outcomes and reuse Romeo's existing authorization, audit, tenancy, and generated-contract boundaries.

### ENH-01 — Workspace activation journey

**Outcome:** New workspaces now see a concise, localized quick-start checklist for connecting a provider, enabling a model, choosing a custom model, and completing a first conversation. The checklist is derived from real workspace data and disappears when complete; administrators receive a direct route to provider setup.

**Reasoning:** Romeo exposed substantial capability before it explained the shortest path to a first successful result. A data-derived activation path reduces blank-state ambiguity without inventing a second onboarding state machine.

**Validation:** Component state is computed from provider/model/agent/conversation data, English/Spanish/French locale parity is maintained, and the application type/i18n suites cover the new copy and props.

### ENH-02 — Capability-safe economy routing

**Outcome:** A per-turn **Lower cost** mode can select the lowest-cost authorized and available model without weakening the chosen model's capabilities, modalities, context window, deployment mode, or network boundary. The selected and effective model are captured in a privacy-safe routing decision.

**Reasoning:** A naive cheapest-model router can silently remove tools, vision, context capacity, or data-residency guarantees. Romeo's router treats those properties as hard constraints and cost as the optimization only after authorization and equivalence checks.

**Implementation:** Routing intent is carried through start, preview, queue persistence, execution, usage metadata, contracts, generated SDKs, database migrations, and the composer. Provider kill switches remain authoritative.

**Tests:** Deterministic selection, capability/context/boundary rejection, authorization, provider availability, queue mapping, contract generation, and UI state/type checks.

### ENH-03 — Deep research mode

**Outcome:** Users can request evidence-first deep research per turn. When retrieval is available, the run requests agentic/web retrieval and applies a protocol requiring numbered citations for material claims, explicit separation of evidence and inference, disclosure of conflicts/uncertainty/missing evidence, and no invented sources.

**Reasoning:** Deep research must be an execution contract, not a cosmetic prompt label. The intent is persisted on queued work and applies even in bare-chat mode because it is explicitly user requested.

**Tests:** Standard/deep contract parsing, queue/database round-trip, context preview, and a bare-chat regression proving the research protocol is retained.

### ENH-04 — Organization sensitive-content policy

**Outcome:** Administrators can configure disabled, audit, block, or redact actions for credit cards, email addresses, US Social Security numbers, and API-token-shaped values. Enforcement covers run prompts/context, queued turns, agents, prompt templates, eval inputs, chat/OpenWebUI imports and channel writes, completed assistant messages, and outbound provider/tool/image/voice/embedding paths.

**Reasoning:** Enterprise DLP needs one policy boundary and privacy-safe evidence. Reports, simulations, errors, and audits expose detector/action/count metadata only—never the content, match, or pattern. Credit-card detection uses Luhn validation to reduce false positives.

**Implementation:** Organization-backed policy service, admin GET/PATCH/simulate API, generated clients, accessible localized administration UI, recursive structured redaction, and stable `content_policy_blocked` responses.

**Tests:** Dedicated content-policy service/route/import/output tests plus broader prompt/eval/bare-chat/redaction regressions cover actions, authorization, Luhn behavior, recursive payloads, persistence/provider boundaries, and privacy sentinels; contracts and OpenAPI coverage pass.

**Remaining:** Provider `message.delta` events are persisted and streamed before the complete output is assembled. The final assistant row is governed, but detecting a sensitive value split across deltas before it is transiently observed requires an explicit buffered-streaming product mode and latency/UX decision.

### ENH-05 — Feedback-to-evaluation quality flywheel

**Outcome:** Authorized editors can turn a negatively rated assistant message into a deterministic evaluation case. Only the causal branch-aware user prompt is retained; the assistant answer, feedback reason, and reviewer identity are excluded. Replays are idempotent.

**Reasoning:** This converts real failures into regression coverage while avoiding the common privacy mistake of copying the entire transcript or reviewer data into an eval corpus.

**Tests:** New/existing suite creation, idempotent replay, positive-feedback rejection, branch selection, read-only denial/editor grant, length bounds, and response/audit privacy sentinels.

### ENH-06 — Cost and quality visibility

**Outcome:** Usage and analytics surfaces report estimated cost alongside volume, model/provider dimensions, and exports. Model discovery exposes useful pricing/capability filters, and knowledge administration exposes ingestion/retrieval quality signals and replay comparison without returning raw corpus text.

**Reasoning:** Operators need to optimize quality and spend together. Estimates remain explicitly estimates; selection and reporting do not override quotas, grants, or deployment policy.

**Validation:** Usage aggregation/export, image-generation cost recording, analytics summaries, model pricing display, retrieval replay/redaction, and locale/type tests.

### ENH-07 — Safer browser-local collaboration UX

**Outcome:** Drafts are subject/workspace/chat scoped, session-bound, expiring, and purged on logout/current-session revocation. Sidebar resizing now supports mouse, pen, touch, and keyboard with validated persistence and full separator semantics. Remote avatars reject private/local and unsafe schemes, send no referrer, use anonymous CORS, and fall back safely.

**Reasoning:** These are small interactions with disproportionate privacy and accessibility impact on shared enterprise devices.

**Tests:** Draft isolation/TTL/storage-failure tests, resizer pointer/keyboard/ARIA/storage tests, and avatar schema/render/picker privacy tests.

### ENH-08 — Release/version and SDK consistency

**Outcome:** Product and protocol version metadata now derive from one contracts source, with a CI consistency check across health, OpenAPI, OpenWebUI, tool dispatch, webhooks, and generators. TypeScript and Python SDKs include the new content-policy, routing, research, and feedback-eval contracts.

**Reasoning:** Version drift makes incident diagnosis and client compatibility ambiguous. Generated transports keep browser, CLI, and external client behavior aligned with deployed contracts.

**Validation:** Version-consistency, OpenAPI route coverage, generated-client compilation, contracts checks, and Python generation complete successfully.

### ENH-09 — Evaluation-gated assistant release channels

**Outcome:** Assistant authors can stage an immutable candidate without changing live conversations, review per-version evaluation status and score, compare snapshots, promote a candidate to production, or roll back to a prior version. Publishing remains blocked when the required evaluation gate fails or the underlying model is unusable.

**Reasoning:** Editing a production assistant in place couples experimentation to customer traffic. Candidate/production semantics create a small, understandable release workflow while reusing immutable versions, existing evaluation suites, authorization, and audit trails.

**Tests:** Candidate publication leaves the live pointer unchanged; production publication/promotion updates it transactionally; version snapshots include bindings and safety configuration; evaluation/model/workspace gates, diffing, rollback, audit metadata, contracts, and localized confirmation UI are covered.

### ENH-10 — Operational discovery and quality triage

**Outcome:** Model selection can be filtered by economy/pricing, tools, and vision readiness; catalog rows expose availability and configuration attention; knowledge sources summarize healthy, stale, failed, pending, duplicate, and chunk totals; analytics combines usage and estimated cost.

**Reasoning:** Enterprise breadth becomes usable only when operators can find an eligible capability and immediately see what needs attention. These summaries are computed from authoritative inventory rather than hardcoded dashboard counters.

**Validation:** Model-attention, pricing display, knowledge-quality aggregation, analytics/export, empty/loading/error states, localization, and type checks.

## Original release blockers: remediation record

The sections below retain the original attack/failure reasoning and acceptance tasks. Their status lines describe the current working tree; “fixed” does not waive the listed live or deployed acceptance tests.

### SEC-01 — Webhook SSRF, redirects, DNS rebinding, and unbounded requests

**Severity:** High  
**Status:** Fixed in source; production egress-policy acceptance remains.

`webhook-url.ts` validates schemes/literals but does not resolve DNS. `webhook-service.ts` uses ordinary `fetch`, follows redirects, and has no timeout or response bound. A permitted hostname can resolve/rebind or redirect to RFC1918, loopback, link-local/cloud metadata, or IPv6 private ranges; a slow peer can hold worker capacity.

**Task:** Route webhooks through one canonical DNS-pinned dispatcher. Resolve all A/AAAA results, reject every non-global/special range, preserve SNI/Host while pinning the socket, use manual redirects, repeat validation on every hop, cap redirects/body/time/concurrency, and support production allowlists/egress proxying.

**Tests:** Private DNS result, mixed results, rebinding between validation/connect, redirects to loopback/169.254/ULA, HTTPS-to-HTTP downgrade, decimal/octal/mapped address forms, timeout, oversize response, safe public success.

### SEC-02 — Duplicated and incomplete tool/browser/OAuth egress policy

**Severity:** High  
**Status:** Fixed in Romeo and CLI; the external browser runner must still prove that it enforces the supplied pinned-address contract.

`network-host-policy.ts` omits important IPv4/IPv6 special ranges and does no DNS resolution. CLI dispatch resolves then performs a second ordinary resolution, creating TOCTOU. Stronger DNS-pinned code already exists in `data-connector-network-policy.ts` and `dns-pinned-fetch.ts`.

**Task:** Consolidate connectors, tools, browser tasks, OAuth token exchange, and webhooks onto one reviewed network policy and dispatcher. Delete duplicate classifiers.

**Validation:** Shared adversarial address corpus and independent external-runner rejection tests.

### SEC-03 — Unbounded direct upload and full-memory object read

**Severity:** High  
**Status:** Fixed in source; real S3 and low-heap acceptance remains.

S3 PUT presigning does not constrain content length/checksum. S3 GET buffers `arrayBuffer()` without a bound. Direct-upload completion downloads the entire object before comparing declared size/checksum. A presigned URL holder can create storage cost and trigger OOM.

**Task:** Use constrained POST/enforced length and checksum, HEAD before GET, reject/delete over-limit objects, stream hashing with a hard byte ceiling and abort, and lifecycle-clean abandoned uploads.

**Tests:** Greater-than-declared/global limit, missing/chunked length, checksum mismatch, concurrent oversized completions under a low heap, and cleanup proof.

### SEC-04 — Rate-limit identity and multi-replica correctness

**Severity:** High  
**Status:** Fixed in source/config validation; a two-replica Valkey/ingress acceptance test remains.

Direct mode assigns all unauthenticated callers the literal identity `direct`, enabling one client to exhaust everyone’s login/webhook budget. Proxy mode trusts forwarding headers without verifying the peer/hop. The default limiter is per-process while Helm defaults to two replicas.

**Task:** Obtain peer address from the server adapter; configure trusted proxy CIDRs/hops and discard untrusted forwarding metadata; require an atomic Valkey limiter for multi-replica production; validate incompatible configurations at startup.

**Tests:** Distinct direct-client buckets, spoofed-header rejection, trusted ingress canonicalization, two-pod global budget, and explicit cache-failure behavior.

### AUTH-01 — Device refresh rotation race

**Severity:** High  
**Status:** Fixed with atomic rotation/CAS; live Postgres contention remains an acceptance criterion.

Concurrent refreshes read the same token without a row lock/CAS, revoke the same original access key, and can each create a valid replacement; one replacement becomes orphaned.

**Task:** Atomic `UPDATE ... WHERE id AND hashed_refresh_token ... RETURNING` or `SELECT FOR UPDATE`, exactly-one-winner behavior, credential-family replay handling, and loser cleanup.

**Validation:** Live Postgres `Promise.all`: one success, one 401/409, only winner credentials remain valid.

### AUTH-02 — MFA recovery code concurrent reuse

**Severity:** High  
**Status:** Fixed with atomic recovery-state consumption; live Postgres contention remains an acceptance criterion.

Recovery state is read/decrypted before the transaction and unconditionally rewritten. Parallel logins can consume the same code and both mint sessions.

**Task:** Atomic row lock/version/CAS consumption transactionally coupled to session issuance.

**Validation:** Live Postgres concurrency produces exactly one session and one success audit; count decrements once.

### AUTH-03 — Password/LDAP lockout lost updates

**Severity:** High  
**Status:** Fixed: local increments are atomic and LDAP uses a shared expiring attempt store; multi-instance acceptance remains.

Local failed-attempt count is read/incremented/written non-atomically. LDAP lockout is an in-process `Map`, so restart or multi-replica routing bypasses it.

**Task:** Atomic database increment returning the lock decision; shared Valkey/Postgres TTL counter for LDAP.

**Tests:** Ten-plus concurrent local failures and two-instance LDAP simulation.

### AUTH-04 — SAML request-state ledger races and replay

**Severity:** High  
**Status:** Fixed with a dedicated request table and atomic consume; external-IdP/browser acceptance remains.

SAML request state is one global JSON system-setting ledger. Concurrent starts lose entries, and duplicate callbacks can both observe an unconsumed request and mint sessions.

**Task:** Dedicated `saml_auth_requests` table keyed by request ID with org/provider/relay hash/expiry/consumed time and atomic one-time `UPDATE ... RETURNING`; indexed cleanup.

**Tests:** Many concurrent starts remain completable; duplicate callback yields one session/audit; cross-org requests cannot overwrite.

### AUTH-05 — MFA login challenge replay

**Severity:** Medium/High  
**Status:** Fixed with one-time persisted challenges and replay coverage.

The signed five-minute MFA challenge is stateless and lacks a consumed `jti`; depending on TOTP replay semantics, the same challenge/code can mint multiple sessions.

**Task/tests:** One-time `jti` ledger plus last accepted TOTP timestep; exact and concurrent replay tests.

### BILL-01 — Billing webhook idempotency and ordering

**Severity:** High  
**Status:** Fixed with durable receipts, organization serialization, ordering checks, and explicit canceled-state protection; live Postgres/provider replay acceptance remains.

Stripe `event.id` is discarded; generic events need no ID; no durable receipt or monotonic event time exists. Retries/replays repeat mutations/audits, and an older `invoice.paid` can reactivate a later canceled subscription.

**Task:** Preserve required provider event IDs, atomically insert receipts keyed `(provider,event_id)` before effects, store provider-created time, reject/ignore older transitions, and encode explicit transition rules.

**Tests:** Exact and concurrent replay mutate once; process-restart retry is idempotent; canceled then older paid remains canceled.

### TEN-01 — Tenant-isolation/contract security gate failures

**Severity:** High  
**Status:** Fixed

The initial scan found six failures:

1. owner-mapped connector reader source access returns 403 instead of 200;
2. provisioned OIDC user lacks expected enterprise workspace membership;
3. OpenAI Responses reasoning capability is false instead of expected true;
4. OpenWebUI member channel list is empty;
5. extraction failure code is `file_ocr_failed` instead of `file_extraction_failed`;
6. native collaboration member channel list is empty.

The failures had four root causes:

- three non-admin test subjects had knowledge/channel membership but lacked the required explicit workspace `read` grant;
- the enterprise OIDC fixture expected workspace provisioning without configuring `workspaceGroupPrefix` or issuing the matching enterprise workspace group;
- negative model-name heuristics incorrectly overrode the OpenAI Responses adapter's positive base `reasoning` capability;
- the extractor-retry test unintentionally exercised the newly enabled local OCR fallback, so host binary behavior changed the terminal failure code.

The fix preserves fail-closed workspace authorization: fixtures now provision explicit workspace grants, the OIDC fixture configures and supplies the intended group mapping, model discovery treats a missing reasoning name hint as unknown instead of false, and the extractor-only test explicitly disables OCR. A provider-unit regression asserts that base reasoning support survives a generic model name.

**Validation:** The current `packages/core` suite is 85 files/838 tests green; the full workspace is 1,756 tests passed with four intentional live-Postgres skips; and `pnpm smoke:tenant-isolation-negative` writes green evidence under `dist/ci/tenant-isolation-negative-suite.json`. Live Postgres and external identity-provider coverage remains production acceptance, not evidence inferred from the local suite.

**Follow-up:** Preserve sanitized structured failure evidence instead of hashes-only output and expand the live cross-org/workspace matrix.

### API-01 — Advertised compatibility routes unreachable in deployed app

**Severity:** High  
**Status:** Fixed by the deployed root `/api/$` bridge; route/OpenAPI coverage is green.

Core/contracts advertise legacy `/api/models`, `/api/chat/completions`, and `/api/embeddings`, but TanStack routes only bridge `/api/v1/$`; advertised aliases 404 at the app boundary.

**Task:** Either add an intentional root `/api/$` bridge or deprecate/remove the aliases from core, OpenAPI, and SDKs. Do not remove valid `/api/v1` compatibility routes.

**Validation:** Root bridge and OpenAPI route coverage pass. A deployed-app smoke enumerating every advertised server/path combination remains required.

### API-02 — Raw upstream exceptions exposed or persisted

**Severity:** High  
**Status:** Fixed for the reported Valkey/provider/tool/bulk paths with stable public errors and redaction sentinels; retain this as a permanent review rule for new integrations.

Several services deliberately put Valkey/provider/tool exception text into public `ApiError` messages/details, audits, or state, bypassing the safe unexpected-error handler. SDK errors can contain URLs, response bodies, query secrets, or credentials.

**Task:** Central classifier mapping allowlisted internal errors to stable public code/message plus request ID. Send only redacted metadata to a structured internal logger.

**Tests:** Throw credential/query/body-bearing sentinels and prove responses, audit, sync state, webhook, and logs contain none.

### RUN-01 — Eager runtime singleton and missing shutdown ownership

**Severity:** High  
**Status:** Fixed. Runtime construction is explicit, workers default off for library use, and lifecycle start/stop is idempotent.

Importing core creates/exports `romeoApi` and starts cleanup/terminal/provider workers. DB imports the core root, so hidden in-memory workers can start before the real app runtime. DB construction drops the close handle; no complete runtime stop/close exists.

**Task:** Remove eager singleton, use type/domain subpath exports, add explicit idempotent `start/stop/close`, one server owner, graceful shutdown, and workers-off library defaults.

**Tests:** Import creates zero timers/network/repository calls; one worker set per process; stop drains timers and closes pool.

### UI-01 — Transcript never refreshes from other clients

**Severity:** High  
**Status:** Fixed with focus/reconnect convergence and live-stream row reconciliation.

Message queries use `staleTime: Infinity` and disable focus refetch. Admin deletions or other-device messages remain stale for the mount lifetime.

**Task:** Refetch/reconcile on focus and reconnect when no active stream, preserving only the live optimistic row, or subscribe to chat events.

**Tests:** Second-client add/delete followed by focus/reconnect; active stream is not clobbered; terminal invalidation converges.

### UI-02 — Per-token transcript/Markdown quadratic work

**Severity:** High  
**Status:** Partially fixed. SSE deltas are cadence-batched and streaming reconciliation is isolated; segmented/incremental Markdown remains a performance enhancement.

Every delta maps/copies transcript state; message topology sorts/copies; accumulated Markdown with plugins reparses on every content update. Long chats/answers therefore approach token count multiplied by transcript/topology and growing parse size.

**Task:** Buffer SSE deltas to animation-frame/short cadence, isolate the active streaming row, cache topology/indexes when only content changes, and render completed Markdown segments incrementally.

**Validation:** 500 messages plus 2,000 deltas benchmark; React Profiler counts, long tasks, memory, token-loss/cancel/reconnect tests.

### UI-03 — Bundle budget, global CSS, and SSR shell

**Severity:** High  
**Status:** Fixed for all enforced bundle budgets. Root-wide `ClientOnly` is removed and real SSR smoke passes.

Final entry/initial/gzip results, all green without raising thresholds:

- shell: 71,821 / 1,274,276 / 353,212 bytes;
- workspace: 7,117 / 1,237,016 / 339,902 bytes;
- admin: 21,314 / 1,261,280 / 347,330 bytes;
- settings: 5,333 / 1,222,530 / 333,999 bytes;
- CSS: 84,294 raw / 16,890 gzip bytes.

The root-wide `ClientOnly` boundary is gone, route content is server rendered, active route panels/namespaces are lazy, and console/chat/content/sidebar/error styles follow their owning routes/components. Vite still reports some over-500-KB async chunks, which remain an optimization opportunity outside the enforced initial-load budgets.

**Task:** Remove root-wide `ClientOnly` and isolate browser-only leaves; route-split styles/namespaces; finish legacy selector/component migration; inspect client entry composition and heavy dynamic imports.

**Validation:** Bundle budget green; SSR response contains route landmark/content; hydration/no-JS smoke; cold-mobile Web Vitals.

## Additional enterprise findings

### Reliability and data consistency

- **REL-01 (Medium, fixed in source):** Timed workers use a shared supervisor for non-overlap, rejection containment, cooperative abort/drain, bounded exponential backoff with jitter, and sanitized reporting. Worker health now tracks scheduling/lease lag, claims, misses, successes, and failures without payloads; webhook event emission catches/reports failures. Multi-process shutdown/lease-loss drills remain deployment acceptance.
- **REL-02 (Medium, fixed for audited repositories):** Update methods no longer report the caller's proposed object when `UPDATE ... RETURNING` affects zero rows; repository conflicts/CAS can distinguish concurrent deletion or stale state. Keep zero-row semantics in repository conformance for every new update method.
- **REL-03 (Medium, fixed):** Webhook delivery pages use SQL keyset pagination. Retry workers claim durable bounded batches with `FOR UPDATE SKIP LOCKED`, owner/token/expiry CAS, bounded concurrency, stable delivery IDs, and tenant-aware indexes. Focused core/DB/migration tests pass; the million-row query plan and two-worker live-Postgres suite remain deployment acceptance.
- **REL-04 (Medium, partially fixed):** The operational exporter now provides bounded dependency-aware readiness, process-only liveness, Prometheus failure posture, and validated worker/lease health inputs; an upstream metrics failure no longer crashes through already-sent headers. A real structured log/trace backend subscriber and live Prometheus/alert drill remain deployment work; unused Helm OTLP knobs were removed so the chart no longer falsely claims export.
- **REL-05 (Medium, fixed):** Authentication failures now use a distinct `AuthenticationError`, return 401 with `WWW-Authenticate`, while authenticated insufficient-scope failures remain 403.

### Authentication and browser security

- **AUTH-06 (Medium, fixed):** Forwarded protocol is honored only in configured trusted-proxy mode; direct/production cookie security derives from the configured application origin and production policy.
- **AUTH-07 (Medium, fixed in source):** The narrowly scoped SAML callback state cookie uses `SameSite=None; Secure` for HTTPS and request state is server-side/one-time. A real external IdP POST remains acceptance evidence.
- **AUTH-08 (Medium, fixed):** Self-service password changes transactionally revoke existing sessions and audit the revocation posture.
- **AUTH-09 (Medium, fixed):** MFA and delegated-OAuth AES-GCM envelope v2 binds purpose and tenant/record identity through AAD; v1 remains readable and rewrap/use migrates to v2. Swap, field-mutation, tag-tamper, compatibility, and migration tests pass.
- **AUTH-10 (Low, fixed):** Request IDs accept only a bounded token grammar; invalid/oversized values receive a server-generated ID.

### Files, content, and privacy

- **FILE-01 (Medium, fixed in production policy):** Helm now requires the malware-scanning policy and rejects a production render when it is disabled. The file pipeline retains quarantine/bounded parsing controls; deploying and scaling the actual scanner plus EICAR and outage fail-closed evidence remain target-environment acceptance.
- **UI-04 (Medium, fixed for audited production error flows):** A central `safeUserErrorMessage` policy now protects 85 call sites across 37 application files. Login, provider, run, export, retention/RAG, deletion, grants/tools, voice, workspace/chat, agent, content, and knowledge failures render localized safe copy plus validated request IDs only; provider event messages no longer enter run/chat state. A secret-bearing provider-message sentinel proves that credentials and private addresses do not reach rendered state. A browser-local image decode diagnostic and development-only route-boundary details are the only intentional raw `Error.message` residuals. Affected asynchronous surfaces use alert/status semantics, with `InlineError` defaulting to `role="alert"`.
- **UI-05 (Medium, fixed):** Sidebar resize uses pointer capture/fallback for mouse, pen, and touch; separator ARIA, Arrow/Shift/Home/End keyboard control, clamping, corrupt-storage cleanup, and failure-safe persistence have focused jsdom coverage.
- **UI-06 (Medium, fixed):** Stable handlers now observe only the latest committed controller through a layout/commit handoff; an abandoned-render regression covers the original concurrency hazard.
- **UI-07 (Low/Medium, fixed for direct browser loads):** Avatar writes accept public HTTPS or bounded raster data only, reject private/local/special hosts and unsafe forms, render with `no-referrer` and anonymous CORS, and fall back on invalid/broken sources. A controlled proxy/cache remains an optional stricter privacy posture.

### Deployment and supply chain

- **DEP-01 (Critical, fixed in source):** Explicit production validation rejects seeded login, insecure/default secrets and origins, memory persistence, and incompatible rate/quota coordination before service construction. Helm adds schema/template fail-hard invariants. Target-environment startup and dependency-failure drills remain acceptance.
- **DEP-02 (High, fixed in source/image test):** The application runtime is a non-root, digest-pinned, minimal Nitro-output image; operations tooling is separate. A full build/export proved Docker-context sentinels absent and the runtime `/app` allowlist clean. Repeat against the pushed release digest in CI.
- **DEP-03 (Medium/High, fixed in chart policy):** Helm is explicitly production-only and fails insecure rate/quota, Valkey, malware, image, privilege/filesystem, NetworkPolicy, worker-egress, readiness, and migration-gating configurations. Digest refs, read-only roots with narrow `/tmp`, app-only selectors, and process-plus-Postgres/Valkey transport readiness render correctly. Cluster CNI/egress and semantic authenticated dependency checks remain external.
- **DEP-04 (Medium, contained):** Compose is explicitly dev-only; application, Postgres, Valkey, and object-store ports are loopback-bound, and app/ops images run non-root. Its weak/mutable development dependencies must never be promoted to production.
- **DEP-05 (Medium, fixed in repository/CI):** Existing Actions are pinned to immutable commits; CODEOWNERS, SECURITY.md, and Dependabot cover packages/actions/Docker; CI executes full-history Gitleaks, deterministic local Semgrep SAST, Trivy filesystem/secret/misconfiguration scanning, an actual runtime build, and a blocking image scan using digest-pinned scanners. External branch protection, private vulnerability reporting, release signing/SBOM/provenance, and alert administration remain operator tasks.
- **DEP-06 (Low, fixed):** pnpm now enforces a 24-hour `minimumReleaseAge`; CI validates the window and exact versioned exceptions.

### Versions, schema, and cleanup

- **VER-01 (Medium, fixed):** Product and protocol version metadata derive from `@romeo/contracts/version`; generators consume the root release version and `check:version-consistency` asserts health/OpenAPI/OpenWebUI/tool/webhook/chart/SDK agreement.
- **VER-02 (Medium, time-bounded acceptance):** Nitro remains prerelease because TanStack Start has no supported stable alternative in this dependency line. The direct dependency is exact-pinned and `docs/security/runtime-prerelease-risk-acceptance.md` records owner, mitigations, exit criteria, and a 2026-11-13 review deadline; CI enforces version/review alignment. Move to stable when compatible or renew explicitly before expiry.
- **VER-03 (Medium):** Planned major upgrades need separate compatibility work: i18next 25→26, react-i18next 16→17, TypeScript 6→7, axe 4.12→4.13, Lucide 1.21→1.31, and KaTeX 0.17→0.18. Stage patches separately from majors; do not bulk-upgrade.
- **DB-01 (Medium, external retirement prerequisite):** Legacy `identities`, bare `sessions`, roles/permissions join tables, and DB `feature_flags` have no in-process consumers beyond purge/schema checks; stale config flags were removed. They were intentionally not dropped because repository inspection cannot disprove external SQL/reporting consumers and a destructive drop is not data-reversible. Inventory the target database and external consumers, prove backup/restore, run an additive deprecation window, then approve a separate destructive migration without weakening tenant purge.
- **CLEAN-01 (Medium, fixed):** The `SettingsSection` alias and retired assistant-selection arguments/tests are removed; all eight `.rm-panel` emitters migrated to the console section primitive; compatibility and exact zero-reference selectors were deleted.
- **CLEAN-02 (Medium, fixed):** Cohesive domain/view/controller/helper extractions reduced all production modules to 500 lines or fewer and the largest CSS file to 923 lines. The ratchet reports zero oversized files and zero forbidden legacy/raw-control metrics; thresholds were not relaxed.
- **CLEAN-03 (Medium, fixed):** Repository inventory and strict direct-conformance evidence now cover all 276/276 methods. The eleven previously uncovered pagination, credential rotation/consumption, eval, delivery, connector, webhook-lease, billing-lock, and billing-receipt operations have explicit behavioral references; live-Postgres variants remain gated acceptance where applicable.

## Prioritized implementation plan

### Phase 0 — Acceptance before release

1. Run the new atomic auth, billing, SAML, and webhook lease tests against live Postgres under contention and two worker processes.
2. Exercise trusted ingress, two-replica Valkey limiting, real SAML/OIDC browser flows, and the external browser runner's pinned-address enforcement.
3. Test direct uploads against real object storage under a low heap and deploy the required malware scanner with EICAR/outage fail-closed evidence.
4. Build the exact release digest, scan it for vulnerabilities/secrets, generate SBOM/provenance, sign it, and verify it before a target-cluster policy/CNI/egress drill.
5. Keep tenant isolation, contracts, SDK drift, types, lint, tests, dependency audit, and deployment policy checks release-blocking.

### Phase 1 — Maintain the now-green source quality budgets

1. Keep the 1,000-line CSS and 500-line production-module ratchets blocking; do not add exceptions or raise thresholds.
2. Preserve route-local lazy boundaries and the five green bundle budgets as features evolve.
3. Run the now-complete 276/276 repository conformance suite against the live Postgres acceptance target.
4. Connect the validated operational metrics/readiness path to the production monitoring stack and implement the selected structured trace/log subscriber.

### Phase 2 — Complete policy and UX coverage

1. Decide whether a buffered streaming/DLP mode should trade token latency for prevention of cross-delta transient disclosure.
2. Preserve the centralized safe-error and alert/status contracts for every new async surface; extend real-browser focus/announcement acceptance as surfaces evolve.
3. Segment or incrementally render long streaming Markdown and keep a 500-message/2,000-delta performance benchmark.
4. Add real-browser activation, feedback-to-eval, release-channel, draft/logout, keyboard/pointer, no-JS, axe, and cold-mobile Web Vitals acceptance.

### Phase 3 — Schema and supply-chain lifecycle

1. Confirm no external consumers, then remove legacy identity/session/RBAC/feature-flag tables through reversible migrations and upgrade/rollback tests.
2. Stage dependency major upgrades separately; migrate Nitro to stable when supported or renew its enforced time-bounded acceptance before expiry.
3. Configure branch protection/private vulnerability reporting, publish scanned operations/runtime digests, and sign/attest/admission-verify exact release artifacts; repository Actions/governance/scanning controls are now present.

## Validation evidence

### Green after this pass

- `pnpm check`: all 16 workspace TypeScript projects passed.
- `pnpm lint` and `pnpm format:check`: passed; `git diff --check`: passed.
- `pnpm test`: **1,756 passed**, 4 intentional live-Postgres-gated skips across all 16 tested workspace projects. Core: 85 files/838 tests; DB: 24 files/124 passed/4 skipped; app: 89 files/518 tests; CLI: 26 files/85 tests; every remaining workspace package passed.
- Production application client/SSR build: passed for 2,921 modules. All bundle budgets passed: shell 71,821/1,274,276/353,212 bytes, workspace 7,117/1,237,016/339,902, admin 21,314/1,261,280/347,330, settings 5,333/1,222,530/333,999, and application CSS 84,294 raw/16,890 gzip.
- Real SSR smoke: `/login` and `/` passed; dependency-cruiser passed.
- `check:dead-code`, version consistency, OpenAPI route coverage, and UI form contracts passed (58 forms/168 controls).
- Production dependency audit: 0 known vulnerabilities at the configured high threshold; the earlier JSON audit showed zero advisories at all severities.
- Focused product/security suites: contracts 28/28; content policy/evals/research/routing/network/envelope/worker 55/55; draft/resizer/avatar/selection 31/31.
- Webhook paging/lease focused evidence: core 16/16; DB 46 passed/4 live-Postgres-gated skips.
- Helm production policy: secure app/worker/backup renders plus 28 negative schema/template cases passed; Helm lint, unique-key YAML parsing, and Compose config passed.
- Full Docker policy build/export: context sentinels excluded and runtime `/app` allowlist passed. The serving image removes unused npm/Corepack/Yarn trees and the rebuilt Node 24.18 image passed Trivy with 0 High/Critical vulnerabilities and 0 secrets.
- Supply-chain policy, full-history Gitleaks, local Semgrep, and Trivy filesystem scans passed; filesystem results were 0 High/Critical vulnerabilities, 0 secrets, and 0 misconfigurations.
- TypeScript and Python SDKs regenerated; generated TypeScript compiles.
- Architecture ratchet passed with zero oversized production files, maximum CSS 923/1,000 lines, maximum locale namespace 273/500 lines, and all forbidden/legacy/raw-control metrics at zero.
- Console browser conformance passed all gated duplicate-title, clipped-descender, bare-table, and legacy-empty checks across 46 rendered admin/workspace routes against the production build.

### External acceptance still release-blocking

- The external/live acceptance in the following section has not been run locally and cannot be inferred from in-memory, simulated, browser-local, or static policy tests.

### Required production-grade acceptance suite

- live Postgres race tests for refresh, MFA recovery, password failures, SAML state, billing replay, and repository CAS;
- adversarial DNS-pinned egress tests plus network-level deny policy;
- low-heap oversized upload tests and scanner fail-closed tests;
- two-replica rate-limit, worker-claim, shutdown, and readiness tests;
- deployed TanStack route/OpenAPI compatibility enumeration;
- real-browser SAML POST, OIDC multi-tenant, draft logout/switch, transcript convergence, axe, keyboard/pointer, SSR/no-JS, and cold-mobile performance tests;
- image-layer sentinel/secret scan, SBOM/vulnerability scan, signature/provenance verification, and policy-as-code deployment checks.

## Positive controls worth preserving

- Session/API tokens are high entropy and SHA-256 digested at rest.
- OIDC JWT verification pins algorithm, issuer, audience, expiry, and signature; PKCE/nonce/state handling is otherwise thoughtful.
- User disable/role changes transactionally revoke owned sessions/API keys and support sessions.
- Middleware ordering places security headers, body limit, pre-auth limiting, CSRF, request context, and principal limiting coherently.
- Unexpected-error handling avoids raw error/path/query disclosure; explicit raw `ApiError` conversions should be brought under that same policy.
- Data-connector DNS-pinned fetch is a strong implementation to standardize on.
- Markdown raw HTML is inert; Mermaid uses dynamic import and strict mode; attachment iframes use an empty sandbox.
- The repository has transaction composition, migration/schema contracts, queue/lease live concurrency tests, extensive browser accessibility checks, and broad CI intent.
- Direct Lucide subpath imports, lazy admin panels, dynamic Mermaid/highlight/KaTeX, safe return-to normalization, route error boundaries, and focus-trapped Radix overlays are solid patterns.

## Exit criteria

Romeo should not be labeled enterprise-grade until:

1. every Critical/High item is fixed or has a written, time-bounded risk acceptance by an accountable owner;
2. tenant-isolation, full unit/integration, type, lint, dead-code, architecture, form, SDK-drift, dependency, build, bundle, browser, and deployment gates are green on Node 24;
3. concurrency fixes pass live Postgres tests, not only in-memory repositories;
4. egress and upload controls are validated against real sockets/object storage and network policy;
5. production startup fails closed on insecure configuration before opening a listener;
6. image contents, SBOM, vulnerabilities, signatures, and provenance are verified from the exact deployable artifact;
7. rollback procedures exist and are tested for schema, runtime, dependency, and deployment changes.
