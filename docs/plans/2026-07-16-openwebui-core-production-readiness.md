# Romeo Open WebUI-Core Production Readiness Plan

Date: 2026-07-16
Status: active implementation checklist
Owner: Romeo engineering

## Objective

Ship Open WebUI's familiar core chat experience on Romeo's enterprise
architecture, with production-grade persistence, recovery, provider validation,
accessibility, localization, security, and operations.

This document is the authoritative checklist. A checked item means its stated
evidence exists in the repository or was produced by a repeatable validation
command. Feature presence alone is not sufficient.

## Product boundaries

- [x] Keep arbitrary code execution, terminals, notebooks, and code interpreters
      out of Romeo.
- [x] Keep multi-model side-by-side comparison and arena workflows out of Romeo.
- [x] Remove the legacy eval model-comparison UI, API, OpenAPI schema, SDK
      resource/contracts, core service, and CLI command; regression-test route absence.
- [x] Preserve single-model selection per message/chat.
- [x] Preserve Romeo's repository boundary: `packages/core` must not depend on
      `packages/db`.

## Already-established core experience

- [x] Streaming chat over persisted SSE events.
- [x] Full Markdown, GFM, math, syntax highlighting, code copy, and code download.
- [x] Governed document/image upload and reusable file selection.
- [x] Per-attachment retained-context controls persisted across reloads.
- [x] Per-chat model selection and model pins synchronized through the server.
- [x] Native Ollama, OpenAI-compatible, OpenAI Responses-compatible, and
      Anthropic adapters.
- [x] Anthropic Messages API streaming, usage, vision, and tool-call serialization
      covered by adapter tests.
- [x] Provider presets, credential references, model discovery, capability
      overrides, enablement, diagnostics, and sanitized failures.
- [x] Context inspector for system prompt, history, memories, files, knowledge,
      citations, and estimated tokens.
- [x] Personal/workspace memory, notes, prompt library, reusable files, governed
      web search, and URL ingestion.
- [x] Persisted citations and portable import/export of messages, model choice,
      citations, and attachment bytes.
- [x] Chat search, internal sharing/revocation, temporary chats, and governed image
      artifacts.
- [x] Server-synchronized theme, locale, font, density, and motion preferences.
- [x] Live browser acceptance for Markdown/code copy, model persistence, context
      inspection, upload, attachment retention, preferences, and provider presets.
- [x] Live local Ollama chat acceptance.

## Phase 1 — Durable queued turns and distributed execution ownership

### Data model

- [x] Add a `queued_chat_turns` table with tenant/workspace/chat ownership.
- [x] Store encrypted-or-governed prompt payload data outside generic system
      settings.
- [x] Add queue status values: `queued`, `leased`, `failed`, `cancelled`,
      `completed`.
- [x] Add a stable `(created_at, id)` order key, `updated_at`, and terminal
      timestamps.
- [x] Add `attempt_count`, `last_error_code`, and sanitized `last_error_message`.
- [x] Add a client-supplied idempotency key with a tenant/chat uniqueness
      constraint.
- [x] Add lease owner, lease token, lease expiry, and heartbeat timestamps.
- [x] Add indexes for next-turn claiming, chat listing, lease recovery, and tenant
      purge.
- [x] Add Drizzle schema, forward-only SQL migration, and snapshot metadata.
- [x] Add queued-turn deletion to chat deletion and tenant-purge paths.

### Repository contract

- [x] Define a queue entity that never exposes stored authentication subjects.
- [x] Add create/list/get/cancel/claim/heartbeat/complete/fail/release repository
      methods.
- [x] Make claim atomic and ordered per chat.
- [x] Prevent two active leases for the same chat.
- [x] Implement all methods in the in-memory repository.
- [x] Implement all methods in the PostgreSQL repository.
- [x] Add repository fragments and contract-inventory coverage.
- [x] Add in-memory lifecycle and PostgreSQL mapper tests.
- [x] Add credentialed PostgreSQL multi-worker claiming tests.

### Service and API

- [x] Replace `chat_turn_queue.v1:*` system-setting reads/writes.
- [x] Derive the current authorized subject at claim time; do not persist a raw
      `AuthSubject` in the queue payload.
- [x] Accept and return idempotency keys through the queue API.
- [x] Return stable public queue states and sanitized failures.
- [x] Make cancellation race-safe against leasing.
- [x] Add bounded retry with terminal failure classification.
- [x] Drain different chats concurrently while preserving in-chat order.
- [x] Recover expired leases safely across application replicas.
- [x] Add explicit OpenAPI definitions and verify Python SDK drift.
- [x] Add API tests for duplicate enqueue, ordering, cancellation/lease races,
      queue bounds, and sanitized failures.
- [x] Add credentialed API lease-expiry and multi-worker claim tests against
      PostgreSQL.

## Phase 2 — Recoverable run execution

### Execution lease and checkpoints

- [x] Persist run execution ownership, expiry, and heartbeat through leased
      background jobs with guarded optimistic updates.
- [x] Persist a provider-request checkpoint sufficient to retry safely in
      governed object storage; expose only its opaque key in operational jobs.
- [x] Persist whether assistant output has started.
- [x] Persist the last committed event sequence and accumulated assistant content.
- [x] Heartbeat while waiting for provider output, not only when tokens arrive.
- [x] Ensure another replica cannot recover a run with a live lease.
- [x] Classify recovery as safely retryable before output, output-interrupted,
      or terminal when no valid checkpoint exists.

### Recovery behavior

- [x] Retry an interrupted run automatically only before assistant output begins.
- [x] Never duplicate a user message during recovery.
- [x] Never duplicate assistant tokens already committed to persisted events.
- [x] If the provider cannot resume after output started, end with an explicit
      recoverable failure and offer a deterministic retry action.
- [x] Continue the queued-turn drain after recovered completion/failure.
- [x] Emit audit, usage, metrics, and webhook terminal state exactly once.
- [x] Add tests for process interruption before output, during output, and after
      provider completion.
- [x] Add process-interruption coverage for tool wait states.
- [x] Add a two-service-instance concurrency test using a shared repository.

## Phase 3 — Independent temporary-chat retention worker

- [x] Add a dedicated temporary-chat cleanup background-job type.
- [x] Add an operator-configurable cleanup interval, batch size, and lease.
- [x] Schedule cleanup independently of chat-list traffic when the worker is
      enabled.
- [x] Claim cleanup work with the existing background-job lease mechanism.
- [x] Preserve legal holds and record skipped resources.
- [x] Delete message attachments from object storage before deleting database
      records.
- [x] Delete queued-turn and run state through governed chat deletion cascades.
- [x] Make deletion idempotent across retries.
- [x] Record scanned/deleted/skipped/failed chats and object-deletion counts on
      background jobs.
- [x] Add sanitized audit records and background-job readback.
- [x] Add worker restart/retry, concurrent worker, legal-hold, and object-store
      failure tests.
- [x] Keep the manual admin cleanup endpoint as an operational escape hatch.

## Phase 4 — Credentialed provider acceptance matrix

### Repeatable harness

- [x] Add a redaction-safe live-provider acceptance command.
- [x] Make target provider/model/base URL selectable without recording secrets.
- [x] Emit a metadata-only JSON evidence artifact.
- [x] Separate `passed`, `failed`, and `not_configured`; never report skipped live
      evidence as passed.
- [x] Add a hard timeout; the adapter-level harness creates no persisted
      chat/file/run artifacts.

### Ollama

- [x] Live local text streaming acceptance with `llama3.2`.
- [x] Live per-model capability discovery for tool-less, tool-capable, and vision
      models.
- [x] Live tool-capability gating without provider HTTP 400s, native tool-call
      serialization, tool-result continuation, vision input, streaming, and usage.
- [x] Live timeout cancellation followed by a successful reconnect.
- [x] Live daemon restart and reconnect behavior.

### OpenAI-compatible / Responses-compatible

- [x] Live model discovery or allowlist acceptance against Ollama's actual
      OpenAI-compatible `/v1` implementation.
- [x] Live streaming text and usage accounting against Ollama's actual
      OpenAI-compatible `/v1` implementation.
- [x] Live vision input against Ollama's actual OpenAI-compatible `/v1`
      implementation.
- [x] Live native tool-call serialization and continuation against Ollama's
      actual OpenAI-compatible `/v1` implementation.
- [ ] Live image generation and governed artifact lifecycle.
- [x] Add a fail-honest credentialed image-provider collector that exercises the
      real API, validates the governed artifact and usage record, deletes the
      artifact, and emits redacted metadata-only evidence.
- [x] Controlled full-stack OpenAI-compatible image generation through HTTP,
      credential resolution, PostgreSQL metadata, S3 bytes, usage/cost accounting,
      retention expiry, and object deletion.
- [x] Live 401, 429, timeout, malformed stream, and provider-outage redaction.

### Anthropic

- [x] Controlled positive HTTP/SSE protocol acceptance covers native model
      discovery, text/usage, system prompts, vision, tool use, and tool-result
      continuation with required Anthropic headers.
- [ ] Live `/v1/messages` streaming text and usage accounting.
- [ ] Live image input.
- [ ] Live tool-use/tool-result continuation.
- [x] Add a fail-honest credentialed Anthropic collector covering model
      discovery, streamed text/usage, image input, tool use, and tool-result
      continuation without retaining prompts, responses, or credentials.
- [x] Live 401, 429, timeout, malformed stream, and provider-outage redaction.

## Phase 5 — Production persistence and deployment validation

- [x] Apply the baseline to a clean PostgreSQL instance.
- [x] Run the full PostgreSQL repository conformance suite with zero skips.
- [x] Validate queue claims and run leases under concurrent transactions.
- [x] Validate trigram chat-search query plans with representative scale fixtures.
- [x] Validate object-store upload/read/delete against the selected S3-compatible
      target.
- [x] Validate attachment and generated-image backup/restore.
- [x] Validate chat export/import across two clean deployments.
- [x] Run two app replicas plus workers against shared PostgreSQL/object storage.
- [x] Kill replicas during streaming, queue draining, and retention cleanup.
- [x] Validate tenant isolation for queue payloads, runs, files, search, shares,
      memories, and web sources.
- [x] Capture log-redaction evidence using prompt, provider-payload, and secret
      sentinels.
- [x] Run load/soak tests for chat creation, SSE reconnect, queue depth, and search.

