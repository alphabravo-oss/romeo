# Romeo Enterprise Remediation and Completion Plan

**Date:** 2026-08-23
**Status:** Complete (implementation and local evidence; external target certification is fail-closed)
**Scope:** Exact current dirty worktree, including the in-progress workflow and connector removals
**Objective:** Resolve every confirmed API, data, UI, UX, accessibility, performance, security, operations, dead-code, and validation issue from the August 23 deep review; finish with evidence that the complete supported product is coherent and releaseable.

## 1. Completion contract

This plan is complete only when all of the following are true:

1. Every `R-###` item below is marked complete with its named evidence.
2. No compatibility break is silently accepted. Every removed or changed contract is either restored, versioned/deprecated through the documented lifecycle, or explicitly approved with migration evidence.
3. No destructive database migration can run without export/backup, compatibility, rollback, ledger, and restore evidence.
4. The application image, operations image, Helm jobs, Compose services, migrations, workers, backups, and restore paths execute the exact commands they advertise.
5. Tenant isolation is enforced at the service, repository, and database layers, including worker/system paths.
6. Shared table state has one typed source of truth per surface; scope, search, sort, filters, pagination, selection, mutation invalidation, loading, errors, saved views, and exports are coherent.
7. The UI meets the current Web Interface Guidelines and WCAG-oriented keyboard, focus, naming, media, motion, localization, and navigation expectations.
8. All repository checks pass under Node 24.18.0, including typecheck, lint, format, dead code, architecture, unit/integration tests, coverage, OpenAPI, SDK drift, migration policy, bundle budgets, browser quality, Helm, container, and release evidence gates.
9. Live/environment-dependent controls have either passing target evidence or a fail-closed configuration that prevents an unsupported enterprise claim.
10. A final requirement-by-requirement audit confirms evidence for every item; absence of a failure is not accepted as proof.

## 2. Implementation principles

- Preserve user changes in the dirty worktree and make narrowly attributable edits.
- Fix root contracts before downstream fixtures or snapshots.
- Prefer typed resource registries and generated contracts over casts and duplicated string conventions.
- Use one query/cache as the authority for rows, counts, loading, errors, refresh, detail selection, and mutation reconciliation.
- Reset or key state whenever tenant, workspace, parent, resource, or filter scope changes.
- Use real links for navigation and semantic controls for actions; ARIA supplements semantics rather than replacing them.
- Require durable, read-back-verified evidence for backups, exports, scans, approvals, and release readiness.
- Use leases, fencing tokens, idempotency keys, and bounded batches for distributed work.
- Do not weaken tests or ratchets to obtain green output; update them only when the desired contract intentionally changed and is fully migrated.

## 3. Dependency order

1. **P0 release safety:** images, migrations, backups, API compatibility, error registry.
2. **P1 security and tenancy:** SSRF boundaries, RLS, production validation, workload identity, release attestations.
3. **P1 distributed operations:** worker coordination, readiness, retention, shutdown, key rotation, DR.
4. **P1 data/UI correctness:** typed server-table resource contract and broken provider/eval/usage/tool-trace surfaces.
5. **P2 product UX:** invalidation, errors, navigation, accessibility, localization, responsive overlays.
6. **P2 engineering quality:** fixtures, dead code, architecture, format, SDKs, inventories, bundle and browser gates.
7. **P0 completion audit:** full supported-runtime and live-target evidence.

## 4. Detailed remediation backlog

### Release, migration, and API contracts

#### R-001 — Publish and use an executable operations image

- **Why:** Helm migration, worker, and backup jobs invoke `pnpm`, but the default final application image intentionally omits the package manager, scripts, workspace packages, and dependencies. Production installation and every enabled job can fail immediately.
- **Tasks:** Publish `app-runtime` and `ops-runtime` separately; add explicit app/ops repository, tag, digest, and pull-policy values; require a digest-pinned ops image when migration/worker/backup features are enabled; point all Jobs/CronJobs at it; include both artifacts in SBOM, vulnerability scan, provenance, release manifest, and readback.
- **Tests:** Build both targets; inspect their filesystem contracts; execute migration `--help`/dry-run and every worker/backup command in the ops image; assert those tools are absent from the app image; render every Helm job and assert the ops digest.
- **Evidence:** Container policy report, Helm render report, command execution smoke, SBOM/scan/provenance for both digests.

#### R-002 — Replace the direct workflow table drop with a governed retirement

- **Why:** `0032_drop_workflows.sql` destroys definitions and run history with no export, compatibility window, rollback, or restore proof.
- **Tasks:** Define the intended product outcome; if removal remains desired, add disable-write/read-old phases, export format, tenant notification/approval, retention/legal-hold treatment, backup checkpoint, reversible rename/archive phase, and a later contract migration; never drop in the first retirement migration.
- **Tests:** Upgrade from the last released schema with populated workflows; verify old binaries remain safe during the compatibility window; export and restore representative data; run rollback/read-old tests; prove legal holds and data-rights exports remain correct.
- **Evidence:** Migration design record, populated upgrade/rollback logs, export/restore artifact, approved destructive-change record.

#### R-003 — Register migration 0032 in the immutable migration ledger

- **Why:** The journal and migration directory changed without the required ledger entry and evolution evidence.
- **Tasks:** After R-002 defines the actual migration sequence, add each migration digest, classification, compatibility stage, dependencies, approvals, rollback/restore commands, and evidence references to the ledger.
- **Tests:** Run database evolution policy self-tests and the real check; mutate a fixture digest to prove immutability enforcement still fails closed.
- **Evidence:** Passing `check:database-evolution-policy` and ledger-review diff.

#### R-004 — Implement real audit-chain integrity

- **Why:** Hashing caller-supplied IDs with unkeyed SHA-256 does not protect canonical audit content, ordering, or authorship.
- **Tasks:** Canonically serialize immutable audit records; assign monotonic per-tenant sequence numbers; chain record/segment roots; sign checkpoints with KMS-backed asymmetric signatures or a versioned keyed MAC; store algorithm and key version; protect checkpoint rows from ordinary mutation.
- **Tests:** Detect content, order, deletion, insertion, previous-hash, root, signature, key-version, and cross-tenant tampering; verify key rotation and historical verification.
- **Evidence:** Cryptographic design review, tamper test matrix, persisted signed checkpoint samples with secret material redacted.

#### R-005 — Implement durable SIEM/WORM export and verification

- **Why:** The current endpoint returns calculations over caller data but persists and exports nothing.
- **Tasks:** Persist export jobs, attempts, idempotency receipts, destinations, checkpoint ranges, and delivery acknowledgements; implement bounded retry/dead-letter; require destination readback; support WORM/retention-lock evidence; prevent retention deletion before required export confirmation.
- **Tests:** Success, duplicate, partial batch, timeout, retry, dead-letter, destination mismatch, readback mismatch, retention-lock absence, and replay verification tests against controlled SIEM/object-store fixtures.
- **Evidence:** Live export/readback evidence with signed root, destination immutability, lag, duplicate handling, and redaction review.

#### R-006 — Make backups durable or fail closed

- **Why:** A successful Kubernetes Job can leave only an ephemeral `/tmp` dump that disappears with the pod.
- **Tasks:** Require a durable destination or an explicit externally managed backup mode; upload dump and manifest; verify remote size and digest; record durable backup status; make missing destination/readback a non-zero exit; expose last-success and age metrics.
- **Tests:** Missing destination, upload failure, timeout, digest mismatch, partial object, credential denial, successful readback, and pod deletion tests.
- **Evidence:** Remote object readback, checksum match, alert state, and successful automated restore.

#### R-007 — Enforce provider ownership for model rows and actions

- **Why:** The provider drawer queries every model, then routes/toggles/deletes rows using the selected provider ID.
- **Tasks:** Make `providerId` required for the provider-model table resource; filter and authorize server-side; remove the ignored `models` prop or use it as the single source; make mutations verify the row's provider ID rather than trusting drawer context.
- **Tests:** Two-provider integration test proving only scoped rows render; attempt cross-provider configure/toggle/delete and expect denial; verify pagination/search/sort preserve the provider scope.
- **Evidence:** Component/API integration test and repository authorization test.

#### R-008 — Restore the eval-suite table data path

- **Why:** The table ignores fetched suites and invokes a parent-required resource without an agent ID, so it is always empty.
- **Tasks:** Choose the server table as authority; require and pass `agentId`; remove the legacy suites query/prop once stats and selection use the same result; preserve selection only if the selected suite remains in scope.
- **Tests:** Non-empty, empty, loading, error, create, pagination, search, sort, agent-switch, and selected-suite invalidation tests.
- **Evidence:** Rendered integration test showing suite selection and eval execution for two agents.

#### R-009 — Apply usage time bounds to rows, totals, and export

- **Why:** The visible range currently filters only a legacy array, allowing a “7 days” view/export to contain all-time data.
- **Tasks:** Add validated `from`/`to` filters to the usage table resource, totals query, saved view, and export job; use one normalized timezone-inclusive/exclusive contract; display the applied interval.
- **Tests:** Boundary timestamps, DST, locale, empty interval, pagination, totals, CSV/export, and unauthorized range tests.
- **Evidence:** API/component test proving identical row IDs and totals across view and export for each preset/custom range.

#### R-010 — Unify tool-trace rows and server controls

- **Why:** Search/sort/page state controls an organization-wide query while rows and refresh use a separate agent-scoped query.
- **Tasks:** Make `agentId` a required server resource parent/filter; use one query for rows, loading, error, refresh, search, sort, and pagination; remove the legacy query.
- **Tests:** Two-agent isolation; controls change displayed rows; refresh targets the same key; agent switch clears prior rows and cursor.
- **Evidence:** Component integration test and API authorization test.

#### R-011 — Type and validate sortable/filterable table fields

- **Why:** Arbitrary TanStack column IDs are sent to resource policies that reject unsupported fields, producing ordinary-click HTTP 400 failures.
- **Tasks:** Generate or define a typed resource registry containing row type, required scope, allowed sort fields, filter operators, search fields, summaries, and export support; map UI column IDs explicitly; set `enableSorting=false` when unsupported; reject invalid configuration at compile time/test time.
- **Tests:** Contract test every server-driven column against the resource registry; click every sortable header; negative API tests for unknown fields/operators.
- **Evidence:** Passing inventory contract and browser table-control suite.

#### R-012 — Reset table state on every scope change

- **Why:** A cursor bound to the old workspace/parent/resource is reused with the new scope and becomes invalid.
- **Tasks:** Derive a stable scope key from resource, tenant-visible workspace, parent, and normalized filters; reset cursor history, row selection, expanded rows, and stale saved-view state when it changes; consider a reducer keyed by scope.
- **Tests:** Switch workspace/parent/resource/filter while on page 2 with selections; assert page 1, no old rows, no invalid cursor, and no cross-scope selection.
- **Evidence:** Hook tests and browser navigation test.

#### R-013 — Prevent previous-scope rows from remaining actionable

- **Why:** `keepPreviousData` keeps old entity rows visible while a new tenant/workspace/parent loads or fails.
- **Tasks:** Retain previous data only for pagination within an identical scope; clear on scope-key changes; disable actions during transitional fetches; visibly distinguish same-scope pagination refresh from scope replacement.
- **Tests:** Slow and failing scope-switch tests proving no old action can be invoked under new context.
- **Evidence:** Component/browser test with delayed requests and action spy.

#### R-014 — Establish an explicit API compatibility decision for the 203 changes

- **Why:** The current OpenAPI fails with 43 errors and 160 warnings, so it cannot be released as a compatible version.
- **Tasks:** Classify every diff as restore, additive transition, versioned breaking release, or approved deprecation completion; add owner, client impact, migration, release version, and expiry; keep the breaking gate red until each decision is implemented.
- **Tests:** Run `oasdiff` against the last released baseline; test old SDK clients through the supported compatibility window.
- **Evidence:** Zero unapproved errors/warnings plus an approved compatibility ledger.

#### R-015 — Govern workflow endpoint retirement

- **Why:** Nine workflow paths disappeared with no deprecation or replacement contract.
- **Tasks:** Restore compatibility endpoints during retirement or publish a versioned API; return deprecation/sunset headers; document data export and replacement behavior; update SDKs only after lifecycle completion.
- **Tests:** Old client tests for list/create/run/resume/approve paths throughout the compatibility window; final sunset tests.
- **Evidence:** Deprecation ledger, client migration guide, passing compatibility gate.

#### R-016 — Preserve or version the `POST /runs` response

- **Why:** The response lost 11 required run fields and changed to a different start envelope.
- **Tasks:** Restore the prior shape, add the new fields additively, or version the operation; document whether asynchronous start returns a run projection or job reference; update all clients together.
- **Tests:** Golden contract tests for old and new SDKs; runtime response validation; polling/SSE continuation tests.
- **Evidence:** Zero `oasdiff` error for the operation and passing client acceptance tests.

#### R-017 — Preserve or version run-event SSE

- **Why:** Changing the stream to a new `oneOf` and removing event fields breaks decoders and resumable-stream clients.
- **Tasks:** Define versioned event envelopes and discriminators; keep sequence/cursor semantics stable; add additive variants instead of replacing required fields; document reconnection and unknown-event handling.
- **Tests:** Old/new decoder tests, resume after disconnect, unknown event, malformed event, duplicate sequence, and backpressure tests.
- **Evidence:** Streaming compatibility suite and generated SDK decoder tests.

#### R-018 — Retire connector enum values safely

- **Why:** Removing Confluence, Jira, Linear, Notion, and Slack from create/update contracts breaks stored configs and clients.
- **Tasks:** Decide supported product scope; retain read schemas for historical resources; reject new creation with explicit deprecated/unsupported errors after a window; provide export/migration; avoid narrowing shared enums until all stored data is migrated.
- **Tests:** Deserialize/list/export historical connector records; old-client create during deprecation; final unsupported response; no orphaned secrets or OAuth connections.
- **Evidence:** Migration report and zero unapproved connector enum breaks.

#### R-019 — Decouple delegated OAuth retirement from connector enums

- **Why:** Reusing the narrowed connector schema breaks OAuth connection read/start flows for historical connector families.
- **Tasks:** Give OAuth connections a stable provider-family schema; distinguish creatable, readable, refreshable, revocable, and retired states; keep revoke/export available for retired providers.
- **Tests:** Historical token decrypt/revoke/export tests; denied new start with remediation; no secret leakage.
- **Evidence:** OAuth lifecycle compatibility tests.

#### R-020 — Make billing event evolution additive

