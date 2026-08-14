import { ApiError } from "../errors";

const allowedApiErrorCodes = new Set([
  "not_found",
  "forbidden",
  "invalid_request",
  "api_key_already_revoked",
  "service_account_already_disabled",
]);

export function publicErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError && allowedApiErrorCodes.has(error.code)
    ? error.message
    : fallback;
}