## Phase 6 — Browser E2E and accessibility

- [x] Add a committed browser E2E suite for the core chat happy path.
- [x] Cover streaming reconnect and queued-message continuation after reload.
- [x] Cover file/image upload, reusable file selection, source preview, and
      attachment retention across reloads.
- [x] Cover model selection/pinning from a second browser session.
- [x] Cover provider preset creation, verification, syncing, and failure messages.
- [x] Cover context inspector sections and estimated-budget overflow behavior.
- [x] Cover prompt library, notes, memory controls, web search, URL ingestion,
      sharing, import/export, temporary chats, and image generation.
- [x] Add axe-core WCAG 2.2 AA checks for chat, settings, and provider admin.
- [x] Add axe-core WCAG 2.2 AA checks for the core chat route.
- [x] Add keyboard-only navigation tests for composer, model picker, dialogs,
      message actions, and sidebar.
- [x] Add focus restoration, visible-focus, status announcement, and reduced-motion
      assertions.
- [x] Add a keyboard skip-link assertion for the main chat surface.
- [x] Add a system `prefers-reduced-motion` browser assertion.
- [x] Test Chromium, Firefox, and WebKit desktop viewports with core chat
      interaction, hydration-error detection, reduced-motion/keyboard checks, and
      axe audits across chat, interface settings, and provider administration.
- [x] Test a representative narrow mobile viewport for composer availability.
- [x] Add narrow-tablet and mobile interaction coverage beyond composer
      availability.

## Phase 7 — Complete localization

- [x] Move all user-facing client strings to typed translation catalogs; retain
      only brand names, native language names, protocol identifiers, input examples,
      and non-presentational developer diagnostics as literals.
- [x] Translate Markdown code controls and source-viewer controls.
- [x] Translate composer validation, streaming, queue, and provider failure states.
- [x] Translate chat search/filter, folder, tag, share, import/export, and temporary
      chat dialogs.
- [x] Translate reusable-file and note dialogs, URL ingestion, image generation,
      drag/drop guidance, model capability filters, and the context inspector.
- [x] Translate settings, memory, notes, profile, and security surfaces.
- [x] Translate workspace navigation, agent-section guidance, evaluation suites,
      rubrics, runs, dashboards, localized scores, and human ratings.
- [x] Translate Agent Studio draft/model controls, prompt presets, validation,
      capability metadata, access grants, test console, publishing, version history,
      rollback, and version-diff controls.
- [x] Translate workspace tool inventory, calculator/date-time actions, risk and
      availability states, voice catalog/binding/preview/sync, and collaboration,
      sharing, favorites, folders, and folder-item controls.
- [x] Translate imported tool-operation tables, approval policies, dry-run
      diagnostics, dispatch controls, network/disabled reasons, and result summaries.
- [x] Translate prompt-template creation, editing, deletion, visibility, tables,
      marketplace catalog, validation, feedback, and summary statistics.
- [x] Translate tool-connector import, OpenAPI validation, auth references,
      enablement, network policy, auth checks, operations, feedback, and summaries.
- [x] Translate user tables, role labels and updates, activation status,
      disablement confirmation, local-password controls, feedback, and summaries.
- [x] Translate knowledge-base/source creation, file ingestion, extraction,
      reindexing, source tables, agent bindings, queries, feedback, and summaries.
- [x] Translate admin-overview readiness, provider, job, and agent metrics.
- [x] Translate all Admin route titles/descriptions plus nested readiness checks
      and background-job headings, statistics, status labels, tables, and feedback.
- [x] Translate Admin analytics summaries/tool breakdowns and CSV feedback,
      audit filters/outcomes/tables/export feedback, and usage alerts/totals/events,
      severities, sources, percentages, currencies, counts, and empty states.
- [x] Translate group creation, selection, membership, removal confirmation,
      tables, validation, feedback, and organization discovery tables.
- [x] Translate device-token creation, one-time secret display, scopes, expiry,
      status/revocation, confirmation, statistics, tables, and feedback.
- [x] Translate impersonation request approval/rejection and active-session
      expiry/revocation, tables, confirmations, empty states, and feedback.
- [x] Translate webhook creation, event selection, status, test/disable actions,
      bulk confirmation, deliveries, attempts, pagination, statistics, and feedback.
- [x] Translate Connected Apps posture, delegated-provider availability,
      authorization/revocation, connection status, tables, statistics, and feedback.
- [x] Translate connector-sync history, running/completed/failed state, counts,
      failure diagnostics, timestamps, messages, and empty states.
- [x] Translate the complete data-connector catalog, creation and local-sync
      forms, validation, runtime blockers, status, statistics, and feedback.
- [x] Translate workspace-shell skip navigation, command registration, fallback
      agent/workspace labels, agent cloning, shared confirmation defaults, drawers,
      message editing, and RAG query examples.
- [x] Translate attachment count/type/size validation plus speech,
      transcription, upload, reusable-image, removal, and image-generation fallback
      failures.
- [x] Give retention parsing stable typed error codes and translate the validation
      presented by governance forms without coupling parser logic to the UI locale.
- [x] Remove the unreachable legacy chat-comment panel rather than representing
      an unmounted component as a wired collaboration feature.
- [x] Translate workspace/chat lifecycle, tool-approval, and voice-capture
      controls, notices, validation, accessible labels, and failure feedback.
- [x] Remove the unreachable legacy milestone status panel.
- [x] Translate provider/model administration and diagnostics.
- [x] Translate model pricing, enablement, capability overrides, context-window
      controls, and pricing/status tables.
- [x] Make the routed model catalog the authoritative model-pricing editor and
      remove the unreachable duplicate model-pricing component.
- [x] Translate governed web-search provider, health, credential, domain,
      freshness, and URL-failure policy controls.
- [x] Translate shared dialogs, toasts, catalog pagination, tabs, command palette,
      and keyboard-shortcut controls.
- [x] Translate billing plan, quota, external-event, entitlement reconciliation,
      and lifecycle-enforcement controls.
- [x] Translate quota-bucket creation, editing, deletion, scope validation,
      reset schedules, usage tables, and summary statistics.
- [x] Translate notification channels, delivery history, and delivery-policy
      posture, allowlist, suppression, and validation controls.
- [x] Translate API-key and service-account creation, scope, token, status,
      detail, bulk-action, revocation, and disablement controls.
- [x] Translate workflow templates, schedules, run controls, and the multi-type
      workflow step builder.
- [x] Translate RAG retrieval policy and operational posture controls.
- [x] Translate RAG policy change-request review and retrieval replay controls.
- [x] Translate governance retention, DSAR export, data-rights coverage, and
      access/compliance report controls.
- [x] Translate GA, PostgreSQL, background-job, and distributed-quota posture.
- [x] Translate authentication-provider, managed-secret, deprovisioning, and
      directory-synchronization controls.
- [x] Translate destructive data-deletion preview, legal-hold, confirmation,
      execution, and affected-record controls.
- [x] Translate abuse policy, kill-switch validation, entitlement safeguards,
      and edge-security posture controls.
- [x] Remove the unreachable legacy SSO settings panel and consolidate SSO
      configuration in the routed authentication-provider console.
- [x] Translate shared data-table search, density, column, selection, empty,
      and client/server pagination controls.
- [x] Translate remaining administration navigation and common controls.
- [x] Localize dates, numbers, token counts, prices, and file sizes.
- [x] Add missing-key and catalog-parity tests for the existing core-chat
      English, Spanish, and French catalogs.
- [x] Verify SSR hydration for every locale without text mismatch.

## Phase 8 — Web, image, and file hardening

### Governed web retrieval

- [x] Controlled positive HTTP protocol acceptance for SearXNG, Brave, and
      Tavily request serialization, credentials, limits, result parsing, and health.
- [ ] Live-test SearXNG, Brave, and Tavily adapters selected for deployment.
- [x] Add a deployment-selected, fail-honest live web-search collector covering
      provider credentials, result/provenance parsing, health, usage, DNS policy,
      socket pinning, and bounded request timeouts.
- [x] Validate allowed/blocked domain precedence and policy enforcement across
      redirect chains.
- [x] Validate SSRF defenses for direct private IPv4/IPv6 targets, private DNS
      results, IPv4-mapped/NAT64 IPv6 addresses, and redirects.
- [x] Pin governed web-search and URL-ingestion sockets to policy-approved DNS
      addresses while preserving the original HTTP Host and TLS SNI; resolve and pin
      every redirect hop independently.
- [ ] Add deployment-level DNS pinning or an egress proxy and validate active DNS
      rebinding between policy resolution and socket connection.
- [x] Persist citation provenance and retrieval/access timestamps.
- [x] Add access timestamps and duplicate-result normalization.
- [x] Add explicit unreachable-source behavior and freshness policy.
- [x] Add rate limits, quotas, metrics, and provider health readback.

### Image generation

- [x] Prefer explicit provider discovery metadata over name-based image capability
      inference where available, retaining explicit admin override.
- [x] Validate content type, image signature, dimensions, and decompression limits.
- [x] Validate revised prompts, generated-image usage counts, failure redaction,
      and partial artifact cleanup.
- [x] Add image-price metadata and estimated cost accounting.
- [x] Enforce bounded size/count inputs, model enablement/capability policy, and
      governed storage quotas for generated images.
- [x] Add separately configurable image-generation count/cost quotas.

### File ingestion

- [x] Add a pluggable malware scanning boundary and fail-closed policy for inline,
      direct, resumable, imported, and chat-attachment ingestion paths.
- [x] Add Office archive expanded-size and decompression-ratio protection.
- [x] Add OCR for scanned PDFs/images with extraction provenance.
- [x] Improve Office document previews without executing active content.
- [x] Expose extraction status, quality, failure reason, and retry.
- [x] Add same-owner/workspace/purpose content-hash duplicate detection with
      duplicate provenance metadata.
- [x] Add workspace/user retention and storage-quota controls.
- [x] Verify live-data deletion across primary/resumable objects, extracted text
      and preview metadata, knowledge chunks/vectors, and governed exports. Generated
      images use the same file-object path; Romeo does not persist separate thumbnail
      objects.
- [ ] Validate attachment/generated-image backup restore and expiry against the
      deployment's selected immutable-backup platform. Request-path per-record backup
      deletion is explicitly not claimed.

## Phase 9 — Performance and observability

