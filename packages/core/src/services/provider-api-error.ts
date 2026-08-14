import {
  normalizeProviderError,
  type ProviderErrorCategory,
  type ProviderKind,
  type ProviderRequestOperation,
} from "@romeo/providers";

import { ApiError } from "../errors";

const publicCategoryPolicy = {
  auth: {
    code: "provider_authentication_failed",
    message: "The model provider rejected authentication.",
    status: 401,
  },
  cancelled: {
    code: "provider_request_cancelled",
    message: "The model provider request was cancelled.",
    status: 400,
  },
  invalid_request_or_capability: {
    code: "provider_invalid_request_or_capability",
    message: "The model provider rejected the request or capability.",
    status: 400,
  },
  policy: {
    code: "provider_policy_rejected",
    message: "The model provider rejected the request under its policy.",
    status: 403,
  },
  quota: {
    code: "provider_quota_exceeded",
    message: "The model provider quota is exhausted.",
    status: 429,
  },
  rate_limit: {
    code: "provider_rate_limited",
    message: "The model provider rate limit was reached.",
    status: 429,
  },
  timeout: {
    code: "provider_timeout",
    message: "The model provider request timed out.",
    status: 504,
  },
  unavailable: {
    code: "provider_unavailable",
    message: "The model provider is temporarily unavailable.",
    status: 503,
  },
  unexpected: {
    code: "provider_unexpected_failure",
    message: "The model provider request failed unexpectedly.",
    status: 502,
  },
} as const satisfies Record<
  ProviderErrorCategory,
  { code: string; message: string; status: number }
>;

export function providerApiError(
  error: unknown,
  context: {
    kind: ProviderKind;
    operation: ProviderRequestOperation;
  } = { kind: "openai-compatible", operation: "chat" },
): ApiError {
  if (error instanceof ApiError) return error;
  const record = asRecord(error);
  if (record?.errorCode === "provider_credential_unavailable") {
    return new ApiError(
      "provider_credential_unavailable",
      "The requested model provider credential is unavailable.",
      503,
    );
  }
  const normalized = normalizeProviderError(
    context.kind,
    error,
    context.operation,
  );
  const policy = publicCategoryPolicy[normalized.category];
  return new ApiError(policy.code, policy.message, policy.status, {
    category: normalized.category,
    retryable: normalized.retryable,
  });
}

export function providerChatApiError(
  error: unknown,
  kind: ProviderKind,
): ApiError {
  return providerApiError(error, { kind, operation: "chat" });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
