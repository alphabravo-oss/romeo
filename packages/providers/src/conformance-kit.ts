import { isProviderNormalizedError } from "./error-normalization";
import type {
  ProviderErrorCategory,
  ProviderNormalizedError,
  ProviderTokenUsage,
  StreamChatChunk,
  StreamChatInput,
} from "./types";
import {
  PROVIDER_ADAPTER_CONFORMANCE_CASE_NAMES,
  type ProviderAdapterConformanceCase,
  type ProviderAdapterConformanceCaseName,
  type ProviderAdapterConformanceFixture,
} from "./provider-conformance-types";

export {
  PROVIDER_ADAPTER_CONFORMANCE_CASE_NAMES,
  type ProviderAdapterConformanceCase,
  type ProviderAdapterConformanceCaseName,
  type ProviderAdapterConformanceFixture,
} from "./provider-conformance-types";

export const PROVIDER_CONFORMANCE_SENTINELS = Object.freeze({
  credential: "romeo-conformance-credential-do-not-expose",
  malformedChunk: "romeo-conformance-malformed-chunk-do-not-expose",
  networkError: "romeo-conformance-network-error-do-not-expose",
  prompt: "romeo-conformance-prompt-do-not-expose",
  rawReasoning: "romeo-conformance-raw-reasoning-do-not-expose",
  responseBody: "romeo-conformance-response-body-do-not-expose",
  responseHeader: "romeo-conformance-response-header-do-not-expose",
  upstreamCode: "romeo_conformance_unknown_upstream_code",
  upstreamUrl: "romeo-conformance-url-do-not-expose",
});

/**
 * Builds framework-neutral, deterministic adapter contract cases. Consumers can
 * register each returned case in Vitest, Jest, Node test, or an out-of-tree
 * adapter harness without this package depending on a test runner.
 */
export function createProviderAdapterConformanceSuite(
  fixture: ProviderAdapterConformanceFixture,
): readonly ProviderAdapterConformanceCase[] {
  assertFixture(fixture);
  const cases: Record<ProviderAdapterConformanceCaseName, () => Promise<void>> =
    {
      golden_stream: () => verifyGoldenStream(fixture),
      tool_calls: () => verifyToolCalls(fixture),
      malformed_chunks: () => verifyMalformedChunks(fixture),
      usage_parsing: () => verifyUsageParsing(fixture),
      cancellation: () => verifyCancellation(fixture),
      retry_error_normalization: () => verifyRetryNormalization(fixture),
      privacy_sentinels: () => verifyPrivacySentinels(fixture),
      hidden_reasoning_privacy: () => verifyHiddenReasoningPrivacy(fixture),
      network_failures: () => verifyNetworkFailure(fixture),
    };
  return PROVIDER_ADAPTER_CONFORMANCE_CASE_NAMES.map((name) =>
    Object.freeze({ kind: fixture.kind, name, run: cases[name] }),
  );
}

async function verifyHiddenReasoningPrivacy(
  fixture: ProviderAdapterConformanceFixture,
): Promise<void> {
  try {
    const chunks = await collect(
      stream(fixture, async () => fixture.rawReasoningStream.createResponse()),
    );
    assertDoesNotExpose(fixture, "hidden_reasoning_privacy", chunks, [
      PROVIDER_CONFORMANCE_SENTINELS.rawReasoning,
    ]);
    assert(
      fixture,
      "hidden_reasoning_privacy",
      !chunks.some(
        (chunk) =>
          typeof chunk === "object" &&
          chunk !== null &&
          chunk.type === "reasoning",
      ),
      "adapter emitted an unclassified reasoning chunk",
    );
  } catch (caught) {
    assertNormalized(fixture, "hidden_reasoning_privacy", caught);
    assertDoesNotExpose(fixture, "hidden_reasoning_privacy", caught, [
      PROVIDER_CONFORMANCE_SENTINELS.rawReasoning,
    ]);
  }
}