- [x] Load Markdown math/Katex, syntax highlighting, and Mermaid only when the
      rendered content activates them; mount governed source previews only on user
      request.
- [x] Lazy-load administration-only panels and visualization libraries.
- [x] Establish route-shell, workspace, admin, settings, and application CSS
      budgets with metadata-only evidence.
- [x] Add bundle-size regression checks to `pnpm verify` after production build.
- [x] Virtualize long-conversation layout/paint with browser-native
      `content-visibility`, retaining every message in DOM/document order for search,
      selection, and assistive technology while keeping the streaming tail live.
- [x] Bound rendered DOM and add search/paging controls for large chat, prompt,
      reusable-file, note, memory, and model catalogs.
- [x] Add authorization-aware repository/API pagination so those catalogs do not
      fetch the complete authorized collection before client-side paging.
- [x] Add metrics for time-to-first-token, tokens/second, reconnects, queue wait,
      recovery, provider errors, context size, retrieval latency, and upload pipeline.
- [x] Add metadata-only traces across API, provider, retrieval, object store, and
      worker boundaries.
- [x] Add dashboards and alerts for provider health, stale leases, queue depth,
      retention failures, object-store failures, and SSE disconnect rates.

## Phase 10 — Completion gates

- [x] `pnpm verify` exits 0.
- [x] OpenAPI route coverage reports zero uncovered public routes.
- [x] Generated TypeScript/Python SDK drift checks pass.
- [x] PostgreSQL conformance runs with zero skips.
- [ ] Credentialed live provider evidence is passed for every provider claimed by
      the target deployment.
- [x] Browser E2E matrix and axe checks pass.
- [x] Production multi-replica restart/recovery evidence passes.
- [x] Retention worker and object-store deletion evidence passes.
- [x] Load/soak thresholds and bundle budgets pass.
- [x] Security/redaction/tenant-isolation evidence passes.
- [x] README integration boundaries match the implemented and validated state.
- [ ] Every unchecked item in this document is either completed or explicitly
      moved to an approved product non-goal; no silent omissions.

## Validation log

Record commands and durable evidence paths here as phases complete.

- 2026-07-16: pre-plan baseline: `pnpm verify` passed; 1,112 tests passed and two
  PostgreSQL-only tests were skipped; production app build passed; OpenAPI route
  coverage reported 401/401 routes; Python SDK drift passed.
- 2026-07-16: manual browser acceptance passed for core chat Markdown/code copy,
  model persistence, context inspection, file upload, attachment retention,
  preferences, provider presets, and locale hydration.
- 2026-07-16: live local Ollama `llama3.2` response returned the requested sentinel.
  OpenAI and Anthropic credentials were not configured, so their live acceptance
  remains unchecked.
- 2026-07-16: durable queued turns moved from generic settings to dedicated
  PostgreSQL/in-memory entities with idempotency, per-chat advisory-lock claims,
  guarded leases/heartbeats/transitions, bounded retries, sanitized failures,
  constrained principal snapshots, explicit OpenAPI schemas, and forward-only
  migrations `0001`/`0002`.
- 2026-07-16: independent temporary-chat cleanup worker passed deletion and
  legal-hold tests; Compose and Helm render/contract smoke tests passed.
- 2026-07-16: `pnpm check`, `pnpm test`, and `pnpm build` passed. Current count:
  1,122 tests passed and two credential-gated PostgreSQL tests skipped. Build
  reported large-chunk warnings, retained as Phase 9 work.
- 2026-07-16: committed `pnpm test:browser:chat` passed Markdown, fenced code,
  syntax highlighting, code/message copy controls, reload persistence, model
  selection presence, keyboard skip navigation, reduced motion, and a 390 px
  viewport.
- 2026-07-16: `pnpm evidence:providers:live` wrote
  `dist/evidence/live-provider-acceptance.json`: Ollama passed with text, usage,
  and seven discovered models; OpenAI-compatible and Anthropic were explicitly
  `not_configured`.
- 2026-07-16: OpenAPI route coverage, Python SDK drift, Kubernetes render, and
  Compose environment contract checks passed. Live PostgreSQL validation could
  not run because neither a database nor Docker daemon was available.
- 2026-07-16: run execution recovery passed pre-output retry, output-interruption,
  post-terminal reconciliation, checkpoint deletion, and two-service shared-
  repository concurrency tests without duplicate messages, usage, or terminal
  events.
- 2026-07-16: temporary-chat cleanup passed concurrent-worker, legal-hold,
  object-store fail-closed, and restart/retry tests. These tests also corrected
  deterministic worker lease-clock handling and in-memory job-ID uniqueness.
- 2026-07-16: fresh `pnpm verify` passed after recovery and retention changes:
  1,130 tests passed and two credential-gated PostgreSQL tests were skipped.
  Production build passed with the existing large-chunk warnings. The committed
  `pnpm test:browser:chat` acceptance suite also passed again.
- 2026-07-16: workspace/user/org file-retention precedence and scoped
  `storage.byte` quotas are wired through the admin UI, API contracts, OpenAPI,
  in-memory/PostgreSQL repositories, and migration `0003`. Enforcement deletes
  every known primary/resumable object key and governed references, counts
  missing objects/bytes, and prevents uploader metadata from extending an admin
  policy. Fresh `pnpm verify` passed 1,183 tests with only the two credentialed
  PostgreSQL tests skipped; production builds, SDK drift, deployment contracts,
  and bundle budgets passed.
- 2026-07-16: expanded browser acceptance passed again after correcting two
  stale/racy harness assumptions: reusable-file rows now target their primary
  action rather than the extraction-action wrapper, and cross-session model-pin
  assertions wait for server synchronization. The suite now explicitly reloads
  after changing attachment retention and proves retained image/released document
  state plus safe source preview survive reload. Long chat rows use browser-native
  layout/paint virtualization while preserving DOM and accessibility order.
- 2026-07-16: chats, prompt templates, reusable files, notes, memories, and
  models gained bounded searchable catalog pages with accessible range/status
  controls. The shared paging utility clamps stale pages after filtering and is
  covered by focused tests. Expanded browser chat acceptance passed, followed by
  fresh `pnpm verify`: 1,186 tests passed, two credentialed PostgreSQL tests were
  skipped, and production builds plus bundle budgets passed. Repository-backed
  authorization-aware pagination remains separately tracked rather than being
  implied by the UI paging result.
- 2026-07-16: note/memory deletion was audited while preparing repository
  pagination and corrected to use the governed file deletion path. File-backed
  personal content now removes object bytes and stores only the same content-free
  tombstone as uploads, generated images, and retained files. Focused API proof
  checks both object removal and absence of title/body sentinels. Fresh
  `pnpm verify` passed 1,187 tests with only two credential-gated PostgreSQL tests
  skipped; production builds and bundle budgets passed.
- 2026-07-16: the committed axe WCAG 2.2 AA browser pass now covers chat,
  settings, and provider administration. It found and drove programmatic labels
  for theme, locale, font size, density, and reduced-motion controls; all three
  routes then passed.
- 2026-07-16: queued-turn API tests now cover stable ordering, idempotency,
  capacity, cancellation/lease races, and sanitized errors; run checkpoint
  reconciliation now covers durable tool-approval and external-dispatch waits.
- 2026-07-16: governed web retrieval now uses bounded manual redirects, applies
  allow/block and public-network policy at every hop, strips credentials on
  cross-origin redirects, rejects private/DNS-private/IPv6-mapped targets, and
  deduplicates equivalent results with access timestamps.
- 2026-07-16: image ingestion now validates signatures and bounded dimensions;
  file and chat attachment ingestion gained a pluggable fail-closed malware
  scanner; direct detections delete quarantined objects; Office extraction now
  enforces aggregate expanded-size and compression-ratio limits. Core passed
  622 tests after these changes, and Compose/Helm environment contracts passed.
- 2026-07-16: OpenAI-compatible discovery now prefers explicit provider image
  capability metadata over name inference. Generated images emit usage records
  and partial failures delete already-created artifacts. File uploads record
  same-owner duplicate-content provenance without cross-user disclosure.
- 2026-07-16: Markdown math/Katex and syntax highlighting moved behind
  content-conditional dynamic imports (Mermaid was already preview-conditional),
  reducing the client route chunk from roughly 672 KB to 214 KB. A new
  `pnpm check:bundle-budget` gate records and enforces route/CSS budgets as part
  of `pnpm verify`.
- 2026-07-16: Markdown code actions, Mermaid states, attachment retention, and
  source-document viewer controls now use the typed English, Spanish, and French
  catalogs; message timestamps use the selected interface locale. App typecheck
  and all 96 app tests passed.
- 2026-07-16: fresh repository-wide `pnpm verify` passed with 1,156 tests and
  two credential-gated PostgreSQL tests skipped. Typechecks, the production
  build, contract checks, and route/CSS bundle budgets passed. The committed
  `pnpm test:browser:chat` rendered-chat acceptance suite also passed.
- 2026-07-16: all administration sections now load through section-scoped React
  lazy boundaries, including their visualization dependencies. The default
  admin route chunk fell from roughly 268 KB to 21 KB; app tests, production
  build, bundle budgets, and the admin/provider browser acceptance path passed.
  A final `pnpm verify` on this exact tree passed all 1,156 tests (with only the
  two credential-gated PostgreSQL cases skipped), typechecks, builds, and budgets.
- 2026-07-16: run completion, failure, and cancellation now use an atomic
  compare-and-set terminal transition. Usage metrics, a metadata-only audit row,
  assistant output, and a deterministic webhook-outbox job commit together.
  An independently polling, leased worker emits stable delivery IDs so crash
  replay does not recreate delivered webhook records. Tests cover two-service
  finalization races, concurrent API cancellation, completion/failure effects,
  dispatch crash reclamation, and idempotent webhook replay; core passes 628
  tests and DB passes 113 with the two credentialed PostgreSQL cases skipped.
  Fresh `pnpm verify` passes all 1,160 tests, typechecks, production builds, and
  bundle budgets; OpenAPI route coverage and Python SDK drift also pass.
- 2026-07-16: model pricing now supports per-image prices for each allowed output
  size. Image generation records estimated USD and integer micro-USD usage, and
  independently configurable `image.generated` and `image.cost.micro_usd`
  buckets are reserved atomically before provider dispatch. Tests prove that a
  denial leaves both buckets unchanged and prevents the provider call, and that
  cost metadata is counted once in usage summaries. A fresh `pnpm verify` passed
  1,162 tests with two credential-gated PostgreSQL tests skipped; typechecks,
  production builds, contract checks, and bundle budgets also passed.
