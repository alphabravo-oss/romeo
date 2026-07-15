# Backlog Track: Durable Core

This track turns Romeo from a greenfield baseline with partial durable components into a production install whose state survives process restarts, upgrades, worker retries, and disaster-recovery drills.

Current implementation findings and the post-lock execution path are tracked in [Current Full-Product Completion Status](./current-status.md). The Phase 19 lock decision is recorded in [Romeo Greenfield Baseline Lock](./baseline-lock.md).

Concrete execution tickets for Phase 19 and Phase 20 live in [Platform Closeout](./execution/platform-closeout.md).

## Phase 19: Durable Postgres Baseline

### Objective

Make Postgres the production source of truth for all non-ephemeral Romeo state while preserving the existing repository boundary. The greenfield baseline migration is now locked; future schema changes require forward-only migrations with upgrade tests and rollback or mitigation notes.

### Scope

- One reviewed Drizzle baseline migration for the accepted schema.
- Postgres repository fragments by domain, not a single large persistence file.
- pgvector-backed embeddings as the default vector path, with Qdrant remaining an optional external vector adapter.
- In-memory repository retained only as a test fixture and single-process development option.
- Migration, seed, schema-validation, backup, restore, and DR drill scripts wired into Compose and Kubernetes paths.

### Tasks

1. Repository contract inventory:
   - Enumerate every method on the Romeo repository contract.
   - Classify each method by domain, transaction requirement, authorization caller, and audit impact.
   - Identify any implicit in-memory behavior that must become explicit in Postgres, such as ordering, uniqueness, idempotency, lifecycle state, and cascade behavior.
   - Maintain repository conformance tests that run against both the in-memory fixture and Postgres; method coverage now spans the full contract, including the explicit transaction boundary, and the Phase 19 baseline lock is recorded in `docs/backlog/baseline-lock.md`.

2. Schema design and baseline migration:
   - Normalize core tables for organizations, users, sessions, service keys, workspaces, groups, memberships, grants, audit records, jobs, usage, webhooks, notifications, billing, support approvals, providers, models, agents, versions, chats, messages, runs, run events, knowledge bases, sources, chunks, embeddings, tools, connectors, workflows, workflow runs, voice assets, and stored artifacts.
   - Use UUID primary keys consistently unless an existing public ID contract requires a different shape.
   - Use explicit created/updated/deleted timestamps where lifecycle matters.
   - Prefer soft deletion for user-owned content that must preserve audit or billing trails.
   - Add foreign keys for ownership and lifecycle boundaries.
   - Add unique constraints for natural uniqueness, such as org slugs, workspace slugs within orgs, provider keys within orgs, agent version numbers, external identity subjects, webhook event IDs, job idempotency keys, and connector sync cursors.
   - Add check constraints for bounded enum-like state where Drizzle supports it cleanly.
   - Add indexes for every list, lookup, authorization, cursor, sync, and retry query used by the service layer.
   - Enable pgvector in the baseline migration and create vector indexes only where query plans justify them.
   - Keep schema files split by domain under the database package.

3. Repository fragments:
   - Implement an identity fragment for users, sessions, API keys, OIDC subjects, deprovisioning state, and account-linking placeholders.
   - Implement an org/workspace fragment for organizations, workspaces, groups, memberships, grants, and derived access lookups.
   - Implement a provider/model fragment for provider registry, model catalog, routing policies, provider connection tests, and sanitized admin settings.
   - Implement an agent fragment for agent definitions, published versions, workspace bindings, eval definitions, and version rollback metadata.
   - Implement a chat/run fragment for chats, messages, model runs, tool-call events, usage records, approvals, and resumable run state.
   - Implement a knowledge fragment for knowledge bases, sources, chunks, embedding records, indexing jobs, extraction jobs, source visibility, and deletion.
   - Implement a retrieval fragment for hybrid search inputs, rank fusion metadata, corpus weighting configuration, and optional Qdrant references.
   - Implement a tool/connector fragment for tool definitions, imported OpenAPI operations, connector records, connector sync cursors, allowed hosts, dispatch-request metadata, and sanitized worker readback.
   - Implement a workflow fragment for definitions, schedules, runs, steps, approvals, linked model runs, retry policy, recovery policy, and browser-task gates.
   - Implement a notification fragment for channels, delivery ledger, retries, provider metadata, redaction status, and user preferences.
   - Implement a billing fragment for plans, entitlements, usage counters, webhook events, invoices or external references, and provider proxy events.
   - Implement a support/governance fragment for approval grants, support access windows, audit evidence, retention holds, and data deletion requests.