async function verifyGoldenStream(
  fixture: ProviderAdapterConformanceFixture,
): Promise<void> {
  const chunks = await collect(
    stream(fixture, async () => fixture.goldenStream.createResponse()),
  );
  const text = chunks.filter(
    (chunk): chunk is string => typeof chunk === "string",
  );
  assertEqual(fixture, "golden_stream", text, fixture.goldenStream.text);
  const usage = chunks
    .filter(isUsageChunk)
    .map((chunk) => chunk.usage)
    .at(-1);
  assertEqual(fixture, "golden_stream", usage, fixture.goldenStream.usage);
}

async function verifyToolCalls(
  fixture: ProviderAdapterConformanceFixture,
): Promise<void> {
  const chunks = await collect(
    stream(fixture, async () => fixture.toolCallStream.createResponse()),
  );
  const toolCallIndex = chunks.findIndex(isToolCallChunk);
  const usageIndex = chunks.findIndex(isUsageChunk);
  const toolCall = chunks.find(isToolCallChunk)?.toolCall;
  assert(
    fixture,
    "tool_calls",
    toolCall !== undefined && toolCall.providerCallId.length > 0,
  );
  assertEqual(
    fixture,
    "tool_calls",
    toolCall?.name,
    fixture.toolCallStream.name,
  );
  assertEqual(
    fixture,
    "tool_calls",
    toolCall?.arguments,
    fixture.toolCallStream.arguments,
  );
  assertEqual(
    fixture,
    "tool_calls",
    toolCall?.argumentKeys,
    fixture.toolCallStream.argumentKeys,
  );
  assert(
    fixture,
    "tool_calls",
    usageIndex >= 0 && usageIndex < toolCallIndex,
    "final usage must be emitted before the tool call starts the next provider leg",
  );
}

async function verifyMalformedChunks(
  fixture: ProviderAdapterConformanceFixture,
): Promise<void> {
  const response = fixture.malformedStream.createResponse();
  const upstreamBody = await response.clone().text();
  assert(
    fixture,
    "malformed_chunks",
    upstreamBody.includes(PROVIDER_CONFORMANCE_SENTINELS.malformedChunk),
  );
  try {
    const chunks = await collect(stream(fixture, async () => response));
    assertDoesNotExpose(fixture, "malformed_chunks", chunks, [
      PROVIDER_CONFORMANCE_SENTINELS.malformedChunk,
    ]);
  } catch (caught) {
    assertNormalized(fixture, "malformed_chunks", caught);
    assertDoesNotExpose(fixture, "malformed_chunks", caught, [
      PROVIDER_CONFORMANCE_SENTINELS.malformedChunk,
    ]);
  }
}

async function verifyUsageParsing(
  fixture: ProviderAdapterConformanceFixture,
): Promise<void> {
  const parser = fixture.dialect.usageParsing;
  assert(fixture, "usage_parsing", parser !== undefined);
  let usage: ProviderTokenUsage | undefined;
  for (const event of fixture.usageEvents) {
    usage = parser?.parseUsage(event, usage) ?? usage;
  }
  assertEqual(fixture, "usage_parsing", usage, fixture.usage);
}

async function verifyCancellation(
  fixture: ProviderAdapterConformanceFixture,
): Promise<void> {
  const controller = new AbortController();
  let markStarted: (() => void) | undefined;
  let requestSignal: AbortSignal | null | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestSignal = init?.signal;
    markStarted?.();
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const abort = () =>
        reject(
          signal?.reason instanceof Error
            ? signal.reason
            : new DOMException("Request aborted.", "AbortError"),
        );
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
      controller.signal.addEventListener("abort", abort, { once: true });
    });
  };
  const pending = collect(stream(fixture, fetchImpl, controller.signal));
  await started;
  controller.abort(
    new DOMException(PROVIDER_CONFORMANCE_SENTINELS.prompt, "AbortError"),
  );
  const caught = await rejection(pending);
  assert(fixture, "cancellation", requestSignal?.aborted === true);
  const normalized = assertNormalized(fixture, "cancellation", caught);
  assertCategory(fixture, "cancellation", normalized, "cancelled", false);
  assertDoesNotExpose(fixture, "cancellation", caught, [
    PROVIDER_CONFORMANCE_SENTINELS.prompt,
  ]);
}

