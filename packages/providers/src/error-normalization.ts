import type {
  ProviderErrorCategory,
  ProviderErrorContext,
  ProviderErrorNormalizer,
  ProviderKind,
  ProviderNormalizedError,
  ProviderNormalizedErrorCode,
  ProviderRequestOperation,
} from "./types";

const categoryPolicy = {
  auth: {
    code: "provider_authentication_failed",
    retryable: false,
    safeMessage: "The provider rejected authentication.",
  },
  cancelled: {
    code: "provider_request_cancelled",
    retryable: false,
    safeMessage: "The provider request was cancelled.",
  },
  invalid_request_or_capability: {
    code: "provider_invalid_request_or_capability",
    retryable: false,
    safeMessage: "The provider rejected the request or capability.",
  },
  policy: {
    code: "provider_policy_rejected",
    retryable: false,
    safeMessage: "The provider rejected the request under its policy.",
  },
  quota: {
    code: "provider_quota_exceeded",
    retryable: true,
    safeMessage: "The provider quota is exhausted.",
  },
  rate_limit: {
    code: "provider_rate_limited",
    retryable: true,
    safeMessage: "The provider rate limit was reached.",
  },
  timeout: {
    code: "provider_timeout",
    retryable: true,
    safeMessage: "The provider request timed out.",
  },
  unavailable: {
    code: "provider_unavailable",
    retryable: true,
    safeMessage: "The provider is temporarily unavailable.",
  },
  unexpected: {
    code: "provider_unexpected_failure",
    retryable: true,
    safeMessage: "The provider request failed unexpectedly.",
  },
} as const satisfies Record<
  ProviderErrorCategory,
  {
    code: ProviderNormalizedErrorCode;
    retryable: boolean;
    safeMessage: string;
  }
>;

const codeCategories = new Map<string, ProviderErrorCategory>([
  ...entries("auth", [
    "authentication_error",
    "invalid_api_key",
    "invalid_authentication",
    "unauthenticated",
    "unauthorized",
  ]),
  ...entries("invalid_request_or_capability", [
    "bad_request",
    "invalid_request",
    "invalid_request_error",
    "model_not_found",
    "not_found_error",
    "unsupported_model",
    "unsupported_parameter",
  ]),
  ...entries("policy", [
    "content_filter",
    "content_policy_violation",
    "permission_denied",
    "policy_violation",
    "safety_violation",
  ]),
  ...entries("quota", [
    "billing_hard_limit_reached",
    "insufficient_quota",
    "quota_exceeded",
    "resource_exhausted",
  ]),
  ...entries("rate_limit", [
    "rate_limit_error",
    "rate_limit_exceeded",
    "too_many_requests",
  ]),
  ...entries("timeout", [
    "api_connection_timeout",
    "econnaborted",
    "etimedout",
    "request_timeout",
    "und_err_connect_timeout",
    "und_err_headers_timeout",
  ]),
  ...entries("unavailable", [
    "eai_again",
    "econnrefused",
    "econnreset",
    "enotfound",
    "service_unavailable",
    "und_err_connect",
    "und_err_socket",
  ]),
]);

const errorNames = new Map<string, ProviderErrorCategory>([
  ...entries("cancelled", ["AbortError", "APIUserAbortError"]),
  ...entries("timeout", ["APIConnectionTimeoutError", "TimeoutError"]),
  ...entries("unavailable", [
    "APIConnectionError",
    "FetchError",
    "NetworkError",
    "TypeError",
  ]),
]);

export const anthropicErrorNormalizer =
  createProviderErrorNormalizer("anthropic");
export const ollamaErrorNormalizer = createProviderErrorNormalizer("ollama");
export const openAiCompatibleErrorNormalizer =
  createProviderErrorNormalizer("openai-compatible");
export const openAiResponsesCompatibleErrorNormalizer =
  createProviderErrorNormalizer("openai-responses-compatible");

export class ProviderNormalizedRequestError
  extends Error
  implements ProviderNormalizedError
{
  readonly category: ProviderErrorCategory;
  readonly code: ProviderNormalizedErrorCode;
  readonly errorCode: ProviderNormalizedErrorCode;
  readonly errorType: ProviderErrorCategory;
  readonly kind: ProviderKind;
  readonly operation: ProviderRequestOperation;
  readonly retryable: boolean;
  readonly safeMessage: string;
  readonly status?: number;

  constructor(input: ProviderNormalizedError) {
    super(input.safeMessage);
    this.name = "ProviderNormalizedRequestError";
    this.category = input.category;
    this.code = input.code;
    this.errorCode = input.errorCode;
    this.errorType = input.errorType;
    this.kind = input.kind;
    this.operation = input.operation;
    this.retryable = input.retryable;
    this.safeMessage = input.safeMessage;
    if (input.status !== undefined) this.status = input.status;
  }
}