4. Transaction boundaries:
   - Wrap agent publish and version-binding updates in a single transaction. Current status: implemented and covered with audit-failure rollback tests.
   - Wrap chat message append, model-run creation, usage reservation, and initial event creation in a single transaction. Current status: implemented for normal API run starts and workflow-spawned model runs; user message, attachment-part rows, run row, retrieval event, quota/usage ledgers, and started-usage records commit atomically, provider execution starts only after commit, and uploaded attachment objects are best-effort removed if the start commit fails.
   - Wrap run completion, terminal usage finalization, and assistant message creation in a single transaction. Current status: implemented and covered with usage-failure rollback tests; webhook emission remains asynchronous after successful persistence so delivery failures do not block completion.
   - Wrap knowledge-base creation/update, owner grants, and audit writes in a single transaction. Current status: implemented and covered with audit-failure rollback tests for create and update.
   - Wrap knowledge source import, chunk creation, embedding job creation, and source-state transition in a single transaction. Current status: inline source registration and uploaded source completion now commit chunk replacement/creation, source status transition, quota/usage ledgers, and source usage records transactionally; inline import also cleans up persisted source objects when the transaction fails. Embedding indexing still keeps external provider/vector-store calls outside the database transaction and needs separate target-evidence review.
   - Wrap local knowledge-source deletion, chunk/embedding cleanup, usage recording, and audit writes in a single transaction. Current status: implemented and covered with audit-failure rollback tests; external vector-store and object-store deletion remain outside the database transaction boundary.
   - Wrap audited chat lifecycle mutations with audit writes in single transactions. Current status: title update, archive, unarchive, legal-hold set, and legal-hold clear are implemented and covered with audit-failure rollback tests.
   - Wrap chat comment creation, mention notification enqueue, notification-delivery ledger writes, and audit creation in a single transaction. Current status: implemented and covered with notification-failure rollback tests.
   - Wrap prompt-template creation/update/share/delete, owner/share grants, and audit writes in a single transaction. Current status: implemented and covered with audit-failure rollback tests.
   - Wrap API key create/revoke operations, including user-owned keys, service-account keys, and audit writes, in single transactions. Current status: implemented and covered with audit-failure rollback tests; service-account key creation re-checks service-account disabled/scope state inside the transaction.
   - Wrap service-account create/disable operations, active API-key revocation, and audit writes in single transactions. Current status: implemented and covered with audit-failure rollback tests.
   - Wrap local session create/revoke/revoke-others operations with audit writes in single transactions. Current status: implemented and covered with audit-failure rollback tests for session creation, current-session revocation, targeted revocation, and revoke-other batch rollback.
   - Wrap device authorization create/refresh/revoke, API-key rotation/revocation, refresh-token rotation, and audit writes in a single transaction. Current status: implemented and covered with audit-failure rollback tests.
   - Wrap voice-profile manual creation, catalog-sync imports, and explicit voice artifact metadata deletion with audit writes in single transactions. Current status: implemented and covered with audit-failure rollback tests; provider catalog reads and object-store artifact deletion remain outside the database transaction boundary.
   - Wrap billing plan application, quota-template reconciliation, external billing sync, lifecycle enforcement, direct quota bucket administration, and audit writes in single transactions. Current status: implemented and covered with audit-failure rollback tests for billing operations plus direct quota create/update/delete; external quota coordinator synchronization remains outside the database transaction boundary.
   - Wrap file create/upload-session/create-complete/delete metadata, quota usage, owner grants, and audit writes in single transactions, with object-store writes cleaned up or delayed around commit where needed. Current status: implemented and covered with audit-failure rollback tests for inline create, direct session create, direct completion, and delete.
   - Wrap local password and MFA mutation state with audit writes in single transactions. Current status: implemented for self/admin password set, TOTP enrollment/confirmation/disable, recovery-code generation/consume, and covered with audit-failure rollback tests for password credential creation and TOTP enrollment.
   - Wrap local MFA and local managed-secret envelope rewraps with the secret-rotation audit in a single transaction. Current status: implemented for `POST /api/v1/admin/secret-rotation/rewrap`; preview remains read-only, execute rewrites local envelopes and writes `admin.secret_rotation.rewrap` atomically, and audit-failure rollback tests prove old encryption envelopes remain intact if audit persistence fails.
   - Wrap user disable and role-promotion/demotion changes with API-key/session/support-session revocation and audit writes in single transactions. Current status: implemented and covered with audit-failure rollback tests.
   - Wrap group creation and group membership add/remove operations with audit writes in single transactions. Current status: implemented and covered with audit-failure rollback tests for create, add-member, and remove-member paths.
   - Wrap provider creation, model pricing updates, provider model sync persistence, workspace creation, and workspace archive updates with audit writes in single transactions. Current status: implemented and covered with audit-failure rollback tests; provider catalog/model discovery remains outside the database transaction boundary.
   - Wrap local managed-secret encrypted setting writes and webhook subscription lifecycle writes with audit rows in single transactions. Current status: implemented and covered with audit-failure rollback tests for local secret create, webhook create, webhook disable, and webhook bulk disable; external vault writes and webhook HTTP delivery attempts remain outside the database transaction boundary.
   - Wrap tool connector admin configuration updates, including auth configuration, connector enablement, network policy, and operation enablement, with audit writes in single transactions. Current status: implemented and covered with audit-failure rollback tests.
   - Wrap SSO settings updates, external login provisioning/session creation, and OIDC deprovisioning with sanitized audit writes in single transactions. Current status: implemented and covered with audit-failure rollback tests for OIDC settings persistence, LDAP login provisioning rollback on success-audit failure, and OIDC deprovision rollback across user disable, credential revocation, and nested lifecycle audit; OAuth2, LDAP/AD, and SAML browser login now commit user provisioning, external group sync, success audit, and session creation through the same transaction boundary.
   - Wrap delegated OAuth local connection revocation state and sanitized audit writes in a single transaction, with external provider revocation kept outside the database transaction boundary. Current status: implemented and covered with audit-failure rollback tests for local delegated OAuth revoke state.
   - Wrap tenant organization update, suspension/reactivation, deletion-request/cancel, and deletion-finalization evidence writes with abuse-control/deletion-control state and audit rows in single transactions. Current status: implemented and covered with audit-failure rollback tests.
   - Wrap directory-sync apply and SCIM user/group lifecycle mutations with credential revocation, membership writes, and audit rows in single transactions. Current status: implemented and covered with audit-failure rollback tests for directory sync apply, SCIM user create/deactivate, and SCIM group create.
   - Wrap eval suite/run/rating persistence and collaboration favorite/share/folder/folder-item mutations with audit rows in single transactions. Current status: implemented and covered with audit-failure rollback tests for eval suite creation, eval result rating, collaboration share grants, and folder owner-grant creation.
   - Wrap native channel create/update/delete and member add/remove mutations with audit rows in single transactions. Current status: implemented and covered with audit-failure rollback tests for channel creation, update with member additions, deletion with member cleanup, member addition, and member removal.
   - Wrap agent tool-binding and knowledge-binding capability updates with audit rows in single transactions. Current status: implemented and covered with audit-failure rollback tests for agent tool approval-state changes and agent knowledge-base enablement changes.
   - Wrap data connector creation plus connector sync finalization, cursor advancement, schedule metadata, and audit writes in single transactions. Current status: connector creation and finalization are implemented and covered with audit-failure rollback tests; external fetch, object storage, and knowledge ingestion remain outside the database transaction boundary.
   - Wrap tool dispatch request creation, approval token consumption, and audit creation in a single transaction. Current status: dispatch enqueue/approval consumption, approval decisions, and dispatch readback completion/failure are transactional and covered with audit-failure rollback tests.
   - Wrap workflow resume state-transition finalization, linked model-run creation, and audit writes in a single transaction. Current status: resume/retry/recover finalization is implemented and covered with audit-failure rollback tests; retry linked-run creation now commits atomically with workflow state and audit writes, and deferred provider execution starts only after the transaction commits.
   - Wrap support approval creation/revocation with audit and notification enqueue. Current status: implemented for direct support-session creation, approval-request creation, approval, rejection, and revocation; failure-injection verifies notification enqueue failures roll back audit/session/request state.
   - Wrap retention policy updates and audit-log retention deletion with governance audit writes in single transactions. Current status: implemented and covered with audit-failure rollback tests for policy updates and `governance.retention.enforce` audit-log deletion rollback; external artifact cleanup remains outside the database transaction boundary.
   - Wrap data-export package registry creation/deletion with governance audit writes in single transactions. Current status: implemented and covered with audit-failure rollback tests for package create/delete; object-store package creation is cleaned up if registry/audit commit fails, and object deletion runs only after registry/audit commit succeeds.
   - Wrap governed data deletion and its audit evidence in a single transaction. Current status: implemented and covered with audit-failure rollback tests.

