# Organization capability flags

Romeo rollout flags are server-authoritative organization policy. They are deliberately separate from generic organization/workspace capability assignments.

## States and resolution

- `disabled`: denied for every organization subject.
- `preview`: enabled only when the authenticated subject's exact `{subjectType, subjectId}` pair is allowlisted.
- `enabled`: enabled for every authenticated organization subject.

Resolution is fail-closed and ordered: a deployment platform kill switch denies first and cannot be overridden; the active organization revision or registry default is then applied; preview membership is evaluated against the authenticated subject. `provider_capabilities_v2` maps to the absolute `external_provider_use` platform control. `image_jobs_v2` maps only to `image_generation` and is enforced by the existing image authorization before quota reservation, provider requests, or object storage. Image editing remains independently protected by the `image_editing` deployment control until a distinct organization rollout flag is introduced; no organization state can bypass either deployment control.

Only `image_jobs_v2` is currently consumed by a product side-effect path. All other IDs are typed rollout reservations exposed for future consumers; changing their organization state has no product effect until that consumer explicitly calls the resolver. The organization administration UI labels that distinction instead of implying that a reserved flag changes current behavior. Remaining consumer integrations keep the overall roadmap item open even though the organization backend/data/API/UI foundation is complete.

Allowlists are accepted only for `preview`, are deduplicated and sorted, contain at most 100 exact user or service-account references, and are validated as active members of the caller's organization. Effective responses and operational metrics never include allowlist IDs, mutation reasons, tenant IDs, request paths, credentials, prompts, or output.

## API

- `GET /api/v1/capability-flags/effective` returns only the caller's effective decisions.
- `GET /api/v1/admin/capability-flags` requires `capabilities:read` and returns definitions, enforced-versus-reserved consumer status, mapped platform-disabled flags, and the organization's active revisions.
- `GET /api/v1/admin/capability-flags/{flagId}/history` requires `capabilities:read` and returns bounded immutable history.
- `PUT /api/v1/admin/capability-flags/{flagId}` requires `capabilities:manage`, a reason, and an optional `expectedVersion` compare-and-swap value.

Equivalent repeated updates are idempotent and return the current revision. A distinct stale update returns the registered `capability_flag_version_conflict` response. Mutations emit `admin.capability_flag.replace` with flag, state, version, and allowlist count only.

The localized organization UI uses progressive disclosure for the bounded 14-flag registry. It shows the source default, current revision, platform ceiling, and whether a runtime consumer is connected. Preview input accepts at most 100 explicit `user:` or `service_account:` identifiers and does not issue an unbounded directory query. History is fetched only when opened; updates invalidate the exact report, history, effective-flag, layered-capability, and workspace capability snapshots that can be affected. Raw API/provider errors are never rendered.

## Persistence and operations

Migration `0022_organization_capability_flags.sql` adds immutable revision history, one active revision per organization/flag, bounded JSON allowlists, version uniqueness, and tenant/history indexes. Tenant deletion removes all flag revisions. PostgreSQL replacements serialize on an organization/flag advisory transaction lock; in-memory behavior has matching CAS and idempotency semantics.

The provider operational summary exposes process-local bounded resolution counters keyed only by registry flag, effective state, and finite reason code. Fleet-wide aggregation remains the responsibility of the Prometheus scraper and deployment monitoring plane.

## Rollout and rollback

Ship new consumers with their flag default chosen to preserve current behavior. For rollback, set the organization revision to `disabled`; for high-risk global rollback, use the corresponding deployment kill switch. The additive table may remain during application rollback because older releases ignore it. On 2026-08-14, the greenfield migration chain and both organization-flag repository cases ran against a disposable PostgreSQL 16/pgvector database: memory and PostgreSQL tenant/history/idempotency parity passed, and the two-writer compare-and-swap race produced exactly one winner. Upgrade-from-prior-release, backup/restore, and mixed-version fleet evidence remain release-environment gates.
