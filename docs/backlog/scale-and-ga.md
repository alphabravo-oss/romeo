# Backlog Track: Scale And GA

This track defines the work required to operate Romeo as a complete product at meaningful scale. It should not be treated as polish; it contains the evidence, operational controls, and reliability work needed before broad production use.

Concrete execution tickets for Phase 32 through Phase 35 live in [Scale And GA Execution Backlog](./execution/scale-and-ga.md).

## Phase 32: Analytics, Quality, And Retrieval Tuning

### Objective

Give admins and builders trustworthy visibility into model quality, retrieval behavior, tool behavior, usage, and regressions.

### Scope

- Evaluation dashboards.
- Retrieval experiment configuration.
- Corpus replay and golden datasets.
- Optional external vector-store comparison.
- Model/provider quality analytics.
- Admin reports and exportable evidence.

### Tasks

1. Evaluation data model:
   - Store eval suites, cases, expected outputs, expected tool calls, expected citations, scoring results, model/provider configuration, and run metadata.
   - Keep raw eval inputs scoped and governed by workspace visibility.
   - Track versioned agent, prompt, model, retrieval, and tool configuration for every eval run.
   - Add retention policy for eval artifacts.

2. Retrieval tuning:
   - Add configurable rank-fusion weights for vector, lexical, recency, source authority, source visibility, and customer-specific corpus weighting.
   - Require corpus evidence before changing defaults.
   - Add offline replay over representative corpora.
   - Compare pgvector and optional Qdrant paths where deployments use Qdrant.
   - Track citation precision, recall, latency, and no-answer behavior.

3. Model and tool analytics:
   - Track latency, cost, token usage, error rates, approval rates, tool success, tool failures, and provider fallback.
   - Add dashboard filters by org, workspace, agent, provider, model, connector, tool, and time range.
   - Keep dashboards redacted and role-scoped.
   - Add anomaly indicators for provider failures, cost spikes, and unusual tool approval rates.

4. Quality gates:
   - Add release gates for critical eval suites.
   - Add regression thresholds for retrieval quality, tool-call accuracy, latency, and error rate.
   - Require explicit approval to ship with known quality regressions.
   - Store release evidence for quality gates.

5. Exports:
   - Add CSV or JSON exports for eval results, usage summaries, model/provider reliability, and retrieval metrics.
   - Redact prompt, source, and tool payload content unless the export scope and permissions explicitly allow it.
   - Include enough metadata for reproducibility.

### Definition Of Done

- Admins can inspect eval outcomes, retrieval quality, provider reliability, and tool behavior.
- Retrieval weighting changes are backed by corpus replay evidence.
- Release quality gates can block promotion.
- Analytics are role-scoped and redacted.
- Exports are reproducible and safe by default.

### Testing

- Eval data model and scoring tests.
- Retrieval replay tests with seeded corpora.
- Dashboard authorization tests.
- Export redaction tests.
- Quality-gate pass/fail tests.
- pgvector versus optional Qdrant comparison tests where Qdrant is enabled.

### Validation

- A release candidate can run a required eval suite and produce evidence.
- Retrieval changes show before/after metrics on representative data.
- Users without workspace access cannot view eval artifacts or analytics for that workspace.

## Phase 33: SaaS And Multi-Tenant Hardening

### Objective

Prepare Romeo for hosted multi-tenant operation, stronger tenant isolation, abuse controls, billing operations, support tooling, and privacy obligations.

### Scope

- Tenant lifecycle and isolation checks.
- Rate limits and quotas.
- Abuse prevention.
- Billing operations and entitlements.
- Data residency, deletion, export, and support workflows.
- Incident and compliance runbooks.

### Tasks

1. Tenant lifecycle:
   - Add org creation, suspension, reactivation, deletion request, and final deletion workflows.
   - Ensure suspended tenants cannot run models, tools, connectors, workflows, or new uploads.
   - Preserve billing and audit evidence according to retention rules.
   - Add tenant-level configuration export for support.

2. Isolation and authorization:
   - Add automated tests for cross-tenant reads and writes across every API group.
   - Review database queries for missing org/workspace predicates.
   - Add service-layer guardrails so repository methods receive scoped principals.
   - Add audit events for denied cross-tenant access attempts where useful.

3. Rate limits and quotas:
   - Use Valkey or equivalent for distributed request limits, run limits, upload limits, connector sync limits, worker concurrency limits, and provider call limits.
   - Enforce plan entitlements at service boundaries.
   - Add admin overrides with expiry and audit.
   - Add user-visible quota status where appropriate.

4. Abuse controls:
   - Add controls for suspicious signup, excessive uploads, provider cost spikes, tool abuse, connector sync storms, and notification spam.
   - Add WAF or ingress guidance for public SaaS.
   - Add emergency kill switches by org, provider, connector, tool, and worker class.
   - Keep kill switches audited.

5. Billing operations:
   - Add plan lifecycle, trial handling, subscription changes, invoice status, usage metering, overage behavior, and entitlement reconciliation.
   - Add billing admin exports.
   - Keep provider webhook idempotency and signature validation.
   - Add reconciliation jobs against provider state.