5. Query and lifecycle behavior:
   - Define cursor pagination for list endpoints before implementing repository methods.
   - Use stable ordering for all cursor queries.
   - Add optimistic concurrency or version checks where admins edit shared configuration.
   - Define idempotency keys for webhooks, job enqueue, connector sync, and external worker readback.
   - Ensure deleted or disabled principals cannot retain sessions, keys, connector ownership, or support access.
   - Ensure workspace membership changes take effect without requiring app restart.

6. Runtime configuration:
   - Add a production readiness failure when durable storage is not configured.
   - Keep in-memory storage behind an explicit development or test flag.
   - Add a schema validation command that checks migration state, extension availability, required indexes, and baseline version.
   - Add a seed command for local development that never runs implicitly in production.
   - Add a migration job entrypoint usable by Compose and Kubernetes.

7. Migration discipline:
   - Treat `packages/db/migrations/0000_greenfield_baseline.sql` as the locked fresh-install baseline.
   - Review schema changes against API contracts, repository tests, backup/restore, and deletion requirements before adding a forward migration.
   - Require forward-only migrations with explicit rollback notes and upgrade tests.

### Definition Of Done

- All repository contract methods have Postgres implementations or are explicitly marked development-only.
- Repository conformance tests pass against Postgres, including strict method coverage and required failure-injection cases.
- Production readiness fails when the app is configured with in-memory persistence.
- A fresh database can be migrated, seeded for development, backed up, restored, and validated.
- The baseline migration includes pgvector setup, required indexes, constraints, foreign keys, and lifecycle columns.
- No feature stores secrets, raw prompt bodies, raw notification bodies, raw provider tokens, or raw worker payloads in audit, usage, jobs, or sync metadata.
- Code is split by domain and repository fragment; no catch-all persistence module is introduced.
- The PRD and deployment docs state the accepted persistence contract.

