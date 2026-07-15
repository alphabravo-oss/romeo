# Execution Backlog: Platform Closeout

This file covers the remaining Phase 19 and Phase 20 work. These tickets are the critical path before Romeo can claim durable self-hosted readiness.

## HAM-P19-01: Baseline SQL Review And Lock

Phase: 19 Durable Postgres Baseline.

Depends on: current Drizzle schema candidate and live migration success.

Goal: accept one tight greenfield baseline migration and prevent corrective migration churn.

Current status: accepted and locked in [Romeo Greenfield Baseline Lock](../baseline-lock.md). The locked baseline is `packages/db/migrations/0000_greenfield_baseline.sql`; future schema changes require forward-only migrations with upgrade tests and rollback or mitigation notes.

Scope details:

- Review `packages/db/migrations/0000_greenfield_baseline.sql` against the final Phase 19 schema.
- Confirm pgvector extension setup, table ownership boundaries, foreign keys, cascades, natural unique constraints, indexes, check constraints, lifecycle columns, and migration-entrypoint behavior.
- Keep shortened explicit foreign-key names for relationships that would otherwise exceed PostgreSQL's identifier limit.
- Run `pnpm review:baseline -- --strict` to verify the static SQL contract before a lock decision.
- Record which schema decisions are locked and which are deliberately deferred.

Tasks:

- Maintain the schema-domain checklist as new product work proposes schema changes.
- Compare future repository list/query paths to required indexes before adding migrations.
- Compare future governed deletion and retention requirements to cascade and soft-delete behavior before adding migrations.
- Keep `romeo.greenfield-baseline-review.v1` evidence from the static review command current for release packets.
- Preserve the lock decision in PRD/backlog evidence.

Definition of done:

- The baseline migrates an empty database without manual intervention.
- `pnpm validate:postgres` passes after migration and after restore.
- SQL review has no unresolved ownership, cascade, constraint, index, pgvector, or lifecycle blockers.
- Baseline review strict mode passes with no PostgreSQL identifier-length decisions remaining.
- No corrective migration files are created after the baseline lock.

Testing:

- Empty database migration test.
- Schema validator live test.
- Restore validation test.
- Repository conformance smoke against the migrated baseline.

Validation and evidence:

- `postgres-schema-validation.json`.
- SQL review checklist.
- Strict static baseline review evidence.
- Restore drill evidence.
- Explicit baseline lock note with accepted follow-up migration policy.

Compose and Kubernetes impact:

- Compose and Helm migration jobs continue to run the same `pnpm migrate:postgres` command.
- No chart or Compose path may assume a different schema initialization command.

Security and migration notes:

- Migration logs must not print database URLs or credentials.
- After lock, future schema changes become forward-only migrations with rollback notes and upgrade tests.

## HAM-P19-02: Repository Method Conformance Closure

Phase: 19 Durable Postgres Baseline.

Depends on: baseline candidate and reusable Postgres repository factory.

Goal: prove every service-facing repository method behaves correctly on Postgres or has an explicit development-only waiver.

Current status: closed for Phase 19 baseline lock. Strict method coverage now passes with 229 directly covered repository contract methods, zero uncovered methods, and no waivers. The expanded shared suite passed against both the default in-memory fixture and isolated migrated pgvector/PostgreSQL 18 databases. The repository contract now includes an explicit transaction boundary with rollback coverage plus delegated OAuth refresh-lock coverage. Agent publish, run completion terminal usage, connector sync finalization, workflow resume finalization, governed data deletion, tool-dispatch enqueue/approval consumption, tool-dispatch approval decisions, tool-dispatch readback, usage metadata updates, organization create/update/read, knowledge-base metadata updates, knowledge upload registration, uploaded source completion, deferred knowledge extraction completion, knowledge source reindexing, and knowledge-source deletion have failure-injection or conformance coverage proving primary writes roll back or persist safely as appropriate. Cross-scope negative authorization evidence now covers connector sync, workflow resume, and governed data deletion.

Scope details:

- Build a repository method inventory from the contract.
- Map each method to domain, authorization caller, transaction boundary, idempotency behavior, ordering behavior, and redaction impact.
- Extend shared conformance tests until memory and Postgres behavior match where services depend on it.

Tasks:

- Maintain the method coverage matrix and keep it strict.
- Generate `romeo.repository-conformance-coverage.v1` evidence with `pnpm review:repository-conformance -- --strict`.
- Keep tests for ordering, pagination, uniqueness, lifecycle transitions, soft deletion, hard deletion, and authorization-facing lookup behavior.
- Keep transaction failure-injection tests for publish, run completion terminal usage, connector sync finalization, workflow resume finalization, governed data deletion, dispatch enqueue/approval consumption, dispatch approval decisions, and dispatch readback.
- Keep negative authorization tests for cross-scope connector sync, workflow resume, governed data deletion, and object-grant denials.
- Add redaction-sensitive tests for audit, usage, job, webhook, notification, connector sync, and worker metadata.
- Document any method that is intentionally memory-only or development-only.

Definition of done:

- Every repository method is covered by shared conformance or documented as a waiver.
- Postgres conformance runs against isolated migrated pgvector databases.
- No service path silently depends on in-memory-only semantics.
- Transaction failure cases leave retryable, consistent state.

Testing:

- `pnpm test:postgres-conformance` with `ROMEO_POSTGRES_CONFORMANCE_DATABASE_URL`.
- `pnpm review:repository-conformance -- --strict`.
- Unit tests for fragment-specific behavior.
- Failure-injection tests using deliberate thrown errors or rollback hooks.
- Negative authorization tests for cross-org and cross-workspace lookups.

Validation and evidence:

- `postgres-conformance.json`.
- Method coverage matrix.
- Repository conformance coverage evidence.
- Waiver list, if any, with owner and removal condition; current method coverage uses no waivers.

Compose and Kubernetes impact:

- Conformance should run independently from Compose and Kubernetes, but it must use the same migration file they use.
- CI should be able to run the suite against a pgvector service.

Security and migration notes:

- Conformance must include redaction-sensitive records so repository fixes cannot accidentally persist raw payloads.
- Do not add schema changes through extra migration files before HAM-P19-01 is locked.

## HAM-P19-03: Production Secret Rotation And Config Posture

Phase: 19 Durable Postgres Baseline and Phase 20 Compose Product Install.

Depends on: production readiness checks and deployment env contracts.

Goal: document and test how operators rotate secrets without losing sessions, corrupting webhook verification, or leaking old values.

Current status: mostly implemented for Compose, backend/API readback, and documented Kubernetes policy. [Secret Rotation Runbook](../../secret-rotation.md) now documents Compose and Kubernetes rotation policy for `SESSION_SECRET`, `WEBHOOK_SIGNING_KEY`, API/service keys, database credentials, object-store credentials, provider credentials, and managed connector secret refs. `SESSION_SECRET_PREVIOUS` is supported for staged dual-read of in-flight OIDC PKCE state cookies only; new state is signed with `SESSION_SECRET`, local `rms_` sessions remain opaque hashed tokens, and explicit session/key revocation handles user-session invalidation. Readiness now validates unsafe `SESSION_SECRET_PREVIOUS` staging. `pnpm smoke:compose:secret-rotation` proves a live Compose app can rotate to a new `SESSION_SECRET` with `SESSION_SECRET_PREVIOUS`, preserve API-key continuity, rotate `WEBHOOK_SIGNING_KEY` so newly created webhook subscriptions derive a different one-time signing secret, remove `SESSION_SECRET_PREVIOUS`, and keep old/new secrets out of Compose logs. `pnpm evidence:secret-rotation-drill`, `SECRET_ROTATION_DRILL_EVIDENCE_PATH`, `GET /api/v1/admin/secret-rotation/drill-posture`, and `client.admin.secretRotationDrillPosture()` now provide metadata-only target secret-rotation evidence generation and mounted readback for staged cutover, local MFA and managed-secret envelope rewrap, old/new secret acceptance, dependency credential review, readiness, alerting, warning, and redaction posture without returning secret refs, secret values, tokens, API keys, key material, webhook signing secrets, log lines, evidence bodies, or mounted paths. Webhook signing-key rotation remains a coordinated subscriber cutover because webhook subscription secrets are derived and raw secrets are not persisted. Executing and mounting target Kubernetes or production-like secret-rotation drill evidence remains open.

Scope details:

- Cover `SESSION_SECRET`, `WEBHOOK_SIGNING_KEY`, API keys, service keys, object-store credentials, database credentials, OIDC settings, connector managed-secret references, and provider keys.
- Distinguish secrets that can rotate live from secrets that need staged dual-read or session invalidation.

Tasks:

- Write rotation runbooks for Compose and Kubernetes.
- Add readiness warnings for known development/default secret values.
- Keep tests for session invalidation or dual-secret behavior, depending on accepted policy.
- Keep log scans around rotation flows.
- Document External Secrets or equivalent integration for Kubernetes.

Definition of done:

- Operators know the exact rotation process and blast radius for each secret class.
- Production readiness identifies unsafe default or missing secret posture.
- Rotating a secret does not expose old or new values in logs, audits, jobs, or support bundles.

