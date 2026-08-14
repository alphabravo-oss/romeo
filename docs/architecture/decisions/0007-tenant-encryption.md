# ADR-0007: Tenant encryption and customer-managed keys

**Status:** Accepted  
**Date:** 2026-08-14  
**Roadmap:** EP-14

## Context

Platform disk/database encryption does not provide tenant-scoped cryptographic control.
Customer-managed keys introduce availability, search, rotation, purge, and support
tradeoffs that cannot be hidden behind a generic “encrypted” label.

## Decision

1. Transport encryption and infrastructure encryption at rest remain mandatory. Tenant
   envelope encryption is an additional governed capability, not a replacement.
2. A versioned tenant data-encryption key encrypts content-class data keys; KMS/HSM key
   references are stored, never raw customer master keys. Envelopes bind purpose,
   organization, workspace/record identity, format version, and algorithm as AAD.
3. Key administration is separate from tenant plaintext access. Global operators do not
   gain chat/file/key plaintext; support uses explicit time-bound break-glass where allowed.
4. Key states include active, rotating, disabled, revoked, and recovery-required. Reads
   identify the exact key version. Rotation is resumable, observable, idempotent, and
   read-old/write-new until verified completion.
5. KMS failure behavior is explicit per data class. Romeo never silently substitutes a
   platform key for an unavailable or revoked customer key.
6. Search/vector/analytics capability is declared per encrypted data class. Separate
   scoped indexes or derived data require explicit policy, keys, lineage, retention, and
   purge; otherwise the feature is disabled.
7. Backups, replicas, exports, caches, derived media, embeddings, and deletion workflows
   preserve tenant/key boundaries. Crypto-erasure does not replace required indexed
   deletion evidence unless explicitly approved by policy.
8. Algorithms and envelope formats are registry-versioned and use supported AEAD. Nonces
   are unique, keys are least-privilege, and plaintext lifetime in memory is bounded.

## Consequences

- BYOK may make tenant data unavailable during KMS outage or revocation; the UI and
  readiness surfaces must explain this safely.
- Features that need plaintext server-side are either performed inside the authorized
  boundary or shown as unavailable; there is no deceptive “BYOK compatible” badge.
- Rotation and restore drills become release/operations evidence.

## Validation

- Envelope swap/tamper/AAD/version/nonce tests and cross-tenant ciphertext substitution.
- KMS deny, timeout, throttle, revoke, rotate, resume, rollback/forward-repair, and cache
  expiry drills.
- Backup/restore and tenant purge prove keys, ciphertext, indexes, caches, media, and
  derived records remain scoped and recoverable/deletable as intended.
- Logs, audits, metrics, support bundles, errors, and traces contain key IDs only where
  allowlisted and never plaintext, key material, or protected content.
- Dual-control authorization and break-glass expiry/alert/revocation tests.

## Reconsider when

An encryption model with stronger customer control is adopted. Searchability or support
convenience alone cannot justify weakening tenant separation or silent key substitution.
