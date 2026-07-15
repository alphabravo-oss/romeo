# Romeo Greenfield Baseline Lock

Status date: 2026-06-30.

## Decision

The Phase 19 durable Postgres greenfield baseline is accepted and locked for Romeo's current product surface.

Locked migration:

- `packages/db/migrations/0000_greenfield_baseline.sql`

Scope of the lock:

- The migration remains the single greenfield baseline for fresh installs.
- Docker Compose and Kubernetes migration jobs continue to run `pnpm migrate:postgres`.
- `pgvector` remains the default vector extension in the baseline.
- Development seed data remains outside migrations and must be applied only with `pnpm seed:postgres -- --confirm-development-seed`.

## Pre-GA Fold-In

On 2026-07-01, chat tag tables were folded into the single greenfield baseline instead of leaving a generated `0001` migration. Rationale: the product is still pre-GA/greenfield, the user explicitly wants a tight final baseline without migration churn, and durable tag storage is part of Romeo's native chat organization model as well as the existing reference bridge shims.

Folded baseline additions:

- `chat_tags`: user-scoped tag dictionary with org/user/slug uniqueness.
- `chat_tag_assignments`: user-scoped chat-to-tag assignments with chat/tag cascade cleanup and idempotent uniqueness.

Later on 2026-07-01, the channel tables were also folded into the same greenfield baseline instead of leaving a generated `0001` migration. Rationale: durable channel list/create/detail/member/update/delete behavior is useful for Romeo collaboration and the existing reference bridge shims, and Romeo is still pre-GA enough that a tight fresh-install baseline is preferable to migration churn.

Folded channel additions:

- `openwebui_channels`: org/workspace/user-scoped channel records with type, privacy, data/meta, archive, and delete lifecycle columns plus owner and updated-time indexes.
- `openwebui_channel_members`: org/channel/user membership rows with role, status, active/muted/pinned/read state, idempotent uniqueness, channel/user indexes, and channel cascade cleanup.

Later on 2026-07-01, local password authentication and local TOTP MFA storage were folded into the same greenfield baseline instead of leaving a generated `0001` migration. Rationale: local fallback auth, enterprise SSO fallback, and admin role promotion are now core backend requirements, and Romeo is still pre-GA enough that fresh installs should get one tight baseline rather than a corrective migration chain.

Folded local auth additions:

- `local_password_credentials`: user-scoped password credential rows with versioned hash metadata, failed-attempt/lockout tracking, and lifecycle timestamps.
- `local_mfa_factors`: user-scoped MFA factor rows with encrypted TOTP secret envelopes, confirmation/disable lifecycle, and user/status indexes.

Later on 2026-07-01, persisted global/org auth-provider settings were implemented through the existing `system_settings` table instead of adding provider-settings tables. Rationale: the provider app-store page needs durable configuration now, but the greenfield baseline already has a generic product settings store that avoids migration churn while provider-specific adapters are still evolving.

Validation after the fold-in:

- `pnpm --filter @romeo/db db:generate` reported no schema changes.
- `packages/db/migrations` contains only `0000_greenfield_baseline.sql`, `meta/0000_snapshot.json`, and `meta/_journal.json`.
- Focused core, db, config, and api-client checks/tests passed for the tag, channel, local auth, MFA, auth-provider catalog/settings, and role-management implementations.

## Evidence

The following gates passed before the lock decision:

- `pnpm review:baseline -- --strict`
- `DATABASE_URL=postgres://postgres:***@127.0.0.1:55445/postgres pnpm migrate:postgres`
- `DATABASE_URL=postgres://postgres:***@127.0.0.1:55445/postgres pnpm validate:postgres -- --output /tmp/romeo-baseline-lock-postgres-validation.json`
- `ROMEO_POSTGRES_CONFORMANCE_DATABASE_URL=postgres://postgres:***@127.0.0.1:55445/postgres pnpm test:postgres-conformance`
- `pnpm review:repository-conformance -- --strict --output /tmp/romeo-repository-conformance-coverage.json`
- `pnpm check`
- `pnpm test`
- `pnpm build`

Covered closeout evidence:

- Strict repository method coverage: current shared conformance reports 229 directly covered contract methods, 0 uncovered methods, 0 waivers.
- Live Postgres conformance: 29 tests passed against isolated migrated pgvector PostgreSQL 18 databases.
- Transaction rollback: repository transaction boundary, agent publish, normal run start, knowledge-base create/update, knowledge-source import/completion/deletion, API key user/service-account create and revoke, service-account create/disable with API-key revocation, local session create/revoke/revoke-others, group create/member add/member remove, provider create/model pricing/model sync, workspace create/archive, managed-secret local create, secret-rotation local MFA/managed-secret rewrap, SSO settings update, external login provisioning/session creation, SSO OIDC deprovision, delegated OAuth revoke, tenant organization lifecycle, directory sync apply, SCIM user/group lifecycle, eval suite/rating, collaboration share/folder, native channel create/update/delete/member mutations, agent tool/knowledge binding mutations, audited chat title/archive/unarchive/legal-hold mutations, webhook create/disable/bulk-disable, tool connector auth/enablement/network-policy/operation update, file create/upload-session/complete/delete, local password/MFA mutations, user disable/role update, chat-comment mention notification enqueue, prompt-template create/update/share/delete, device authorization create/refresh/revoke, voice profile create/catalog sync/artifact delete, direct quota create/update/delete, billing plan/quota/external-sync/lifecycle enforcement, run completion terminal usage, data connector create/sync finalization, workflow resume finalization, support impersonation notification enqueue, retention policy/enforcement, data-export package create/delete, governed data deletion, tool-dispatch enqueue/approval consumption, tool-dispatch approval decisions, and tool-dispatch readback.
- Negative authorization: cross-scope connector sync, workflow resume, governed data deletion, plus existing object-grant denial tests.
- Compose evidence already covers clean migration, explicit seed, secure-mode restart, worker one-shots, generated-secret log scanning, and database plus object-store backup/restore DR smoke.

## Post-Lock Policy

After this lock, schema changes must be forward-only migrations with:

- a short rationale tied to a product/backlog item,
- upgrade tests from `0000_greenfield_baseline.sql`,
- rollback or mitigation notes,
- schema validation evidence,
- repository conformance evidence when repository behavior changes.

Do not create corrective migration chains that only undo earlier greenfield mistakes. If a future change belongs to an unfinished feature and the lock has not been released externally yet, it still needs an explicit decision before modifying the locked baseline.