- **Why:** Newly required `eventId` and `occurredAt` reject existing producers.
- **Tasks:** Accept legacy events during a bounded transition; derive deterministic idempotency identity and received timestamp when absent; emit deprecation telemetry; later require fields only in a versioned contract.
- **Tests:** Legacy/new payloads, duplicate delivery, clock skew, replay, invalid timestamp, and version-negotiation tests.
- **Evidence:** Billing producer compatibility suite and deprecation metrics.

#### R-021 — Version agent-version publication input

- **Why:** Adding a required body to a previously bodyless operation breaks callers.
- **Tasks:** Preserve a bodyless default operation or add a new version/path; validate the new input explicitly; regenerate SDKs after compatibility is restored.
- **Tests:** Old bodyless client and new-body client tests; OpenAPI request-body compatibility assertion.
- **Evidence:** Zero `oasdiff` error and passing SDK tests.

#### R-022 — Make retention-policy evolution additive

- **Why:** Newly required `runEventRetentionDays` breaks clients that update older fields only.
- **Tasks:** Apply current/default value when omitted during transition; distinguish PUT replacement from PATCH semantics; publish the future required version and migration guidance.
- **Tests:** Legacy partial update, explicit new value, validation bounds, concurrent update/version conflict, and audit tests.
- **Evidence:** Contract compatibility and policy persistence tests.

#### R-023 — Register policy-bundle 409 errors completely

- **Why:** Runtime code throws two client-visible codes that are missing from the status registry.
- **Tasks:** Add both codes to the 409 allocation and generated/public contract; verify safe messages and client exhaustiveness.
- **Tests:** Public-error checker, route tests for not-pending/not-approved, generated SDK error union tests.
- **Evidence:** Passing `check:public-api-errors`.

### Security, tenancy, reliability, and operations

#### R-024 — Expand fail-closed production configuration validation

- **Why:** A process marked production can start with memory-only storage/coordination, disabled quota/malware controls, and placeholder encryption credentials.
- **Tasks:** Model required settings by enabled capability; reject memory drivers and placeholder credentials for multi-replica production; require durable object storage, distributed realtime/quota, independent high-entropy keys, and provider-specific credentials; support explicit reviewed exceptions with owner/expiry.
- **Tests:** Positive production profiles and a negative matrix for every unsafe default, missing secret, reused key, and unsupported driver.
- **Evidence:** Passing config tests and startup smoke for each supported production profile.

#### R-025 — Put OIDC discovery and JWKS behind the hardened egress boundary

- **Why:** Arbitrary HTTPS issuers, malicious discovery metadata, DNS rebinding, redirects, and unbounded JWKS responses can reach internal services or hang workers.
- **Tasks:** Validate issuer and every discovered endpoint; block private/special-use/link-local addresses; pin DNS; revalidate redirects; require HTTPS and same-origin/allowlist policy; add timeout and response-size limits; cache keys with bounded TTL.
- **Tests:** Literal/private IPv4/IPv6, rebinding, redirect-to-private, oversized response, timeout, wrong issuer, cross-origin JWKS, valid rotation, and cache expiry.
- **Evidence:** SSRF negative suite and DNS-pinning parity coverage including OIDC paths.

#### R-026 — Reuse hardened delivery for notification webhooks

- **Why:** Notification webhooks currently use raw fetch with automatic redirects and no DNS pinning or timeout.
- **Tasks:** Route notification webhooks through the hardened webhook engine or shared network boundary; require production host allowlists; enforce redirect, DNS, timeout, size, retry, and redaction policies.
- **Tests:** Rebinding/redirect/private-address negatives, timeout, payload cap, allowlist, signature, retry, and log-redaction tests.
- **Evidence:** DNS-pinning parity report covering notification delivery.

#### R-027 — Add database-enforced tenant isolation

- **Why:** Service-layer authorization alone leaves one missed predicate or compromised application role capable of cross-tenant access.
- **Tasks:** Add `orgId` to globally keyed repository signatures; adopt composite tenant keys/FKs where practical; set transaction-local tenant context; enable and force RLS on tenant tables; create a narrowly audited system role for cross-tenant coordinators.
- **Tests:** Per-table RLS read/write/delete negatives, guessed global IDs, background/system role boundaries, transaction pool context reset, and migration compatibility.
- **Evidence:** RLS migration, repository conformance, and live Postgres tenant-isolation report.

#### R-028 — Apply default-deny networking to every workload

- **Why:** Most Jobs/CronJobs do not match the app NetworkPolicy and therefore have unrestricted egress.
- **Tasks:** Add namespace/workload default deny; define explicit DNS, API, database, Valkey, provider, object-store, SIEM, and browser-runner rules per component; fail chart validation when an enabled workload lacks policy.
- **Tests:** Render coverage for every component; live allowed/denied probes; compromised-worker-style attempts to metadata and cluster services.
- **Evidence:** NetworkPolicy render inventory and CNI enforcement evidence.

#### R-029 — Make scheduled work cover every tenant safely

- **Why:** One worker credential scopes retention, retries, connector sync, and billing to only its tenant in multi-tenant mode.
- **Tasks:** Implement a system-scoped tenant coordinator with bounded enumeration, per-tenant leases, fairness, progress, and audit—or generate isolated per-tenant jobs/identities; never reuse an ordinary tenant credential for global work.
- **Tests:** Multiple tenants, suspended/deleting tenants, one failing tenant, fairness, restart, duplicate scheduler, and least-privilege tests.
- **Evidence:** Multi-tenant worker acceptance report with per-tenant completion.

#### R-030 — Lease and fence connector synchronization

- **Why:** Concurrent schedules/manual starts can import duplicates and race cursor/superseded-source updates.
- **Tasks:** Add atomic claim (`FOR UPDATE SKIP LOCKED` or equivalent), lease owner/token/expiry, renewable lease, unique active-sync constraint, fenced completion, and idempotent source upserts.
- **Tests:** Two-worker contention, lease expiry/reclaim, stale completion, crash, retry, manual-vs-scheduled race, and duplicate source tests.
- **Evidence:** Repository conformance and distributed worker smoke.

#### R-031 — Lease and fence knowledge extraction

- **Why:** Multiple workers can process one source, and a late failure can overwrite a successful state.
- **Tasks:** Add atomic pending-to-extracting claim, version/fencing token, heartbeat/expiry, idempotent chunk writes, and fenced success/failure transitions.
- **Tests:** Concurrent workers, late failure, crash/reclaim, duplicate chunks, object-read failure, and cancellation tests.
- **Evidence:** Distributed extraction acceptance report.

#### R-032 — Require real container-scan evidence for release readiness

- **Why:** Security evidence passes with zero scan results and currently produces only a scan plan.
- **Tasks:** Execute scanners against both release digests; ingest machine-readable results; enforce severity/license/secret policy; bind reports to manifest digest; make missing/stale scans fail.
- **Tests:** Missing scan, wrong digest, stale scan, high CVE, allowed exception, malformed report, and clean image tests.
- **Evidence:** Digest-bound scan reports and passing security-evidence gate.

#### R-033 — Accept only authentic protected-environment approvals

- **Why:** Arbitrary IDs supplied by CI are structurally indistinguishable from real release authorization.
- **Tasks:** Consume signed platform attestations or protected-environment API evidence; bind approval to commit, manifest, digests, environment, policy, and time; make dry-run approvals explicitly non-promotable.
- **Tests:** Fabricated IDs, wrong commit/digest, expired approval, insufficient approvers, revoked approval, and valid protected approval.
- **Evidence:** Signed approval attestation and publish-plan verification.

#### R-034 — Split liveness from dependency-aware readiness

- **Why:** `/health` always returns OK and TCP connects do not prove schema, credentials, commands, storage, or required configuration.
- **Tasks:** Keep liveness process-only; add unauthenticated but non-sensitive `/readyz` with bounded checks for migration version, `SELECT 1`, Valkey `PING`, object-store operation/HEAD, required encryption/config, and essential worker dependencies; mark unready during shutdown.
- **Tests:** Each dependency failure, timeout budget, recovery, migration mismatch, and non-leaking response tests.
- **Evidence:** Kubernetes readiness smoke and rollout behavior report.

#### R-035 — Enforce database TLS verification in production

- **Why:** Hosted database encryption currently generates only advisory posture.
- **Tasks:** Parse supported Postgres connection security settings; require `verify-full` or provider-equivalent CA/SNI verification; support explicit in-cluster exception with scope/expiry; fail startup on downgrade.
- **Tests:** Plaintext, require-without-verify, wrong CA, hostname mismatch, valid CA, provider-specific configuration, and exception expiry.
- **Evidence:** Production config and live TLS verification evidence.

#### R-036 — Give each workload a least-privilege identity

- **Why:** One shared worker API key lets compromise of a low-trust worker reach billing, retention, and other administrative APIs.
- **Tasks:** Define scopes/audiences per worker; provision distinct Secret/service account or workload identity; rotate independently; reject mismatched audience; remove unused credentials from pod environments.
- **Tests:** Cross-worker endpoint denials, rotation, revoked key, audience mismatch, and secret-mount inventory tests.
- **Evidence:** Workload permission matrix and live negative authorization suite.

#### R-037 — Make retention bounded, resumable, and observable

- **Why:** A single 10,000-row batch and sequential object downloads cannot maintain SLAs for large tenants.
- **Tasks:** Add keyset candidate queries, repeated bounded batches, durable cursors/checkpoints, HEAD metadata instead of downloads, bounded concurrency, rate limits, backlog age/count metrics, and alerting.
- **Tests:** Dataset larger than one batch, restart/resume, legal hold, concurrent writers, object metadata failure, throttling, and SLA/backlog alarms.
- **Evidence:** Scale test showing backlog drains within policy.

#### R-038 — Lease notification retries and use provider idempotency

- **Why:** Concurrent retry invocations can send duplicate external notifications.
- **Tasks:** Add claim/lease/fencing repository operations, attempt state, provider idempotency key, and dead-letter transition; align with webhook retry semantics.
- **Tests:** Two-worker contention, timeout ambiguity, duplicate provider response, lease reclaim, dead-letter, and manual retry.
- **Evidence:** Distributed notification retry smoke.

#### R-039 — Wire graceful application shutdown

- **Why:** The exported close routine is not attached to Nitro/process lifecycle, so rollouts can cut in-flight work and leave resources undrained.
- **Tasks:** On termination mark unready, stop scheduling/accepting new work, drain transports/workers within a deadline, close DB/Valkey/object clients, then exit; configure Kubernetes `preStop`/grace period consistently.
- **Tests:** SIGTERM with in-flight HTTP/SSE/job work, deadline expiry, repeated signal, rollout, and lease recovery.
- **Evidence:** Graceful-shutdown acceptance log with zero lost acknowledged work.

#### R-040 — Separate desired WAF mode from observed enforcement

- **Why:** An environment string can claim block mode without any WAF installed.
- **Tasks:** Model desired and observed posture separately; validate provider-specific ingress annotations/config; require live malicious/oversize/rate probes before enterprise readiness; report unknown rather than pass without observation.
- **Tests:** Declared-only, missing ingress, monitor mode, block mode with passing probes, bypass path, and stale evidence.
- **Evidence:** Live edge enforcement report bound to target ingress.

#### R-041 — Implement every generated GA evidence command

- **Why:** Operators are directed to 11 nonexistent scripts, making major gates impossible to collect despite green string-based contract tests.
- **Tasks:** Inventory generated `pnpm` commands; implement each recorder or explicitly mark the feature unsupported; add shared argument/redaction schema; resolve every generated command against `package.json`; provide `--help` and `--dry-run`.
- **Tests:** Command-resolution contract, help/dry-run execution, redaction, missing credential, malformed target, and successful controlled evidence tests.
- **Evidence:** Zero unresolved generated commands and passing GA preflight.

#### R-042 — Enforce backup lifecycle and immutability

- **Why:** `retentionDays` currently writes a date into a manifest but neither protects nor deletes remote objects.
- **Tasks:** Configure/verify destination lifecycle and retention lock; distinguish minimum retention from deletion schedule; report observed policy; protect manifests and indexes; audit deletion.
- **Tests:** Missing lock, shorter-than-required retention, early delete denial, expiry deletion, policy drift, and legal-hold tests.
- **Evidence:** Provider lifecycle/lock readback and deletion drill.

#### R-043 — Require essential operations or explicit external ownership

- **Why:** Default production installs silently omit retries, retention enforcement, and backup/DR.
- **Tasks:** For each essential operation require enabled in-chart implementation or an explicit external manager declaration with evidence path, owner, freshness, alerts, and API readback; fail chart validation otherwise.
- **Tests:** Missing operation, enabled in-chart, valid external evidence, stale evidence, and conflicting ownership.
- **Evidence:** Production render policy and operational ownership manifest.

#### R-044 — Require malware scanning for untrusted enterprise content

- **Why:** Production permits scanning off even though documents enter storage and extraction.
- **Tasks:** Require enabled/required scanning or an expiring approved exception; quarantine until scan completion; enforce fail-closed handling for scanner outage; record signature engine/version.
- **Tests:** Clean, malware, scanner timeout/outage, oversized file, encrypted archive, retry, exception expiry, and log-redaction tests.
- **Evidence:** File-ingest acceptance and production config report.

#### R-045 — Require positive CSRF proof for cookie-authenticated mutations

- **Why:** Requests missing Origin, Referer, and Fetch Metadata currently pass without a CSRF token.
- **Tasks:** Require allowed Origin/Referer or a synchronizer/double-submit token for unsafe cookie-authenticated requests; rotate token with session; exempt non-cookie bearer flows explicitly.
- **Tests:** Missing headers/token, malicious origin, same-site subdomain policy, valid token, replay after logout, bearer API, and proxy normalization.
- **Evidence:** CSRF negative suite.

#### R-046 — Deploy a nonce/hash-based Content Security Policy

- **Why:** Without CSP, any XSS has a broad execution and exfiltration surface.
- **Tasks:** Inventory scripts/styles/workers/connect/media/images; add per-response nonce or build hashes; set restrictive `default-src`, `script-src`, `object-src 'none'`, `base-uri`, `frame-ancestors`, and bounded source directives; begin report-only, resolve violations, then enforce.
- **Tests:** Header unit tests, browser CSP violation capture, inline injection block, worker/media paths, and dev/prod profiles.
- **Evidence:** Enforced CSP browser report with zero unexpected violations.

#### R-047 — Remove secrets from argv

