# Romeo v1 API evolution and deprecation policy

**Status:** Accepted  
**Applies to:** public REST/SSE operations, generated SDKs, and compatibility aliases

## Compatibility promise

Public v1 changes are additive throughout the supported-client window. A schema change
is breaking when an existing conforming client can no longer send, receive, deserialize,
resume, or interpret the same request, response, cursor, event, or public error. A code
generator accepting the new document does not make the change compatible.

The OpenAPI breaking-change gate, route coverage, and TypeScript/Python SDK drift gates
are release-blocking. Compatibility aliases enforce the same authentication,
authorization, tenant, policy, quota, audit, and error rules as canonical routes.

## Additive change rules

- Add optional request fields with server defaults; do not make existing fields required.
- Add response fields only where clients are required to tolerate them. Prefer versioned
  discriminated unions for new event/content variants.
- Do not change operation IDs, field meaning, enum values, nullability, default behavior,
  cursor binding, idempotency, error status/code, or SSE ordering in place.
- Renames are new fields/operations plus an explicit migration. The old name remains
  supported and semantically equivalent during the window.
- Unknown additive SSE events are safely ignorable; required state transitions need an
  event-schema version and compatibility reducer tests.
- Tightening a security check is allowed and may be urgent, but public safe error behavior
  and operator migration guidance remain explicit.

## Deprecation contract

An operation may set `deprecated: true` only when it also defines
`x-romeo-deprecation` with:

- `sinceVersion` and `deprecatedAt`;
- `sunsetAt` at least 90 days later unless an approved emergency exception exists;
- a replacement operation ID, or `null` when the capability is intentionally retired;
- a documentation URL;
- the bounded metric `romeo_api_deprecated_requests_total`;
- `zeroUsageDaysRequired` of at least 30; and
- a matching entry in `docs/api/deprecation-ledger.json`.

Active deprecations are defined exactly once in the typed
`packages/contracts/src/api-deprecations.ts` registry. That registry decorates
OpenAPI and drives the global request middleware; hand-authored OpenAPI-only or
ledger-only deprecations fail the release check. A non-null replacement
operation must still exist in the current OpenAPI document.

Every documented success response includes the standard `Deprecation`, `Sunset`, and
`Link` headers. Runtime behavior emits the same headers for deprecated calls. Generated
clients retain the operation and expose its deprecation annotation until removal.

Runtime responses use RFC 9745's structured-date `Deprecation` value, RFC
8594's HTTP-date `Sunset` value, and `Link` relations for deprecation guidance
and the successor operation. Process-local usage evidence records operation ID,
bounded response class, counts, first/last use, and the current zero-usage
window only. The provider operational summary exports this snapshot to
Prometheus with bounded labels. Fleet removal evidence must aggregate all
replicas and cover restarts for the declared zero-usage window.

Telemetry is metadata-only and bounded by operation ID and response class. It never
records tokens, API keys, subject
IDs, tenant IDs, paths with identifiers, queries, request/response bodies, prompts, or
provider data.

## Removal gate

Removal requires all of the following:

1. the notice date passed;
2. supported clients and documentation migrated;
3. at least the declared consecutive zero-usage window across the production fleet;
4. compatibility and sunset dashboards/alerts were reviewed;
5. an evidence artifact records counts/window/builds without tenant or client identity;
6. the ledger entry changes to `removed` and links the reviewed evidence;
7. OpenAPI, both SDKs, compatibility coverage, upgrade, rollback/forward-repair, and
   release notes pass together.

Emergency security removal needs a time-bounded exception, owner, threat rationale,
customer communication, safe public error/upgrade path, and post-incident evidence. It
does not allow a silent deletion.

## Enforcement

- `pnpm check:api-evolution-policy` validates the exported OpenAPI document and ledger.
- `pnpm contract:breaking` compares the document with the committed baseline.
- `pnpm check:sdk-typescript-drift` and `pnpm check:sdk-drift` prove both generated clients.
- Default and OpenWebUI-enabled route-coverage gates prove deployed paths match contracts.

The policy checker also has an embedded fixture self-test so weakening a validation rule
cannot turn the production document's current lack of deprecated operations into a
vacuous green gate.