async function verifyRetryNormalization(
  fixture: ProviderAdapterConformanceFixture,
): Promise<void> {
  const normalizer = fixture.dialect.errorNormalization;
  assert(fixture, "retry_error_normalization", normalizer !== undefined);
  const rateLimit = assertNormalized(
    fixture,
    "retry_error_normalization",
    await rejection(
      collect(
        stream(fixture, async () =>
          providerFailureResponse(429, "rate_limit_exceeded"),
        ),
      ),
    ),
  );
  const invalid = assertNormalized(
    fixture,
    "retry_error_normalization",
    await rejection(
      collect(
        stream(fixture, async () =>
          providerFailureResponse(400, "invalid_request"),
        ),
      ),
    ),
  );
  assertCategory(
    fixture,
    "retry_error_normalization",
    rateLimit,
    "rate_limit",
    true,
  );
  assertCategory(
    fixture,
    "retry_error_normalization",
    invalid,
    "invalid_request_or_capability",
    false,
  );
}

function providerFailureResponse(status: number, code: string): Response {
  return Response.json(
    { error: { code, message: "Synthetic provider conformance failure." } },
    { status },
  );
}

async function verifyPrivacySentinels(
  fixture: ProviderAdapterConformanceFixture,
): Promise<void> {
  const sentinels = Object.values(PROVIDER_CONFORMANCE_SENTINELS);
  const fetchImpl: typeof fetch = async () =>
    Response.json(
      {
        error: {
          code: PROVIDER_CONFORMANCE_SENTINELS.upstreamCode,
          message: PROVIDER_CONFORMANCE_SENTINELS.responseBody,
        },
        prompt: PROVIDER_CONFORMANCE_SENTINELS.prompt,
      },
      {
        headers: {
          "x-private-provider-value":
            PROVIDER_CONFORMANCE_SENTINELS.responseHeader,
        },
        status: 401,
      },
    );
  const caught = await rejection(
    collect(
      stream(fixture, fetchImpl, undefined, {
        apiKey: PROVIDER_CONFORMANCE_SENTINELS.credential,
        messages: [
          { role: "user", content: PROVIDER_CONFORMANCE_SENTINELS.prompt },
        ],
        provider: {
          ...fixture.provider,
          baseUrl: `https://example.invalid/${PROVIDER_CONFORMANCE_SENTINELS.upstreamUrl}`,
        },
      }),
    ),
  );
  const normalized = assertNormalized(fixture, "privacy_sentinels", caught);
  assertCategory(fixture, "privacy_sentinels", normalized, "auth", false);
  assertDoesNotExpose(fixture, "privacy_sentinels", caught, sentinels);
}

async function verifyNetworkFailure(
  fixture: ProviderAdapterConformanceFixture,
): Promise<void> {
  const fetchImpl: typeof fetch = async () => {
    throw new TypeError(PROVIDER_CONFORMANCE_SENTINELS.networkError);
  };
  const caught = await rejection(collect(stream(fixture, fetchImpl)));
  const normalized = assertNormalized(fixture, "network_failures", caught);
  assertCategory(fixture, "network_failures", normalized, "unavailable", true);
  assertDoesNotExpose(fixture, "network_failures", caught, [
    PROVIDER_CONFORMANCE_SENTINELS.networkError,
  ]);
}