### Testing

- Unit tests for each repository fragment.
- Cross-repository conformance suite against in-memory and Postgres.
- Integration tests for migrations, schema validation, and seed behavior.
- API tests for persistence across app restart where the current harness allows it.
- Authorization negative tests for workspace, group, connector, knowledge, workflow, billing, and support access.
- Redaction tests for audit, usage, job, webhook, notification, and sync metadata.
- Transaction tests for failed midway operations, especially publish, run start, run completion, knowledge import, tool dispatch, connector sync, workflow resume, and deletion. Current coverage includes publish, normal run-start started-usage rollback, inline knowledge-source import registered-usage rollback, uploaded knowledge-source completion usage rollback, knowledge-source deletion rollback, API key create/revoke audit rollback for user and service-account keys, service-account create/disable rollback including API-key revocation rollback, local session create/revoke/revoke-others rollback, group create/member add/member remove rollback, provider create/model pricing/model sync rollback, workspace create/archive rollback, managed-secret local create rollback, secret-rotation local MFA/managed-secret rewrap rollback, SSO settings/external-login/deprovision rollback, delegated OAuth revoke rollback, quota create/update/delete rollback, tenant organization lifecycle rollback, directory sync apply rollback, SCIM user/group lifecycle rollback, eval suite/rating rollback, collaboration share/folder rollback, native channel create/update/delete/member rollback, agent tool/knowledge binding rollback, audited chat lifecycle rollback, webhook create/disable/bulk-disable rollback, tool connector auth/enablement/network-policy/operation update rollback, data connector create/sync finalization rollback, voice profile/catalog/artifact deletion rollback, run completion terminal usage, workflow resume finalization, workflow retry linked-run creation rollback, support impersonation notification enqueue rollback, retention policy/enforcement rollback, data-export package create/delete rollback, governed data deletion, tool-dispatch enqueue/approval consumption, tool-dispatch approval decisions, and tool-dispatch readback.
- Performance smoke tests for representative list, search, and authorization queries.

### Validation