const errorNormalizers = {
  anthropic: anthropicErrorNormalizer,
  ollama: ollamaErrorNormalizer,
  "openai-compatible": openAiCompatibleErrorNormalizer,
  "openai-responses-compatible": openAiResponsesCompatibleErrorNormalizer,
} as const satisfies Record<ProviderKind, ProviderErrorNormalizer>;

export function normalizeProviderError(
  kind: ProviderKind,
  error: unknown,
  operation: ProviderRequestOperation,
): ProviderNormalizedError {
  return errorNormalizers[kind].normalizeError(error, { operation });
}

export function isProviderNormalizedError(
  value: unknown,
): value is ProviderNormalizedError {
  const record = asRecord(value);
  return (
    record !== undefined &&
    typeof record.category === "string" &&
    record.category in categoryPolicy &&
    typeof record.kind === "string" &&
    typeof record.operation === "string"
  );
}

function createProviderErrorNormalizer(
  kind: ProviderKind,
): ProviderErrorNormalizer {
  return Object.freeze({
    kind,
    normalizeError(error: unknown, context: ProviderErrorContext) {
      const category = classifyProviderError(error);
      const policy = categoryPolicy[category];
      const status = httpStatus(error);
      return Object.freeze(
        new ProviderNormalizedRequestError({
          category,
          code: policy.code,
          errorCode: policy.code,
          errorType: category,
          kind,
          operation: context.operation,
          retryable: policy.retryable,
          safeMessage: policy.safeMessage,
          ...(status === undefined ? {} : { status }),
        }),
      );
    },
  });
}

function classifyProviderError(error: unknown): ProviderErrorCategory {
  const alreadyNormalized = asRecord(error)?.category;
  if (
    typeof alreadyNormalized === "string" &&
    alreadyNormalized in categoryPolicy
  ) {
    return alreadyNormalized as ProviderErrorCategory;
  }

  for (const record of inspectedRecords(error)) {
    const name = typeof record.name === "string" ? record.name : undefined;
    const namedCategory = [name, constructorName(record)]
      .filter((candidate): candidate is string => candidate !== undefined)
      .map((candidate) => errorNames.get(candidate))
      .find((candidate) => candidate !== undefined);
    if (namedCategory !== undefined) return namedCategory;

    for (const candidate of providerCodeCandidates(record)) {
      const codeCategory = codeCategories.get(candidate.toLowerCase());
      if (codeCategory !== undefined) return codeCategory;
    }
  }

  const status = httpStatus(error);
  if (status === 401) return "auth";
  if (status === 403) return "policy";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limit";
  if ([400, 404, 405, 409, 413, 415, 422].includes(status ?? 0)) {
    return "invalid_request_or_capability";
  }
  if (status !== undefined && status >= 500 && status <= 599) {
    return "unavailable";
  }
  if (error instanceof TypeError) return "unavailable";
  return "unexpected";
}

function constructorName(record: Record<string, unknown>): string | undefined {
  try {
    const prototype = Object.getPrototypeOf(record) as unknown;
    if (typeof prototype !== "object" || prototype === null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(
      prototype,
      "constructor",
    );
    const constructor = descriptor?.value;
    if (typeof constructor !== "function") return undefined;
    const name = constructor.name;
    return typeof name === "string" && name.length <= 80 ? name : undefined;
  } catch {
    return undefined;
  }
}

function providerCodeCandidates(record: Record<string, unknown>): string[] {
  return [record.code, record.errorCode, record.type].filter(
    (value): value is string => typeof value === "string" && value.length <= 80,
  );
}

function inspectedRecords(error: unknown): Record<string, unknown>[] {
  const root = asRecord(error);
  if (root === undefined) return [];
  return [
    root,
    asRecord(root.error),
    asRecord(root.cause),
    asRecord(root.response),
    asRecord(asRecord(root.response)?.data),
    asRecord(asRecord(asRecord(root.response)?.data)?.error),
  ].filter((record): record is Record<string, unknown> => record !== undefined);
}

function httpStatus(error: unknown): number | undefined {
  for (const record of inspectedRecords(error)) {
    for (const candidate of [
      record.status,
      record.statusCode,
      record.status_code,
    ]) {
      if (
        typeof candidate === "number" &&
        Number.isInteger(candidate) &&
        candidate >= 100 &&
        candidate <= 599
      ) {
        return candidate;
      }
    }
  }
  return undefined;
}

function entries(
  category: ProviderErrorCategory,
  values: readonly string[],
): Array<[string, ProviderErrorCategory]> {
  return values.map((value) => [value, category]);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