function stream(
  fixture: ProviderAdapterConformanceFixture,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  overrides?: Partial<StreamChatInput>,
): AsyncIterable<StreamChatChunk> {
  return fixture.dialect.chat.streamChat({
    apiKey: "romeo-conformance-api-key",
    fetchImpl,
    messages: [{ role: "user", content: "Synthetic conformance prompt." }],
    model: fixture.model,
    provider: fixture.provider,
    ...(signal === undefined ? {} : { signal }),
    ...overrides,
  });
}

function assertFixture(fixture: ProviderAdapterConformanceFixture): void {
  if (
    fixture.kind !== fixture.dialect.kind ||
    fixture.kind !== fixture.provider.type ||
    fixture.provider.id !== fixture.model.providerId ||
    fixture.dialect.chat.kind !== fixture.kind
  ) {
    throw new Error("Provider adapter conformance fixture identity mismatch.");
  }
}

function assertNormalized(
  fixture: ProviderAdapterConformanceFixture,
  name: ProviderAdapterConformanceCaseName,
  caught: unknown,
): ProviderNormalizedError {
  assert(fixture, name, isProviderNormalizedError(caught));
  return caught as ProviderNormalizedError;
}

function assertCategory(
  fixture: ProviderAdapterConformanceFixture,
  name: ProviderAdapterConformanceCaseName,
  error: ProviderNormalizedError | undefined,
  category: ProviderErrorCategory,
  retryable: boolean,
): void {
  assert(
    fixture,
    name,
    error?.kind === fixture.kind &&
      error.category === category &&
      error.retryable === retryable,
    error === undefined
      ? "missing normalized error"
      : `received ${error.kind}/${error.category}/${String(error.retryable)}`,
  );
}

function assertEqual(
  fixture: ProviderAdapterConformanceFixture,
  name: ProviderAdapterConformanceCaseName,
  actual: unknown,
  expected: unknown,
): void {
  assert(fixture, name, stableJson(actual) === stableJson(expected));
}

function assertDoesNotExpose(
  fixture: ProviderAdapterConformanceFixture,
  name: ProviderAdapterConformanceCaseName,
  value: unknown,
  sentinels: readonly string[],
): void {
  const inspected = `${String(value)} ${stableJson(value)}`;
  assert(
    fixture,
    name,
    sentinels.every((sentinel) => !inspected.includes(sentinel)),
  );
}

function assert(
  fixture: ProviderAdapterConformanceFixture,
  name: ProviderAdapterConformanceCaseName,
  condition: boolean,
  detail?: string,
): asserts condition {
  if (!condition) {
    throw new Error(
      `Provider adapter conformance failed: ${fixture.kind}/${name}${detail === undefined ? "" : ` (${detail})`}.`,
    );
  }
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, child) =>
      child !== null &&
      typeof child === "object" &&
      !Array.isArray(child) &&
      !(child instanceof Error)
        ? Object.fromEntries(
            Object.entries(child as Record<string, unknown>).sort(
              ([left], [right]) => left.localeCompare(right),
            ),
          )
        : child instanceof Error
          ? {
              ...Object.fromEntries(Object.entries(child)),
              message: child.message,
              name: child.name,
            }
          : child,
    );
  } catch {
    return "<unserializable>";
  }
}

async function collect(
  input: AsyncIterable<StreamChatChunk>,
): Promise<StreamChatChunk[]> {
  const chunks: StreamChatChunk[] = [];
  for await (const chunk of input) chunks.push(chunk);
  return chunks;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (caught) {
    return caught;
  }
  return undefined;
}

function isUsageChunk(
  chunk: StreamChatChunk,
): chunk is Extract<StreamChatChunk, { type: "usage" }> {
  return typeof chunk === "object" && chunk.type === "usage";
}

function isToolCallChunk(
  chunk: StreamChatChunk,
): chunk is Extract<StreamChatChunk, { type: "tool_call" }> {
  return typeof chunk === "object" && chunk.type === "tool_call";
}
