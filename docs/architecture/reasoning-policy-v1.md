# Reasoning policy v1

Romeo's v1 reasoning policy is a strict, privacy-safe control plane. It never
requests or exposes hidden chain-of-thought.

## Resolution order

The resolver applies these layers in order:

1. the immutable deployment/platform deny;
2. the versioned organization maximum;
3. the versioned workspace maximum;
4. the pinned agent-version default;
5. the direct per-run request;
6. the selected provider dialect plus provider and model capabilities.

The per-run request selects the desired policy, the organization layer caps it,
and the target constraint decides whether it can be enforced. A changed or
unsupported request is rejected with Romeo's stable
`provider_invalid_request_or_capability` failure before provider side effects.
It is never silently reinterpreted as ordinary generation. `mode: off` remains
an explicit, side-effect-free override.

Direct `POST /api/v1/runs` and durable queued chat turns accept the additive
`reasoningPolicy` source field. Queued turns store the validated requested
policy in a nullable, size-bounded JSON column, so rows written by older Romeo
versions remain valid. Reads strictly parse the snapshot and fail closed on
malformed or future non-null shapes. A same-key replay with a different policy is rejected as an
idempotency conflict rather than silently reusing another effort level. The
worker copies the snapshot into the ordinary StartRun input, so both paths share
the resolver and fail closed before provider side effects.

Safe `run.started.parameterResolution.reasoningPolicy` evidence records only
the requested/effective enum and bounded numeric controls, adjustment reasons,
and the selected source. It contains no prompts, credentials, provider bodies,
or raw reasoning. Retry, fallback, continuation, and crash recovery preserve
the typed request layers. Mutable organization/workspace assignments and the
platform deny are re-read immediately before every provider attempt, including
a retry or fallback, so a newly restrictive revision takes effect before
another adapter call.

The non-executing context preview accepts the same request and resolves it
against the actually routed provider/model. It returns only bounded
requested/effective/source/rejection/adjustment metadata and never contacts the
provider or exposes provider-ready messages. Generated SDKs are updated through
the coordinated source-contract generation window.

## Enterprise administration

Reasoning uses the same versioned capability-assignment store and resolver as
the rest of Romeo's capability hierarchy; there is no parallel mutable control
plane. `reasoning_policy` supports organization and workspace assignments with
deny-dominant merging. Mode and effort use ordered lower maxima, token ceilings
use the numeric minimum, and summary retention uses false-dominant boolean
intersection. The deployment-controlled `reasoning_policy` kill switch remains
outermost and cannot be enabled by a tenant.

The existing capability-admin GET surfaces effective policy and bounded
assignment evidence. PATCH writes an immutable replacement revision with an
expected version, bounded reason, optional expiry, tenant validation, and a
privacy-safe audit containing field names rather than values. POST assignment
preview uses the identical strict parser and resolver without writing an
assignment or audit record. Both write and preview require
`capabilities:manage`; read/history/explain require `capabilities:read`.

The lazy, localized capability admin UI uses generated query/mutation contracts
for organization and workspace controls, exact cache invalidation, expiry,
conflict recovery, and accessible preview feedback. Agent defaults and per-run
requests remain inner request layers and can never broaden the effective
maximum.

Legacy `reasoning_policy.org.v1:<orgId>` SystemSettings are read only as a
compatibility fallback when no active versioned organization assignment
exists. The first versioned organization revision becomes authoritative; the
legacy setting is no longer consulted, so migration and rollback history stay
in the assignment ledger.

Romeo does not currently expose a validated data-class label at run action
time. EP-06-08 therefore does not infer one from prompts, users, workspaces, or
provider metadata; data-class-specific reasoning restrictions remain an
explicit residual until a governed classification source exists at that
boundary.

## Composer and model selection

The chat composer exposes only `Agent default`, `Off`, `Automatic`, `Low`,
`Medium`, and `High`. `Agent default` sends no per-run policy, so it cannot
accidentally replace the immutable agent-version default. `Automatic` sends
`mode: auto` without an effort; it is distinct from explicit `Medium`. Raw
traces and summary retention are never composer options.

The control is driven by the selected model's effective capability report. Its
menu presents localized cost/latency guidance, and an explicit unsupported
choice remains visibly invalid until the user selects `Agent default`, `Off`,
or a capable model. The backend remains authoritative and rejects a stale
unsupported request before provider dispatch. The model picker offers an
explicit reasoning filter and automatically constrains its results when the
pending turn requests reasoning or includes images. The pending requirement is
announced rather than silently hiding incompatible models.

Direct starts, durable queued turns, regenerations, edits/resends,
continuations, and context preview share the same request mapping. Queued-turn
ghosts show their requested level. Context preview displays only bounded
requested/effective/source/adjustment evidence; it never displays
provider-native parameters or hidden reasoning.

## Current native mappings

- OpenAI-compatible Chat Completions maps supported automatic effort to
  `reasoning_effort`.
- OpenAI Responses-compatible maps supported automatic effort to
  `reasoning.effort`.
- OpenAI Responses-compatible maps requested summary mode only when the
  selected capability report advertises provider-safe summaries. The adapter
  accepts only the protocol's designated reasoning-summary field.
- Anthropic and Ollama reject requested automatic reasoning because their
  current Romeo dialects do not expose an enforceable v1 mapping.
- Chat Completions-compatible, Anthropic, and Ollama dialects reject summary
  mode because their current stream fields do not establish provider-safe
  summary semantics.
- A requested maximum token budget is rejected for every current dialect
  because none can enforce that maximum through the current adapter contract.

Those remaining token-budget and dialect summary mappings keep EP-06-02 open.

## Hidden-reasoning boundary

Provider adapters may emit `reasoning_summary` only for a protocol field whose
provider semantics explicitly identify it as a safe summary. The Responses
adapter currently recognizes only `response.reasoning_summary_text.delta`.
Generic Chat Completions `reasoning_content`, `reasoning`, and `thinking`,
Responses raw reasoning deltas, Anthropic thinking deltas, and Ollama thinking
fields are discarded or fail closed without exposing their text.

The runtime accepts legacy unclassified `reasoning` chunks only as untrusted
input: it drops the text and emits at most a metadata-only
`hidden_reasoning_omitted` marker per attempt. Explicit safe summaries use
`provider_safe_summary`, but the runtime buffers the bounded complete summary
for that attempt instead of releasing individual deltas. Core applies content
policy once to the assembled text so a sensitive value split across provider
chunks cannot escape. Only a normally completed attempt releases governed
`reasoning.summary.delta` events followed by one
`reasoning.summary.completed`; cancelled, timed-out, failed, retried, and
fallback attempts produce metadata-only `discarded` completion and no text.

Summary events remain separate from assistant answer/message content and use
the run-event retention, legal-hold, deletion, and tenant-purge lifecycle.
Portable export, external share, webhook, audit, and context inspection exclude
summary text by default because no explicit governed inclusion choice exists.
Historical replay reassembles and re-governs even marker-bearing rows before
browser release, while the browser independently ignores legacy/unclassified
reasoning and bounds accumulated safe-summary state. The message row renders a
collapsed, plain-text provider-safe summary only after it clears policy; it
shows metadata-only progress while text is still buffered.

The registry-derived offline conformance kit includes a hidden-reasoning
privacy case for every current dialect. Any new dialect must provide a raw
reasoning sentinel fixture and prove that no unclassified chunk or secret text
escapes.
