# Provider dialect interfaces

Provider dialects are compositions of focused operation adapters. A dialect
registers an adapter only when Romeo has an implementation for that provider
family; defining an interface does not advertise support or enable network
dispatch.

| Operation                         | TypeScript interface             | Required today | Current implementations                         |
| --------------------------------- | -------------------------------- | -------------- | ----------------------------------------------- |
| Model discovery                   | `ProviderDiscoveryAdapter`       | yes            | all registered dialects                         |
| Streaming chat                    | `ProviderChatAdapter`            | yes            | all registered dialects                         |
| Embeddings                        | `ProviderEmbeddingsAdapter`      | no             | OpenAI-compatible, Responses-compatible, Ollama |
| Image generation                  | `ProviderImageAdapter`           | no             | OpenAI-compatible, Responses-compatible         |
| Audio transcription and synthesis | `ProviderAudioAdapter`           | no             | none                                            |
| Provider file lifecycle           | `ProviderFilesAdapter`           | no             | none                                            |
| Provider batches                  | `ProviderBatchesAdapter`         | no             | none                                            |
| Provider-native token counting    | `ProviderTokenCountingAdapter`   | no             | none                                            |
| Bounded capability probing        | `ProviderCapabilityProbeAdapter` | no             | none                                            |
| Safe provider-error normalization | `ProviderErrorNormalizer`        | no             | all registered dialects                         |
| Standalone usage parsing          | `ProviderUsageParser`            | no             | all registered dialects                         |

The public `ProviderDialectSummary.operations` object contains the same complete
operation set. `chat` and `discovery` are literal `true` under the current
provider-kind contract. Every optional value is derived from whether the
registered dialect actually has that adapter property. It is not inferred from
a provider name, a model identifier, or a model-advertised capability.

`ModelProviderAdapter` remains as a compatibility aggregate of health,
discovery, and chat. `EmbeddingProviderAdapter` and
`ImageGenerationProviderAdapter` remain deprecated type aliases. New code
should depend on the focused interface for the operation it invokes.

The audio, file, batch, token-counting, and capability-probe interfaces establish
typed boundaries only. They intentionally have no current registry entries or
lookup helpers. Adding a live implementation requires its separate roadmap
slice, safe error/privacy behavior, and conformance evidence; until then the API
reports those operations as unsupported.

## Error normalization boundary

Every current dialect registers a `ProviderErrorNormalizer`. Provider status and
allowlisted provider code/name fields map to exactly nine categories: `auth`,
`quota`, `rate_limit`, `unavailable`, `invalid_request_or_capability`, `policy`,
`timeout`, `cancelled`, and `unexpected`. The resulting Romeo error code and
retryability are fixed by category.

Normalization returns a detached safe error. It never retains a cause or copies
an upstream message, body, URL, header, credential, prompt, request, response, or
unknown provider code. A bounded numeric HTTP status may be retained for
classification, but public core errors expose only the stable Romeo code,
category, retryability, and fixed copy.

## Adapter conformance

The reusable [provider adapter conformance kit](../testing/provider-adapter-conformance.md)
is exported from `@romeo/providers` without a test-framework dependency. The
package test derives every current dialect from the registry and runs the same
eight offline cases for golden streams, tool calls, malformed chunks, usage,
cancellation, retry classification, privacy sentinels, and network failures.
An exact exhaustive fixture inventory makes a newly registered provider kind
fail the test/typecheck gate until it supplies native protocol evidence.

## Chat parameter translation

The [provider chat parameter translation boundary](./provider-parameter-translation.md)
validates and resolves sampling, reasoning, structured-output, and tool knobs
against the actual dialect, provider, and model immediately before dispatch.
Registered adapters encode only the effective result. Managed runs persist a
privacy-safe requested-versus-effective summary without retaining schemas or
tool names in public event metadata.