- Run the full test suite with `DATABASE_URL` set to a local Postgres instance with pgvector.
- Run migration from empty database, schema validation, seed, app readiness, backup, restore into a second database, and schema validation again.
- Inspect generated migration SQL before accepting the baseline, using `pnpm review:baseline -- --strict --output <evidence-file>` as the repeatable static gate.
- Capture query plans for retrieval, run history, audit listing, connector sync, workflow resume, and notification retry queries.
- Verify Compose and Kubernetes migration jobs use the same migration command.

## Phase 20: Docker Compose Product Install

### Objective

Provide a reliable Docker Compose install for local teams and self-hosted customers while keeping the runtime contract compatible with Kubernetes.

### Scope

- App container.
- Postgres with pgvector.
- Valkey for cache, rate-limit, and queue coordination.
- RustFS or another S3-compatible local object store.
- Optional worker services using the same image and explicit commands.
- Optional local model service profile, such as Ollama, only when configured.
- Migration/init job.
- Health checks, readiness checks, backup/restore, upgrade, and smoke-test commands.

### Tasks

1. Compose topology:
   - Define services for app, Postgres, Valkey, object store, migration job, and worker profiles.
   - Use named volumes for Postgres, Valkey, and object store state.
   - Keep all secrets in `.env` or Docker secrets-compatible files; never hard-code secrets in Compose.
   - Expose only required ports by default.
   - Add profiles for `dev`, `self-hosted`, `workers`, `voice`, `browser-worker`, and optional local model runtime.

2. Postgres and migration:
   - Use a pgvector-capable image.
   - Run migrations through a one-shot service before app startup.
   - Add health checks that verify connection readiness and required extension availability.
   - Document how to switch from Compose Postgres to external Postgres using the same `DATABASE_URL` contract.
   - Add backup and restore commands for the Compose database.

3. Object storage:
   - Bootstrap required buckets in an explicit init service or documented command.
   - Use S3-compatible environment variables shared with Kubernetes deployment.
   - Validate object store credentials in readiness without exposing values.
   - Add backup, restore, and DR drill automation for stored artifacts, with manifest SHA-256 validation.
   - Document artifact retention and local cleanup expectations.

4. Workers:
   - Add worker services or profiles for knowledge extraction, connector sync, voice catalog sync, workflow resume, notification retry, webhook delivery, retention, and future tool dispatch.
   - Keep worker commands explicit.
   - Ensure worker logs use IDs and metadata only.
   - Use restart policies appropriate for loops versus one-shot jobs.

5. Security defaults:
   - Disable seeded login unless the `dev` profile is selected.
   - Generate strong local defaults only through an explicit bootstrap command.
   - Run containers as non-root where the image supports it.
   - Use read-only filesystems for app and workers when feasible.
   - Add resource limits to prevent local runaway jobs.
   - Document localhost-only assumptions and production reverse proxy requirements.

6. Upgrade path:
   - Document backup-before-upgrade.
   - Add a smoke-test command that runs readiness and a small API workflow after upgrade.
   - Add a rollback note for image tag rollback after database migrations.
   - Keep image tags explicit and avoid implicit `latest` in production docs.

### Definition Of Done

- A new user can start Romeo with Docker Compose, run migrations, pass readiness, log in through the configured auth mode, create an agent, run a chat, upload a knowledge source, and persist state after restart.
- Compose can be configured with local Postgres or external Postgres without changing application code.
- Worker profiles can run without sharing unnecessary secrets.
- Backup and restore commands work against the Compose database and object store.
- Compose docs call out development-only settings versus self-hosted production settings.

### Testing

- Compose smoke test from an empty volume set.
- Restart persistence test for app, worker, Postgres, and object store.
- Backup/restore test into a clean Compose project name.
- Object-store backup/restore test that reads a restored attachment through the app API.
- Negative readiness test with missing `DATABASE_URL`, missing pgvector, missing object store, and seeded login enabled in production profile.
- Worker smoke tests for each enabled worker command.
- Upgrade dry run from previous release artifact once releases exist.

### Validation

- `docker compose config` renders without unresolved variables.
- App readiness returns no critical findings in self-hosted mode.
- Logs are inspected for secret leakage.
- A restored Compose instance serves existing chats, agents, knowledge records, and artifacts from restored Postgres plus restored object storage.
- The same environment names map cleanly to Helm values in Phase 21.

## Track Sequencing

Phase 19 should finish before any feature work that adds persistent state. Phase 20 should finish before the product is presented as self-hostable. Later tracks may prototype against existing boundaries, but they should not lock new data models until the durable baseline is accepted.
