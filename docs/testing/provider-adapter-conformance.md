# Provider adapter conformance

`@romeo/providers` exports a framework-neutral adapter contract kit through
`createProviderAdapterConformanceSuite`. The kit accepts one typed protocol
fixture and returns nine named asynchronous cases. A consumer can register the
cases in Vitest, Jest, Node test, or an out-of-tree adapter harness without
bringing a test framework into the provider package's runtime surface.

The current package test derives its dialect list from `listProviderDialects()`
and requires an exact fixture for every registry entry. Each dialect runs all of
the following cases:

| Case                        | Contract evidence                                                               |
| --------------------------- | ------------------------------------------------------------------------------- |
| `golden_stream`             | Native offline stream yields exact text fragments and final token usage         |
| `tool_calls`                | Native tool events normalize name, arguments, keys, and a nonempty call ID      |
| `malformed_chunks`          | Semantically invalid native chunks emit no attacker-controlled sentinel         |
| `usage_parsing`             | Registered standalone parser produces the dialect's exact normalized usage      |
| `cancellation`              | Caller `AbortSignal` reaches the request and becomes non-retryable cancellation |
| `retry_error_normalization` | Rate limits retry; invalid requests/capabilities do not                         |
| `privacy_sentinels`         | Bodies, headers, credentials, prompts, URLs, and unknown codes remain detached  |
| `hidden_reasoning_privacy`  | Raw thinking fields never become text or an unclassified reasoning chunk        |
| `network_failures`          | Fetch failures become safe, retryable provider-unavailable errors               |

All request functions are injected and all responses are in-memory. The suite
does not use provider credentials, DNS, sockets, wall-clock sleeps, random
timing, or live endpoints. Cancellation synchronizes on request start and then
aborts directly, so the result is deterministic.

## Extension gate

Adding a registry dialect requires all of the following in the same change:

1. Add a typed `ProviderAdapterConformanceFixture` keyed by the new
   `ProviderKind`. The fixture record uses an exhaustive `Record`, so registry
   growth fails typechecking until a protocol fixture exists.
2. Supply native-protocol golden text/usage, tool-call, and semantically
   malformed and raw-reasoning stream responses. Both privacy inputs must
   contain their shared marker; an empty successful stream is not evidence.
3. Register standalone usage and safe error-normalization interfaces. The
   conformance fixture identity, dialect, chat adapter, provider, and model must
   agree on provider kind.
4. Run every returned case offline. Do not skip a case because a provider SDK
   happens to normalize or buffer its wire protocol differently.
5. Keep live credentialed acceptance separate. Live tests may supplement this
   contract but cannot replace its deterministic privacy, cancellation, and
   failure evidence.

Optional operations such as embeddings or images remain governed by their
focused interface tests. A chat conformance pass does not advertise an optional
operation or change public dialect metadata.
