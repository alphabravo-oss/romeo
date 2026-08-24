# Runtime readiness, operation ownership, and workload identity

## Readiness contract

`GET /api/v1/health` reports process liveness only. `GET /api/v1/readyz` is
accepted only when the server adapter supplies a loopback transport peer. Its
response is deliberately bounded to generic pass/fail identifiers; it never
contains connection strings, role names, buckets, endpoints, migration names,
worker errors, tenant IDs, or provider details.

Production readiness requires configuration/encryption posture, PostgreSQL
connectivity and exact migrations, the least-privilege base login posture,
authenticated Valkey command success, object-store policy plus write/read/
delete readback, and fresh ownership for every essential scheduled operation.
The runtime marks readiness false before graceful drain and can recover after a
transient dependency failure. Expensive probes are single-flight with bounded
success/failure TTLs; a stale success never remains ready indefinitely.

## Scheduled-operation ownership

Exactly one owner is permitted:

| Mode       | Owner                                                 | Proof                                                                                                                              |
| ---------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `internal` | Fenced all-tenant coordinator in each elected runtime | Fresh worker-health snapshots for every enabled operation; failures/backoff are unready                                            |
| `external` | Named external platform owner                         | Mounted v1 evidence with exact operation coverage, healthy status, observation within max age, live status reference, and alerting |

Legacy tenant-token CronJobs for connector sync, webhook/notification retry,
retention, billing reconciliation/lifecycle, and voice/provider sync are
production-invalid. The rendered `romeo-operational-ownership` ConfigMap is a
non-secret deployment inventory; live proof still comes from runtime health or
the mounted external evidence.

The internal operation inventory includes `file_lifecycle`. It runs every
second with a tenant-local actor restricted to `files:read` and `files:write`;
upload HTTP handlers never perform scanner, OCR, or extraction work. File work
uses record-level lease tokens and lifecycle versions inside the coordinator's
tenant job fence. Queue lag and current dead letters are exported as the bounded
`file.lifecycle` operational summary type, with no file, workspace, owner, or
tenant identifiers.

The same coordinator owns `content_deletion` at a one-second interval. Each
fair, bounded tenant turn claims at most one normalized deletion operation with
a renewable lease and monotonically increasing fence; shutdown aborts the
active turn and the durable row remains retryable. The worker deletes and
read-backs object storage, verifies external vector absence, rechecks legal
hold and target generation inside the final relational transaction, and only
then records the privacy-safe attestation. Readiness requires a fresh
`scheduled_content_deletion` health snapshot, so supervisor failure, backoff,
or stale completion is fail-closed and visible to the platform readiness alert.
No tenant token, global-admin key, or separate CronJob owns this queue.

## Workload permission matrix

| Workload             | Kubernetes identity          | Credential env                        | Audience                     | Only permitted API boundary                    | Other runtime secrets                                   |
| -------------------- | ---------------------------- | ------------------------------------- | ---------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| App                  | `romeo`                      | normal runtime Secret                 | interactive/admin principals | public/tenant API according to subject         | production runtime set                                  |
| Migration            | `romeo-migration`            | `DATABASE_URL`                        | none                         | database migration only                        | none                                                    |
| PostgreSQL backup    | `romeo-postgres-backup`      | database plus backup destination refs | none                         | backup program only                            | none                                                    |
| Tool dispatch        | `romeo-tool-dispatch`        | `TOOL_DISPATCH_BROKER_TOKEN`          | `tool_dispatch`              | matching claim/renew/complete broker endpoints | optional tool payload and resolver-specific Secret only |
| Browser automation   | `romeo-browser-automation`   | `BROWSER_AUTOMATION_BROKER_TOKEN`     | `browser_automation`         | matching claim/renew/complete broker endpoints | none                                                    |
| Knowledge extraction | `romeo-knowledge-extraction` | `KNOWLEDGE_EXTRACTION_BROKER_TOKEN`   | `knowledge_extraction`       | matching claim/renew/complete broker endpoints | none                                                    |

Broker secrets rotate independently. The app Deployment mounts each enabled
audience's `credentialSecret` and optional `previousCredentialSecret`; workers
mount only `credentialSecret` (write-new). During rotation, the server accepts
the current and explicitly configured previous value only for the matching
audience. Revocation or
audience mismatch denies claim, renew, and completion. Claim tokens are opaque,
audience-bound, lease/fence-bound, and tenant execution occurs inside an exact
tenant database role; broker credentials are never ordinary organization API
keys or `global_admin` principals.

Each broker worker has a component-scoped egress NetworkPolicy. The chart adds
only the exact release/app pod selector and API port needed for broker traffic;
tool/browser deployments must add their reviewed external destinations, while
knowledge extraction can remain app-only. The app ingress policy admits only
the enabled release-scoped broker components in addition to the operator's
normal ingress boundary.
Because the chart's broker origin is a fixed same-release ClusterIP service,
the worker pod explicitly sets `ROMEO_WORKER_BROKER_ALLOW_INSECURE_HTTP=true`.
Outside this chart-controlled NetworkPolicy boundary, the CLI requires HTTPS
and an origin-only base URL before it reads or sends the audience credential.
