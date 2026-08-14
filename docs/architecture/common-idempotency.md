# Common command idempotency

## Status and scope

The common idempotency foundation is implemented for `POST /api/v1/runs` and
`POST /api/v1/images/generations`. Both operations accept the standard
`Idempotency-Key` request header and continue to accept the legacy optional
`idempotencyKey` request-body field. When both are present, their normalized
values must match.

This is an additive compatibility layer. Requests without a key keep their
previous behavior. Exports, compare sessions, compute jobs, and future durable
media jobs must adopt this facility when those command surfaces land; EP-00-06
therefore remains open.

## Receipt identity and privacy

A receipt is uniquely scoped by:

- organization;
- authenticated actor type and stable actor identifier;
- credential identity (API-key ID or session ID, hashed; principal fallback);
- exact operation ID; and
- SHA-256 hash of the normalized client key.

The canonical request is recursively key-sorted, excludes undefined values,
and is persisted only as a SHA-256 hash. The raw idempotency key and request
body are never stored. Audit and operational telemetry contain only the
bounded operation and claim outcome. They contain no tenant, principal,
credential, key, request hash, request body, prompt, response body, or raw
error labels.

Terminal successful receipts retain only the bounded response required for an
exact replay (maximum 128 KiB), the HTTP status, and expiry. Terminal failures
retain only a stable safe error code. Receipts expire after 24 hours by
default, and cleanup deletes at most the requested bounded batch. Tenant purge
removes all organization receipts.

## Claim and replay semantics

The repository contract has one atomic claim operation and lease-token-guarded
complete/fail operations. PostgreSQL serializes a receipt scope with a
transaction advisory lock; the unique scope index is the final invariant.
In-memory storage implements the same state machine.

- No receipt: the caller owns a new 15-minute lease.
- Same scope and request hash, active lease: `409 idempotency_request_in_progress`.
- Same scope and request hash, completed: replay the exact stored response.
- Same scope and request hash, failed: `409 idempotency_request_failed`.
- Same scope but different request hash: `409 idempotency_key_conflict`.
- Same scope and request hash, expired lease: one caller takes over with a new
  lease token.

Completion and failure require the current lease token, preventing an expired
worker from publishing over a takeover. Responses with a receipt include
`Idempotency-Replayed` and `Idempotency-Receipt-Expires-At`.

For OpenAI-compatible image providers, Romeo sends the opaque receipt ID as
the upstream `Idempotency-Key`; the raw client key is never disclosed to a
provider.

## Operational evidence

The provider operational summary and Prometheus exporter expose
`romeo_idempotency_outcome_total` with only bounded `operation` and `outcome`
labels. Outcomes are `owner`, `replay`, `conflict`, `in_progress`, and
`failed`. The metric is process-local and must be aggregated by the fleet
monitoring layer.

## Transaction boundary and remaining work

The durable claim prevents concurrent duplicate owners, and completed calls
replay without repeating run/message, provider, storage, or file-record
effects. It does not create a distributed transaction across PostgreSQL,
external providers, and object storage. A process failure after an external or
domain side effect but before receipt completion can leave an expired receipt
eligible for takeover. The image adapter's opaque upstream idempotency key can
reduce provider duplication when the provider honors it, but local object and
message publication are not yet transactionally checkpointed.

Before declaring EP-00-06 complete:

1. add operation-specific durable checkpoints or transactional outbox
   publication for run and media side effects, then prove kill-after-effect
   recovery without duplicate visible artifacts/messages;
2. adopt the facility for exports, compare sessions, compute jobs, durable
   media jobs, and other new provider-side-effect commands;
3. run live PostgreSQL concurrent-claim, takeover, migration/rollback, tenant
   purge, and mixed-version fleet acceptance in the release environment; and
4. define the production cleanup schedule and alert thresholds from measured
   receipt volume and latency.

## Validation contract

Focused tests cover exact replay, request-shape conflict, one concurrent owner,
lease takeover, terminal failure, bounded cleanup, tenant purge, raw key/body/
error privacy sentinels, route header/body compatibility, and duplicate run,
message, provider, storage, and file-record suppression in the normal
completed-call path. PostgreSQL concurrency tests are environment-gated when
no live database is configured.
