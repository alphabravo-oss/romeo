# ADR-0006: Secure compute isolation

**Status:** Accepted  
**Date:** 2026-08-14  
**Roadmap:** EP-10

## Context

Executing model- or user-authored code creates a materially different trust boundary
from rendering chat. Process-level sandbox libraries alone do not provide dependable
tenant isolation, egress control, or cleanup.

## Decision

The required GA runtime profile and operational qualification are specified in the
[secure-compute isolation decision](../secure-compute-isolation-decision.md): Kata
Containers runtime-rs with QEMU/KVM, one short-lived VM per job, selected by a
dedicated Kubernetes `RuntimeClass` on compute-only nodes. Ordinary containers,
application-host execution, and silent runtime fallback are prohibited.

1. Secure compute is a separately installed, default-disabled high-risk capability.
   API nodes never execute untrusted code in-process or on their host filesystem.
2. Jobs run in an isolated runner with non-root identity, read-only root, no privilege
   escalation, minimal capabilities, seccomp/AppArmor (or equivalent), PID/CPU/memory/
   disk/wall limits, job-scoped ephemeral storage, and deterministic teardown.
3. Network is default-deny. Approved destinations use the canonical DNS-pinned egress
   layer; metadata, control planes, data planes, private/special ranges, redirects, and
   unbounded transfer are denied.
4. Images/runtimes are allowlisted by immutable digest, scanned, signed, and policy
   versioned. Package installation is disabled unless an explicit curated dependency
   mode is authorized before job start.
5. Inputs are copied by authorized immutable reference after malware/content-policy
   checks. Outputs are quarantined, bounded, scanned, typed as artifacts, and authorized
   independently before download or model reuse.
6. Secrets are job-scoped handles with least privilege, never environment dumps or
   inherited API-process credentials. Logs and errors are bounded and redacted.
7. Authorization, grants, DLP, quota, budget, concurrency, approval, and idempotency are
   checked before queueing and rechecked before sensitive side effects.
8. Runner loss, timeout, cancel, lease loss, and drain have terminal durable states and
   guaranteed cleanup. No automatic retry occurs for non-idempotent work.

## Consequences

- Local development may use a clearly marked emulator, but production cannot weaken the
  isolation contract by configuration.
- Compute availability can be lower than chat availability without degrading chat safety.
- Browser automation and compute may share egress primitives, not execution privileges.

## Validation

- Escape, syscall, privilege, fork bomb, memory/disk/CPU, timeout, and orphan cleanup tests.
- Metadata/private-network/DNS-rebinding/redirect/oversize exfiltration tests.
- Malicious input/output, archive bomb, malware, secret, cross-tenant artifact, and expired
  grant tests.
- Multi-runner claim/lease/cancel/drain chaos, resource accounting, and quota reconciliation.
- Deployment policy rejects root/writable/mutable-image/no-egress-policy configurations.

## Reconsider when

A stronger isolation platform is adopted. The replacement must meet or exceed these
properties and provide migration, rollback, and adversarial evidence.
