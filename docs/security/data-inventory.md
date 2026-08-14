# Enterprise data inventory

The machine-readable [data inventory](./data-inventory.json) is Romeo's canonical
map of persistent and transient data surfaces. It classifies every Drizzle
PostgreSQL table and field plus object storage, backups, Valkey, indexes,
telemetry, audit, browser/SSR caches, worker scratch, support evidence, and
release/air-gap artifacts.

## Classification

The four levels are ordered and restrictive:

1. `public` is deliberately approved for public release and contains no tenant or
   subject data.
2. `internal` is non-public Romeo operational or catalog metadata without customer
   content or credentials.
3. `confidential` includes tenant configuration, identifiers, relationships,
   usage, audit, prompts, messages, documents, media, vectors, results, and derived
   customer content.
4. `restricted` includes credentials, authentication factors, external identities,
   personal account data, storage locators, and encrypted or hashed secret material.

A table supplies the minimum classification for every field. Designated high-risk
column names are always escalated to `restricted`, including credential/hash/token,
secret, idempotency, lease-token, scope-snapshot, and object-key fields. A new table
or an unrecognized high-risk field fails the quality gate until the inventory is
reviewed.

Classification is not authorization. Every access still requires tenant predicates,
current subject/resource authorization, effective capability/policy, and action-time
checks. Search indexes, backups, caches, derived data, exports, and artifacts inherit
the source's access, retention, legal-hold, deletion, and incident obligations.

## Machine enforcement

Run:

```bash
pnpm check:data-inventory
```

The checker imports the actual Drizzle schema, expands all table fields, rejects
missing/duplicate/unknown tables, prevents sensitive-table downgrades, verifies the
restricted-column escalation set, requires every non-database store, and enforces
privacy sentinels for telemetry and request-scoped caches. Adversarial self-tests
prove those controls fail closed. It writes metadata-only evidence to
`dist/ci/data-inventory.json`; that artifact contains schema/table/field names and
classification only, never row values, tenant identifiers, content, endpoints, or
secrets.

## Control-plane use

This inventory is the input to EP-14 encryption, customer-managed keys, key rotation,
crypto-shred, approval, evidence, and compliance work. It also defines the minimum
scope for:

- retention, legal hold, data-rights deletion, tenant purge, backup expiry, and
  restore validation;
- plaintext search/embedding exceptions and their tenant/ACL predicates;
- log, metric, trace, support-bundle, and release-evidence redaction;
- object/file/artifact lifecycle and signed access;
- browser/session transition cache clearing; and
- online and air-gapped storage, key, backup, and incident runbooks.

The inventory deliberately does not claim that every restricted field is already
protected by a tenant-specific envelope key. EP-14-02 through EP-14-08 remain open
until their implementation and exact-target validation are complete.