Testing:

- Unit tests for secret metadata redaction.
- API tests for old session/API key behavior after revocation or rotation.
- `pnpm smoke:compose:secret-rotation` for session-secret staging and webhook-signing-key cutover.
- Kubernetes documentation test with Secret update and rollout commands.

Validation and evidence:

- Secret rotation runbook evidence.
- Redacted log scan evidence.
- Readiness report before and after rotation.
- Target secret-rotation drill evidence, including `romeo.secret-rotation-drill-evidence.v1`.

Compose and Kubernetes impact:

- Compose `.env.example` must clearly mark rotation-sensitive values.
- Kubernetes docs must support native Secrets and External Secrets-managed Secrets.

Security and migration notes:

- Never persist raw secret values as rotation evidence.
- Prefer key identifiers, hashes, creation timestamps, and revocation state.

## HAM-P20-01: Compose Product Workflow Smoke Expansion

Phase: 20 Docker Compose Product Install.

Depends on: current Compose smoke, object-store DR smoke, and seeded-login-disabled app path.

Goal: prove Compose can run a representative product workflow from clean state through restart without relying on process-local memory.

Current status: mostly implemented for the current Compose product surface. `pnpm smoke:compose` now creates durable chat, knowledge-source, attachment, run, usage, audit, notification, notification-delivery, and webhook-delivery records with seeded login disabled, restarts the app, restarts Valkey, RustFS, and Postgres one service at a time, re-reads the records, redacted webhook delivery payload metadata, and attachment bytes through public/admin APIs after each restart, validates schema inside the container, and scans Compose logs for generated secrets plus generated raw prompt/comment/document/webhook sentinels. `pnpm smoke:compose:workers` now extends raw-content inspection to worker stdout/stderr and Compose logs for a controlled workflow-resume prompt sentinel. `pnpm smoke:kubernetes:log-redaction` now provides the focused Kubernetes pod/job scan for operator-supplied prompt, provider-payload, worker-payload, and secret sentinels without storing the sentinel values. Remaining work is live execution of that harness, plus the existing GA live-smoke log checks, against the selected Kubernetes namespace.

Scope details:

- Exercise organization admin auth, workspace, agent, model/provider settings, chat, run, knowledge source, usage event, notification ledger, webhook or audit event, object-store artifact, and readiness.
- Re-read records through public or admin APIs after app restart.

Tasks:

- Extend the smoke helper with focused workflow creation utilities instead of a large all-purpose helper.
- Keep a minimal chat run with durable usage records.
- Register or upload a knowledge artifact and verify authenticated readback.
- Verify usage, audit, job, notification, and webhook delivery records contain metadata only.
- Keep app, Valkey, object store, and Postgres one-at-a-time restart readback coverage current.
- Re-run readiness and re-read all workflow records.

Definition of done:

- A clean Compose install can migrate, seed explicitly, disable seeded login, pass readiness, run the workflow, restart services, and preserve state.
- No workflow evidence depends on in-memory repository state.
- Logs and evidence contain no generated secrets or raw prompt/comment/document/webhook payload bodies in the Compose app path.

Testing:

- `pnpm smoke:compose`.
- Focused smoke assertions for workflow records, webhook delivery readback, and artifact readback.
- Restart persistence checks for app, Postgres, Valkey, and object store.
- Negative unauthenticated API checks after seeded login is disabled.

Validation and evidence:

- `compose-smoke.json`.
- Captured redacted readiness report.
- Captured redacted generated-secret and raw-content log scan result.

Compose and Kubernetes impact:

- The workflow should use commands and env names that have direct Helm equivalents.
- Do not add Compose-only API behavior.

Security and migration notes:

- Generated test prompts and documents should still be treated as sensitive and excluded from logs.
- Any schema gap found during smoke expansion must follow the post-lock forward-migration policy in [Romeo Greenfield Baseline Lock](../baseline-lock.md).

## HAM-P20-02: Long-Running Worker Restart And Backpressure Smoke

Phase: 20 Docker Compose Product Install.

Depends on: one-shot worker smoke and worker API key support.

Goal: prove worker loops survive restart and respect bounded concurrency without leaking secrets.