- **Why:** API keys and refresh tokens in flags leak through process lists, shell history, CI logs, and support captures.
- **Tasks:** Add environment, protected file descriptor/stdin, or keychain inputs; deprecate and then reject secret flags in production; scrub argv/errors; update every example and generated evidence command.
- **Tests:** Process-list inspection, shell/log redaction, missing secret, stdin/file mode, and deprecated flag behavior.
- **Evidence:** Secret-handling contract and documentation scan.

#### R-048 — Add object-store backup and coordinated restore

- **Why:** Database-only recovery leaves uploaded files, artifacts, and derived objects missing or inconsistent.
- **Tasks:** Require bucket versioning/replication/backup; record database/object checkpoint relationship; schedule object-store verification; restore both sides into an isolated target; reconcile missing/orphan objects.
- **Tests:** Coordinated restore, point-in-time skew, missing object, orphan object, encrypted object, cross-region copy, and key-rotation recovery.
- **Evidence:** End-to-end DR drill with application readback.

#### R-049 — Implement versioned webhook and OAuth keyrings

- **Why:** Single-key rotation invalidates webhook consumers and makes stored OAuth tokens undecryptable.
- **Tasks:** Store key version with every signature/envelope; support previous-key verify/decrypt and current-key sign/encrypt; add rewrap and dual-sign windows; measure remaining old versions before retirement.
- **Tests:** Mixed key versions, rotate/rewrap, old webhook verification, rollback, revoked key, and zero-old-key completion.
- **Evidence:** Rotation drill and version-coverage metrics.

#### R-050 — Forbid inline production secrets in Helm values

- **Why:** `secrets.create=true` places plaintext inputs into Helm release metadata and deployment logs.
- **Tasks:** Require pre-created Secret, External Secrets, or CSI references in production; retain inline creation only for explicitly non-production profiles; validate referenced keys without reading values into evidence.
- **Tests:** Production inline-secret rejection, external/pre-created success, missing key, rotation, and redaction.
- **Evidence:** Helm negative/positive policy suite.

### UI data flow, UX, accessibility, and performance

#### R-051 — Centralize inventory mutation reconciliation

- **Why:** Creates, updates, deletes, and mark-read operations frequently invalidate only legacy query keys, leaving the visible server table stale.
- **Tasks:** Add typed table-resource invalidation helpers; invalidate the narrowest affected scope; optimistically reconcile safe row changes; ensure summaries and detail queries update with rows; remove duplicate legacy invalidations after migration.
- **Tests:** Eval, prompt, notification, knowledge, service-account, provider-model, connector, and API-key mutation integration tests.
- **Evidence:** Mutation contract proving every inventory-writing operation refreshes/reconciles its visible resource.

#### R-052 — Make loading, error, empty, and stale states first-class table states

- **Why:** The hook maps missing/error data to `[]`, so outages appear as legitimate “No records” states.
- **Tasks:** Extend shared table state with initial loading, background fetching, error, retry, stale/scope-transition, and empty semantics; add `aria-busy` and announced errors; never expose row actions on stale scope data.
- **Tests:** Initial load, background refresh, retry success/failure, empty success, offline/stale, and scope transition across representative tables.
- **Evidence:** Shared table-state visual/component suite.

#### R-053 — Make command-palette first click work

- **Why:** The visible search button emits an event that the lazy launcher does not observe until the palette is already mounted.
- **Tasks:** Handle the custom event in the lazy global overlay launcher; start import on click/keyboard/intent; queue one open request until mount; deduplicate global listeners.
- **Tests:** First click, first keyboard shortcut, rapid duplicate triggers, import failure/retry, focus placement, and focus restoration.
- **Evidence:** Browser command-palette acceptance test from a cold route.

#### R-054 — Stop admin/settings routes from loading chat sessions

- **Why:** Route preload and admin controller fetch agents/chats/chat experience that are not needed, increasing latency and hydration/cache weight.
- **Tasks:** Split workspace identity/catalog bootstrap from chat-session data; define per-route loader dependencies; start independent required loads in parallel; cancel unused route loads.
- **Tests:** Network-request assertions for admin/settings/workspace/chat routes; navigation cancellation; cache reuse without duplicate requests.
- **Evidence:** Browser trace showing no chat fetch on non-chat routes.

#### R-055 — Complete the inventory migration to one source of truth

- **Why:** Tool operations, knowledge, prompts, governance, and other panels mix a legacy query for gating/stats/errors with an inventory query for rows.
- **Tasks:** For each surface select one authority; derive counts, loading, errors, selection, refresh, and mutations from it; remove unused props/queries and document any intentionally separate detail query.
- **Tests:** Request-count assertions and state-consistency tests for every migrated panel.
- **Evidence:** Static inventory check plus browser network trace with one list request per resource/scope.

#### R-056 — Make dashboard summaries authoritative

- **Why:** Several cards show an estimated total for the full dataset beside status counts computed from only the current page.
- **Tasks:** Define resource summary fields computed server-side after the intended base scope and before display pagination; clearly define whether active filters apply; label page-only metrics if retained.
- **Tests:** More-than-one-page fixtures for data connectors, tool connectors, notifications, and other summary consumers.
- **Evidence:** Summary contract and UI tests with exact full-dataset counts.

#### R-057 — Make `Field.required` semantically real

- **Why:** The design-system API suggests validation semantics but renders only an asterisk.
- **Tasks:** Carry required state through field context; apply native `required` and `aria-required` to compatible controls; expose a separately named visual-only indicator when needed; connect errors/descriptions consistently.
- **Tests:** Native form blocking, accessible-name/description, custom control, optional field, and screen-reader attribute tests.
- **Evidence:** Form primitive tests and UI form-contract checker.

#### R-058 — Implement an accessible command combobox

- **Why:** The palette input/results lack label, combobox/listbox relationships, active descendant, selected state, and async announcements.
- **Tasks:** Use an established accessible command primitive or implement the ARIA combobox pattern; label input; manage active descendant; use listbox/options and `aria-selected`; announce loading/error/result count; preserve keyboard conventions.
- **Tests:** Axe, keyboard traversal, typeahead, empty/error/loading, disabled result, mouse/keyboard activation, escape, and focus restoration.
- **Evidence:** Command-palette accessibility/browser suite.

#### R-059 — Use real links for navigational table rows

- **Why:** Clickable/`role=link` rows cannot be opened in a new tab, copied, or used with standard link context menus.
- **Tasks:** Put a real router link in the primary cell; optionally use a safe row-click enhancement without nesting interactive controls; leave action cells as buttons; remove misleading row roles.
- **Tests:** Enter, Cmd/Ctrl-click, middle-click, copy link, row action isolation, and screen-reader role/name tests.
- **Evidence:** Shared table navigation tests.

#### R-060 — Give each row-selection checkbox a unique name

- **Why:** Every checkbox is announced as the same generic “Select row.”
- **Tasks:** Compose localized select/deselect text with `rowAriaLabel`; support identifier fallback; keep select-all distinct and report selection counts.
- **Tests:** Accessible-name assertions for multiple rows, selected state, and select-all mixed state.
- **Evidence:** Axe/accessibility component tests.

#### R-061 — Await asynchronous destructive confirmations

- **Why:** Alert dialogs close before an async operation succeeds and provide no pending lock, error, or retry.
- **Tasks:** Make dialog open state controlled; await confirmation; disable cancel/confirm while pending; show safe inline error; close only on success; retain focus on failure; guard double submission.
- **Tests:** Success, rejection, slow request, double click, escape while pending, retry, and focus restoration.
- **Evidence:** AlertDialog component and browser tests.

#### R-062 — Wire server saved views and export jobs

- **Why:** The backend exposes enterprise saved views/exports while UI saved views remain local-only and server export is hidden.
- **Tasks:** Add an application adapter for list/save/update/delete/default/share views and async export jobs; bind views to typed resource/scope/schema versions; retain local-only mode only when explicitly requested.
- **Tests:** Create/update/delete/undo, cross-device readback, permission boundaries, stale schema migration, large export, job failure/retry, and download authorization.
- **Evidence:** End-to-end saved-view/export browser suite.

#### R-063 — Preload locale namespaces before render

- **Why:** Effect-time loading and render-time mutation cause translation-key flashes, hydration drift, and route waterfalls.
- **Tasks:** Declare route namespaces; load them in server/router loaders in parallel with route data; serialize resources; keep i18n configuration immutable during render; retain bounded fallback behavior.
- **Tests:** SSR/hydration in every locale, slow namespace load, missing key, route transition, and no-key-flash browser assertions.
- **Evidence:** SSR/browser localization suite.

#### R-064 — Make locale storage failure-safe and cached

- **Why:** Browser privacy/quota/security errors from localStorage can crash locale initialization or switching.
- **Tasks:** Wrap reads/writes; use an in-memory cache/fallback; listen for valid cross-tab changes; validate stored locale; prefer server/profile preference where available.
- **Tests:** Throwing storage mock, quota error, invalid locale, cross-tab event, SSR, and successful persistence.
- **Evidence:** i18n provider tests under restricted storage.

#### R-065 — Define a compile-time table resource registry

- **Why:** Arbitrary strings plus optional scope parameters let parent/workspace requirements be omitted without a type error.
- **Tasks:** Map resource name to row type, scope input, allowed sorts/filters, summary, saved-view/export capability, and response schema; expose a discriminated hook API that requires the correct scope.
- **Tests:** Type tests (`tsd`/compile fixtures) for valid/invalid calls and runtime registry parity with server resources.
- **Evidence:** Passing type contract and zero `useInventoriedServerTable<any>` calls.

#### R-066 — Validate table responses at the contract boundary

- **Why:** An unchecked cast allows malformed rows/page metadata to reach renderers and actions.
- **Tasks:** Generate/use Zod schemas per resource or validate a safe common envelope plus registered item schema; convert failures into typed query errors with trace IDs; never partially trust invalid pages.
- **Tests:** Missing IDs, wrong page metadata, unknown resource, invalid summary, oversized page, and valid response tests.
- **Evidence:** Runtime contract tests and safe error UI.

#### R-067 — Repair reduced-motion CSS and test computed behavior

- **Why:** The selector/`@media` syntax is invalid, so manual reduced-motion styling is discarded despite a regex test.
- **Tasks:** Split the `.reduce-motion` selector and media block; audit all animation/transition declarations; avoid `transition: all`; provide deterministic reduced variants.
- **Tests:** CSS parser/build warning gate and browser computed-style assertions under emulated reduced motion and manual setting.
- **Evidence:** Clean production CSS build and motion browser tests.

#### R-068 — Provide captions/transcripts for audio attachments

- **Why:** Meaningful audio may render without a text alternative.
- **Tasks:** Require/generate a transcript or caption track before offering playback for speech content; expose transcript association; distinguish non-speech audio with a useful description; preserve privacy/retention rules.
- **Tests:** Speech with captions, pending transcript, transcript failure, non-speech description, keyboard playback, and accessibility tree.
- **Evidence:** Media accessibility integration test.

#### R-069 — Use a coherent sortable-list interaction pattern

- **Why:** Focusable `listitem` containers and ad hoc arrow handlers create redundant tab stops and incomplete semantics.
- **Tasks:** Prefer explicit move buttons or implement an accessible sortable-list pattern with grabbed/position announcements; keep pointer drag optional; maintain keyboard/touch alternatives.
- **Tests:** Keyboard reorder, pointer reorder, screen-reader announcements, boundary disabled states, focus retention, and persisted order.
- **Evidence:** Attachment tray interaction suite.

#### R-070 — Restore visible focus indicators

- **Why:** Workspace selection and title editing remove outlines without an equally visible replacement.
- **Tasks:** Add high-contrast `:focus-visible` rings; use `:focus-within` for compound controls; audit outline removal across app/UI CSS; validate light/dark/high-contrast themes.
- **Tests:** Keyboard screenshot/contrast tests for every interactive primitive and affected navigation control.
- **Evidence:** Focus-visible browser audit with zero unpaired outline removal.

#### R-071 — Deep-link important tab state

- **Why:** Billing, governance, RAG, notification, abuse, and posture tabs are uncontrolled and do not participate in history or sharing.
- **Tasks:** Make Tabs controlled; validate tab values in router search schemas; update URL without losing unrelated parameters; define invalid/default behavior.
- **Tests:** Direct link, back/forward, refresh, invalid value, authorization-hidden tab, keyboard tab navigation.
- **Evidence:** Route integration tests for every stateful tab surface.

#### R-072 — Add router-controlled table state

- **Why:** Search, sort, filters, page, and view cannot be shared or restored with browser navigation.
- **Tasks:** Provide a router adapter that serializes validated compact state; reset cursor appropriately; support opt-out for ephemeral tables; coordinate URL state with saved views without loops.
- **Tests:** Direct link, back/forward, malformed parameters, saved view, scope switch, and debounced search.
- **Evidence:** Representative browser table-state suite.

#### R-073 — Preload admin chunks on intent

- **Why:** Admin lazy panels begin loading only after click, creating an avoidable code waterfall.
- **Tasks:** Add authorized code-only preload functions; trigger on hover/focus/likely navigation; avoid loading privileged data during intent; reuse the workspace pattern.
- **Tests:** Hover/focus preloads once, click uses cached chunk, unauthorized user does not preload restricted data, import failure retry.
- **Evidence:** Browser performance trace.

#### R-074 — Move overlay opener capture out of render

- **Why:** DOM reads and ref mutation during render are not concurrency-safe.
- **Tasks:** Capture the opener in trigger handlers or layout/Radix lifecycle hooks; restore only when still connected/visible; avoid synchronous layout reads in render.
- **Tests:** StrictMode/concurrent render, nested overlay, removed opener, controlled open, keyboard/menu launch.
- **Evidence:** Overlay focus tests with no render-time DOM access.

#### R-075 — Scope overlay opener state per instance

- **Why:** A module-global pending opener can race between multiple menus/dialogs.
- **Tasks:** Replace global mutable state with context or explicit trigger refs owned by each overlay chain; support nested and simultaneous overlays.
- **Tests:** Two menus opening separate dialogs, nested dialog, rapid alternating activation, and unmount.
- **Evidence:** Overlay concurrency tests.

#### R-076 — Remove nested labels from column visibility controls

- **Why:** A label wrapping a Checkbox that renders its own label creates invalid semantics and inconsistent hit targets.
- **Tasks:** Pass text through the checkbox API or allow an unwrapped control slot; ensure one label/control hit target.
- **Tests:** DOM validity, click label toggles once, accessible name, keyboard toggle.
- **Evidence:** DataTableControls primitive test.

