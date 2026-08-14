# Usage and cost taxonomy

Romeo records usage through one canonical ledger. A metric is not a free-form
label: its registry entry defines its unit, allowed source boundary,
aggregation, measurement provenance, overlap behavior, and whether it is a
billable quantity.

## Canonical measurements

| Class     | Canonical measurements                                                                        |
| --------- | --------------------------------------------------------------------------------------------- |
| Text      | input, output, cached-input, reasoning, and total tokens                                      |
| Image     | input images, generated images, and estimated micro-USD cost                                  |
| Audio     | input/output seconds, with bounded byte/character fallbacks only when duration is unavailable |
| Video     | input seconds                                                                                 |
| Compute   | CPU milliseconds and memory byte-milliseconds                                                 |
| Retrieval | retrieval units plus separately classified request/activity events                            |
| Storage   | bytes, embeddings, and non-additive source lifecycle observations                             |

Activity, latency, and transport metrics use their own units and are never
silently added to billable media or token quantities. Deprecated ambiguous
units such as `ms`, `char`, `count`, and `disconnect` are rejected for new
writes.

## Token overlap and cost

Provider input and output tokens are the primary billable components. Cached
input and reasoning token counts are retained as `component_of_total`
measurements for provider reconciliation and policy without being added again
to total tokens. Reasoning carries an estimated component-cost annotation when
model output pricing is configured, plus an explicit pointer to the reported
output metric that already contains that cost; the annotation is never a
second cost candidate. A provider-reported total is explicitly `non_additive`.
Estimated token events remain separate from reported token events and are not
presented as interchangeable facts.

Romeo does not manufacture a reported total when an adapter supplies only
input and output components. Summary and UI fallbacks may add those components
for display, while the durable `llm.total_token.reported` metric is written only
for an upstream total. Reasoning tokens are never inferred from hidden text or
answer length. Usage source metadata is stamped from the selected adapter,
never copied from an upstream response.

Cost rollups select exactly one observation per run and input/output side:
provider-reported token counts supersede estimates. Retry, tool-call, and
fallback legs retain separate bounded provider/model usage segments, so billed
attempts are not lost and fallback usage is priced against the model that
produced it. Within each segment the latest provider snapshot wins, avoiding
duplicate cumulative stream chunks. Likewise, an explicit integer
`image.cost.micro_usd` event supersedes legacy cost metadata on
`image.generated`. This prevents estimated/reported or compatibility records
from being charged twice while keeping every underlying measurement auditable.
The additive CSV columns `measurement`, `overlapPolicy`, `billable`,
`costSelected`, and `reconciledCostUsd` make the same decision explicit for
offline finance analysis; the legacy raw `estimatedCostUsd` column is retained
as measurement evidence, not as the value to sum.

Image prices are stored as integer micro-USD quantities to avoid floating-point
currency aggregation. Provider-specific pricing metadata may accompany an
event but cannot change its unit.

All discrete quantities, including tokens, bytes, images, retrieval units, and
micro-USD, must be nonnegative safe integers. Only duration seconds and
throughput rates may be fractional. Repository enforcement rejects non-finite,
negative, unsafe, or unexpectedly fractional writes.

## Enforcement

- Services write through `recordUsage`, `recordSubjectUsage`, or
  `updateRecordedUsage`.
- Both in-memory and PostgreSQL repository boundaries validate every new or
  updated event, preventing internal/background code from bypassing the
  taxonomy.
- Historical rows remain readable for compatibility; only new mutations are
  rejected.
- The TypeScript metric union couples each metric to its allowed unit and
  source type.
- Authenticated callers with `usage:read` can discover the exact public
  vocabulary and semantics through `GET /api/v1/usage/taxonomy`; OpenAPI and
  both generated SDKs carry the same versioned contract. Historical event
  responses keep their string metric field so pre-taxonomy rows remain
  exportable during migration.
- `pnpm check:usage-taxonomy` inventories production writes, rejects direct
  repository bypasses and deprecated units, verifies contract/registry parity,
  and locks every reviewed dynamic metric site to an exact file count.

No usage metadata may include prompt, response, audio, image, document,
credential, raw provider error, or storage-object content. Privacy-safe IDs,
bounded counts, model/provider identifiers, and measurement provenance are the
intended metadata surface. The same bounded recursive metadata validator used
by the audit ledger rejects forbidden keys, credential-shaped strings, control
characters, oversized strings/collections, excessive nesting, and non-finite
numbers before either in-memory or PostgreSQL persistence. Legacy-row cleanup
may retain old metric/unit classifications, but the replacement metadata must
pass the current privacy policy.

Reasoning token ceilings are safety constraints. Every currently registered
dialect rejects `maxReasoningTokens` before provider dispatch because none
exposes an enforceable native ceiling; Romeo does not treat an output-token
limit or a post-hoc usage observation as equivalent enforcement.