- 2026-07-16: governed web retrieval now supports maximum publication age,
  explicit handling for unknown publication dates, and fail-or-skip behavior for
  unreachable URL batches. Skip mode still fails closed for domain, protocol,
  SSRF, and other policy violations. Search and URL-fetch quotas are enforced
  before outbound HTTP; metadata-only usage captures success, partial, failure,
  latency, and result counts; sanitized provider health is persisted and shown
  in administration. A fresh `pnpm verify` passed 1,167 tests with the two
  credential-gated PostgreSQL tests skipped, plus all typechecks, production
  builds, contract checks, and bundle budgets.
- 2026-07-16: citation records now retain normalized source type, provider,
  retrieval, access, and publication timestamps through context budgeting,
  recovery events, assistant-message persistence, PostgreSQL JSON mapping,
  reload, and portable export/import. Chat source details display the durable
  provider and timestamps and safely handle malformed imported source links.
  Focused persistence and mapper tests pass; a fresh `pnpm verify` passed 1,169
  tests with two credential-gated PostgreSQL tests skipped, plus all typechecks,
  production builds, contract checks, and bundle budgets.
- 2026-07-16: the committed browser suite now proves queued-turn continuation
  across reload, an in-flight leader surviving the same reload, server-synced
  model pins and per-chat selection from a second browser session, every context
  inspector section plus overflow failure, and provider preset/create/sync/
  verify flows with actionable credential and endpoint failures. It also covers
  governed document/image library attachment, source preview, retention/context
  effects, and attachment-state axe checks. Direct file-input automation remains
  unchecked because agent-browser 0.31.1 sets the hidden input files without
  delivering React's trusted change event; the harness therefore seeds through
  the governed file API and exercises the real reusable-file UI. The run drove
  24 px WCAG 2.2 retention targets and corrected provider health so model
  allowlists cannot bypass endpoint verification. `pnpm test:browser:chat`
  passed; a fresh `pnpm verify` passed 1,171 tests with two credential-gated
  PostgreSQL tests skipped, all typechecks, builds, contracts, and budgets.
- 2026-07-16: reusable files now persist a sanitized extraction lifecycle for
  inline, direct, and resumable uploads: pending/processing/success/failure/not-
  applicable status, extractor method, quality, attempt/completion timestamps,
  character count, and stable failure code. An authorized retry endpoint and
  file-library control recover failed extraction without exposing extracted
  contents, raw exceptions, object keys, or private infrastructure details.
  Tests cover all upload modes, failure-to-success retry, client routing, and a
  negative ownership/grant case. A fresh `pnpm verify` passed 1,174 tests with
  two credential-gated PostgreSQL tests skipped, plus all typechecks,
  production builds, contract checks, OpenAPI/SDK drift, and bundle budgets.
- 2026-07-16: chat source viewing now renders DOCX, PPTX, and XLSX attachments
  through an authorized, bounded plain-text preview endpoint. The browser uses
  a sandboxed iframe; responses are `nosniff` with a deny-all CSP; extraction
  reads only recognized document/slide/note/sheet text parts and never renders
  macros, relationships, formulas, scripts, or embedded objects. A synthetic
  DOCX acceptance test proves macro and external-relationship sentinels are
  absent from the preview. A fresh `pnpm verify` passed 1,175 tests with two
  credential-gated PostgreSQL tests skipped, plus all typechecks, production
  builds, contract checks, OpenAPI/SDK drift, and bundle budgets.
- 2026-07-16: file ingestion now supports opt-in local OCR for approved images
  and scanned-PDF fallback. The adapter invokes fixed `tesseract`/`pdftoppm`
  argument lists through `execFile` without a shell, bounds bytes/pages/time,
  isolates and deletes temporary files, and is disabled unless explicitly
  configured. Extraction metadata persists OCR method, provider, page count,
  confidence, quality, attempt timestamps, and safe failure codes. Tests cover
  image OCR, bounded two-page PDF rendering, API-level scanned-PDF fallback,
  and provenance. Compose and Helm contracts pass. A fresh `pnpm verify` passed
  1,178 tests with two credential-gated PostgreSQL tests skipped, plus all
  typechecks, production builds, contract checks, OpenAPI/SDK drift, and bundle
  budgets.
- 2026-07-16: chat, prompt-template, reusable-file, note, memory, and model
  catalogs now page and filter in the repository before returning bounded API
  results. Authorization is applied before totals and limits: chats honor
  ownership/user/group grants and expiry, prompts honor visibility/ownership/
  user/group grants, files honor owner/user/group grants, workspace content
  honors personal/workspace scope, and models are tenant-scoped. Legacy
  unpaginated responses remain compatible for existing consumers while the
  catalog UIs use the bounded endpoints. OpenAPI pagination contracts and the
  generated Python SDK are synchronized. Focused pagination tests passed, the
  expanded browser chat acceptance suite passed, and fresh `pnpm verify` passed
  1,191 tests with only two credential-gated PostgreSQL tests skipped, plus all
  typechecks, production builds, and bundle budgets.
- 2026-07-16: metadata-only run observability now persists time to first token,
  end-to-end duration, estimated output-token throughput, recovery count,
  sanitized provider-failure code, and queued-turn wait time without storing
  prompt, response, or raw error content. A focused redaction test proves content
  sentinels are absent from usage records. The broader observability item remains
  open for reconnect, retrieval/upload pipeline coverage, traces, dashboards, and
  alerts. Fresh `pnpm verify` passed 1,192 tests with only two credential-gated
  PostgreSQL tests skipped, plus all typechecks, production builds, and bundle
  budgets.
- 2026-07-16: observability coverage now includes cursor-based SSE replay and
  bounded client reconnect without duplicate token application, connection/
  reconnect/premature-disconnect counters, governed web retrieval latency, and
  inline/direct/resumable upload-pipeline latency. Provider operations now rolls
  recent TTFT, throughput, context size, queue wait, recoveries, reconnects,
  disconnects, provider failures, retrieval, and upload latency into a
  metadata-only admin dashboard. The Prometheus exporter exposes 31 metric
  families and validated alert rules for provider errors, SSE disconnects,
  queue wait, and TTFT. Expanded browser acceptance passed and fresh
  `pnpm verify` passed 1,194 tests with only two credential-gated PostgreSQL
  tests skipped, plus all typechecks, production builds, and bundle budgets.
- 2026-07-16: metadata-only trace correlation now accepts validated W3C
  `traceparent`, returns a sanitized trace ID, attaches request/trace IDs to
  central usage and audit events, propagates standard trace headers to provider
  and governed-retrieval HTTP boundaries, and persists correlation IDs with run
  execution jobs so recovered workers can continue the originating trace.
  Arbitrary caller trace labels are rejected and raw payloads remain excluded.
  Object-store read/delete spans and non-run worker families remain open, so the
  cross-boundary trace checklist item is intentionally not checked. Fresh
  `pnpm verify` passed 1,196 tests with only two credential-gated PostgreSQL
  tests skipped; the 31-family operational monitoring and 14-rule alert contract
  also passed.
- 2026-07-16: trace correlation now covers every configured object-store method
  through a metadata-only diagnostics span wrapper and persists safe file-
  lifecycle span outcomes for operational aggregation. Request correlation is
  propagated through central job helpers and resumed by run, browser automation,
  external tool-dispatch, webhook-outbox, and temporary-chat retention workers;
  retention system audits preserve the same IDs. Redaction tests prove object
  keys, bodies, prompts, URLs, and raw errors are absent from spans. Provider
  operations now shows storage failures, the exporter exposes 32 metric
  families, and 16 validated Prometheus rules include explicit object-store and
  retention-worker failure alerts alongside provider, lease, queue, and SSE
  signals. OpenAPI coverage and Python SDK drift passed, expanded browser chat
  acceptance and axe checks passed, and fresh `pnpm verify` passed 1,194 tests
  with only two credential-gated PostgreSQL tests skipped, plus all typechecks,
  production builds, and bundle budgets.
- 2026-07-16: committed browser acceptance now additionally creates and inserts
  a prompt template, creates and inserts a reusable note, creates/enables/pins a
  user-controlled memory, toggles governed web search, verifies a disabled/SSRF-
  governed URL produces an actionable in-dialog failure, and creates a persisted
  temporary chat. The URL mutation was corrected to keep expected policy
  failures out of the browser's unhandled-rejection channel. Image generation,
  sharing/export interaction, and the broader browser-engine/viewport matrix
  remain open, so the aggregate browser checklist item stays unchecked. The
  expanded browser suite passed and fresh `pnpm verify` passed 1,194 tests with
  only two credential-gated PostgreSQL tests skipped, plus all typechecks,
  production builds, and bundle budgets.
- 2026-07-16: the remaining core-feature browser matrix now opens governed chat
  access state, invokes the JSON export action, re-imports that artifact through
  the actual file-input handler, and verifies the imported conversation. A
  deterministic local OpenAI-compatible fixture is started and stopped by the
  harness; Romeo creates/syncs its image-capable model through provider APIs,
  generates an image through the production image endpoint, persists it through
  the governed file lifecycle, and attaches its blob-backed preview in the
  composer. The complete expanded browser acceptance suite passed; no external
  credential or public network dependency is hidden by this browser gate.
- 2026-07-16: keyboard acceptance now covers composer submission, model-picker
  search and arrow traversal, modal focus trapping, message-copy activation, and
  sidebar overflow actions. Model, dialog, and sidebar Escape paths restore the
  opener; model options support ArrowUp/ArrowDown/Home/End; interactive icon,
  model, sidebar, menu, and message controls have explicit focus-visible rings;
  copy state changes to the localized accessible label `Copied`; and polite
  composer status plus reduced-motion behavior are asserted. Expanded browser
  acceptance passed, and fresh `pnpm verify` passed 1,194 tests with only two
  credential-gated PostgreSQL tests skipped, plus all typechecks, production
  builds, and bundle budgets.
