# Audit integrity and verified export

Romeo's audit integrity layer protects the stored audit event, its tenant and
its position in the tenant history. The trust APIs never accept an event list,
root, acknowledgement, or signing-key version as authoritative input.

## Canonical record and chain

Each successful audit insert and its integrity record are committed in one
transaction. PostgreSQL takes a transaction-scoped advisory lock derived from
the organization ID before allocating the next sequence, so concurrent writers
cannot reuse or reorder a tenant sequence. Historical rows are backfilled under
the same lock.

The `romeo.audit-integrity-record.v1` payload contains the immutable event ID,
organization ID, actor, action, resource, outcome, metadata, and timestamp.
Object keys use code-unit lexical order, unsupported values are rejected, and
the resulting JSON is hashed with SHA-256. The record hash is SHA-256 over the
schema, sequence, previous record hash, and payload hash. Tenant heads preserve
the last sequence and hash across policy-authorized retention pruning.

Checkpoints cover a contiguous range. They bind the first and last record hash,
a binary SHA-256 Merkle root, the preceding checkpoint hash, algorithm, key
version, tenant, range, count, and creation time. The default signer uses
domain-separated HMAC-SHA-256 keys and supports an active version plus retained
historical verification keys. The signer interface is injectable through
`CreateServicesOptions`, so a managed KMS implementation and its full historical
key-version inventory can replace it without changing records or checkpoints.
The checkpoint hash binds the signed body and signature.

PostgreSQL triggers reject ordinary updates and deletes of integrity records
and checkpoints. The only current mutation path sets the transaction-local
authorization marker for retention or tenant purge; export jobs never receive
that marker.

## Export protocol

An export request resolves a stored, tenant-scoped checkpoint and hashes the
idempotency key. A durable transaction writes the destination, job, and
idempotency receipt. Workers claim jobs with a random lease token, a bounded
lease, and a maximum attempt count. A lease-token compare-and-set commits each
attempt, preventing a stale worker from completing a reclaimed job.

Before delivery, Romeo verifies the checkpoint, reconstructs the canonical
`romeo.audit-export-payload.v1` payload from stored records, and compares its
digest to the durable job digest. Success requires all of the following:

1. The destination acknowledges the exact sequence range with a SHA-256-shaped
   acknowledgement.
2. Independent destination readback returns the same acknowledgement,
   checkpoint hash, range, and payload digest.
3. WORM destinations also return non-empty retention-lock evidence.

Failures store only a bounded error code, use exponential backoff capped at
five minutes, and move to a dead-letter state after the configured maximum.
Retention deletion fails closed while any active destination lacks a verified
job covering every eligible sequence; WORM destinations additionally require
retention-lock evidence. Trust posture reports destination state, sequence lag,
last success, and age from stored jobs.

## Tamper and failure evidence

`packages/core/src/services/audit-integrity.test.ts` covers canonical content,
record order, deletion/partial range, insertion, previous-hash, checkpoint
range/root/hash/signature/key-version, cross-tenant tampering, historical-key
verification, post-retention sequencing, success, duplicate replay, conflicting
replay, destination range mismatch, readback mismatch, missing retention lock,
timeout, retry, dead-letter, and retention gating.

Repository conformance in `packages/db/src/romeo-repository.test.ts` runs the
same public service against memory and, when
`ROMEO_POSTGRES_CONFORMANCE_DATABASE_URL` is present, migrated PostgreSQL. Schema and
migration tests assert the tables, constraints, indexes, and immutability
triggers.

Run the local evidence with Node 24:

```sh
pnpm --filter @romeo/core exec vitest run \
  src/services/audit-integrity.test.ts src/enterprise-surfaces-api.test.ts
pnpm --filter @romeo/db exec vitest run \
  src/romeo-repository.test.ts src/schema-contract.test.ts \
  src/migration-baseline.test.ts
pnpm check:database-evolution-policy
pnpm check:data-inventory
```

Live KMS signatures, customer SIEM acknowledgements, object-store retention
lock, and migrated PostgreSQL evidence are environment-gated. Release evidence
must record the destination identity, redacted checkpoint/root/key version,
payload digest, acknowledged range, readback digest, lock mode/expiry, duplicate
result, lag/age, and failure alert state. Secret bytes, lease tokens, endpoint
credentials, and raw restricted audit metadata must not enter evidence logs.
