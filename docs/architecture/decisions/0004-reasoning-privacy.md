# ADR-0004: Reasoning privacy and retention

**Status:** Accepted  
**Date:** 2026-08-14  
**Roadmap:** EP-06, EP-11, EP-14

## Context

Models expose reasoning through incompatible concepts: effort/budget controls, safe
summaries, encrypted provider state, token counts, or raw hidden traces. Raw
chain-of-thought may contain secrets, unsafe intermediate content, or provider-protected
data and is not required to provide a useful enterprise explanation.

## Decision

1. Romeo exposes reasoning effort, budget, outcome metadata, and provider-safe summary
   as separate typed concepts.
2. Raw hidden chain-of-thought is neither requested, persisted, streamed, indexed,
   exported, logged, nor shown by default. Provider fields marked hidden remain hidden.
3. A reasoning summary is ordinary governed output: it is attributable, content-policy
   checked, authorized, retained, exported, and deleted under explicit policy.
4. Provider-encrypted continuation state is an opaque secret envelope with purpose and
   tenant/record binding. It is never rendered or treated as an explanation.
5. Any future raw-trace mode requires a new ADR, provider permission, explicit installed
   capability, platform and organization enablement, data-class restrictions, separate
   storage/encryption/retention, access grants, prominent UI, audit, and dual approval.
6. Usage records may retain bounded reasoning-token counts and costs without content.
7. Model comparison and evals use outputs, summaries, citations, and outcome metrics;
   they do not gain raw-trace access implicitly.

## Consequences

- UI labels must not call a summary “full reasoning” or imply unsupported transparency.
- Adapters delete/ignore raw reasoning fields at the trust boundary.
- Debugging relies on safe request IDs, normalized provider metadata, summaries, and
  controlled synthetic reproductions rather than production chain-of-thought.

## Validation

- Provider fixtures inject secret-bearing hidden reasoning into chunks and terminal
  payloads; API, SSE, DB, audit, logs, support bundles, exports, evals, and DOM remain clean.
- Effort/budget mapping and unsupported-value behavior are adapter-conformance tested.
- Summary authorization, DLP, retention, legal hold, export, and deletion are tested.
- Opaque continuation envelopes have swap/tamper/rotation and tenant-binding tests.

## Reconsider when

Law, provider contracts, or a validated enterprise use case justifies a separately
governed raw trace. Convenience debugging is not sufficient.