- 2026-07-16: responsive browser acceptance now exercises the prompt dialog,
  model picker, keyboard submission, completion status, and horizontal layout
  constraints at 390x844 mobile and 768x1024 tablet viewports. Composer actions
  remain reachable through a narrow horizontal action rail, the send action
  stays pinned, and model/dialog overlays remain inside the viewport. The run
  exposed and fixed an SSE recovery edge case: each browser stream connection
  is now bounded and reconnects from its last persisted sequence, preventing a
  missed terminal frame from leaving the composer permanently busy. Expanded
  browser acceptance passed, app typecheck and all 103 app tests passed, and a
  fresh `pnpm verify` passed 1,194 tests with only two credential-gated
  PostgreSQL tests skipped, plus all typechecks, production builds, and bundle
  budgets.
- 2026-07-16: typed English, Spanish, and French catalogs now cover composer
  validation, ready/streaming/queued states, model and prompt controls, stream
  recovery failures, and actionable provider credential, permission, missing-
  model, rate-limit, outage, cancellation, and generic failure messages. The
  workspace controller resolves these messages through the active locale rather
  than hard-coded fallbacks. Browser acceptance switches between all three
  locales and verifies the document language, model picker, prompt library, and
  live status text before restoring English; the full feature and accessibility
  matrix still passes. Fresh `pnpm verify` passed 1,194 tests with only two
  credential-gated PostgreSQL tests skipped, plus all typechecks, production
  builds, and bundle budgets.
- 2026-07-16: chat navigation and lifecycle localization now covers search and
  empty results, tag/folder filters and dialogs, pinning, rename/delete, sharing
  and access revocation, JSON/HTML/Markdown export actions, import, temporary-
  chat guidance, pagination, workspace switching, and sidebar accessibility
  labels. Translation keys are inferred from the canonical English catalog and
  statically require exact Spanish/French parity. Invalid imports now surface a
  localized inline alert instead of an unhandled promise rejection. Browser
  acceptance verifies Spanish and French filters, temporary-chat guidance,
  folder dialogs, localized chat actions, and export controls; fresh `pnpm
verify` passed 1,194 tests with only two credential-gated PostgreSQL tests
  skipped, plus all typechecks, production builds, and bundle budgets.
- 2026-07-16: a shared locale-format layer now renders dates, date-times,
  numbers, durations, token counts, USD prices, and decimal file sizes through
  explicit English/Spanish/French `Intl` formatters. It is wired through core
  chat/context inspection, file libraries, common stats and pagination, usage
  and pricing, provider operations, account/session/security panels, governance,
  connectors, workflows, webhooks, analytics, notifications, readiness, and the
  remaining administrative timestamps; raw `toLocale*` and `toFixed` display
  paths were removed. Unit coverage verifies grouping, decimal, bytes, tokens,
  currency, and date behavior. Browser acceptance clears and inspects page
  errors around every locale reload and proves no SSR hydration mismatch. The
  same run exposed a dark-theme provider-alert contrast failure, now corrected
  with AA-safe success/error colors. Stream completion is additionally guarded
  by polling the authoritative run record while SSE remains primary, and the
  temporary-chat acceptance step now waits for terminal state before continuing.
  Expanded browser/axe acceptance passed, and fresh `pnpm verify` passed 1,203
  tests with only two credential-gated PostgreSQL tests skipped, plus all
  typechecks, production builds, and bundle budgets.
- 2026-07-16: user settings are now fully routed through the typed locale
  catalogs: settings navigation and descriptions, interface theme/language/
  density/motion controls, memory and note catalogs and edit dialogs, identity
  and profile editing, local-password validation, TOTP enrollment/removal,
  active-session revocation, and notification tables/actions. Locale selection
  remains server-synchronized; browser acceptance explicitly patches the user
  preference, then opens interface, memory, profile, and security routes under
  both Spanish and French and verifies their translated interaction state before
  restoring English. Expanded browser/axe acceptance passed, and fresh `pnpm
verify` passed 1,203 tests with only two credential-gated PostgreSQL tests
  skipped, plus all typechecks, production builds, and bundle budgets.
- 2026-07-16: provider and model administration now use the typed English,
  Spanish, and French catalogs for connection setup, credentials and discovery,
  verification and synchronization controls, operational metrics and alerts,
  model search and availability filters, capability overrides, deployment and
  context metadata, pricing, empty/error states, and success feedback. Browser
  acceptance opens the provider administration surface in Spanish and French,
  verifies both provider and model catalog text, and exercises the localized
  connection dialog. Expanded browser/axe acceptance passed, and fresh `pnpm
verify` passed 1,203 tests with only two credential-gated PostgreSQL tests
  skipped, plus all typechecks, production builds, and bundle budgets.
- 2026-07-16: the admin console shell now resolves its title, operations,
  configuration, access/identity, and automation groups, every section link,
  back and skip links, loading state, and access-denied actions through the
  typed English, Spanish, and French catalogs. Browser acceptance verifies the
  translated console title and rendered navigation group in Spanish and French;
  the expanded browser/axe suite passed. Fresh `pnpm verify` completed all 1,203
  tests with only two credential-gated PostgreSQL tests skipped, plus all
  typechecks, production builds, and bundle budgets.
- 2026-07-16: the hard-coded-string audit identified and removed untranslated
  core-chat copy from the reusable-file and note libraries, URL-ingestion and
  image-generation dialogs, drag/drop overlay, suggestion label, model
  capability filters, extraction retry action, and the complete context
  inspector including accessible labels and budget/source summaries. Browser
  acceptance opens both the file library and context inspector under Spanish
  and French and verifies their localized rendered state. Expanded browser/axe
  acceptance passed, and fresh `pnpm verify` passed 1,203 tests with only two
  credential-gated PostgreSQL tests skipped, plus all typechecks, production
  builds, and bundle budgets.
- 2026-07-16: governed web-search administration now resolves its provider
  health, endpoint and managed-credential controls, allowed/blocked domains,
  result and freshness limits, unknown-publication-date behavior, unreachable-
  URL policy, enabled state, and save feedback through the typed catalogs.
  Browser acceptance visits the live panel in Spanish and French and verifies
  its localized rendered state. One unrelated model-picker focus timing run was
  retried and the complete expanded browser/axe suite passed; fresh `pnpm
verify` passed 1,203 tests with only two credential-gated PostgreSQL tests
  skipped, plus all typechecks, production builds, and bundle budgets.
- 2026-07-16: shared interface controls now resolve modal close actions, toast
  dismissal, catalog ranges and page navigation, tab-list labels, static command
  groups and navigation/theme/help commands, command search and empty state, and
  the keyboard-shortcut sheet through the typed catalogs. Browser acceptance
  opens the command palette through its keyboard event and the shortcut sheet
  through its application event under Spanish and French, verifying localized
  visible groups and accessible dialog labels. Expanded browser/axe acceptance
  passed, and fresh `pnpm verify` passed 1,203 tests with only two credential-
  gated PostgreSQL tests skipped, plus all typechecks, production builds, and
  bundle budgets.
- 2026-07-16: billing administration now resolves plan editing and current-plan
  state, reset intervals, quota tables and empty states, external billing event
  synchronization, entitlement status and reconciliation feedback, and lifecycle
  recommendations, confirmation, enforcement, and warnings through the typed
  catalogs. Browser acceptance visits the billing route under Spanish and French
  and verifies localized rendered state. Expanded browser/axe acceptance passed,
  and fresh `pnpm verify` passed 1,203 tests with only two credential-gated
  PostgreSQL tests skipped, plus all typechecks, production builds, and bundle
  budgets.
- 2026-07-16: notification administration now resolves channel creation and
  validation, enabled/disabled table state, delivery history, policy posture,
  channel-type and webhook/Slack/email allowlists, suppression controls,
  validation guidance, timestamps, empty states, and save feedback through the
  typed catalogs. Browser acceptance visits the notification route under
  Spanish and French and verifies localized rendered state. Responsive keyboard
  acceptance was decoupled from prior conversation length by starting each
  viewport in a fresh chat and waiting for the populated composer’s enabled send
  action before pressing Enter. Expanded browser/axe acceptance passed, and
  fresh `pnpm verify` passed 1,203 tests with only two credential-gated
  PostgreSQL tests skipped, plus all typechecks, production builds, and bundle
  budgets.
- 2026-07-16: access-credential administration now resolves API-key and service-
  account creation and validation, scope selection, one-time token display,
  status and summary tables, key detail metadata, row and bulk actions,
  revocation/disablement confirmations, and success/failure feedback through the
  typed catalogs. Browser acceptance visits the access route under Spanish and
  French and verifies both credential panels. Composer live-region acceptance
  now atomically waits for its polite-ready invariant to avoid a transient
  rerender between separate status reads. Expanded browser/axe acceptance
  passed, and fresh `pnpm verify` passed 1,203 tests with only two credential-
  gated PostgreSQL tests skipped, plus all typechecks, production builds, and
  bundle budgets.
- 2026-07-16: workflow administration now resolves template and custom creation,
  schedule controls and validation, workflow/template/run tables and actions,
  status and empty states, and the complete multi-type step editor for agent
  runs, handoffs, rooms, approval gates, tool approvals, browser tasks, and
  notifications through the typed catalogs. Every pure-builder validation
  outcome is translated at the UI boundary while the validator remains stable
  and independently tested. Browser acceptance visits the
  workflow route under Spanish and French, opens the real custom-workflow
  dialog, and verifies its localized step builder. Expanded browser/axe
  acceptance passed, and fresh `pnpm verify` passed 1,203 tests with only two
  credential-gated PostgreSQL tests skipped, plus all typechecks, production
  builds, and bundle budgets.
- 2026-07-16: RAG governance now resolves retrieval-policy editing, enabled
  tiers, embedding-model and residency constraints, external vector-store and
  physical-isolation controls, posture status, source/chunk/embedding health,
  and queue/failure counters through the typed English, Spanish, and French
  catalogs. Browser acceptance visits the RAG route under Spanish and French
  and verifies the localized policy heading. The interaction harness now
  isolates generated attachments and treats deliberately unavailable pinned
  providers as cancellable in-progress runs, preserving coverage of live-region,
  keyboard, and responsive behavior without requiring an undeclared local
  Ollama service. Expanded browser/axe acceptance passed, and fresh `pnpm
verify` passed 1,203 tests with only two credential-gated PostgreSQL tests
  skipped, plus all typechecks, production builds, and bundle budgets.