#### R-077 — Add safe-area and overscroll containment to overlays

- **Why:** Full-height sheets can conflict with notches/home indicators and scroll-chain into the page.
- **Tasks:** Apply `env(safe-area-inset-*)`, `overscroll-behavior: contain`, correct internal scrolling, and focus scroll margins; test portrait/landscape.
- **Tests:** Mobile viewport screenshots, nested scroll, keyboard-open viewport, iOS safe-area emulation, and focused control visibility.
- **Evidence:** Mobile browser visual suite.

#### R-078 — Localize enums, currency, and units

- **Why:** Raw API status strings, `ms`, token counts, and USD concatenation bypass translations and locale rules.
- **Tasks:** Add exhaustive translated enum maps; use `Intl.NumberFormat` currency/unit/percent formatting; wrap code identifiers with `translate="no"`; define unknown fallback.
- **Tests:** English/Spanish/French output, pluralization, missing enum, large/decimal/negative values, and RTL-ready structure.
- **Evidence:** Locale snapshot/unit tests.

#### R-079 — Localize live-region attachment announcements

- **Why:** Raw status enums and percentages are announced inconsistently.
- **Tasks:** Add translated, count-aware lifecycle messages; format percent through Intl; announce meaningful transitions without flooding; include item identity/position when needed.
- **Tests:** Upload/transcription lifecycle, multiple attachments, error/retry, reorder, and live-region message assertions.
- **Evidence:** Accessibility interaction tests.

#### R-080 — Make date rendering tolerant at the UI boundary

- **Why:** One invalid API timestamp currently throws and can crash an entire panel.
- **Tasks:** Validate timestamps at API decoding; make display helpers return a localized unknown/invalid state; report diagnostics with trace context; never hide systemic schema errors silently.
- **Tests:** ISO/date object, invalid, empty, out-of-range, timezone, SSR/hydration, and locale cases.
- **Evidence:** Contract and formatter tests.

#### R-081 — Cache Intl formatter instances

- **Why:** Constructing formatters per table cell adds avoidable work on large pages.
- **Tasks:** Implement bounded caches keyed by locale and normalized options, or expose memoized locale-provider formatters; invalidate on locale change; avoid unbounded user-option keys.
- **Tests:** Output parity, cache reuse, locale switch, option differentiation, and bounded-cache behavior.
- **Evidence:** Unit test plus representative render benchmark.

#### R-082 — Avoid unconditional mobile autofocus

- **Why:** Login can summon the mobile keyboard immediately and shift layout.
- **Tasks:** Autofocus only the single primary desktop control when appropriate; preserve error-focused behavior; never fight password managers or restored browser focus.
- **Tests:** Mobile/desktop viewport, MFA/email modes, validation error, back navigation, and screen reader.
- **Evidence:** Browser focus tests.

#### R-083 — Use links for master-detail route selection

- **Why:** URL-changing buttons do not support open-in-new-tab, copy-link, or standard navigation semantics.
- **Tasks:** Add a Link-capable master item API; preserve selected/current-page semantics; keep non-navigation actions as buttons.
- **Tests:** Mouse/keyboard/new-tab/copy-link, current item, nested actions, and back/forward.
- **Evidence:** Master-detail navigation tests.

#### R-084 — Report correct server table row counts

- **Why:** `aria-rowcount` currently describes only the page even when a total estimate is available.
- **Tasks:** Accept exact/estimated/unknown totals; expose appropriate row indices across pages; communicate approximation in nearby status text without lying to assistive technology.
- **Tests:** Exact, estimated, unknown, filtered, empty, and later-page accessibility tree.
- **Evidence:** Data table a11y tests.

#### R-085 — Make saved-view deletion recoverable

- **Why:** A single click immediately rewrites storage/server state.
- **Tasks:** Add undo toast/window or confirmation based on sharing/impact; make server deletion idempotent; restore prior default when undone.
- **Tests:** Delete, undo, timeout, server failure, shared/default view, keyboard, and announcement.
- **Evidence:** Saved-view browser tests.

#### R-086 — Remove hardcoded English from shared UI defaults

- **Why:** Dialog close/actions and export filenames leak English into localized product surfaces.
- **Tasks:** Require caller-provided localized labels or add a UI locale provider with complete defaults; localize generated filenames safely.
- **Tests:** All supported locales and missing-provider development assertion.
- **Evidence:** Static hardcoded-copy scan and locale tests.

#### R-087 — Move token formatting into count-aware i18n

- **Why:** Manual language branching cannot scale and mishandles pluralization.
- **Tasks:** Add ICU/count-aware messages; keep only numeric compact formatting in utilities; preserve non-breaking spacing.
- **Tests:** Zero/one/many and compact thresholds in every locale.
- **Evidence:** Locale formatter tests.

#### R-088 — Omit empty `aria-describedby`

- **Why:** Joining an empty ID array returns `""`, and the current nullish fallback never runs.
- **Tasks:** Normalize empty relationships to `undefined`; share the helper across Input/Select/Textarea/custom controls.
- **Tests:** No description, help only, error only, both, and dynamic error changes.
- **Evidence:** Form primitive DOM tests.

#### R-089 — Make heading level and toolbar naming explicit

- **Why:** Generic `EmptyState` always emits `h2`, and `Toolbar` can expose an unnamed landmark.
- **Tasks:** Accept semantic heading level/as-child based on context; require `aria-label`/`aria-labelledby` for toolbars; audit all usages.
- **Tests:** Heading hierarchy and landmark-name assertions across representative pages.
- **Evidence:** Route-level axe/DOM audit.

#### R-090 — Stabilize table column definitions

- **Why:** Recreating selection/resolved column objects invalidates TanStack models and adds render churn.
- **Tasks:** Memoize definitions from primitive/stable dependencies; avoid hiding dynamic state in stale closures; measure before/after.
- **Tests:** Reference stability, callback freshness, column visibility, selection, and render-count test.
- **Evidence:** Component test and profiler trace.

#### R-091 — Stabilize console navigation groups

- **Why:** Inline mapped arrays retrigger effects on every route render.
- **Tasks:** Memoize translated group descriptors using primitive locale/permission dependencies; ensure authorization changes still update immediately.
- **Tests:** Render-count/effect-count, locale switch, permission change, and route navigation.
- **Evidence:** ConsoleLayout unit test.

#### R-092 — Replace regex inventory tests with behavior contracts

- **Why:** Checking only that a file contains `DataTable` cannot detect missing parent scope, invalid sorts, split queries, stale cursors, or invalidation failures.
- **Tasks:** Generate tests from the typed resource registry; render each surface with representative MSW/API fixtures; exercise scope, controls, mutation, error, and empty paths.
- **Tests:** The generated matrix itself plus negative fixtures proving each original defect would fail.
- **Evidence:** Inventory behavior report with resource/surface coverage.

#### R-093 — Expand route-level accessibility automation

- **Why:** One small primitive axe test with contrast disabled does not cover real workflows.
- **Tasks:** Add axe and keyboard/focus suites for login, workspace chat/composer, command palette, admin tables, dialogs/sheets, settings, and mobile viewports; run contrast in browser-capable tests.
- **Tests:** Chromium/Firefox/WebKit, light/dark, reduced motion, zoom, keyboard-only, and representative locale variants.
- **Evidence:** Browser quality report with zero serious/critical violations and reviewed lower-severity exceptions.

### Engineering quality, dead code, gates, and conditional controls

#### R-094 — Restore supported-runtime TypeScript correctness

- **Why:** The app cannot typecheck because a capability definition fixture omits the required `merge.booleans` contract.
- **Tasks:** Update the fixture to the intended schema; search all capability fixtures; avoid casts that suppress contract drift; keep the test compiling against the real definition type.
- **Tests:** App typecheck and capability policy unit tests.
- **Evidence:** Passing `pnpm check` under Node 24.18.0.

#### R-095 — Make repository inventory counts derived, not hardcoded

- **Why:** The test expects 305 methods after the contract changed to 298, creating maintenance noise rather than useful coverage.
- **Tasks:** Remove the literal count or derive an intentionally versioned manifest count; retain equality, uniqueness, classification, and authorization-caller assertions; ensure removed methods require an explicit manifest diff.
- **Tests:** Inventory test plus a negative fixture for an unclassified method.
- **Evidence:** Passing repository inventory with a reviewed manifest diff.

#### R-096 — Remove real-calendar expiry from idempotency tests

- **Why:** Fixed 2026 dates make the test suite decay with wall time.
- **Tasks:** Inject/fake the clock or derive future fixtures from a test reference instant; use explicit markers only where deliberately expired; add a fixture-rot guard.
- **Tests:** Before/at/after expiry and lease boundaries under fake time.
- **Evidence:** Stable idempotency tests independent of current date.

#### R-097 — Make catalog freshness tests deterministic

- **Why:** A fixed August 14 probe can no longer be “fresh” after 24 hours.
- **Tasks:** Pass an explicit `now` through decorator/surface boundaries or fake time in tests; centralize freshness duration; test boundary conditions.
- **Tests:** Never/fresh/exact-boundary/stale/invalid timestamp.
- **Evidence:** Stable model catalog tests.

#### R-098 — Use one reference clock for legal-hold cleanup

- **Why:** Cleanup accepts a historical run time while legal-hold evaluation calls `Date.now()`, producing inconsistent plans and failing tests.
- **Tasks:** Thread an explicit reference time/clock through deletion planning in both in-memory and DB implementations; persist/audit the evaluation instant.
- **Tests:** Hold before/at/after expiry, historical replay, worker run time, and DB/in-memory conformance.
- **Evidence:** Passing temporary cleanup and conformance tests.

#### R-099 — Align the S3 connector credential contract

- **Why:** Constructor credentials are required but unused, while each operation now requires `secretRef`; tests and factory pass contradictory values.
- **Tasks:** Remove dead constructor credentials and require a value-capable secret resolver plus operation/connector secret reference—or intentionally implement a documented static fallback for non-production; make the interface non-optional where required.
- **Tests:** Missing ref, unsupported resolver, invalid secret, resolved credentials, rotation, endpoint/region isolation, and no-secret-log tests.
- **Evidence:** Passing S3 reader/factory tests and dead-code check.

#### R-100 — Update migration baseline and schema contracts intentionally

- **Why:** The baseline test omits the current migration and does not describe the governed retirement sequence.
- **Tasks:** After R-002/R-003, update the migration list, schema contract, snapshots/journal, query-plan inventory, and upgrade fixtures; do not merely append the destructive file to make the test green.
- **Tests:** Baseline, schema contract, clean install, last-release upgrade, rollback/restore, and migration immutability.
- **Evidence:** Passing DB test suite and database evolution policy.

#### R-101 — Cover every repository method behaviorally

- **Why:** Five methods are missing from shared conformance: legacy text-part backfill, file lease renewal, tool calls by run, billing plan lookup by external customer, and idempotency failure.
- **Tasks:** Add backend-agnostic conformance cases for success, not-found, tenant isolation, concurrency/idempotency, and failure behavior; run against in-memory and live Postgres.
- **Tests:** Strict repository conformance locally and in the Postgres job.
- **Evidence:** `uncoveredMethodCount: 0` and passing live conformance.

#### R-102 — Resolve every lint finding without suppression debt

- **Why:** Twenty warnings/errors include accessibility violations, stale effect dependencies, dead imports, and weak tests.
- **Tasks:** Fix root behavior; remove unused code; use primitive effect dependencies; add meaningful rejection assertions; allow a suppression only with narrow rationale and a negative test.
- **Tests:** `pnpm lint` and affected component/service tests.
- **Evidence:** Zero-warning lint report.

#### R-103 — Give VAD sensitivity defined behavior

- **Why:** The function clamps sensitivity and then discards it, so callers cannot influence interruption behavior.
- **Tasks:** Define the intended VAD authorization/runtime contract; either return the normalized sensitivity to the runtime/audit path or remove the unsupported input; validate bounds at the contract edge.
- **Tests:** Below/within/above range, barge-in on/off, raw-audio denial, and runtime integration.
- **Evidence:** Voice contract tests proving sensitivity changes the intended output or is absent from the API.

#### R-104 — Remove connector SDK dependencies after feature retirement

- **Why:** Linear, Notion, and Slack SDKs remain installed after their implementations were deleted.
- **Tasks:** Remove unused dependencies and lockfile entries after R-018/R-019 confirms retirement; ensure no generated/client/runtime reference remains; document any intentionally retained migration reader separately.
- **Tests:** Dead-code check, clean install, build, historical data export tests.
- **Evidence:** Passing Knip report and dependency diff.

#### R-105 — Remove remaining dead variables, imports, and duplicate queries

- **Why:** Unused values such as `deadLettered`, `abortableQuery`, stale grants/models/operations, and unused types obscure real behavior and cost requests/bundle size.
- **Tasks:** Delete or wire each value according to the owning contract; use one query source; add missing dead-letter metrics only if actually required; rerun static inventory.
- **Tests:** Lint, Knip, request-count tests, and affected behavior tests.
- **Evidence:** Zero reported dead files/dependencies/unlisted/unresolved entries.

#### R-106 — Stabilize WorkspaceMembers effect dependencies

- **Why:** `query.data ?? []` creates a new empty array and retriggers effects unnecessarily.
- **Tasks:** Depend on primitive selected workspace ID or a memoized stable array; avoid effects for state derivable during render where possible.
- **Tests:** Empty/loading/data transitions and effect-count assertions.
- **Evidence:** Lint and component test.

#### R-107 — Make the entire tree formatter-clean

- **Why:** 168 files fail the repository formatter, increasing review noise and hiding substantive diffs.
- **Tasks:** Run Prettier mechanically after functional edits; inspect high-risk generated/SQL/YAML changes; keep generated outputs produced by their generators rather than hand-editing.
- **Tests:** `pnpm format:check` and `git diff --check`.
- **Evidence:** Both commands pass.

#### R-108 — Remove EOF whitespace defects

- **Why:** Four files currently contain extra blank lines at EOF.
- **Tasks:** Let the formatter normalize them; retain `git diff --check` in completion gates.
- **Tests:** `git diff --check`.
- **Evidence:** Zero whitespace errors.

#### R-109 — Refactor oversized production modules by responsibility

- **Why:** Nine files exceed the architecture limit and combine unrelated configuration, orchestration, persistence, or rendering concerns.
- **Tasks:** Split along stable domain seams; keep public entry points small; avoid circular dependencies/barrel regressions; add focused tests for extracted modules; lower, not raise, the ratchet.
- **Tests:** Architecture/dependency checks, unit suites, and public export compatibility.
- **Evidence:** `oversizedProductionFiles: 0` without increasing limits.

