# Provider chat parameter translation

Romeo resolves provider-neutral chat parameters at one adapter boundary before a
provider SDK or HTTP encoder sees them. The boundary validates values, combines
dialect rules with the selected provider and model capabilities, and omits a
field when support is not explicit. It never renames an unsupported knob into a
different semantic.

## Current dialect matrix

| Dialect                            | Sampling                              | Reasoning                                                                                  | Structured output                                              | Tools        |
| ---------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------ |
| Anthropic                          | temperature `0..1`, top-p, max tokens | omitted                                                                                    | omitted                                                        | native tools |
| Ollama                             | temperature `0..2`, top-p, max tokens | omitted                                                                                    | omitted                                                        | native tools |
| OpenAI-compatible chat completions | temperature `0..2`, top-p, max tokens | effort only when both provider and model explicitly advertise reasoning; summaries omitted | JSON object/schema when both targets advertise structured JSON | native tools |
| OpenAI Responses-compatible        | temperature `0..2`, top-p, max tokens | effort and summary when both targets advertise reasoning                                   | JSON object/schema when both targets advertise structured JSON | native tools |

Temperature and top-p are omitted when either selected target explicitly
disables temperature controls. Reasoning, structured output, and tools require
both the provider and model capability to be `true`; optimistic protocol support
alone is insufficient.

Shared validation accepts only finite bounded sampling values. `maxTokens` must
be a positive safe integer no larger than the selected context window or
200,000, whichever is lower. A request may contain at most 64 tools. Tool names,
descriptions, and JSON schemas are bounded, and tool/schema objects must be plain
records whose serialized schema is at most 64 KiB. Invalid values are omitted
with a stable reason: `invalid_value`, `unsupported_by_dialect`, or
`unsupported_by_model_or_provider`.

Tool sets fail closed as one unit. If any definition is invalid or the set has
more than 64 entries, Romeo returns the stable, non-retryable
`provider_invalid_request_or_capability` outcome before the adapter is invoked.
It never dispatches a tool-less or partial request. Capability-based omissions
remain safe, recorded downgrades; malformed caller input is not a downgrade.

## Dispatch and persistence

All current chat paths reach the same translation boundary:

- managed runs, provider retries, provider fallback, automatic tool-call loops,
  approval continuations, external-operation continuations, and crash recovery;
- OpenAI-compatible non-streaming and streaming chat completions; and
- evaluation generation, which resolves explicit reasoning-policy variants through the same action-time policy and dialect boundary.

Managed model-version parameters remain requested values until an actual target
is selected. This is necessary because a fallback may support a different
subset. Recovery checkpoints retain the requested typed values so a leased run
does not silently change after a worker restart. Continuations reconstruct the
same request from the immutable agent version.

The existing open run-event data contract persists a privacy-safe
`parameterResolution` on `run.started`. If a fallback answers, its safe
resolution is stored with the existing terminal `providerFallback` metadata.
Snapshots include numeric sampling values, reasoning enums, structured-output
type/strictness, tool count, and omission reasons. They never contain prompts,
messages, schema contents or names, tool names or descriptions, URLs, headers,
or credentials.

OpenAI-compatible facade requests translate the supported standard request
fields into the same provider-neutral types before adapter dispatch. The facade
does not invent run persistence for these stateless requests.

## Extension requirements

A new registered dialect must define a parameter policy and pass the
registry-derived offline translation suite. Its test must prove the exact native
request body for supported fields and absence of unsupported fields. Any new
provider-neutral knob needs a typed request shape, bounded validation, a
privacy-safe summary representation, tests for provider/model capability
conflicts, and coverage for retry/fallback and recovery before it can be
advertised.
