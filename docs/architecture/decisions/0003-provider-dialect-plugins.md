# ADR-0003: Provider dialect plugin boundary

**Status:** Accepted  
**Date:** 2026-08-14  
**Roadmap:** EP-05, EP-06, EP-08, EP-09

## Context

OpenAI-compatible endpoints are not behaviorally identical. Capability guessing and a
single broad provider interface cause silent parameter loss, incorrect streaming,
unsafe fallback, and misleading model selectors.

## Decision

1. A registered provider dialect owns discovery, request mapping, stream decoding,
   usage parsing, error normalization, and capability probing for its provider family.
2. Focused optional interfaces cover chat, embeddings, image, audio, files, batches,
   token counting, and realtime. An adapter implements only supported interfaces.
3. Model capability truth retains four sources separately: provider-advertised,
   Romeo-probed, administrator-overridden, and effective. Provenance, freshness, and
   conflicts are visible; overrides are versioned, expiring, and audited.
4. The effective capability resolver intersects adapter/model truth with installation,
   entitlement, policy, grants, health, quota, and request constraints.
5. Unsupported parameters fail with a stable capability error unless policy explicitly
   permits a visible downgrade. Cross-provider or cross-region fallback is never silent.
6. Plugins receive bounded canonical inputs and secret handles, not unrestricted
   repositories. Network access uses the canonical DNS-pinned egress policy.
7. Raw provider errors, bodies, URLs, headers, hidden reasoning, and credentials never
   enter public errors, chat rows, audit records, or support evidence.
8. Built-in and future out-of-tree adapters pass the same conformance kit and versioned
   plugin contract. Arbitrary runtime code upload is not implied by “plugin.”

## Consequences

- “Support all models” means all models behind a registered, conformant dialect with
  truthful capabilities—not blindly forwarding unknown fields.
- UI controls derive from effective capability reports rather than provider names.
- Adding a provider does not add authorization, egress, secret, or retention exceptions.

## Validation

- Golden request/response/stream/usage/error fixtures per dialect.
- Capability-lie, malformed chunk, cancellation, retry, rate-limit, and unknown-field tests.
- Region/residency, egress pinning, secret-redaction, and fallback-boundary tests.
- Live bounded probes are admin-initiated, rate/cost limited, non-destructive, and audited.
- Model picker and API reject the same unsupported/disabled selections with safe reasons.

## Reconsider when

A provider protocol requires a genuinely different trust boundary. It may add a focused
interface or separate worker, but not bypass canonical policy and content contracts.
