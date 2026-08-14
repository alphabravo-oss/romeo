# Audit taxonomy

Status: implemented; EP-00-08 is complete for all current production audit writes.

## Source of truth and guarantees

`packages/core/src/audit-taxonomy.ts` derives one typed registry from the categorized action and per-action metadata inventories. Its 267 exact actions assign category, resource semantics, semantic class, required actor/organization/outcome/resource context, metadata-only sensitivity, reject-on-forbidden redaction, and bounded metadata value classes. The semantic classes cover lifecycle starts, policy decisions, provider routing, media, compute/tools, ACL filtering, compare/replay, and encryption or secret rotation.

`AuditAction` is a finite union. `AuditMetadata<A>` binds metadata keys to the selected action. Dynamic business decisions use finite literal mappings or action-generic builders; arbitrary strings and `Record<string, unknown>` metadata cannot cross the canonical writer without failing typecheck or the static gate. All production service writes use `writeAuditLog`, including writes inside repository transactions, so caller-supplied identifiers, timestamps, actors, and rollback behavior are preserved.

`assertValidAuditLog` validates the complete record before persistence. Both the in-memory and PostgreSQL `createAuditLog` implementations invoke it independently, so direct repository callers cannot bypass the taxonomy. Unknown actions, unknown metadata keys, forbidden content fields, excessive size/depth, unsafe control characters, and credential-shaped strings fail with stable generic errors that contain neither the action, metadata key/value, nor audit body.

`pnpm check:audit-taxonomy` uses the TypeScript program and runtime registry to reject:

- any production `createAuditLog` call outside the canonical writer;
- an action whose inferred type is not a finite set of registered literals;
- metadata with a string index signature instead of a finite typed shape;
- metadata keys outside the inferred finite action set;
- duplicate action allocation or registry drift.

The current release-blocking inventory is zero direct-write bypasses, zero dynamic-action sites, and zero dynamic-metadata sites. The gate runs through `quality` and CI. Runtime privacy and in-memory boundary sentinels live in `packages/core/src/audit-taxonomy.test.ts`; the PostgreSQL adapter has a local pre-query rejection test, and repository conformance covers the same behavior against live PostgreSQL when `ROMEO_POSTGRES_CONFORMANCE_DATABASE_URL` is configured.

## Privacy boundaries

Safe metadata describes decisions and bounded aggregates: identifiers, detector codes and counts, state transitions, policy outcomes, provider/model routing identifiers, media byte counts or formats, ACL decision counts, tool/compute status, compare identifiers, and encryption rotation status. It must never contain prompts, assistant output, raw media, retrieved source text or URLs, request/response bodies, credentials, secrets, access or refresh tokens, passwords, raw error messages, or stack traces.

The audit query/export API remains compatible and historical rows remain readable. This work validates new writes; it does not rewrite historical records.