Current status: implemented for the current Compose worker surface, with a guarded Kubernetes execution harness waiting on live cluster execution. The CLI worker loops now check abort signals after each iteration before sleeping, so graceful shutdown/restart does not wait for a long interval. `pnpm smoke:compose:workers` runs the one-shot workers, starts, restarts, and stops the workflow-resume, webhook-retry, and notification-retry loop-worker services with short test intervals, records post-restart iteration evidence in `loopRestarts`, creates a controlled pending workflow run, SIGKILLs and restarts the workflow-resume service, verifies recovery to `waiting_approval`, and asserts no duplicate linked model run or workflow run was created. `pnpm smoke:kubernetes:workers` now targets an existing Helm release, starts Jobs from the rendered core worker CronJobs, validates metadata-only output, force-deletes a running workflow-resume pod, reruns workflow-resume, and verifies no duplicate linked run or workflow run. `/api/v1/jobs/operational-summary`, TypeScript/Python SDK generation, CLI `romeo jobs summary`, and `pnpm smoke:jobs:lag` now provide metadata-only queued-lag, stale-running, and recent-failure alert-state evidence without returning job payloads. Remaining work is executing Kubernetes worker evidence in a reachable selected cluster, future worker-class crash cases as those queues land, and live alert firing against the production monitoring stack.

Scope details:

- Cover data connector sync, workflow resume, webhook retry, notification retry, retention enforcement, knowledge extraction, and voice catalog sync.
- Run both `--once` and bounded loop modes where supported.

Tasks:

- Add Compose smoke coverage that starts worker profiles with generated scoped API keys.
- Keep restart coverage for workflow-resume, webhook-retry, and notification-retry idle loop services.
- Keep crash/restart coverage during a controlled pending-work case.
- Verify workers resume without duplicate unsafe side effects.
- Keep worker output scans for secrets, bearer tokens, and raw workflow prompts; expand to document bodies, connector payloads, and provider payloads as those worker paths execute out of process.
- Keep metadata-only queue or job lag summaries wired through API, CLI, SDKs, and CI smoke evidence.

Definition of done:

- Worker loops can be restarted without corrupting durable state.
- Duplicate work is prevented or idempotent.
- Worker logs are metadata-only.
- Operators can inspect queue lag and stale running jobs without exposing raw job payloads.
- Backpressure and max-iteration settings are documented.

Testing:

- `pnpm smoke:compose:workers`.
- `pnpm smoke:jobs:lag`.
- Long-running worker smoke with bounded loop services.
- Unit tests for graceful abort before interval sleep.
- Crash/restart tests for pending workflow resume; add webhook retry crash coverage when a controlled durable delivery case is available without external egress.
- Redaction tests for worker stdout/stderr and Compose logs.

Validation and evidence:

- `compose-workers-smoke.json`.
- Worker restart evidence; current smoke evidence records `loopRestarts` for workflow-resume and webhook-retry plus `workflow_resume_sigkill_recovery`.
- Redacted log scan report covering generated secrets and workflow raw-prompt sentinels.

Compose and Kubernetes impact:

- Compose loop settings should map to Kubernetes CronJob or Deployment settings.
- Kubernetes worker templates must keep separate ServiceAccounts and scoped secrets.

Security and migration notes:

- Worker jobs must store metadata only unless a specific retained artifact policy exists.
- If new worker state is required, it must follow the post-lock forward-migration policy in [Romeo Greenfield Baseline Lock](../baseline-lock.md).

## HAM-P20-03: Raw Prompt, Provider Payload, And Connector Payload Redaction Review

Phase: 20 Docker Compose Product Install, with coverage across all later phases.

Depends on: current generated-secret log scanning.

Goal: move beyond generated-secret scanning and prove sensitive product content does not leak into operational surfaces.

Current status: partially implemented for in-repository operational metadata, the main Compose app path, and the current Compose worker path. `packages/core/src/redaction-sentinels.test.ts` now drives run prompts, local connector ingestion, chat comments/notifications, webhook test payloads, generated webhook signing secrets, and compliance report exports with unique sentinels, then scans audit logs, usage events, background jobs, connector sync summaries, notification ledgers, webhook subscriptions, webhook delivery records, and compliance JSON/CSV exports. Webhook delivery persistence now stores only a redacted key summary while the initial outbound webhook still receives the intended event body. `pnpm smoke:compose` now injects generated raw prompt/comment/document sentinels into the live Compose product workflow and scans captured Compose logs for them alongside generated secrets. `pnpm smoke:compose:workers` now injects raw workflow prompt sentinels into controlled workflow-resume work, verifies worker output summarizes run/step metadata without raw input or output values, and scans worker stdout/stderr plus Compose logs for those sentinels. `pnpm smoke:kubernetes:log-redaction` adds a deployment-agnostic Kubernetes pod/job scan for prompt, provider-payload, worker-payload, and secret sentinels. Remaining work is live execution in the selected namespace, broader provider/connector payload worker cases as out-of-process workers land, and future support-bundle coverage when that export exists.

Scope details:

