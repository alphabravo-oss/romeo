# Public API error registry

Romeo's stable HTTP error codes are allocated in the typed registry at
`packages/core/src/public-api-error-registry.ts`. The registry maps every
current `ApiError` and direct error-envelope code to a canonical HTTP status,
retryability, a localization intent and resolvable intent copy key, and bounded
operator remediation. The shared `api-errors` namespace has exact English,
Spanish, and French key parity. The two inventory modules are implementation-only
partitions that keep production files below the architecture ratchet; the
exported registry is the sole lookup surface.

New public codes must be registered before use. `ApiError` accepts only the
registry's code union and validates code/status pairs at runtime. Dynamic code
boundaries must call `requirePublicApiErrorCode`, while untrusted provider codes
are reduced through the provider dialect normalizer to registered category
codes. The release gate scans literal
constructors, rejects missing or duplicate registrations and status drift, and
runs together with the core typecheck. It also proves that every allocated copy
key exists and is non-empty in every supported locale.

Localization copy is not returned by a new discovery endpoint. Exposing the
full operator-oriented catalog to unauthenticated clients would add unnecessary
enumeration surface; clients continue receiving the existing stable error
envelope and may map its code to localized copy. Operators use source-controlled
registry metadata and request IDs.

The registry intentionally preserves five pre-existing multi-status codes as
explicit compatibility exceptions: `delegated_oauth_scope_invalid`,
`knowledge_retrieval_plan_empty`, `managed_secret_external_write_failed`,
`saml_request_state_invalid`, and `scim_error`. New exceptions fail the policy
gate. These should be split into semantically distinct codes only through the
API evolution policy, not silently changed in place.

Privacy requirements remain unchanged: codes, copy keys, and remediation are
metadata only. Raw exception messages, credentials, request bodies, concrete
resource paths, prompts, and provider payloads must never be used as registry
metadata or unknown public codes.

Provider failures use nine stable categories with fixed public codes and retry
classification: authentication, quota, rate limit, unavailable, invalid request
or capability, policy, timeout, cancelled, and unexpected. Category details are
safe enums only; upstream bodies, URLs, headers, messages, and provider-native
codes are discarded before the error reaches core.
