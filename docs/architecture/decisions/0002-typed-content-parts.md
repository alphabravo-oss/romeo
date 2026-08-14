# ADR-0002: Versioned typed content parts

**Status:** Accepted  
**Date:** 2026-08-14  
**Roadmap:** EP-06 through EP-13

## Context

Text plus ad-hoc image fields cannot safely represent audio, documents, generated
media, tools, citations, reasoning summaries, or artifacts. Provider-shaped payloads
also leak dialect details into storage and UI code.

## Decision

1. Messages use a closed, versioned discriminated union of canonical content parts.
   Initial governed kinds include text, image, audio, document, video, tool call/result,
   citation, reasoning summary, and artifact reference.
2. Parts carry stable IDs, ordering, MIME/type metadata, size/duration/dimensions where
   applicable, provenance, lifecycle state, and references to object storage. Large or
   binary payloads are never embedded in event rows, audit records, or general JSON.
3. Contracts distinguish user input, provider output, derived/extracted content, and
   references. Trust labels and transformations remain attributable.
4. Provider adapters translate between the canonical union and native dialects. The
   domain, policy engine, persistence, API, SDKs, and UI do not store provider payloads
   as their primary representation.
5. Every part kind declares validation, authorization, malware/content-policy checks,
   retention, deletion/legal-hold, export, accessibility, and fallback behavior.
6. Unknown additive parts remain round-trippable only where explicitly safe; clients
   render a localized unsupported placeholder and never execute unknown content.
7. Editing creates a new message/part version with provenance. Immutable source media
   is not overwritten.
8. Signed download URLs are short-lived and authorized at issuance and retrieval.

## Consequences

- Text-only endpoints keep an explicit compatibility projection rather than becoming
  an untyped escape hatch.
- STT can produce a derived text part while preserving a governed audio source.
- Generated images, citations, and artifacts can share conversation ordering without
  sharing storage or execution privileges.
- Schema evolution follows expand/read-both/write-new/contract and SDK drift gates.

## Validation

- Contract round trips and malformed/oversized/unknown-kind rejection.
- Cross-tenant reference, revoked grant, expired URL, retention, legal-hold, and purge tests.
- Provider adapter conformance for supported/unsupported modalities and fallback paths.
- DLP/malware tests before persistence and external dispatch, including transformations.
- Browser accessibility, upload/progress/cancel/retry, and safe unsupported-part rendering.

## Reconsider when

A modality cannot be represented without weakening validation or authorization. That
modality receives a new explicit part kind and migration rather than an arbitrary blob.
