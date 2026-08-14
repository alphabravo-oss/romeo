import { RomeoApiError } from "@romeo/api-client";

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

/**
 * Converts an untrusted server/provider failure into localized public copy.
 * Raw Error.message is intentionally never returned: upstream bodies can
 * contain endpoint details, provider output, or credential fragments.
 */
export function safeUserErrorMessage(error: unknown, fallback: string): string {
  const requestId =
    error instanceof RomeoApiError ? error.body?.error.request_id : undefined;
  return typeof requestId === "string" && requestIdPattern.test(requestId)
    ? `${fallback} [${requestId}]`
    : fallback;
}