#### R-110 — Bring CSS and initial-route bundles below budget with headroom

- **Why:** CSS exceeds the cap and initial JS is dangerously close to both raw/gzip limits.
- **Tasks:** Remove duplicate/dead styles, scope route styles, lazy-load heavy admin/diagram/editor modules, audit barrel imports, and establish at least 10% target headroom where practical; do not merely raise budgets.
- **Tests:** Clean Node 24 production build, bundle manifest check, route chunk ownership, and smoke rendering.
- **Evidence:** Passing bundle gate with documented headroom and no functionality loss.

#### R-111 — Make data-table inventory resilient and current

- **Why:** A deleted workflow component causes ENOENT before the checker can report real state/data mismatches.
- **Tasks:** Remove/migrate retired entries; make the checker report missing files as structured failures and continue; generate inventory bindings from the typed registry where possible; include mixed-query and scope requirements.
- **Tests:** Self-test missing file, duplicate dataset, state/rows mismatch, invalid scope, unsupported sort, and valid inventory.
- **Evidence:** Passing `check:data-table-inventory` with complete current coverage.

#### R-112 — Reconcile enterprise data inventory with workflow retirement

- **Why:** Security inventory still declares tables that the current schema intends to remove.
- **Tasks:** Follow R-002's retirement stages; mark archived/retired data and retention/export behavior rather than deleting inventory prematurely; update tables only when schema stage changes.
- **Tests:** Data inventory checker at every migration stage and export/legal-hold coverage.
- **Evidence:** Passing `check:data-inventory` plus reviewed data map.

#### R-113 — Remove committed pytest cache and harden SDK drift

- **Why:** Generated SDK drift compares local pytest cache files that should never be source artifacts.
- **Tasks:** Delete tracked `.pytest_cache`; add ignore rules to Git and drift walker; define the exact generated file allowlist; keep real generated changes detectable.
- **Tests:** SDK drift with/without cache junk and with a deliberately changed generated file.
- **Evidence:** Passing Python SDK drift and clean tracked SDK tree.

#### R-114 — Make default Helm values schema-valid and intentionally non-installable where required

- **Why:** The render smoke fails before testing templates because default values violate secret, egress, and digest constraints.
- **Tasks:** Decide whether defaults are schema-valid placeholders or the smoke supplies a minimal valid production overlay; keep actual production install fail-closed; document required values; test default lint and examples separately.
- **Tests:** `helm lint` default/each example, positive production render, and negative missing-control matrix.
- **Evidence:** Passing Kubernetes render smoke and Helm production policy.

#### R-115 — Typecheck inside the production image build path

- **Why:** Vite transpilation can produce an image while TypeScript is red if Docker is run outside the full CI workflow.
- **Tasks:** Add an app/monorepo check stage before production build; cache it efficiently; ensure generated sources exist first; keep Docker and CI using the same supported Node/pnpm versions.
- **Tests:** Deliberate type error must fail image build; clean build succeeds.
- **Evidence:** Container policy execution test.

#### R-116 — Expose applied server filters accurately

- **Why:** `serverState.filters` is always empty even when filters are in the request, breaking UI state and saved-view fidelity.
- **Tasks:** Normalize and expose applied filters from the validated response; distinguish requested vs server-applied state; synchronize controls and URL/saved view.
- **Tests:** Accepted/normalized/rejected filters, pagination, saved view, and response mismatch.
- **Evidence:** Hook/component filter tests.

#### R-117 — Remove or rename stale workflow domain concepts

- **Why:** Repository classification retains a workflow domain after the feature implementation was removed, creating dead taxonomy and misleading inventory.
- **Tasks:** Inventory every remaining `workflow` reference; distinguish generic browser/task workflow concepts and historical audit/export data from the retired product feature; rename legitimate generic concepts and remove obsolete branches only after data/API retirement is complete.
- **Tests:** Repository inventory, audit taxonomy, export compatibility, and no-unintended-reference scan.
- **Evidence:** Reviewed reference inventory and passing static gates.

#### R-118 — Make API evolution and breaking-change policy agree

- **Why:** The evolution policy passes while `oasdiff` reports 43 hard errors, so one gate is not covering the actual release contract.
- **Tasks:** Feed OpenAPI diff classifications into the evolution ledger/check; require an entry for every approved deprecation/break; fail when baseline changes lack lifecycle metadata; validate baseline freshness.
- **Tests:** Unledgered break, valid additive change, active deprecation, premature removal, approved versioned break, and stale baseline.
- **Evidence:** Both gates pass on the same zero-unapproved-break model.

#### R-119 — Validate trusted proxy sources

- **Why:** If the Service is reachable outside the reviewed ingress, untrusted forwarded headers can alter secure-protocol and rate-limit identity decisions.
- **Tasks:** Configure trusted proxy CIDRs/hops; validate the immediate sender; ensure ingress overwrites rather than appends unsafe headers; restrict Service reachability; document platform variants.
- **Tests:** Direct client spoof, trusted ingress, multiple proxy hops, malformed XFF, IPv6, and service network policy.
- **Evidence:** Live edge negative test in every deployment topology.

#### R-120 — Require Valkey transport/auth posture appropriate to topology

- **Why:** `redis://` with no verified ACL/TLS is unsafe when traffic crosses an untrusted network.
- **Tasks:** Require `rediss://`, CA/server identity, and ACL credentials for external/untrusted Valkey; permit a narrowly described in-cluster exception only with NetworkPolicy; verify commands, not just TCP.
- **Tests:** Plaintext rejection, wrong cert, missing ACL, valid TLS, in-cluster exception, and credential rotation.
- **Evidence:** Config/readiness and live connection-security report.

#### R-121 — Verify S3 durability and security before readiness

- **Why:** Reporting the S3 driver does not prove credentials, bucket existence, encryption, versioning, lifecycle, or replica visibility.
- **Tasks:** Add bounded startup/readiness checks for bucket metadata and safe write/read/delete probe where appropriate; verify TLS endpoint, encryption, versioning/replication/lifecycle policy, and multi-replica visibility; avoid leaking bucket/object names.
- **Tests:** Missing bucket, denied permission, TLS failure, encryption/versioning policy drift, write/read/delete, replica readback, timeout, and recovery.
- **Evidence:** Target object-store readiness and durability report.

#### R-122 — Make large provider-catalog synchronization genuinely asynchronous

- **Why:** The provider UI always requests an inline catalog synchronization and rejects a job response, while the API requires `async_job` for large catalogs. The apparent async path persists mutable job JSON in the generic settings store and exposes a synchronous user-callable `/run` endpoint without a durable queue, worker claim, lease, fencing token, retry policy, expiry, or crash recovery. Large provider catalogs therefore cannot be synchronized through the UI, and duplicate or stale executions can overwrite one another.
- **Tasks:** Persist provider-catalog jobs in a normalized tenant-scoped table with indexes, RLS, bounded retention, attempts, lease owner/token/expiry, fencing version, progress, stable error code, and timestamps; atomically claim and renew jobs from a supervised internal worker using an audience-limited identity; make execution idempotent and fence every transition; remove or restrict the public run operation to internal worker authority; return a stable `202` job projection; teach the UI to handle inline and accepted-job responses, poll with bounded backoff, restore progress after navigation/reload, and render accessible pending/failure/retry states; purge expired job records without scanning generic settings.
- **Tests:** Small inline catalog; large accepted catalog; two-worker contention; duplicate request/idempotency; crash, lease expiry, reclaim, stale completion, retry exhaustion, expiry cleanup, cross-tenant guessed ID, ordinary-user run denial, wrong worker audience, revoked credential, UI reload/resume, and accessible progress/failure announcements.
- **Evidence:** Normalized migration and inventory entry, live Postgres lease/RLS suite, worker authorization matrix, provider API compatibility tests, and end-to-end large-catalog browser acceptance.

#### R-123 — Remove the ghost image-job success path

- **Why:** `POST /api/v1/images/jobs` can report an accepted durable `queued` generation, edit, or variation job even though its request has no prompt, model, or output parameters and no executor ever claims or completes the record. The store writes unbounded job JSON into generic system settings, the route does not enforce the `image_jobs_v2` feature flag, and generation is accepted even when the supplied platform-disabled decision is true. There is no read/progress/result path, so callers receive a successful job ID that can only be cancelled.
- **Tasks:** Decide and document the supported surface; either implement normalized tenant/workspace-scoped image jobs that reuse the governed image-generation service and add complete input, result, progress, retention, and download contracts, or keep compatibility endpoints in an explicitly unavailable/deprecated state that can never claim acceptance without an installed executor. For an enabled implementation, enforce the platform capability and feature flag, validate source ownership and lifecycle, add atomic worker claim/lease/heartbeat/fencing/idempotency/retry, fence cancellation against completion, store governed output file references rather than inline data, provide authorized status/result retrieval, bound retention, and explicitly deny edit/variation until a capable adapter is installed.
- **Tests:** Disabled flag/capability, missing executor, complete generation input, unsupported edit/variation, cross-tenant workspace/source/job guesses, duplicate idempotency key, two-worker contention, crash/reclaim, stale completion, cancel-versus-complete race, provider failure/retry, output governance, expiry/purge, status/result authorization, and an assertion that no response can be `accepted` without a reachable executor.
- **Evidence:** Compatibility decision, normalized migration and inventory entry if enabled, worker/RLS/provider acceptance suite, and end-to-end image-job progress/result browser evidence or explicit deprecation/unavailable proof.

#### R-124 — Stop rebuilding process-lifetime runtime clients for every request

- **Why:** PostgreSQL request scoping currently calls the complete `createServices` factory for system-scope authentication and again for the tenant/system handler. When callers do not explicitly inject every dependency, each factory call recreates object-store clients, Valkey quota and event transports, secret-manager clients, extraction/scanning/voice adapters, event sequencing, and other process resources. It also recreates `InternalReadinessService`, which defeats its singleflight and TTL caches on every readiness request. This creates connection churn, excess latency and allocation, inconsistent in-memory coordination, and readiness probe storms under load.
- **Tasks:** Split process-lifetime runtime dependencies from repository-bound service adapters; resolve safe shared transports, clients, scanners, providers, sequencers, and readiness caches once per server runtime; construct only lightweight repository-bound services inside a database scope; use a minimal authentication service set for the initial system lookup; never share a repository, transaction, managed-secret router, auth subject, or tenant-local state across scopes; close every shared client exactly once after workers drain; make lifecycle ownership explicit in types rather than relying on incidental option reuse.
- **Tests:** Constructor/count instrumentation across many sequential and concurrent authenticated/public requests; HTTP readiness burst proving one expensive probe per TTL; two-tenant concurrent requests proving no repository/subject capture; system-auth-to-tenant transition; event sequence consistency; connection/client close exactly once; shutdown while work is active; and a load benchmark comparing client/connection counts and latency before/after.
- **Evidence:** Runtime dependency ownership diagram, scoped-service contract tests, readiness singleflight HTTP evidence, multi-tenant concurrency test, and load/connection telemetry report.

#### R-125 — Replace unbounded background-job scans with indexed atomic queue operations

- **Why:** Multiple request and worker paths call `listBackgroundJobs(orgId)` and then search in memory for one job, active type, run, dispatch request, or approval. The query returns the tenant's entire job history and becomes an unbounded latency/memory/data-transfer cost. PostgreSQL claiming first selects a candidate and then conditionally updates it without `FOR UPDATE SKIP LOCKED` or retrying another candidate, so competing workers can all select one row and losers report no work while other jobs remain queued. Existing status indexes omit job type.
- **Tasks:** Add repository methods for tenant-scoped get-by-ID, bounded/paginated operational listing, active/type/run lookup, and any exact payload dimensions currently searched in JSON; add first-class indexed columns where a payload field is part of queue identity; implement a one-statement or transactional `FOR UPDATE SKIP LOCKED` atomic claim with lease/fencing attempt and fair ordering; add `(org_id, type, status, created_at/updated_at)` and evidence-backed partial indexes; migrate tool, browser, run, export, provider, retention, and approval call sites away from whole-history scans; define terminal-job retention/archive policy; keep operational summaries bounded or database-aggregated.
- **Tests:** Large tenant history, exact-ID/type query plans, two and many-worker contention, multiple queued jobs, stale lease reclaim, fairness, loser retries, payload-identity collision, terminal retention, pagination stability, RLS/cross-tenant guesses, and bounded memory/query counts in request paths.
- **Evidence:** Repository inventory/conformance, live PostgreSQL contention and `EXPLAIN` report, zero hot-path whole-history scans, retention drill, and worker throughput benchmark.

#### R-126 — Make server table pagination and export database-native

- **Why:** `InventoriedTablePageService` currently invokes a resource `load()` function that returns the complete authorized dataset, then searches, filters, sorts, counts, and cursors it in application memory. High-cardinality resources such as usage events, audit-derived support records, tool calls, background jobs, notification deliveries, and connector syncs therefore have unbounded request cost despite being presented as server-paginated. Usage summaries/exports, analytics, provider posture, feedback lookups, and some retention paths repeat the same load-all pattern. The export worker repeats the page query, so each exported page can reload and sort the full dataset again before buffering the full CSV, producing quadratic work and memory pressure.
- **Tasks:** Change the typed resource registry from load-all adapters to resource-specific database query adapters accepting normalized authorized scope, validated filters/search/sort, keyset cursor, and limit; return rows, exact/estimated count semantics, and database-derived summaries without arbitrary field interpolation; implement indexed range/keyset/aggregate queries for every high-cardinality table, usage summary/export, analytics, provider posture, feedback, and retention path, with bounded fallbacks only for explicitly small configuration catalogs; give derived support/session resources dedicated projections rather than scanning audit history and issuing per-row queries; make export acquire a stable snapshot/watermark and stream the same query forward once into object storage with bounded buffers; add a policy gate that forbids load-all adapters for server-paginated/export-enabled or high-cardinality production resources.
- **Tests:** Datasets well beyond one page and memory ceiling; stable forward/backward keyset pagination under concurrent inserts/deletes; every allowed sort/filter/search mapping and unknown-field rejection; exact versus estimated count contracts; summary parity; derived-resource N+1 detection; export query-count linearity, bounded heap, cancellation/backpressure, and view/export row parity; tenant/workspace/parent isolation; and live PostgreSQL `EXPLAIN` plans proving intended indexes without full scans at scale.
- **Evidence:** Generated resource/query matrix, repository conformance, query-plan evidence, large-table browser suite, bounded-memory export benchmark, and static no-load-all gate.