6. Privacy and data rights:
   - Add export and deletion request workflows.
   - Classify data by retention policy.
   - Track deletion progress across database, object storage, search/vector indexes, logs, and backups.
   - Document backup retention limitations.
   - Add data residency notes where deployments require region pinning.

7. Support tooling:
   - Add sanitized support bundles with config posture, readiness findings, logs metadata, recent job IDs, version, chart values hash, and dependency health.
   - Exclude secrets, prompts, document bodies, tokens, and raw payloads.
   - Tie support access to Phase 23 support policy.

### Definition Of Done

- Cross-tenant authorization tests cover all API and worker surfaces.
- Rate limits and quotas work across multiple app instances.
- Suspended tenants cannot incur new provider/tool/worker activity.
- Billing entitlements are enforced and reconcilable.
- Deletion/export workflows are documented and tested.
- Support bundles are useful and redacted.

### Testing

- Cross-tenant negative tests for every API group.
- Distributed rate-limit tests with multiple app instances.
- Quota and entitlement tests.
- Billing webhook idempotency and reconciliation tests.
- Tenant suspension and reactivation tests.
- Data deletion and export tests.
- Support bundle redaction tests.

### Validation

- Attempted cross-tenant access fails even when IDs are guessed.
- A suspended tenant cannot create new cost-incurring work.
- Data deletion produces evidence for every storage class.
- Support bundle review finds no sensitive content.

## Phase 34: Scale, Performance, And Resilience

### Objective

Prove Romeo can handle expected production load, recover from common failures, and degrade safely under provider, database, worker, and network pressure.

### Scope

- Scale targets.
- Load and soak testing.
- Database index and query-plan review.
- Worker throughput and backpressure.
- Provider circuit breakers.
- Object-store upload behavior.
- Chaos and failure drills.

### Tasks

1. Scale targets:
   - Keep target tiers for small self-hosted, enterprise self-hosted, and hosted SaaS current in `docs/deployment-sizing.md`.
   - Specify concurrent users, chats, runs, workflow resumes, connector syncs, uploads, notifications, webhooks, tool dispatches, browser tasks, and eval runs.
   - Define latency, error-rate, cost, and queue-lag SLOs.
   - Define maximum supported artifact sizes and retention assumptions.

2. Load fixtures:
   - Build synthetic data generators for orgs, users, workspaces, agents, chats, runs, messages, knowledge chunks, connectors, workflows, audits, notifications, and billing events.
   - Build load drivers for chat, retrieval, upload, workflow resume, connector sync, tool dispatch, notification retry, and admin listing.
   - Keep fixtures free of real secrets and customer data.

3. Database performance:
   - Review query plans under representative volume.
   - Add indexes where query plans prove need.
   - Track slow queries and lock contention.
   - Tune connection pool settings for app and workers.
   - Define archival or partitioning strategy for high-volume audit, run events, job events, and usage tables if needed.

4. Worker backpressure:
   - Add concurrency limits by worker class.
   - Keep the implemented metadata-only job lag summary API/CLI/SDK surface green, and map its alert state into production monitoring.
   - Keep the Prometheus operational exporter and alert-rule validation green.
   - Add provider and connector rate-limit backoff.
   - Prevent a failing connector or provider from starving unrelated work.
   - Add dead-letter monitoring and replay controls.

5. Provider resilience:
   - Keep the implemented idle stream timeout, metadata-only failure events, pre-output retry, circuit-breaker, fallback, and kill-switch behavior green.
   - Keep metadata-only provider operational summary coverage for circuit, fallback, kill-switch, model-count, status, and alert-code visibility green.
   - Avoid retrying unsafe external side effects.
   - Keep provider operational summary signals mapped through the Prometheus operational exporter/rules contract.
   - Run live provider outage drills against the selected production provider classes.

6. Object store and uploads:
   - Validate multipart or resumable upload path if large uploads are supported.
   - Add artifact cleanup for failed uploads.
   - Add object-store latency and failure handling.
   - Verify restored database records still match object-store artifacts after DR.

7. Failure drills:
   - Simulate Postgres restart, Valkey restart, object-store outage, provider outage, worker crash, network partition, slow provider, failed migration, failed backup upload, and expired secrets.
   - Define expected behavior, alerts, and recovery steps.
   - Record evidence from each drill.

### Definition Of Done

- Scale targets are published and tied to test evidence.
- Load tests cover key user and worker paths.
- Query plans are reviewed for high-volume tables.
- Backpressure prevents worker storms and provider overload.
- Failure drills have documented results and fixes.
- SLO dashboards and alerts exist for production paths.

### Testing

- Load tests at each target tier.
- Soak tests for long-running workers and workflow resume.
- Database query-plan tests or recorded plan review.
- Provider failure injection tests.
- `pnpm smoke:providers:resilience` for pre-output retry, no-retry-after-output, circuit fail-fast, fallback before output, kill-switch fallback, and provider error redaction.
- Worker crash and retry tests.
- `pnpm smoke:jobs:lag` for metadata-only queued-lag, stale-running, and recent-failure alert-state evidence.
- Object-store outage and upload cleanup tests.
- Backup/restore under loaded data volume.