- Review logs, audit metadata, usage metadata, job metadata, webhook delivery records, connector sync summaries, run events, support bundles, and release evidence.
- Include raw prompts, completions, document bodies, provider request/response payloads, connector payloads, notification message bodies, webhook secrets, bearer tokens, and object-store credentials.

Tasks:

- Keep the API/repository redaction fixture current as new metadata writers are added.
- Drive representative worker flows with raw product-content sentinels, not only generated secrets.
- Scan Compose logs, worker stdout/stderr, Kubernetes pod logs, job logs, and persisted metadata exports.
- Keep regression tests around known risky metadata writers, especially webhook delivery records and connector sync summaries.
- Document any intentional retained content and its retention/access policy.

Definition of done:

- Sensitive sentinels do not appear in logs, audits, usage, jobs, webhook records, sync summaries, support bundles, or release evidence.
- Any retained prompt/document content is only in the intended user-facing resource or object-store artifact path with authorization.
- Redaction tests run in CI.

Testing:

- Sentinel-based API tests; current coverage is `packages/core/src/redaction-sentinels.test.ts`.
- Worker redaction tests.
- Compose log and evidence scans.
- Support bundle redaction test once support bundle exists.

Validation and evidence:

- Redaction scan report for API/repository metadata, Compose logs, worker logs, and Kubernetes logs.
- List of checked surfaces, currently audit logs, usage events, background jobs, data connector syncs, user notifications, notification deliveries, webhook subscriptions, webhook deliveries, and compliance JSON/CSV exports.
- Explicit exceptions with product owner approval, if any.

Compose and Kubernetes impact:

- Compose and Kubernetes logs must use the same structured logging and redaction behavior.
- Kubernetes validation should include pod logs and job logs.

Security and migration notes:

- Do not persist raw sentinel content in new metadata columns.
- If a retained-content requirement emerges, add explicit retention, access, and deletion semantics before schema lock.

## HAM-P20-04: External Postgres Compose Acceptance

Phase: 20 Docker Compose Product Install.

Depends on: `DATABASE_URL` contract and migration command parity.

Goal: prove Compose can use an external hosted Postgres-compatible database without changing application code.

Current status: implemented for local external pgvector/PostgreSQL acceptance plus hosted-service posture guidance. `deploy/compose/external-postgres.compose.yml` disables the bundled `postgres` service through a Compose profile override and points `migrate`, `app`, and backup tooling at the externally supplied `DATABASE_URL`. The override also resets `postgres-backup` service dependency on the bundled Postgres service so the backup profile renders cleanly in external-database mode. `pnpm smoke:compose:external-postgres` starts a standalone pgvector/PostgreSQL 18 container outside the Compose project, applies the normal migration command against it, runs the explicit seed, recreates the app with `DEV_SEEDED_LOGIN=false`, verifies admin readiness, runs durable product workflow readback after app restart, validates schema, verifies the override renders without the bundled `postgres` service, and scans Compose logs for generated secrets. Readiness and Postgres operational posture now report sanitized remote-database TLS and verification warning codes without exposing hostnames, users, passwords, or URLs. Remaining work is live backup/restore validation against a real managed provider when credentials are available.

Scope details:

- Treat external hosted Postgres and local Compose Postgres as the same app contract.
- Validate TLS, pgvector, connection limit, pool sizing, migration, schema validation, backup, restore, and readiness expectations.

Tasks:

- Keep `.env` and deployment docs current for external Postgres.
- Keep the external pgvector/PostgreSQL smoke running migration and validation through the same `DATABASE_URL` contract.
- Keep Compose app startup verified with the bundled Postgres service disabled.
- Keep representative workflow smoke and restart readback covered.
- Run backup and restore using the same scripts.
- Keep managed-provider TLS, connection-security posture, and connection-pool sizing guidance current.

Definition of done:

- Compose external Postgres mode is a configuration change only.
- Readiness and schema validation behave the same as bundled Postgres.
- Backup/restore scripts work with libpq environment variables and do not leak passwords.

Testing:

- `docker compose -f deploy/compose/compose.yml -f deploy/compose/external-postgres.compose.yml config`.
- `pnpm smoke:compose:external-postgres`.
- Backup/restore dry run and live run where credentials exist.

Validation and evidence:

- External Postgres smoke evidence.
- Redacted database connectivity and validation report.
- Backup manifest and restore drill evidence.

Compose and Kubernetes impact:

- Env names must align with Helm external Postgres values.
- External Postgres documentation should be reusable for Kubernetes managed-service guidance.

Security and migration notes:

- Require TLS guidance for hosted services.
- Do not include database passwords in process arguments, logs, or evidence.