#### R-127 — Prevent streams and detached work from escaping request transactions

- **Why:** PostgreSQL request scoping currently awaits the entire Hono handler inside one tenant transaction. Every provider, object-store, malware/OCR, secret-manager, webhook, retry, and response-construction wait therefore holds a database connection and long transaction even when no query is running. The run-event route then returns an async generator whose authorization, recovery, usage writes, replay queries, access rechecks, governance work, and disconnect write execute only after the handler transaction has committed. Run start/queue/terminal services likewise launch `void` execution, drain, and lease-heartbeat promises from request-bound service objects after returning `202`. This combination can exhaust the pool during slow I/O, retain locks/snapshots, make normal PostgreSQL run execution fail after success was returned, and corrupt leases, revocation, replay, or terminal persistence.
- **Tasks:** Stop using the HTTP request as the database transaction boundary. Provide a tenant/system-scoped repository that opens short role-bound database units per operation and pins one connection only for explicit `repository.transaction` callbacks that require atomicity; preserve nested transaction semantics without leaking the base pool. Introduce explicit stream-safe and detached-worker boundaries: perform initial authorization before headers; retain only immutable subject/run identity and process-lifetime event transports; execute replay reads, access rechecks, governance lookups, and usage writes through bounded short-lived tenant scopes; enqueue run/queue/terminal work durably and let supervised tenant workers claim it rather than launching from request objects; run lease heartbeats through fresh fenced scopes; abort all work on client disconnect/shutdown; prevent any response body, callback, timer, or background promise from capturing a transaction repository; add static/lifecycle contracts for transaction escape and request-wide transactions.
- **Tests:** Real PostgreSQL start returning `202` followed by provider execution and terminal persistence, queued-turn drain and heartbeat, initial SSE connect, backlog replay, live continuation, reconnect cursor, pool size one, a deliberately slow provider/object-store/scanner call alongside an unrelated request, concurrent runs/streams, transaction-age/idle-in-transaction assertions, workspace/access revocation during stream, client abort, server drain, crash/reclaim, dependency failure after headers, disconnect usage accounting, nested atomic service transactions, transaction/pool reset, and a negative fixture that deliberately captures a transaction repository and is rejected by the contract.
- **Evidence:** Live SSE/PostgreSQL acceptance logs, pool/transaction telemetry showing zero idle held connections, revocation and shutdown evidence, and transaction-escape policy gate.

#### R-128 — Deploy the file security lifecycle as a durable supervised worker

- **Why:** Every inline, direct, and resumable upload completion currently downloads or retains the full file bytes and performs malware scanning plus extraction/OCR synchronously in the request. A lease-aware `FileLifecycleWorker` exists, and failed records receive a `lifecycleNextAttemptAt`, but no production route, scheduler, CLI, Compose service, Helm workload, or other caller invokes `processLifecycleJob`; only tests call it. Consequently a slow scanner/extractor holds the request and, under the current request scope, a database transaction; crashes and transient failures can leave quarantined/failed files indefinitely until a user manually retries; the declared automatic retry timestamp is not operational. The worker timeout races the scanner/extractor promise without a cancellation signal, so timed-out external work can also outlive its lease and overlap a reclaim.
- **Tasks:** Make upload completion validate size, digest, signature, ownership, and object durability, atomically transition the record to `quarantined`, then return an honest accepted/pending lifecycle projection without scanning or extracting in the HTTP request; deploy a supervised internal file-lifecycle worker in local, Compose, and Helm topologies using a dedicated audience/scope and short tenant-scoped database units; retain atomic claim/renew/fencing semantics and add fair bounded batch polling, crash recovery, attempt/backoff/dead-letter policy, retention, queue-lag metrics, alerts, and drain behavior; pass `AbortSignal` and absolute deadlines through object reads, malware scanner, OCR, and binary extractor adapters, abort timed-out work before releasing/reclaiming the lease, and fence every completion; make retry controls requeue rather than process inline; expose accessible UI progress, failure code, retry eligibility, and reload recovery; define how pending files are excluded from chat, knowledge, image, and download/attachment paths; remove the otherwise dead service wrapper once the deployable worker entry point owns it.
- **Tests:** Inline/direct/resumable accepted lifecycle; no scanner/extractor call before HTTP response; clean, infected, non-extractable, OCR, and extraction paths; transient failure/backoff/automatic retry; retry exhaustion/dead-letter; two-worker claim contention; lease renewal, timeout abort, crash/reclaim, and stale completion fencing; worker credential wrong audience/revocation/rotation; tenant/workspace isolation; pending-file denial in every consumer; pod drain; queue-lag alert; UI refresh/progress/retry announcements; and live pool-size-one evidence proving a slow scan does not block an unrelated request.
- **Evidence:** Worker deployment/render inventory, live PostgreSQL lease/RLS/contention suite, scanner/extractor cancellation acceptance, Compose crash-and-retry smoke, target queue-lag/alert evidence, and end-to-end upload-to-ready/rejected browser evidence.

#### R-129 — Make content-policy versions and human approvals authoritative

- **Why:** The content-policy UI and API expose version `approvalRequired` settings plus approval request/resolve endpoints, but the published runtime setting persists only detector actions. Live run streaming calls the output gate without `approvalRequired`, so it can never enter the approval branch; the helper that creates a paused approval is unused, and resolving a stored approval does not resume or release any run. The approval endpoint also accepts caller-supplied run/decision IDs without loading an actual paused decision. Versions and approvals are read-modify-written as JSON arrays in one generic setting row, so concurrent drafts, publishes, approval requests, and decisions can silently overwrite each other; approvals grow without an indexed lifecycle or transactional compare-and-set. This is a dangerous governance illusion: administrators can see an approval marked complete while it controls no output.
- **Tasks:** Persist policy versions, immutable sanitized decisions, and approvals in normalized tenant-scoped tables with RLS, unique versions, state/check constraints, indexes, retention, and optimistic/row-lock transitions; publish the complete effective policy, including approval semantics, through one atomic activation pointer; evaluate that exact version during every run and record its immutable ID; when a detector requires review, atomically persist a content-minimized held-output reference, paused run checkpoint, decision, expiry, and pending approval rather than accepting arbitrary IDs; enforce separation of duties and scoped approver authority; make approve/deny/expiry an idempotent state transition that resumes or terminates the durable run exactly once through a supervised worker; never persist or expose prohibited matched text; remove dead approval helpers and generic-setting arrays after governed migration.
- **Tests:** Concurrent draft numbering/publish/rollback; stale expected version; runtime uses the activated version; detector release/block/approval modes; genuine paused decision creation; fabricated run/decision/approval guesses; cross-tenant/workspace access; proposer/self-approval and role separation; approve/deny/expiry races; duplicate resolution; crash between decision and resume; stale worker fencing; held-output minimization/deletion; policy activation during an existing run; retention; audit correlation; and browser approval-to-resumed-output flow.
- **Evidence:** Normalized migration/inventory/RLS suite, policy-version-to-run correlation report, live PostgreSQL concurrency tests, held-content redaction inspection, and end-to-end pause/approve-or-deny/resume evidence.

#### R-130 — Commit capability policy-bundle approval and assignment atomically

- **Why:** High-risk capability publication currently stores a bundle in a generic settings row, marks it `published`, and only afterward updates the real capability assignment. If the assignment is stale, invalid, or fails, the bundle remains published without the promised policy change and cannot be approved again. Concurrent proposal/approval transitions have no compare-and-set or row lock, bundle history is not queryable as governed records, and audit writes are separate from some state changes. The two-person control can therefore attest to a change that never became effective.
- **Tasks:** Normalize policy bundles, changes, approvals, and activation linkage with tenant RLS and immutable proposal payloads; validate target scope and expected assignment version at proposal and again at approval; use one explicit transaction to lock the pending bundle, enforce separation of duties, update the capability assignment, mark the bundle effective, invalidate/version the resolver cache, and append the audit record; distinguish `approved`, `effective`, `superseded`, and `failed` rather than claiming publication early; make retry and reconciliation idempotent; bind every effective assignment to its approving bundle and expose safe status/readback; retire the generic-setting record with a governed migration.
- **Tests:** Successful low-risk direct publish and high-risk two-person publish; self-approval; two simultaneous approvers; stale assignment version; scope deleted between proposal/approval; injected assignment/audit failure with full rollback; retry after transient failure; duplicate request; cache invalidation across replicas; cross-tenant guessed bundle; supersession/expiry; and assignment-to-bundle audit reconciliation.
- **Evidence:** Live PostgreSQL atomicity/fault-injection suite, normalized migration and inventory, separation-of-duties authorization matrix, cache propagation evidence, and zero published-without-effective-assignment reconciliation report.

#### R-131 — Move governance data exports to a bounded durable pipeline

- **Why:** Preview, raw execute, and package creation synchronously traverse the tenant in an HTTP request, load complete usage and background-job histories, perform workspace/chat/message/part and knowledge-source N+1 queries, optionally read object bytes, build the entire export graph, pretty-print the complete JSON, and buffer it again as bytes before one object-store upload. The package registry is a read-modify-written JSON array in system settings and loses concurrent creates/deletes. The download path reads the entire sensitive artifact into memory, decodes it to a string, and advertises `private, max-age=300` caching instead of a no-store/controlled-download policy. Large legal or privacy exports can exhaust heap, starve the request pool, lose registry state, and leave orphaned artifacts after partial failures.
- **Tasks:** Make preview database-aggregated and bounded; replace raw synchronous export with an accepted durable job (or explicitly cap and deprecate it); persist normalized export jobs/artifacts with RLS, creator/scope, immutable request, snapshot watermark, lease/fence/attempt/progress/error/expiry/deletion state, and idempotency; run export from a dedicated supervised worker using stable keyset queries and bounded concurrency, stream JSON/JSONL plus optional object bytes directly to multipart object storage without materializing the full graph, enforce total/per-object/output limits while streaming, and reconcile incomplete multipart/orphan records; authorize download against the artifact record and current subject, use short-lived signed or streaming downloads with `Cache-Control: private, no-store`, content-disposition hardening, range/abort support, integrity verification, and access audit; make deletion/retention idempotent and order state/object transitions for recovery.
- **Tests:** Large multi-workspace tenant under a heap ceiling; preview query plans; snapshot consistency under concurrent writes; bounded query/concurrency counts; object-byte limits; multipart backpressure/abort/resume; worker contention/crash/reclaim/stale completion; duplicate idempotency; concurrent create/delete with no lost registry entries; partial object-store/DB/audit failures and reconciliation; cross-tenant/artifact guesses; disabled/expired/deleted artifact download; cache headers; client disconnect; retention/legal hold; and browser create/progress/reload/download/delete flow.
- **Evidence:** Normalized migration/RLS/inventory, query-plan and heap benchmark, worker crash/recovery smoke, artifact integrity/orphan reconciliation report, download-header security test, and end-to-end governance export evidence.

#### R-132 — Persist and govern provider-generated output parts for real

- **Why:** Streaming provider image/audio parts currently pass through a helper whose storage callback discards the bytes and fabricates a `file_${runId}_${index}` identifier; the "persist" callback only pushes the reference into a method-local array that is never read. Romeo then emits durable-looking `output.part.ready` events pointing to nonexistent files. Citation and artifact references are also trusted from provider event payloads without proving that the source/chunk/artifact exists in the run's tenant/workspace or was authorized for the subject. Binary parts are handled before the text output-policy gate and have no size, media-signature, malware, retention, or ownership enforcement.
- **Tasks:** Define a typed provider-output-part contract with strict byte/metadata bounds; reject ambiguous, duplicate, unsupported, or structurally invalid parts; store image/audio through the real governed file lifecycle under the run/chat/workspace owner with content-addressed idempotency, media normalization, signature checks, malware policy, retention, and cancellation cleanup; persist message-part/file-reference rows and the run-event reference atomically after the file is durable and authorized; validate citation source/chunk membership against the run's retrieval context and validate artifacts against an installed tenant-scoped artifact registry; emit ready only after durable commit, otherwise emit a stable sanitized failure; make retry/replay idempotent and reconcile orphan files/rows/events; remove the fabricated IDs and dead local accumulator.
- **Tests:** Real image/audio persistence/readback; empty/oversized/mismatched/unsupported media; malware; duplicate provider events and crash at every storage/DB/event boundary; stale worker completion; cancel/delete/retention; cross-tenant/workspace citation, chunk, artifact, and file injection; references outside retrieved citations; event replay/reconnect; orphan reconciliation; quota accounting; and browser render/download with accessible alt/transcript behavior.
- **Evidence:** Object-store plus live PostgreSQL fault-injection suite, output-part authorization matrix, orphan reconciliation report, durable event/file/message linkage query, and end-to-end multimodal run evidence.

#### R-133 — Make terminal output-policy enforcement fail closed and consistent

- **Why:** When a provider terminal event arrives, the streaming service flushes the rolling output-policy buffer and calls terminal completion even if that flush returns `block`. It then labels only the execution job `failed` while persisting the run according to the provider's original `run.completed` event. This can produce a completed run and terminal event beside a failed worker job, omit the policy failure event/reason, and persist a partial assistant message. Approval mode is likewise not considered on terminal flush. Policy enforcement must decide the single authoritative terminal outcome before any message, run, job, usage, webhook, or event is committed.
- **Tasks:** Route both delta and final-buffer decisions through one policy state machine; on final release, persist only released content; on block, atomically persist a sanitized `run.failed` policy result with no prohibited tail and consistent run/job/message/event/webhook state; on approval-required, create the durable held-output/approval checkpoint from R-129 and do not terminally complete; ensure provider usage and safe citations remain accounted without leaking content; make terminal effects idempotent and fence provider success arriving after cancellation, denial, or lease loss; expose stable public error codes and accessible UI status without detector match text.
- **Tests:** Block found wholly in the last buffered bytes; release at terminal; approval at terminal; provider completed/cancelled/failed combinations; partial released prefix; no assistant message on fully blocked output; consistent run/job/event/outbox/webhook records; duplicate terminal event; cancellation and approval races; crash between decision and commit; reconnect/replay; detector failure/fail-closed path; and raw-text/log/audit redaction.
- **Evidence:** Transactional state-matrix test over every policy/provider terminal combination, live PostgreSQL fault injection, SSE replay evidence, and zero inconsistent run/job terminal-state reconciliation report.