### Validation

- Romeo meets defined SLOs under target load.
- Backpressure keeps the system responsive during provider failures.
- Restored environments pass readiness and data-integrity checks.
- Alerts fire for queue lag, backup failure, provider outage, and high error rate in the selected production monitoring stack.

## Phase 35: Documentation, Supportability, And GA Exit

### Objective

Close the product-completion loop with installation docs, operator runbooks, developer docs, security docs, support procedures, and explicit GA acceptance criteria.

### Scope

- Compose install guide.
- Kubernetes install guides for external Postgres and CloudNativePG.
- Upgrade, backup, restore, DR, and rollback runbooks.
- Security hardening guide.
- Admin, developer, connector, worker, and SDK docs.
- Troubleshooting and support bundle.
- GA checklist.

### Tasks

1. Installation docs:
   - Write Compose quickstart and self-hosted production guide.
   - Write Kubernetes guide for external hosted Postgres.
   - Write Kubernetes guide for CloudNativePG-managed Postgres.
   - Write private and air-gapped install guide.
   - Include required secrets, minimum resources, supported versions, ports, storage classes, and network egress.
   - Clearly label development-only settings.

2. Operations runbooks:
   - Backup, restore, and DR drill.
   - Upgrade and rollback.
   - Rotating secrets.
   - Provider outage response.
   - Queue backlog response.
   - Failed migration response.
   - Expired OIDC/JWKS or OAuth configuration response.
   - Object-store recovery.
   - Tenant suspension and deletion.

3. Security documentation:
   - Document authentication modes, OIDC, account-linking policy, SCIM if present, RBAC, support access, secret management, connector egress, tool execution, browser automation, audit, redaction, retention, and data deletion.
   - Document Kubernetes hardening and NetworkPolicy examples.
   - Document Compose security limits and reverse proxy guidance.
   - Document threat models for risky workers.

4. Product docs:
   - Admin guide.
   - Builder guide for agents, tools, workflows, knowledge, evals, voice, and notifications.
   - Connector setup guides.
   - Native client guides where clients exist.
   - SDK and CLI reference.
   - API reference generated from OpenAPI.

5. Supportability:
   - Add a sanitized support bundle command.
   - Add readiness report export.
   - Add version and dependency status output.
   - Add log correlation guidance.
   - Add known-failure troubleshooting pages.
   - Add support escalation checklist.

6. GA checklist:
   - Durable Postgres baseline locked and upgrade-tested.
   - Compose install passes from empty state and after restore.
   - Kubernetes install passes with external Postgres.
   - Kubernetes install passes or documented validation passes with CloudNativePG.
   - Release pipeline publishes and reads back artifacts.
   - Critical security and redaction tests pass.
   - Cross-tenant tests pass where SaaS is enabled.
   - Required eval suites pass.
   - Load tests meet target tier.
   - Backup/restore and DR drill pass.
   - Docs are reviewed against the released artifact versions.

### Definition Of Done

- Operators can install, upgrade, back up, restore, troubleshoot, and secure Romeo using the docs.
- Developers can use the API, SDKs, CLI, connector patterns, and worker patterns without reading internal code first.
- Support can collect useful evidence without exposing secrets or customer content.
- GA has objective pass/fail criteria tied to test and release evidence.

### Testing

- Docs-following test for Compose from a clean machine.
- Docs-following test for Kubernetes external Postgres.
- CloudNativePG path validation where an operator is available.
- Air-gapped bundle verification.
- `pnpm release:airgap-check -- --require-readback-validation` evidence for private/disconnected release bundles.
- Runbook tabletop exercises for outage, restore, failed migration, and secret rotation.
- Link check and command check for docs.
- Support bundle redaction test.

### Validation

- A fresh operator can follow the docs without private tribal knowledge.
- Every command in install and runbook docs is either tested or clearly marked as environment-specific.
- GA checklist evidence is stored with the release.
- No GA-blocking item remains open without a documented owner and exception approval.

## GA Exit Criteria

Romeo is full-product complete when these statements are true:

- Production state is durable in Postgres with pgvector, validated migrations, backup/restore, and DR drill evidence.
- Docker Compose can run a self-hosted install with durable Postgres, Valkey, object storage, workers, readiness, backup, and restore.
- Kubernetes can run Romeo with either CloudNativePG-managed Postgres or external hosted Postgres through the same app contract.
- Release artifacts are tested, scanned, versioned, published, and read back.
- Identity, authorization, audit, redaction, support access, and deprovisioning behavior are tested.
- Connector, tool, workflow, notification, voice, and browser automation capabilities that are enabled by default have safe execution boundaries.
- Optional risky capabilities are disabled by default and have explicit deployment docs.
- Scale, resilience, and quality evidence match the target deployment tier.
- Documentation is sufficient for install, operation, development, security review, and support.

## Track Sequencing

Phase 32 and Phase 34 should begin once durable Postgres is stable enough to generate representative data. Phase 33 is required before hosted SaaS launch, but may be partially deferred for single-tenant enterprise deployments. Phase 35 should run continuously, with final GA evidence collected after every other required phase is accepted.
