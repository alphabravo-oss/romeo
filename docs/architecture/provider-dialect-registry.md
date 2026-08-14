# Provider dialect registry

Romeo resolves provider protocols through one static, versioned registry in
`@romeo/providers`. Provider kind is configuration; the registry is the
authoritative statement of which protocol operations Romeo can actually
invoke for that kind.

## Invariants

- Every `ProviderKind` has exactly one dialect entry and stable implementation
  version.
- The registry contract version is independent from an individual dialect
  implementation version.
- Discovery and chat are required by the current provider-kind contract. All
  other [focused dialect interfaces](./provider-dialect-interfaces.md) are
  optional operations and are absent when unsupported.
- Operation lookup never falls through to another provider kind. An absent
  operation fails explicitly before credentials, quota, network, provider, or
  storage work.
- Importing the provider library creates no worker, timer, listener, or network
  request.
- Registry summaries are detached metadata. A caller cannot mutate the live
  registry through introspection.
- Model-advertised capabilities remain separate from implemented protocol
  operations. Both must permit an action before dispatch.

The current identities are:

| Provider kind                 | Dialect version              | Discovery | Chat | Embeddings | Image generation | Usage parsing |
| ----------------------------- | ---------------------------- | --------- | ---- | ---------- | ---------------- | ------------- |
| `anthropic`                   | `anthropic-messages.v1`      | yes       | yes  | no         | no               | yes           |
| `ollama`                      | `ollama-native.v1`           | yes       | yes  | yes        | no               | yes           |
| `openai-compatible`           | `openai-chat-completions.v1` | yes       | yes  | yes        | yes              | yes           |
| `openai-responses-compatible` | `openai-responses.v1`        | yes       | yes  | yes        | yes              | yes           |

Audio, files, batches, provider-native token counting, and capability probing
are false for every current dialect because no conformant operation adapter is
registered yet. Safe error normalization and usage parsing are present for all
current dialects.

`getProviderAdapter`, `getEmbeddingAdapter`, and
`getImageGenerationAdapter` are compatibility entry points backed by this
registry. Image generation no longer calls the OpenAI-compatible helper
directly; it resolves the configured dialect operation and retains the
existing model-capability, policy, quota, idempotency, and artifact checks.
Provider connection responses include only the dialect contract/version and
operation-presence summary; no adapter object, endpoint detail, credential, or
probe payload is serialized. The provider detail UI renders those versions and
explicit supported/unsupported badges, while reminding administrators that
implemented protocol support does not replace model capability, policy, grant,
or health checks.

## Extension workflow

Adding a provider kind requires a typed registry entry, a versioned adapter,
truthful operation presence, contract/conformance tests, and safe error
normalization. Adding a new operation requires extending the dialect contract
and every applicable conformance fixture; it must not be inferred from a model
name or silently routed through a superficially similar API.

This registry and its focused interfaces complete the static operation boundary,
not the whole provider platform. Live audio/files/batches/token counting/probes,
richer capability provenance, first-class cloud authentication, parameter
translation, and the full adapter conformance kit remain tracked by EP-05.