- 2026-07-16: RAG change-request and replay administration now resolves
  approval/rejection confirmations and feedback, review metadata, replay input
  validation, candidate-case controls, comparison deltas, and replay reports
  through the typed English, Spanish, and French catalogs. Browser acceptance
  opens the change-request and replay tabs under Spanish and French and verifies
  their localized panel headings. Expanded browser/axe acceptance passed, and
  fresh `pnpm verify` passed 1,203 tests with only two credential-gated
  PostgreSQL tests skipped, plus all typechecks, production builds, and bundle
  budgets.
- 2026-07-16: governance administration now resolves retention policy and
  enforcement, scoped DSAR preview/execution/package lifecycle, data-rights
  storage coverage, and access/compliance report exports through the typed
  English, Spanish, and French catalogs. Browser acceptance opens the real
  governance route under Spanish and French, verifies retention navigation,
  switches to the localized data-export tab, and verifies its DSAR form.
  Expanded browser/axe acceptance passed, and fresh `pnpm verify` passed 1,203
  tests with only two credential-gated PostgreSQL tests skipped, plus all
  typechecks, production builds, and bundle budgets.
- 2026-07-16: system-posture administration now resolves GA evidence gates,
  PostgreSQL readiness and warnings, background-job totals/alerts/type tables,
  and distributed-quota health through the typed English, Spanish, and French
  catalogs, including table headings and empty states. Browser acceptance opens
  the real posture route under Spanish and French and verifies the localized
  system and GA evidence headings. Expanded browser/axe acceptance passed, and
  fresh `pnpm verify` passed 1,203 tests with only two credential-gated
  PostgreSQL tests skipped, plus all typechecks, production builds, and bundle
  budgets.
- 2026-07-16: authentication-provider administration now resolves provider
  status and enablement, local-login safeguards, managed client secrets,
  connection diagnostics, OIDC deprovisioning, directory-sync preview/apply,
  and OIDC/SAML/LDAP configuration through the typed English, Spanish, and
  French catalogs. Browser acceptance opens the real authentication route under
  Spanish and French, opens a provider configuration dialog, and separately
  verifies the localized directory-sync action and dialog title. Expanded
  browser/axe acceptance passed, and fresh `pnpm verify` passed 1,203 tests with
  only two credential-gated PostgreSQL tests skipped, plus all typechecks,
  production builds, and bundle budgets.
- 2026-07-16: destructive data-deletion administration now resolves preview and
  execution feedback, chat/confirmation identifiers, legal-hold state, and all
  affected message/run/comment/notification/tool/usage/access/folder counters
  through the typed English, Spanish, and French catalogs. Browser acceptance
  verifies the localized deletion heading and preview action on the real
  governance route under Spanish and French. Expanded browser/axe acceptance
  passed, and fresh `pnpm verify` passed 1,203 tests with only two credential-
  gated PostgreSQL tests skipped, plus all typechecks, production builds, and
  bundle budgets.
- 2026-07-16: abuse and edge-security administration now resolves organization
  suspension, billing-entitlement safeguards, localized bounded-ID validation,
  connector/provider/tool/worker kill switches, TLS/HSTS, proxy/ingress, WAF,
  rate-limit, and request/file-size posture through the typed English, Spanish,
  and French catalogs. Browser acceptance opens the real abuse route under
  Spanish and French, verifies the policy panel, switches to edge posture, and
  verifies its localized heading. Expanded browser/axe acceptance passed, and
  fresh `pnpm verify` passed 1,203 tests with only two credential-gated
  PostgreSQL tests skipped, plus all typechecks, production builds, and bundle
  budgets.
- 2026-07-17: the UI wiring audit removed the unreachable legacy
  `SsoSettingsPanel`; its OIDC responsibilities are already implemented by the
  routed authentication-provider console alongside SAML/LDAP, managed secrets,
  diagnostics, deprovisioning, and directory synchronization. Shared data
  tables now resolve search, options, density, column visibility, selection,
  match/empty states, and client/server pagination through the typed English,
  Spanish, and French catalogs. Catalog tests assert the shared Spanish/French
  controls, and browser acceptance verifies them on the real audit table. The
  full gate also exposed a parallel-only RAG test race: the test now uses the
  repository’s established assistant-message polling invariant instead of
  reading immediately after a non-terminal retrieval event. Isolated regression,
  expanded browser/axe acceptance, and fresh `pnpm verify` passed 1,204 tests
  with only two credential-gated PostgreSQL tests skipped, plus all typechecks,
  production builds, and bundle budgets.
- 2026-07-17: model-pricing administration now resolves model/provider/status
  columns, token and generated-image prices, model enablement, capability
  overrides, context windows, save feedback, and summary statistics through the
  typed English, Spanish, and French catalogs. Quota administration now resolves
  creation, update, deletion, scope validation, reset schedules, usage columns,
  empty states, and summary statistics through the same catalogs. Browser
  acceptance verifies the localized model-pricing surface, opens the real quota
  route under Spanish and French, and opens each localized quota-creation dialog.
  Expanded browser/axe acceptance and fresh `pnpm verify` passed 1,204 tests with
  only two credential-gated PostgreSQL tests skipped, plus all typechecks,
  production builds, and bundle budgets.
- 2026-07-17: the product-boundary audit found and removed a legacy eval
  multi-model comparison implementation that contradicted Romeo’s explicit
  non-goal. The UI panel, app client/types, public TypeScript SDK
  resource/contracts, API route/schema/OpenAPI description, core domain/service,
  CLI command, and comparison-specific tests are gone. OpenAPI and direct-route
  regressions now prove the endpoint remains absent. The remaining single-model
  evaluation workflow and workspace navigation now resolve suite/rubric/run,
  dashboard, localized-score, and human-rating text through typed English,
  Spanish, and French catalogs. Browser acceptance opens the real evaluation
  route and suite dialog in Spanish and French and asserts that comparison UI is
  absent. Expanded browser/axe acceptance and fresh `pnpm verify` passed 1,202
  tests with only two credential-gated PostgreSQL tests skipped, plus all
  typechecks, production builds, and bundle budgets.
- 2026-07-17: prompt-template administration now resolves create/edit/delete
  actions, name/body validation, private/workspace/marketplace visibility,
  workspace and marketplace tables, empty states, feedback, and summary
  statistics through typed English, Spanish, and French catalogs. Browser
  acceptance opens the real prompt-template route and creation dialog under
  Spanish and French. Expanded browser/axe acceptance and fresh `pnpm verify`
  passed 1,202 tests with only two credential-gated PostgreSQL tests skipped,
  plus all typechecks, production builds, and bundle budgets.
- 2026-07-17: tool-connector administration now resolves OpenAPI import and
  validation, enablement, API-key/OAuth managed references, auth diagnostics,
  host allowlisting and deny-all posture, operation tabs, status, empty states,
  feedback, and summary statistics through typed English, Spanish, and French
  catalogs. Browser acceptance opens the real Connections route and connector
  import dialog under Spanish and French. Expanded browser/axe acceptance and
  the complete `pnpm verify` pipeline passed 1,202 tests with only two
  credential-gated PostgreSQL tests skipped, plus all typechecks, production
  builds, and bundle budgets.
- 2026-07-17: user administration now resolves user/status/role tables,
  organization and global administrator roles, immediate-disable confirmation,
  role updates, local-password validation and management, empty states,
  feedback, and summary statistics through typed English, Spanish, and French
  catalogs. Browser acceptance opens the real Users route and management dialog
  under Spanish and French. Expanded browser/axe acceptance passed, and a fresh
  `pnpm verify` exited zero with 1,202 tests passed, only two credential-gated
  PostgreSQL tests skipped, and all typechecks, production builds, and bundle
  budgets green.
- 2026-07-17: the workspace knowledge surface now resolves knowledge-base and
  source creation, file-selection and inline-size guidance, extraction and
  reindexing status, source deletion, localized source tables/counts, agent
  bindings, retrieval queries, notices, and feedback through typed English,
  Spanish, and French catalogs. Browser acceptance opens the real Knowledge
  route plus both base-creation and source-creation dialogs under Spanish and
  French. Expanded browser/axe acceptance passed, and a fresh `pnpm verify`
  exited zero with 1,202 tests passed, only two credential-gated PostgreSQL tests
  skipped, and all typechecks, production builds, and bundle budgets green.
- 2026-07-17: admin-overview readiness, provider health/alerts, background jobs,
  and agent counts now use typed catalogs and locale-aware numbers. Workspace
  export/archive, chat archive/legal hold, tool approval, and voice-capture
  controls now resolve labels, notices, validation, accessible names, and
  fallback failures through typed English, Spanish, and French catalogs. The
  unreachable legacy `StatusPanel` milestone view was removed. Browser
  acceptance verifies the localized overview, lifecycle headings, and voice
  control under Spanish and French. Expanded browser/axe acceptance passed, and
  a fresh `pnpm verify` exited zero with 1,202 tests passed, only two
  credential-gated PostgreSQL tests skipped, and all typechecks, production
  builds, and bundle budgets green.
- 2026-07-17: Agent Studio now resolves draft/model controls, localized prompt
  presets, numeric and blocked-term validation, model/deployment capability
  badges, publishing and rollback feedback, access grants, the live test
  console, evaluation summaries, version history, and version diffs through the
  typed English, Spanish, and French catalogs. Locale-aware formatting is used
  for context windows, suite counts, scores, and version numbers. Browser/axe
  acceptance opens the real Agent Studio route under Spanish and French and
  verifies the studio, draft form, access controls, and test console. The focused
  app suite passed 108 tests, expanded browser acceptance exited zero, and a
  fresh `pnpm verify` exited zero with 1,202 tests passed, only two
  credential-gated PostgreSQL tests skipped, and all typechecks, production
  builds, and bundle budgets green.
- 2026-07-17: workspace Tools, Voice, and Collaboration now resolve tool
  availability/risk, calculator and date-time execution, voice catalog sync,
  preview and binding, sharing, favorites, folder creation, and folder contents
  through typed English, Spanish, and French catalogs. Imported tool operations
  now localize policies, dry-run readiness and blockers, actions, and dispatch
  summaries. The wiring audit also removed the unreachable duplicate
  `ModelPricingPanel`, made the routed combined model catalog’s pricing editor
  authoritative, translated every Admin route header/description, and localized
  nested readiness and background-job panels. The browser suite now visits the
  real Tools, Voice, and Collaboration routes in Spanish and French; its model
  picker focus-restoration wait now follows the asynchronous focus invariant.
  Focused app tests passed 108 tests, expanded browser/axe acceptance passed end
  to end, and fresh `pnpm verify` exited zero with 1,202 tests passed, only two
  credential-gated PostgreSQL tests skipped, and all typechecks, production
  builds, and bundle budgets green.
