# Provider Model

Milestone 1 supports:

- Generic OpenAI-compatible providers.
- OpenAI Responses-compatible providers.
- Ollama providers.

Providers expose a common interface:

- `health()`
- `listModels()`
- `streamChat()`
- `embedTexts()` through the embedding adapter registry
- capability metadata

The registry stores provider configuration separately from credentials. Credentials are represented by references so production implementations can use KMS, secret managers, or encrypted database storage.

Provider adapters should map external token counters into Romeo's `ProviderTokenUsage` shape before yielding usage chunks. `@romeo/providers` includes helpers for OpenAI-compatible Chat Completions and Responses payloads (`prompt_tokens`, `completion_tokens`, `input_tokens`, `output_tokens`, `total_tokens`) and Ollama payloads (`prompt_eval_count`, `eval_count`) so core usage accounting never needs provider-specific token field names.

Tool-capable adapters keep provider-specific continuation formats behind the provider package. Chat Completions providers serialize assistant/tool continuation messages, while Responses-compatible providers serialize typed `function_call` and `function_call_output` input items. The app, public API, and run state machine continue to use Romeo's common tool-call contract.

Embedding adapters currently cover OpenAI-compatible `/embeddings` and Ollama `/api/embed` endpoints. They validate vector counts and dimensions, accept API keys only at call time, and return Romeo's common embedding result shape for controlled indexing and query-time persisted-vector retrieval.

Later providers must prove they can map into the common runtime contract without leaking provider-specific message shapes into the app or public API.
