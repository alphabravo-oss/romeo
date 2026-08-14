# Privacy-safe run context inspection

## Scope and security boundary

`GET /api/v1/chats/{chatId}/context-inspection` exposes a bounded explanation of a persisted run. An omitted `runId` selects the newest run in the authorized chat; an explicit run must belong to that same chat. The caller must pass both the existing `chats:read`/chat-resource check and the existing `runs:read`/run-resource check. Cross-chat and cross-tenant identifiers return the normal privacy-safe authorization/not-found responses.

The response is an explanation surface, not a provider-request replay. It deliberately excludes:

- hidden reasoning and token deltas;
- system prompts, provider request/response bodies, and raw usage metadata;
- tool arguments, result values, input/output key names, and credentials;
- policy blocked terms, match text, or retrieved prompt-injection text;
- signed/source URLs and inaccessible or deleted internal documents.

The older proposed-turn preview still computes token and attachment counts through the canonical builder, but its compatibility `messages` entries now carry only role/image counts and blank content. The browser no longer renders those entries. This prevents the preview endpoint from becoming a system-prompt or retrieved-document disclosure path.

## Returned provenance

The typed contract returns at most eight currently visible user/assistant messages with 20,000 characters per message, 50 data-free lifecycle checkpoints, 100 citations, 50 tool summaries, and ten transformation summaries. It includes run/chat/agent/version identifiers, the selected provider/model (including a recorded fallback), current chat transcript version, input/parent message identifiers, safe pinned-agent policy settings, current source labels, and unavailable-resource state.

Internal citations are reauthorized at read time against the caller's current `knowledge:read` scope, knowledge-base grants, source tenant/workspace ownership, and source access policy. Revoked, deleted, or inaccessible sources contribute only to a count. Public web citations already visible on the assistant response retain a bounded title/type but no URI. Provider and model display names are returned only when their current tenant relationship remains valid; otherwise the immutable safe ID is shown with `available: false`.

Repository reads for tools and usage are exact `(org, workspace, run)` predicates with limits. PostgreSQL uses the existing `tool_calls_run_idx` and `usage_events_source_idx`; the in-memory repository implements the same predicates, ordering, and limits. No schema migration is required.

The endpoint does not create a second sensitive-data entitlement: it returns authorized visible chat content and allowlisted counts/identifiers only. A new audit event is therefore not emitted. Standard authenticated request logging remains in place, while payloads remain excluded from telemetry.

## UI and cache behavior

The inspector uses the generated `runs.inspectPersistedContext` TanStack option/key factory. It is browser-only (`ssr: false`), chat/run keyed, abort-signal aware, and cannot share cache entries across chats or explicit runs. Temporary chats disable the query. Loading, empty, unavailable, revoked-source, and privacy-safe error states are localized in English, Spanish, and French.

The non-modal dialog receives focus on open, closes with Escape, and restores focus to its trigger. Headings and definition lists preserve a navigable reading structure. Visible message whitespace is preserved and long identifiers/content wrap without creating horizontal page overflow.

## Validation and exactness limit

Automated coverage proves API authentication, cross-tenant denial, explicit-run/chat binding, current knowledge reauthorization, event-data omission, source-URL omission, bounded content, fallback provenance, safe tool/policy summaries, repository parity, exact generated query keys, cancellation, localized states, Escape, and focus restoration.

The inspector is intentionally described as current persisted provenance, not an exact historical provider replay. Romeo does not yet persist the exact ordered message IDs/checkpoint IDs and run-start transcript version that were sent after trimming and transformations. A message edit after a run can therefore change the currently visible excerpt. EP-04-06 must add that immutable, privacy-safe run-context manifest, and EP-04-04 must add durable summary checkpoints, before EP-04-17 can truthfully claim exact “shaped this run” reproducibility. EP-04-17 remains open until those dependencies land and the inspector switches from current-path reconstruction to that manifest.
