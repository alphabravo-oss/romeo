import { ApiError } from "../errors";

export function providerApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const record = asRecord(error);
  const errorCode =
    typeof record?.errorCode === "string"
      ? record.errorCode
      : "provider_generation_failed";
  const errorType =
    typeof record?.errorType === "string" ? record.errorType : undefined;
  return new ApiError(
    errorCode,
    "The model provider failed to complete the chat request.",
    errorCode === "provider_credential_unavailable" ? 503 : 502,
    errorType === undefined ? {} : { errorType },
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