- 2026-07-17: Admin Analytics, Audit, and Usage now resolve summary statistics,
  provider/eval/job health, tool breakdowns, audit filters and outcomes, usage
  alerts/totals/events, severity and source labels, empty states, refresh/export
  controls, and actionable export failures through typed English, Spanish, and
  French catalogs. Counts, percentages, dates, and currencies use locale-aware
  formatting. Browser acceptance visits all three real routes under Spanish and
  French and verifies their localized headings, filters, and tables. Focused app
  tests passed 108 tests, expanded browser/axe acceptance passed end to end, and
  fresh `pnpm verify` exited zero with 1,202 tests passed, only two
  credential-gated PostgreSQL tests skipped, and all typechecks, production
  builds, and bundle budgets green.
- 2026-07-17: access-and-identity administration now resolves group creation,
  selection, membership changes and removal confirmation; organization tables;
  device-token creation, one-time secret display, scopes, expiry, status and
  revocation; plus impersonation approvals, rejections, active-session expiry
  and revocation through typed English, Spanish, and French catalogs. Dates,
  TTLs, and statistics use locale-aware formatting. Browser acceptance visits
  Groups, Organizations, Device Tokens, and Impersonation under Spanish and
  French, opens the group and device-token creation dialogs, and verifies both
  impersonation sections. Focused app tests passed 108 tests, expanded
  browser/axe acceptance passed end to end, and fresh `pnpm verify` exited zero
  with 1,202 tests passed, only two credential-gated PostgreSQL tests skipped,
  and all typechecks, production builds, and bundle budgets green.
- 2026-07-17: automation and integration administration now resolves webhook
  creation, event selection, single/bulk disablement, tests, delivery history,
  status and attempt counts; delegated OAuth posture, provider availability,
  authorization and revocation; plus connector-sync state, timestamps and
  governed failure diagnostics through typed English, Spanish, and French
  catalogs. The wiring audit removed the unreachable legacy
  `ChatCommentPanel` instead of claiming an unmounted feature. Browser acceptance
  visits Webhooks and Connected Apps, opens the localized webhook dialog, and
  verifies connector sync history on the real Connections route under Spanish
  and French. Focused app tests passed 108 tests, expanded browser/axe acceptance
  passed end to end, and fresh `pnpm verify` exited zero with 1,202 tests passed,
  only two credential-gated PostgreSQL tests skipped, and all typechecks,
  production builds, and bundle budgets green.
- 2026-07-17: the final client-string audit localized the complete data-connector
  route, catalog metadata and runtime diagnostics; workspace-shell skip,
  command, fallback and clone labels; shared confirmation/drawer accessibility;
  RAG examples; attachment, speech, transcription and image-generation failures;
  and typed retention-validation errors. Intentional literals are limited to
  brand names, native language names, protocol/input examples, and developer-only
  diagnostics. Browser acceptance verifies the real Connections catalog and
  creation dialog plus workspace skip navigation under Spanish and French. The
  focused TypeScript check and all 108 app tests passed, expanded browser/axe
  acceptance passed end to end, and `pnpm verify` exited zero with 1,202 tests
  passed, only two credential-gated PostgreSQL tests skipped, and all typechecks,
  production builds, SDK/route checks, and bundle budgets green. Full verifier
  log: `/tmp/romeo-verify-final-audit.log`.
- 2026-07-17: added the repeatable `pnpm test:browser:matrix` Playwright harness
  and metadata-only `dist/ci/browser-engine-matrix.json` evidence. Chromium
  149.0.7827.55, Firefox 151.0, and WebKit 26.5 passed desktop chat interaction,
  keyboard/reduced-motion assertions, hydration-error detection, and zero-axe-
  violation audits on chat, interface settings, and provider administration.
  The first run uncovered and drove fixes for invalid/unnamed agent-picker ARIA,
  WebKit link focus behavior, timezone-sensitive date hydration, and fast
  bootstrap identity/authorization hydration races. The deeper Chromium
  browser/axe suite passed again after those fixes.
- 2026-07-17: `pnpm evidence:ollama:live` passed against the actual local Ollama
  runtime in 17.3 seconds. Redaction-safe evidence at
  `dist/evidence/live-ollama-acceptance.json` records discovery of seven usable
  models; correct completion-only (`gemma:2b`), tool (`qwen2.5:1.5b`), vision
  (`gemma3:4b`), and embedding-only filtering; tool-less gating without a 400;
  native tool call and tool-result continuation; real PNG vision input; usage
  from every scenario; timeout cancellation; and a successful post-timeout
  reconnect. An actual Ollama daemon restart remains explicitly unchecked.
- 2026-07-17: the generic live-provider harness passed Romeo's
  OpenAI-compatible adapter against Ollama's actual `/v1` implementation using
  `llama3.2:latest`. Evidence at
  `dist/evidence/live-openai-compatible-ollama.json` records successful model
  discovery/allowlist resolution, streaming text, and provider usage. Hosted
  OpenAI credentials and image/error scenarios are not inferred from this
  local-compatible result and remain unchecked. The extended
  `dist/evidence/live-ollama-acceptance.json` run also passed real OpenAI-
  compatible vision plus native tool-call and tool-result continuation with
  provider usage through the same `/v1` endpoint.
- 2026-07-17: live PostgreSQL 17 conformance passed 36/36 tests with zero skips
  against a newly initialized, isolated cluster and a fresh database created by
  the harness from every ordered greenfield migration. The run covers the full
  repository contract, transaction rollback, production readiness through the
  real API, simultaneous queue claims, simultaneous run-execution background-job
  claims, API enqueue/cancellation races across two service instances, and
  expired-lease recovery by a different worker. It uncovered and fixed a live-
  driver timestamp binding defect in queue lease comparison and completed the
  readiness fixture with the required production MFA-secret encryption key.
  Evidence log: `/tmp/romeo-postgres-conformance.log`.
- 2026-07-17: representative PostgreSQL 17 chat-search planning passed against
  100,000 generated chats, 100,000 messages, and 100,000 attachment parts in an
  isolated migrated database. The evidence harness now verifies real minimum
  table counts and fails a representative-volume claim unless PostgreSQL visibly
  uses `chats_title_trgm_idx`, `messages_content_trgm_idx`, and
  `message_parts_filename_trgm_idx`; the initial 20,000-row trial correctly
  failed because the planner still preferred sequential scans. The Drizzle
  schema and required-index contract now own all three indexes, and the guarded
  `pnpm seed:postgres-query-plan-fixtures` command produces deterministic,
  metadata-only fixture evidence while refusing unconfirmed or accidental
  remote writes. Passed artifacts:
  `dist/ci/postgres-query-plan-fixtures.json`,
  `dist/ci/postgres-schema-validation-query-plan.json`, and
  `dist/ci/postgres-query-plan-review.json`.
- 2026-07-17: live S3-compatible object lifecycle and DR evidence passed against
  a temporary MinIO server on isolated loopback ports and temporary storage.
  `pnpm evidence:object-store:live` exercised Romeo's actual `S3ObjectStore`
  signer/adapter with exact-byte attachment, generated-image, and chat-export
  uploads/readbacks plus delete/read-after-delete. The existing backup tooling
  then downloaded six source objects, and the DR drill restored them into a
  separate bucket and verified all six by SHA-256. The acceptance evidence
  returns no endpoint, bucket name, credentials, object keys/bodies, or presigned
  URLs; a sentinel scan found no signing credential or temporary secret. The
  temporary server was stopped and its data directory removed. Evidence:
  `dist/evidence/live-object-store-acceptance.json`,
  `dist/evidence/object-store-source-backup/manifest.json`, and
  `dist/evidence/object-store-dr-drill.json`.
- 2026-07-17: `pnpm evidence:ollama:restart` passed an actual isolated Ollama
  process restart on loopback port 11435 without touching the user's daemon on
  port 11434. The harness proved initial health/model discovery/streaming,
  observed the outage after terminating the first process, started a fresh
  daemon, rediscovered `gemma:2b`, and streamed successfully again. It stopped
  its child process before exit and records no process output, prompts,
  responses, or model payloads. Evidence:
  `dist/evidence/live-ollama-restart-acceptance.json`.
- 2026-07-17: live PostgreSQL conformance now passes 37/37 with zero skips after
  adding a portable-chat transfer across two independently created, freshly
  migrated databases and two separate object stores. The source deployment
  imports and exports a cited message with a retained attachment; the target
  deployment imports that archive and re-exports the same citation metadata,
  exact attachment bytes, and retention flag. This is an actual two-database
  boundary, not a second chat in one repository. Updated evidence log:
  `/tmp/romeo-postgres-conformance.log`.
- 2026-07-17: `pnpm evidence:providers:failure-live` passed provider-specific
  failure and redaction acceptance for the real OpenAI-compatible and Anthropic
  adapters over a controlled loopback HTTP server. Both adapters classified
  live 401, 429, aborted timeout, malformed SSE JSON, and connection-refused
  outage scenarios into stable sanitized codes. The server returned raw prompt,
  API-key, and provider-body sentinels, and the evidence retained none of them,
  no endpoint, and no response body. This closes protocol-failure acceptance;
  it does not substitute for the still-unchecked credentialed positive Anthropic
  streaming/vision/tool scenarios. Evidence:
  `dist/evidence/live-provider-failure-acceptance.json`.
- 2026-07-17: `pnpm evidence:retention-object-store:live` passed against a
  freshly migrated PostgreSQL database and isolated MinIO bucket. The governed
  retention API expired a chat attachment and generated image through supported
  explicit expiry metadata, marked both database records deleted, and proved
  both S3 objects unreadable. The independent temporary-chat cleanup worker then
  claimed its durable job, deleted an expired chat plus its attachment object,
  and recorded one deleted chat/object. Audit and evidence scans retained no
  database URL, endpoint, bucket, credentials, object keys/bodies, or sentinel
  content. The first trial correctly exposed that PostgreSQL keeps `created_at`
  immutable; the live fixture was corrected to use Romeo's supported
  `metadata.expiresAt` input. The MinIO server and temporary database were
  stopped and removed. Evidence:
  `dist/evidence/live-retention-object-store-acceptance.json`. The separate
  immutable-backup-platform expiry gate remains unchecked because temporary
  MinIO does not prove immutability or retention-lock policy.
