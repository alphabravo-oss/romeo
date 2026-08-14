# Database evolution policy

Status: accepted  
Owner: database and release engineering  
Applies to: every persistent Romeo schema, index, constraint, backfill, and data-format change

## Invariants

1. Released migration files are immutable and append-only. Their SHA-256 digests are locked in `migration-ledger.json`.
2. Application rollouts use expand, bounded backfill, read-both, write-new, and only then contract. A release must remain compatible with the immediately preceding application version while an expand or backfill migration is active.
3. Tenant predicates, tenant purge, retention, legal hold, export, and backup/restore behavior are part of the schema contract. A migration is incomplete when any one is missing.
4. Deployments may restart or retry any migration. Schema changes and backfills are idempotent, resumable, observable, and bounded; they do not depend on one application process remaining alive.
5. Destructive SQL is never hidden in an expand migration. `DROP TABLE`, `DROP COLUMN`, destructive type rewrites, bulk deletion, and new non-null constraints on populated tables require a separately reviewed contract migration and release evidence.
6. A rollback never pretends that deleted data can be recreated. Expand/backfill releases prefer application rollback with the additive schema retained. Contract releases require a verified backup/restore or forward-repair procedure and an explicit compatibility cutoff.
7. Schema migrations run as a dedicated deployment job before application rollout; ordinary application processes do not race to migrate at startup.

## Required phases

### Expand

Add nullable columns, new tables, compatible indexes, and permissive constraints. New indexes on large tables use an operationally safe construction plan appropriate to the target PostgreSQL topology. Old readers and writers continue to work.

### Backfill

Backfills are deterministic, restartable, tenant-bounded, checkpointed, and rate limited. They publish metadata-only progress, lag, failures, and estimated completion. A representative plan and lock-duration budget are reviewed before production.

### Read-both / write-new

The application tolerates old and new records while writing the new representation. Reads have an explicit precedence rule. Reconciliation detects divergence without logging protected content.

### Contract

Only after fleet convergence and the compatibility window may Romeo remove an old column, table, index, or format. The release record must identify the last compatible application version, zero-use evidence, restore or forward-repair procedure, and approval.

## Migration ledger

`docs/database/migration-ledger.json` is the machine-readable inventory. The accepted historical baseline is represented by a locked filename, digest, and phase tuple. Every later SQL migration must have exactly one full `migrations` entry containing:

- filename and immutable SHA-256;
- evolution phase and whether it changes existing data;
- restart, previous-version compatibility, tenant-purge, backup/restore, and repair assertions;
- evidence references that can be executed or reviewed;
- a destructive approval reference for contract migrations.

The historical migrations through `0019` are locked as the accepted baseline. The policy checker applies stricter destructive-SQL and evidence requirements to every later migration. A developer may not edit a historical digest to make a changed migration pass; corrections are additive migrations.

New ledger entries use this shape (evidence paths are repository-relative metadata artifacts, never credentials or evidence bodies):

```json
{
  "file": "0020_example_expand.sql",
  "sha256": "<64 lowercase hex characters>",
  "phase": "expand",
  "changesExistingData": false,
  "restartSafe": true,
  "previousVersionCompatible": true,
  "tenantPurgeValidated": true,
  "backupRestoreValidated": true,
  "repairStrategy": "Retain the additive schema and roll back the application.",
  "evidence": {
    "upgrade-from-current": "dist/ci/example-upgrade.json",
    "restart": "dist/ci/example-restart.json",
    "rollback-or-forward-repair": "dist/ci/example-repair.json",
    "backup-restore": "dist/ci/example-backup-restore.json",
    "tenant-purge": "dist/ci/example-tenant-purge.json",
    "schema-contract": "dist/ci/example-schema-contract.json"
  }
}
```

## Release sequence

1. Back up and verify the restore target before high-risk migration work.
2. Apply migrations to a copy of the current supported release database, not only an empty database.
3. Restart the migration job at interruption points and prove convergence.
4. Run schema validation, repository conformance, tenant-isolation negatives, tenant purge, retention/legal-hold, and representative query-plan tests.
5. Deploy a mixed-version canary when the change affects a live read/write path.
6. Observe migration lag, locks, errors, database saturation, and application error budgets.
7. Roll back the application while retaining additive schema if thresholds fail.
8. Contract only in a later approved release after the compatibility and evidence windows close.

## Mandatory validation

- greenfield and upgrade-from-current migration runs;
- interrupted/restarted migration convergence;
- previous and current application compatibility during expand/backfill;
- tenant purge and data-rights behavior for every new tenant-owned record;
- backup creation, restore, integrity comparison, and encrypted offsite retention evidence;
- rollback or forward-repair rehearsal with recovery time recorded;
- query plans and lock timing at representative cardinality;
- in-memory/PostgreSQL repository parity and cross-tenant negative tests;
- release evidence containing only metadata, hashes, counts, timings, and safe identifiers.

Production-only acceptance remains external when it needs target data volume, topology, backup infrastructure, or a mixed-version fleet. Missing external evidence blocks that rollout; it does not justify weakening this policy.