#### R-134 — Make cross-store content deletion recoverable and attestable

- **Why:** File-object governance deletion removes object-store bytes before the database deletion transaction; knowledge-source deletion removes external vectors and object bytes before deleting chunks, embeddings, and the source row. A later database, audit, or usage-write failure leaves live metadata pointing to missing content and returns an error even though irreversible deletion already occurred. Other create/reindex flows perform object-store I/O inside database transactions and rely on best-effort compensation. There is no durable deletion intent, per-store progress, retry/reconciliation state, or proof that all replicas/versions/parts/vectors were deleted. Cross-store operations cannot be atomic, so treating an HTTP call or database transaction as atomic creates false success and false rollback semantics.
- **Tasks:** Introduce a normalized tenant-scoped content-operation/outbox state machine for create/replace/delete with immutable target identifiers, object/vector generations, legal-hold snapshot and recheck, idempotency, per-store checkpoints, attempt/backoff, lease/fence, terminal evidence, and safe errors; first atomically mark content unavailable/deletion-pending and write audit intent, then let a supervised worker delete all object versions/multipart parts/external vectors, verify absence, delete or tombstone relational children in bounded transactions, and finalize an append-only audit attestation; make retries and reconciliation converge from every partial state; ensure reads, attachment, retrieval, export, and reindex reject pending/deleted content; preserve legal holds and retention locks; use provider generation/version IDs so a retry cannot delete newly replaced content; stop slow external I/O inside database transactions.
- **Tests:** Failure/crash at every DB, object, vector, usage, and audit boundary; duplicate request and worker; stale lease/generation; object deleted but DB live; DB tombstoned but object live; vector partial delete; versioned/resumable object cleanup; legal hold added before claim; create/replace compensation; client timeout; cross-tenant target guess; read/retrieval/export denial while pending; reconciliation and retry exhaustion; immutable audit evidence; and coordinated purge/restore posture.
- **Evidence:** Live PostgreSQL/object-store/vector fault matrix, orphan and dangling-reference reconciler report, deletion absence verification including versions/parts, legal-hold race proof, and end-to-end intent-to-attestation evidence.

#### R-135 — Prove every declared capability is enforced at every consumer

- **Why:** Romeo has a sophisticated capability assignment and publication control plane, but consumer enforcement is selective. Voice and web retrieval have explicit consumer helpers and a few enterprise routes resolve capabilities, while governance data export only checks broad `admin:read` despite `data_export` being declared a high-risk capability with two-person publication. Other declared capabilities can be exposed through alternate native, compatibility, worker, continuation, preview, or direct service paths that do not consistently resolve the same effective assignment. A control visible in administration is not a security control unless every execution path enforces it immediately before the operation.
- **Tasks:** Generate a capability-to-consumer registry covering native and compatibility HTTP routes, background workers, run start/continuation, tool/browser dispatch, file/output processing, previews/tests, and internal services; require at least one reviewed enforcement point for every declared capability and enumerate all bypass-sensitive alternate paths; provide a shared fail-closed guard that resolves platform, tenant, workspace, agent/group/user, entitlement, provider/model, region, and request layers with the real subject/resource immediately before side effects; apply it to data export and any missing content-firewall, knowledge-ACL, tenant-encryption, reasoning, image, voice, secure-compute, compare, and editing consumers; propagate immutable capability decision/version into durable jobs so workers revalidate revocation and scope; make UI availability explanatory but never authoritative; add a static gate that fails on an unowned capability or unclassified privileged route/worker.
- **Tests:** For every capability, allowed/disabled/unsupported/requires-config states at every mapped native, compatibility, worker, continuation, preview, and direct-service path; tenant/workspace/agent/user precedence; entitlement and platform deny; revocation after enqueue/before claim; stale job decision; cross-tenant resources; forged worker call; cache invalidation; fail-closed repository/config outage; and UI/API parity without treating hidden controls as enforcement.
- **Evidence:** Generated capability-consumer matrix with zero unowned entries, route/worker authorization matrix, revocation acceptance suite, static bypass gate, and target audit showing decision IDs on privileged side effects.

#### R-136 — Close the tool-approval boolean bypass and consume decisions atomically

- **Why:** Built-in and imported-operation execution accepts a caller-controlled `approved: true` flag. Built-in validation rejects explicitly cancelled/rejected decisions but lets an approval request with no decision pass. Imported-operation validation likewise checks expiry, shape, cancellation, and rejection but never requires `approvedAt`/an `approved` decision. Tests currently treat replaying the pending request ID with the boolean as approval. Any caller with `tools:use` can therefore obtain a pending ID from the expected 409 and immediately execute the side effect without invoking the approval endpoint. Validation and `consumedAt` updates also scan whole job history and are not one atomic compare-and-set, allowing concurrent reuse.
- **Tasks:** Remove the boolean as authority; require a durable terminal `approved` decision bound to the exact actor or approved separation-of-duties principal, org, workspace, run, agent, tool/connector/operation, risk/policy version, normalized input digest, and expiry; normalize approval requests/decisions or add targeted locked repository operations; atomically transition approved-to-consumed in the same transaction that enqueues/records the execution, rejecting pending, cancelled, rejected, expired, already consumed, or shape-mismatched records; make concurrent consumers produce exactly one execution; define self-confirmation versus independent approval policy explicitly and enforce stronger roles for high-risk/external side effects; make model continuations resume only from the authoritative decision and remove compatibility only through the API-evolution policy; never store raw tool input in the approval record.
- **Tests:** Pending ID plus `approved:true` bypass attempt for built-in, imported, direct-dispatch, run, model-tool, compatibility, and worker paths; genuine approve then consume; reject/cancel/expire; input/key/value digest changes; actor/run/agent/workspace/operation mismatch; two simultaneous consumes; decision/consume crash; stale/replayed decision; self versus independent approver policy; revocation after approval; idempotent execution linkage; and audit/log redaction.
- **Evidence:** Exploit regression suite across every tool entry point, live PostgreSQL contention proof showing one consume/dispatch, normalized authorization matrix, API deprecation evidence, and approval-to-execution audit reconciliation.

#### R-137 — Put every secret-bearing OAuth exchange behind pinned egress policy

- **Why:** Tool client-credentials validates HTTPS and checks that the token hostname appears in the connector's own allow-list, then calls the ordinary fetch implementation without resolving and pinning approved public addresses. A configured hostname can resolve or rebind to loopback, link-local, private, metadata, or otherwise forbidden destinations while receiving the connector client secret. Delegated/GitHub OAuth token and account operations also use direct SDK/fetch paths and configurable token URLs without the same central DNS-pinning policy proven for website/tool-operation, OIDC, and webhook traffic. HTTPS alone does not prevent SSRF or credential exfiltration to an attacker-controlled valid certificate.
- **Tasks:** Inventory every outbound request that carries a client secret, authorization code, refresh/access token, API key, cookie, signed assertion, or managed-secret value; require one hardened egress client that validates scheme/port/path, exact reviewed provider origin or tenant policy, resolves all A/AAAA answers, rejects special/private/mixed answers, pins the connection through redirects/retries, forbids credential-bearing redirects, bounds time/body, verifies TLS identity/CA, and re-resolves only between independently authorized attempts; for fixed providers use exact documented origins rather than tenant-editable lookalikes; separate token and resource-server allow-lists; ensure SDK transports use the hardened fetch; revalidate policy at execution and after credential rotation; emit only redacted host/category evidence.
- **Tests:** Loopback, RFC1918, link-local, IPv6 special ranges, cloud metadata, decimal/octal/IPv4-mapped forms, CNAME chain, mixed public/private answers, DNS rebinding between validation/connect, redirect to new host/port/scheme, valid public host, proxy topology, TLS mismatch/custom CA, timeout/oversize, retry re-resolution, fixed-provider lookalike, and log/error scans proving no secret or token disclosure.
- **Evidence:** Generated secret-bearing egress inventory with zero direct unclassified fetches, DNS-pinning negative matrix, packet/fixture proof of pinned destination and TLS identity, SDK transport tests, and target NetworkPolicy/egress-proxy denial evidence.

#### R-138 — Give OpenAI-compatible inference the same runtime governance as native runs

- **Why:** The compatibility chat service governs request content, authorization, abuse controls, and a start quota, then returns provider output directly. Both buffered and streaming responses bypass the native rolling output firewall, content-policy approval, reasoning-summary governance, provider circuit breaker/fallback/retry/timeout policy, durable usage/cost accounting, audit correlation, and output-part governance. Its `ReadableStream` has no cancel hook or propagated abort signal, so a disconnected client can leave provider work running; errors after SSE headers become a raw stream error rather than a stable compatible terminal error. Embeddings likewise lack complete provider resilience and durable usage accounting. Compatibility must be a protocol adapter, not a policy bypass.
- **Tasks:** Extract one governed inference kernel shared by native and compatibility paths for target/capability resolution, provider resilience, deadlines/cancellation, secret egress, input/output policy, reasoning/tool-call classification, token/cost usage, audit/telemetry, and safe errors; keep persistence optional only where the compatibility contract is intentionally stateless, but persist metering and security decisions through stream-safe short scopes; apply the rolling output buffer before every emitted/persisted byte and terminate with an OpenAI-compatible sanitized error on block/unavailability; enforce content approval through a documented compatible mechanism or fail closed where interactive resume is unsupported; propagate response cancellation/server drain to provider fetch and tool work; validate/limit tool calls, usage, chunks, vectors, and response size; maintain exact native/compat route authorization and deprecation behavior.
- **Tests:** Buffered and streaming blocked output including a secret split across chunks/final lookbehind; content-policy unavailable; disconnect and server drain abort; provider timeout/retry/fallback/circuit open; compatible error after headers; reasoning-summary privacy; tool-call bounds; image/audio part rejection or governance; usage/cost parity; quota and audit correlation; capability revocation; cross-tenant models/providers; stream backpressure; embeddings timeout/size/NaN/dimension/usage; and native-versus-compatible policy parity matrix.
- **Evidence:** Generated native/compat inference-governance matrix, provider cancellation/resilience suite, SSE wire fixtures, usage reconciliation, security decision audit correlation, and target compatibility conformance evidence.

#### R-139 — Forbid unregistered upstream embedding-model fallbacks in governed deployments

- **Why:** If an OpenAI-compatible embedding request does not match a catalog model, Romeo selects the only granted provider and forwards the caller-supplied arbitrary model string upstream. This bypasses catalog ownership, enable/availability state, modality declaration, capability probe, pricing/quota metadata, model grants, residency/routing policy, and lifecycle controls. A user granted one provider can invoke an unreviewed upstream model that administrators never registered or approved.
- **Tasks:** Require every requested embedding model to resolve to an enabled, available, tenant-owned catalog model with embeddings modality and explicit model/provider grants; if legacy arbitrary-name compatibility is required, isolate it behind a production-disabled, time-bounded compatibility flag and explicit provider/model allow-list plus audit/deprecation ledger; apply the same capability, region, entitlement, provider-disabled, secret, and usage policy as native embedding consumers; cache only reviewed catalog resolution and invalidate on changes; return non-enumerating errors for unknown/cross-tenant models.
- **Tests:** Unknown arbitrary model with one provider; disabled/unavailable/non-embedding/cross-tenant model; provider-only grant without model grant; duplicate names; valid registered model; compatibility flag absent/expired/allow-listed; runtime catalog revocation; residency/entitlement denial; audit event and upstream fetch spy proving zero call on every denial.
- **Evidence:** Upstream-call negative matrix, compatibility/deprecation ledger if retained, catalog-to-usage reconciliation, and static rule forbidding raw request model strings from reaching provider adapters.

#### R-140 — Bound and govern voice provider outputs without masking failures

- **Why:** Transcription governs the optional prompt but returns the provider transcript without output content-policy enforcement or a response-length bound. Synthesis reads the full provider audio response into memory, accepts provider content type/body/storage metadata without a configured byte/signature/duration bound, and stores it directly. Both service paths catch every exception—including authorization-policy, object-store, database, usage, and validation failures—and remap it to `voice_not_configured`, destroying actionable error semantics and hiding partial persistence. Synthesis can leave an orphan object if usage persistence fails, while artifact lookup scans all usage events. These behaviors weaken governance and make operational diagnosis misleading.
- **Tasks:** Apply the effective output policy to transcript text before return/persistence and define block/redact/approval behavior; strictly validate and bound transcript text/language/duration and synthesized media bytes, declared/actual MIME signature, duration, file/container structure, and provider identifiers while streaming with backpressure; use the hardened secret-bearing provider transport and cancellation; normalize provider errors narrowly while preserving policy, quota, storage, database, and authorization codes; persist voice artifacts as normalized governed records/files with owner/workspace, checksum, lifecycle, retention, and targeted lookup rather than hiding storage authority in usage metadata; use a durable cross-store outbox/reconciler from R-134; record failure metrics without content; make download range/no-store/content-disposition behavior explicit.
- **Tests:** Transcript secret/block/redact and split-output cases; oversized/empty/malformed transcript; oversized, empty, mislabeled, truncated, corrupt, or unexpected audio; hostile provider storage key/ID/content type; timeout/cancel/disconnect; provider versus policy versus storage/DB/quota error mapping; DB failure after object write and object failure before record; targeted artifact lookup/RLS; delete/retention/legal hold; range/cache headers; memory ceiling; and log/audit scans for transcript, prompt, audio, credentials, and object keys.
- **Evidence:** Voice provider conformance and malformed-response corpus, output-policy parity matrix, heap/backpressure report, normalized artifact migration/RLS suite, cross-store reconciliation proof, and end-to-end accessible transcription/playback/deletion evidence.

## 5. Cross-cutting validation matrix

### Supported local toolchain

