import { describe, expect, it } from "vitest";

import { defaultProviderCapabilities } from "./capabilities";
import { normalizeProviderError } from "./error-normalization";
import { getProviderDialect, listProviderDialects } from "./registry";
import type {
  ProviderErrorCategory,
  BaseModel,
  ProviderKind,
  ProviderInstance,
  ProviderNormalizedErrorCode,
} from "./types";

const statusGoldens: Array<{
  category: ProviderErrorCategory;
  code: ProviderNormalizedErrorCode;
  error: unknown;
  retryable: boolean;
}> = [
  {
    category: "invalid_request_or_capability",
    code: "provider_invalid_request_or_capability",
    error: { status: 400 },
    retryable: false,
  },
  {
    category: "auth",
    code: "provider_authentication_failed",
    error: { status: 401 },
    retryable: false,
  },
  {
    category: "policy",
    code: "provider_policy_rejected",
    error: { status: 403 },
    retryable: false,
  },
  {
    category: "rate_limit",
    code: "provider_rate_limited",
    error: { status: 429 },
    retryable: true,
  },
  {
    category: "quota",
    code: "provider_quota_exceeded",
    error: { status: 429, error: { code: "insufficient_quota" } },
    retryable: true,
  },
  {
    category: "unavailable",
    code: "provider_unavailable",
    error: { status: 503 },
    retryable: true,
  },
  {
    category: "timeout",
    code: "provider_timeout",
    error: { status: 504 },
    retryable: true,
  },
];

describe("provider error normalization", () => {
  it.each(statusGoldens)(
    "maps provider failures to $category",
    ({ category, code, error, retryable }) => {
      expect(
        normalizeProviderError("openai-compatible", error, "chat"),
      ).toMatchObject({
        category,
        code,
        errorCode: code,
        errorType: category,
        kind: "openai-compatible",
        operation: "chat",
        retryable,
      });
    },
  );

  it("maps cancellation, timeout names, and network failures without raw text", () => {
    const cancelled = normalizeProviderError(
      "anthropic",
      new DOMException("PRIVATE_ABORT_REASON", "AbortError"),
      "chat",
    );
    const timeout = normalizeProviderError(
      "ollama",
      Object.assign(new Error("PRIVATE_TIMEOUT_DETAIL"), {
        name: "APIConnectionTimeoutError",
      }),
      "embeddings",
    );
    const network = normalizeProviderError(
      "openai-responses-compatible",
      new TypeError("fetch failed for https://secret.invalid?key=PRIVATE"),
      "chat",
    );

    expect(cancelled).toMatchObject({
      category: "cancelled",
      errorCode: "provider_request_cancelled",
      retryable: false,
    });
    expect(timeout).toMatchObject({
      category: "timeout",
      errorCode: "provider_timeout",
      retryable: true,
    });
    expect(network).toMatchObject({
      category: "unavailable",
      errorCode: "provider_unavailable",
      retryable: true,
    });
    expect(serialized([cancelled, timeout, network])).not.toMatch(
      /PRIVATE|secret[.]invalid/u,
    );
  });

  it("drops malicious provider bodies, URLs, headers, credentials, prompts, and raw exception text", () => {
    const secret = "SENTINEL_PROVIDER_SECRET_927";
    const malicious = {
      status: 429,
      message: `raw exception ${secret}`,
      body: { prompt: secret },
      headers: { authorization: `Bearer ${secret}` },
      request: { url: `https://${secret}.invalid`, apiKey: secret },
      response: {
        status: 429,
        data: { error: { message: secret, code: "rate_limit_exceeded" } },
      },
    };
    const normalized = normalizeProviderError(
      "openai-compatible",
      malicious,
      "imageGeneration",
    );

    expect(normalized).toMatchObject({
      category: "rate_limit",
      errorCode: "provider_rate_limited",
      operation: "imageGeneration",
      status: 429,
    });
    expect(serialized(normalized)).not.toContain(secret);
    expect(normalized).not.toHaveProperty("cause");
    expect(normalized).not.toHaveProperty("body");
    expect(normalized).not.toHaveProperty("headers");
    expect(normalized).not.toHaveProperty("request");
    expect(normalized).not.toHaveProperty("response");
  });

  it("registers a kind-matched normalizer for every current dialect", () => {
    const kinds = listProviderDialects().map((summary) => summary.kind);
    expect(kinds).toEqual([
      "anthropic",
      "ollama",
      "openai-compatible",
      "openai-responses-compatible",
    ] satisfies ProviderKind[]);
    for (const kind of kinds) {
      const dialect = getProviderDialect(kind);
      expect(dialect.errorNormalization).toMatchObject({ kind });
      expect(
        dialect.errorNormalization?.normalizeError(
          { status: 401 },
          {
            operation: "chat",
          },
        ),
      ).toMatchObject({
        category: "auth",
        errorCode: "provider_authentication_failed",
        kind,
      });
    }
  });

  it.each([
    "anthropic",
    "ollama",
    "openai-compatible",
    "openai-responses-compatible",
  ] as const)("normalizes %s chat adapter failures", async (kind) => {
    const secret = `SENTINEL_${kind}_CHAT_SECRET`;
    const provider: ProviderInstance = {
      id: `provider_${kind}`,
      orgId: "org_error_normalization",
      type: kind,
      name: kind,
      baseUrl: `https://${kind}.example.invalid/v1`,
      enabled: true,
      capabilities: defaultProviderCapabilities(kind),
    };
    const model: BaseModel = {
      id: `model_${kind}`,
      providerId: provider.id,
      name: "test-model",
      displayName: "Test model",
      enabled: true,
      capabilities: provider.capabilities,
      contextWindow: 8_192,
    };

    const caught = await collect(
      getProviderDialect(kind).chat.streamChat({
        apiKey: "managed-test-key",
        fetchImpl: async () =>
          Response.json(
            { error: { message: secret, url: `https://${secret}.invalid` } },
            { status: 401 },
          ),
        messages: [{ role: "user", content: `private prompt ${secret}` }],
        model,
        provider,
      }),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(caught).toMatchObject({
      category: "auth",
      errorCode: "provider_authentication_failed",
      kind,
      operation: "chat",
      retryable: false,
      status: 401,
    });
    expect(serialized(caught)).not.toContain(secret);
  });
});

function serialized(value: unknown): string {
  return `${JSON.stringify(value)} ${value instanceof Error ? value.message : ""}`;
}

async function collect(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const _value of iterable) {
    // Exhaust the stream so request and decode failures cross the adapter boundary.
  }
}