- 2026-07-17: tenant-feature isolation passed both the focused service suite and
  live PostgreSQL 17 conformance. Two distinct organizations were seeded with
  queue-prompt, run, general-file, chat-search, share-principal, workspace-memory,
  and web-source sentinels. Cross-tenant direct reads were denied, tenant-B
  catalogs/search returned no tenant-A records, and serialized denial/results
  contained none of the sentinels. The curated evidence runner was corrected to
  invoke Vitest directly so its declared file list is the actual executed scope.
  `pnpm smoke:tenant-isolation-negative` passed and wrote
  `dist/ci/tenant-isolation-negative-suite.json`; a fresh migrated PostgreSQL
  cluster passed 39/39 conformance tests with zero skips. Live log:
  `/tmp/romeo-postgres-conformance.log`.
- 2026-07-17: full-API unexpected-error log acceptance exposed and fixed a raw
  exception logging boundary. Romeo no longer sends an `Error` object, stack,
  message, cause, provider code/body, request path/query, or raw caller-supplied
  request ID to stderr. The diagnostic is restricted to HTTP method, a bounded
  error kind, and a SHA-256 request-ID fingerprint. A repeatable harness injected
  prompt, provider-payload, API-secret, query, and request-ID sentinels through
  the real API middleware/error handler, observed the sanitized 500 and exactly
  one allowlisted metadata log, and proved that none of the raw sentinels or
  unsafe fields were captured. `pnpm evidence:logs:redaction-live` passed;
  evidence: `dist/evidence/live-log-redaction-acceptance.json`.
- 2026-07-17: `pnpm evidence:multi-replica:live` passed with two independent
  production Nitro app processes, a replacement process, a fresh migrated
  PostgreSQL database, Romeo's S3 adapter against isolated MinIO, and a
  controlled OpenAI-compatible SSE provider. Replica A was killed after taking
  the durable run lease but before provider output; replica B safely reclaimed
  and completed that run exactly once, drained the queued next turn, and replayed
  the terminal SSE event. The replacement replica was then killed after deleting
  one of 300 expired file objects; replica B completed the remaining 299 object
  deletions and tombstones. Its independent temporary-chat worker also deleted an
  expired chat and stored attachment. Evidence stores only bounded counts,
  booleans, timings, and a log digest; sentinel scans found no prompts, provider
  payloads, object contents, credentials, database URL, or storage endpoint.
  Evidence: `dist/evidence/live-multi-replica-recovery-acceptance.json`; run log:
  `/tmp/romeo-multi-replica-acceptance.log`.
- 2026-07-17: `pnpm evidence:chat-load-soak:live` passed against two production
  Nitro processes sharing a fresh migrated PostgreSQL database and a controlled
  OpenAI-compatible SSE provider. Ten concurrent clients created 40 chats,
  started 40 runs, established a durable queue depth of 40, and drained all 40
  continuations for 80 completed runs. The harness interrupted an SSE stream on
  replica A and resumed it from the persisted sequence on replica B, then ran 144
  health/search iterations over an observed 15.012-second soak. Zero requests
  failed; observed p95 latency was 25 ms for chat creation, 3 ms for chat search,
  33 ms for run starts, and 17 ms for queue enqueue, all within committed local
  acceptance thresholds. The fresh `pnpm verify` run also passed the app bundle
  budget. Evidence contains no database URL, provider endpoint, credentials,
  titles, prompts, responses, or replica logs, and sentinel scans were clean.
  Evidence: `dist/evidence/live-chat-load-soak.json` and
  `dist/ci/app-bundle-budget.json`; logs: `/tmp/romeo-chat-load-soak.log` and
  `/tmp/romeo-verify-final.log`.
- 2026-07-17: governed web retrieval now closes the DNS policy/connect TOCTOU
  gap in application code. The new DNS-pinned HTTP/TLS transport connects only
  through addresses already returned by Romeo's resolver and accepted by its
  private-network policy, while retaining the original hostname for Host, TLS
  SNI, and certificate verification. Web-search provider requests and URL
  ingestion use the transport, and redirects are resolved, validated, and pinned
  independently. An actual socket test reaches an otherwise-unresolvable host
  exclusively through its supplied pin; focused provider, redirect, ingestion,
  private-address, and website-connector tests pass (47 assertions total), and
  `@romeo/core` strict typechecking passes. A deployment egress-proxy or equivalent
  infrastructure-layer rebinding drill remains a separate unchecked defense-in-
  depth gate.
- 2026-07-17: the live PostgreSQL/S3 retention drill now generates its image
  through Romeo's real `/api/v1/images/generations` path and a controlled
  OpenAI-compatible HTTP endpoint instead of pre-labeling an uploaded fixture.
  It proves environment-secret authorization, outbound model/prompt/response-
  format serialization, revised-prompt handling, exact PNG persistence through
  `S3ObjectStore`, governed `generated_image` catalog metadata, one-image usage,
  40,000-micro-USD estimated-cost accounting, policy expiry, tombstoning, and
  object-store read-after-delete. Prompt, credential, endpoint, storage, object,
  and revised-prompt sentinel scans were clean. Updated evidence:
  `dist/evidence/live-retention-object-store-acceptance.json`; log:
  `/tmp/romeo-retention-object-store.log`. The credentialed target-deployment
  image-provider gate remains unchecked until that deployment selects and
  supplies an image-capable provider.
- 2026-07-17: `pnpm evidence:image:credentialed-live` now provides a fail-honest
  target-provider collector. Its controlled positive contract exercised the real
  image API, provider credential resolution, signature/dimension validation,
  governed file/object persistence, usage recording, API deletion, tombstoning,
  and object read-after-delete; every check passed in
  `dist/ci/live-image-provider-collector-contract.json`. With no target image
  endpoint/model/key in this environment, the canonical deployment artifact is
  explicitly `not_configured` with every behavioral check false at
  `dist/evidence/live-image-provider-acceptance.json`; it is not counted as live
  external-provider proof.
- 2026-07-17: `pnpm evidence:anthropic:controlled-live` passed native Anthropic
  positive-path acceptance over an actual loopback HTTP/SSE server. Romeo used
  `/v1/models` and two `/v1/messages` requests with the API key and
  `anthropic-version` header. The first request serialized a system prompt,
  base64 image, tool definition, and streamed text/input-output usage plus a
  fragmented `tool_use`; the second serialized the assistant tool call and user
  `tool_result`, then streamed final text and usage. Evidence contains only
  counts/booleans and no endpoint, key, prompts, image body, tool result,
  response text, or provider payload. Evidence:
  `dist/evidence/live-anthropic-protocol-acceptance.json`; log:
  `/tmp/romeo-anthropic-protocol.log`. The three credentialed Anthropic-cloud
  checks remain explicitly unchecked because no `ANTHROPIC_API_KEY` or selected
  deployment model is available in this environment.
- 2026-07-17: `pnpm evidence:anthropic:credentialed-live` now provides the same
  fail-honest boundary for a selected Anthropic deployment. A controlled
  positive contract passed model discovery, initial streamed text and usage,
  PNG vision input, native tool use, serialized tool result, final continuation,
  and evidence redaction in
  `dist/ci/live-anthropic-credentialed-collector-contract.json`. The canonical
  deployment artifact at
  `dist/evidence/live-anthropic-credentialed-acceptance.json` is explicitly
  `not_configured` because no target key/model is present, so the three external
  Anthropic gates remain unchecked.
- 2026-07-17: `pnpm evidence:web-search:controlled-live` passed all three governed
  search protocols over actual loopback HTTP. SearXNG sent GET `q` plus
  `format=json` without a credential; Brave sent GET `q`, `count`, and its
  subscription token; Tavily sent POST JSON `query`, `max_results`, and Bearer
  authorization. Romeo parsed provider-specific result envelopes, persisted
  healthy status, and retained no endpoint, key, query, raw payload, or result
  snippet in evidence. Evidence:
  `dist/evidence/live-web-search-protocol-acceptance.json`; log:
  `/tmp/romeo-web-search-protocol.log`. Deployment-selected live endpoints remain
  unchecked because no SearXNG URL, Brave key, or Tavily key is configured.
- 2026-07-17: `pnpm evidence:web-search:deployment-live` adds a fail-honest
  deployment collector for exactly one selected `searxng`, `brave`, or `tavily`
  endpoint. It requires real results and verifies credential resolution where
  applicable, normalized provenance/access times, persisted health, usage, DNS
  policy, and socket pinning. The canonical artifact is explicitly
  `not_configured` at
  `dist/evidence/live-web-search-deployment-acceptance.json`, rather than
  presenting controlled protocol proof as a deployment pass. Governed provider
  requests now also have a configured hard abort across request and body parsing;
  timeout behavior passed focused service tests, and Helm plus Compose environment
  contracts passed with `WEB_SEARCH_TIMEOUT_MS=12000` as the documented default.
- 2026-07-17: the post-hardening full `pnpm verify` run passed 1,210 ordinary
  tests across 124 test files (plus four intentionally credential-gated database
  tests in the ordinary non-PostgreSQL run), every workspace strict typecheck,
  every build, OpenAPI public-route coverage, 410-operation Python SDK drift,
  and app bundle budgets. The same change set had already passed fresh PostgreSQL
  conformance with zero skips, explicit two-tenant feature isolation, full-API
  sentinel log redaction, provider-failure redaction, DNS-pinned web-transport
  tests, and live multi-replica/load evidence. `pnpm release:security` refreshed
  CycloneDX plus live `pnpm audit --prod` evidence with zero info, low, moderate,
  high, or critical dependency findings. This satisfies the repository
  security/redaction/tenant-isolation completion gate; container-image scanning,
  deployment egress enforcement, and immutable-backup proof remain separately
  represented by their own deployment gates. Evidence/logs:
  `dist/release/security-evidence.json`,
  `dist/ci/tenant-isolation-negative-suite.json`,
  `dist/evidence/live-log-redaction-acceptance.json`, and
  `/tmp/romeo-verify-post-collectors.log`. The controlled Anthropic and
  SearXNG/Brave/Tavily protocol acceptances are now mandatory `pnpm verify`
  steps, so their evidence cannot silently drift while cloud credentials are
  absent.