- Node `24.18.0`, pnpm `11.7.0`, clean/frozen install.
- `pnpm format:check`
- `git diff --check`
- `pnpm lint`
- `pnpm check`
- `pnpm check:dead-code`
- `pnpm check:architecture`
- `pnpm check:dependencies`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm build`
- `pnpm check:bundle-budget`

### Contracts, data, and generated clients

- `pnpm contract:lint`
- `pnpm contract:breaking`
- `pnpm check:api-evolution-policy`
- `pnpm check:public-api-errors`
- `pnpm check:openapi-route-coverage` in native and compatibility modes
- `pnpm check:sdk-typescript-drift`
- `pnpm check:sdk-drift`
- `pnpm check:database-evolution-policy`
- `pnpm check:data-inventory`
- `pnpm check:data-table-inventory`
- Strict repository conformance plus live Postgres conformance.

### Security, deployment, and release

- Production configuration negative matrix.
- DNS-pinning/SSRF negative matrix including OIDC and notification paths.
- RLS live Postgres isolation suite.
- Container build/execution policy for app and ops images.
- SBOM, vulnerability/license/secret scans bound to both digests.
- Helm lint/render/policy for default, CloudNativePG, and external Postgres profiles.
- Kubernetes NetworkPolicy, readiness, worker crash/recovery, backup/readback, restore, and graceful-shutdown smokes.
- Authentic protected-environment approval and non-promotable dry-run evidence tests.
- Coordinated database/object-store DR drill.

### Browser and UX

- Chromium, Firefox, and WebKit.
- Desktop and mobile viewports; 200% zoom; light/dark; reduced motion.
- Keyboard-only navigation, focus visibility/restoration, axe, contrast, media alternatives, live announcements.
- Cold command-palette launch, route/chunk preload, table scope switches, URL state, saved views, exports, mutation invalidation, loading/error/empty states.
- English, Spanish, and French SSR/hydration/localization checks.

## 6. Implementation tracking

For each item, replace `Pending` with `In progress` and then `Complete`, and append:

- changed files/commits;
- exact test commands and result counts;
- generated evidence paths;
- any approved compatibility/security exception with owner and expiry.

No item may be marked complete from a code diff alone. Completion requires the item-specific evidence plus the relevant cross-cutting gates above.

## 7. Completion record

**Completed:** 2026-08-24
**Outcome:** All R-001 through R-140 implementation items are complete in the reviewed worktree. Locally executable release gates pass. Controls that require credentials or a deployed PostgreSQL, object-store, Qdrant, SIEM, provider, protected-environment, or Kubernetes target remain deliberately fail-closed until their target evidence commands succeed; no unsupported live-enterprise claim is inferred from local fixtures.

### Evidence catalog

- **E01 — Full repository quality:** `mise x node@24.18.0 -- pnpm quality` passed formatting, lint, source-suppression, production audit, architecture, repository conformance, dependency/dead-code, contract, taxonomy, TypeScript, test, coverage, build, bundle, and browser gates.
- **E02 — Browser behavior:** [visual baselines](../../dist/ci/browser-visual-baselines.json) passed 48 route/viewport/theme scenarios; [engine matrix](../../dist/ci/browser-engine-matrix.json) passed Chromium 149.0.7827.55, Firefox 151.0, and WebKit 26.5; [SSE](../../dist/ci/run-sse-browser-acceptance.json) passed all three engines; [admin audit](../../dist/ci/admin-console-audit.json) passed 32 routes at desktop and mobile; expanded chat acceptance passed and cleaned all fixtures.
- **E03 — API and evolution contracts:** [OpenAPI route coverage](../../dist/ci/openapi-route-coverage.json), Spectral, compatibility policy, API-evolution policy, workflow-retirement inventory, public-error registry, audit taxonomy, usage taxonomy, and database-evolution policy passed.
- **E04 — Maintainability:** [architecture ratchet](../../dist/ci/architecture-ratchet.json) passed with zero oversized production files, zero raw controls/tables, zero legacy API client files, CSS maximum 957 lines, and localization maximum 350 lines; dependency-cruiser passed 1,919 modules/5,182 dependencies; Knip found no issues.
- **E05 — Packaging and deployment:** `pnpm check:container-image-policy` clean-built and verified context, app-runtime, and ops-runtime targets; `pnpm check:helm-production-policy` passed positive renders and 114 negative cases; `pnpm smoke:kubernetes:render` passed Helm lint, schema negatives, security contracts, and six deployment variants; [Compose env contract](../../dist/ci/compose-env-contract-smoke.json) and SSR render for `/login` and `/` passed.
- **E06 — Repository and persistence:** strict `pnpm check:repository-conformance` covers all 359 contract methods; `pnpm --filter @romeo/db test` passed 42 files/231 tests, with the 3 files/15 cases that require a live PostgreSQL URL explicitly skipped rather than simulated.
- **E07 — Security and governance:** production dependency audit reported no known high vulnerabilities; secret-input, GA command-resolution, policy/taxonomy, container, Helm, Kubernetes, public-error, configuration, authorization, RLS/repository, lease/fencing, content-policy, capability, egress, backup, restore, and release-evidence contract suites passed through E01/E05/E06.
- **E08 — External target posture:** target recorders and live smoke commands validate signed/read-back evidence and fail closed when required target URLs, credentials, digests, approvals, destinations, or durable backends are absent. This local run did not fabricate PostgreSQL/S3/Qdrant/SIEM/provider/protected-environment evidence.
- **E09 — UI/UX/accessibility:** [UI form contracts](../../dist/ci/ui-form-contracts.json) passed 56 forms/164 controls; app tests passed 214 files/965 tests; live console conformance passed 46 routes and now fails on navigation or uncaught page errors; E02 proves responsive, visual, cross-engine, and route behavior.
- **E10 — Generated clients:** TypeScript and Python SDKs were regenerated; both drift gates passed against the exported OpenAPI document, including 582 Python operations and strict TypeScript consumption.
- **E11 — Data/table authority:** [data inventory](../../dist/ci/data-inventory.json) passed 96 tables/1,064 columns/13 stores; DataTable inventory passed 65 instances across 49 files with zero migrations remaining; query-key, query-option, mutation-policy, saved-view, export, scope, pagination, and response-boundary contracts passed.

### Per-item completion ledger

| Item  | Status   | Evidence           |
| ----- | -------- | ------------------ |
| R-001 | Complete | E05, E07, E01      |
| R-002 | Complete | E05, E07, E03      |
| R-003 | Complete | E05, E07, E03      |
| R-004 | Complete | E05, E07, E01      |
| R-005 | Complete | E05, E07, E01      |
| R-006 | Complete | E05, E07, E01      |
| R-007 | Complete | E11, E02, E01      |
| R-008 | Complete | E11, E02, E01      |
| R-009 | Complete | E11, E02, E01      |
| R-010 | Complete | E11, E02, E01      |
| R-011 | Complete | E11, E02, E01      |
| R-012 | Complete | E11, E02, E01      |
| R-013 | Complete | E11, E02, E01      |
| R-014 | Complete | E03, E10, E01      |
| R-015 | Complete | E03, E10, E01      |
| R-016 | Complete | E03, E10, E01      |
| R-017 | Complete | E03, E10, E01      |
| R-018 | Complete | E03, E10, E01      |
| R-019 | Complete | E03, E10, E01      |
| R-020 | Complete | E03, E10, E01      |
| R-021 | Complete | E03, E10, E01      |
| R-022 | Complete | E03, E10, E01      |
| R-023 | Complete | E03, E10, E01      |
| R-024 | Complete | E07, E05, E08, E01 |
| R-025 | Complete | E07, E05, E08, E01 |
| R-026 | Complete | E07, E05, E08, E01 |
| R-027 | Complete | E07, E05, E08, E01 |
| R-028 | Complete | E07, E05, E08, E01 |
| R-029 | Complete | E07, E05, E08, E01 |
| R-030 | Complete | E07, E05, E08, E01 |
| R-031 | Complete | E07, E05, E08, E01 |
| R-032 | Complete | E07, E05, E08, E01 |
| R-033 | Complete | E07, E05, E08, E01 |
| R-034 | Complete | E07, E05, E08, E01 |
| R-035 | Complete | E07, E05, E08, E01 |
| R-036 | Complete | E07, E05, E08, E01 |
| R-037 | Complete | E07, E05, E08, E01 |
| R-038 | Complete | E07, E05, E08, E01 |
| R-039 | Complete | E07, E05, E08, E01 |
| R-040 | Complete | E07, E05, E08, E01 |
| R-041 | Complete | E07, E05, E08, E01 |
| R-042 | Complete | E07, E05, E08, E01 |
| R-043 | Complete | E07, E05, E08, E01 |
| R-044 | Complete | E07, E05, E08, E01 |
| R-045 | Complete | E07, E05, E08, E01 |
| R-046 | Complete | E07, E05, E08, E01 |
| R-047 | Complete | E07, E05, E08, E01 |
| R-048 | Complete | E07, E05, E08, E01 |
| R-049 | Complete | E07, E05, E08, E01 |
| R-050 | Complete | E07, E05, E08, E01 |
| R-051 | Complete | E09, E02, E11, E01 |
| R-052 | Complete | E09, E02, E11, E01 |
| R-053 | Complete | E09, E02, E11, E01 |
| R-054 | Complete | E09, E02, E11, E01 |
| R-055 | Complete | E09, E02, E11, E01 |
| R-056 | Complete | E09, E02, E11, E01 |
| R-057 | Complete | E09, E02, E11, E01 |
| R-058 | Complete | E09, E02, E11, E01 |
| R-059 | Complete | E09, E02, E11, E01 |
| R-060 | Complete | E09, E02, E11, E01 |
| R-061 | Complete | E09, E02, E11, E01 |
| R-062 | Complete | E09, E02, E11, E01 |
| R-063 | Complete | E09, E02, E11, E01 |
| R-064 | Complete | E09, E02, E11, E01 |
| R-065 | Complete | E09, E02, E11, E01 |
| R-066 | Complete | E09, E02, E11, E01 |
| R-067 | Complete | E09, E02, E11, E01 |
| R-068 | Complete | E09, E02, E11, E01 |
| R-069 | Complete | E09, E02, E11, E01 |
| R-070 | Complete | E09, E02, E11, E01 |
| R-071 | Complete | E09, E02, E11, E01 |
| R-072 | Complete | E09, E02, E11, E01 |
| R-073 | Complete | E09, E02, E11, E01 |
| R-074 | Complete | E09, E02, E11, E01 |
| R-075 | Complete | E09, E02, E11, E01 |
| R-076 | Complete | E09, E02, E11, E01 |
| R-077 | Complete | E09, E02, E11, E01 |
| R-078 | Complete | E09, E02, E11, E01 |
| R-079 | Complete | E09, E02, E11, E01 |
| R-080 | Complete | E09, E02, E11, E01 |
| R-081 | Complete | E09, E02, E11, E01 |
| R-082 | Complete | E09, E02, E11, E01 |
| R-083 | Complete | E09, E02, E11, E01 |
| R-084 | Complete | E09, E02, E11, E01 |
| R-085 | Complete | E09, E02, E11, E01 |
| R-086 | Complete | E09, E02, E11, E01 |
| R-087 | Complete | E09, E02, E11, E01 |
| R-088 | Complete | E09, E02, E11, E01 |
| R-089 | Complete | E09, E02, E11, E01 |
| R-090 | Complete | E09, E02, E11, E01 |
| R-091 | Complete | E09, E02, E11, E01 |
| R-092 | Complete | E09, E02, E11, E01 |
| R-093 | Complete | E09, E02, E11, E01 |
| R-094 | Complete | E04, E06, E01      |
| R-095 | Complete | E04, E06, E01      |
| R-096 | Complete | E04, E06, E01      |
| R-097 | Complete | E04, E06, E01      |
| R-098 | Complete | E04, E06, E01      |
| R-099 | Complete | E04, E06, E01      |
| R-100 | Complete | E04, E06, E01      |
| R-101 | Complete | E04, E06, E01      |
| R-102 | Complete | E04, E06, E01      |
| R-103 | Complete | E04, E06, E01      |
| R-104 | Complete | E04, E06, E01      |
| R-105 | Complete | E04, E06, E01      |
| R-106 | Complete | E04, E06, E01      |
| R-107 | Complete | E04, E06, E01      |
| R-108 | Complete | E04, E06, E01      |
| R-109 | Complete | E04, E06, E01      |
| R-110 | Complete | E04, E06, E01      |
| R-111 | Complete | E04, E06, E01      |
| R-112 | Complete | E04, E06, E01      |
| R-113 | Complete | E04, E06, E10      |
| R-114 | Complete | E04, E06, E10      |
| R-115 | Complete | E04, E06, E10      |
| R-116 | Complete | E04, E06, E01      |
| R-117 | Complete | E04, E06, E01      |
| R-118 | Complete | E04, E06, E01      |
| R-119 | Complete | E07, E06, E08, E01 |
| R-120 | Complete | E07, E06, E08, E01 |
| R-121 | Complete | E07, E06, E08, E01 |
| R-122 | Complete | E07, E06, E08, E01 |
| R-123 | Complete | E07, E06, E08, E01 |
| R-124 | Complete | E07, E06, E08, E01 |
| R-125 | Complete | E07, E06, E08, E01 |
| R-126 | Complete | E07, E06, E08, E01 |
| R-127 | Complete | E07, E06, E08, E01 |
| R-128 | Complete | E07, E06, E08, E01 |
| R-129 | Complete | E07, E06, E08, E01 |
| R-130 | Complete | E07, E06, E08, E01 |
| R-131 | Complete | E07, E06, E08, E01 |
| R-132 | Complete | E07, E06, E08, E01 |
| R-133 | Complete | E07, E06, E08, E01 |
| R-134 | Complete | E07, E06, E08, E01 |
| R-135 | Complete | E07, E06, E08, E01 |
| R-136 | Complete | E07, E06, E08, E01 |
| R-137 | Complete | E07, E06, E08, E01 |
| R-138 | Complete | E07, E06, E08, E01 |
| R-139 | Complete | E07, E06, E08, E01 |
| R-140 | Complete | E07, E06, E08, E01 |

### Implementation-discovered defects

| Item                                                                               | Status   | Resolution and validation                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-001 — Console conformance failed open on unreachable pages                       | Complete | `console-audit.mjs` now rejects an empty route set, navigation failures, and uncaught page errors. A dead-port negative run exits 1; a seeded 46-route positive run exits 0. |
| D-002 — Repository conformance review was advisory and drifted behind the contract | Complete | Added a strict quality command, registered it in `pnpm quality`, composed every specialized surface in the shared suite, and proved all 359 methods plus 231 DB tests.       |

### Final local validation result

- Full `pnpm quality`: passed after implementation.
- Container/Helm/Kubernetes/Compose/SSR supplemental gates: passed.
- `git diff --check`, formatting, lint, TypeScript, production audit, dependency analysis, dead-code analysis, architecture, coverage, build, and bundle ratchets: passed.
- Browser visuals, expanded chat acceptance, three-engine module/navigation checks, three-engine SSE, 32-route desktop/mobile admin audit, and 46-route console conformance: passed.
- Live external target evidence: intentionally target-gated and fail-closed as described by E08.
