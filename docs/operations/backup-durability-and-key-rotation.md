# Backup durability, coordinated restore, and runtime key rotation

Production backup success means durable remote readback, not process exit.
Postgres managed backup validates a fresh destination-policy document before
`pg_dump`, uploads the dump, manifest, and status, and streams each object back
to verify byte count and SHA-256. The destination policy must prove versioning,
replication, object lock, protected manifests/indexes, lifecycle deletion after
minimum retention, and protected legal-hold bypass. Missing, stale, weakened,
or unreadable evidence fails before the dump is created.

Object backups use `romeo.object-store-backup.v2`. Operators assign the same
backup-set ID and checkpoint to the database and object backup. Production
object backup also requires verified destination-policy evidence and records
object version/encryption metadata. Coordinated restore verifies both manifest
digests, the database dump digest, backup-set equality, bounded checkpoint
skew, and verified destination policy. It then restores objects before the
database into isolated targets; object restore refuses a nonempty bucket and
performs full digest readback plus missing/orphan reconciliation.

Real provider evidence remains intentionally environment-gated: provider API
readback must supply lifecycle/object-lock/replication truth, and a credentialed
restore drill must prove the isolated database and object targets plus
application-level readback. Offline smokes prove the fail-closed policy and
tamper matrix, not cloud durability.

Webhook and delegated OAuth rotations are read-old/write-new. Add the previous
key, deploy the new active key, allow OAuth use to rewrap legacy/previous
envelopes, and allow webhook consumers to adopt the active versioned signature
while the previous signature header is present. A global administrator with the
explicit `admin:read` scope must read
`GET /api/v1/admin/runtime-key-rotation/posture` through the system-coordinator
database boundary before removing a deployment-global previous key. The
authoritative report uses aggregate database queries across all organizations;
any previous, legacy-unversioned, unknown-version, or corrupt record blocks
removal. It returns no organization, record, ciphertext, payload, signature, or
key identifiers and writes a sanitized platform-census audit event. Tenant-local
counts must never be used as proof that a deployment-global key is removable.
Keep key material out of logs, evidence, Helm values, and command arguments.
