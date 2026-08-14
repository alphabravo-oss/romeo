import { describe, expect, it } from "vitest";

import { publicApiErrorDefinition } from "../public-api-error-registry";
import { providerApiError } from "./provider-api-error";

describe("provider API error mapping", () => {
  it.each([
    ["provider_authentication_failed", "auth", 401, false],
    [
      "provider_invalid_request_or_capability",
      "invalid_request_or_capability",
      400,
      false,
    ],
    ["provider_policy_rejected", "policy", 403, false],
    ["provider_quota_exceeded", "quota", 429, true],
    ["provider_rate_limited", "rate_limit", 429, true],
    ["provider_timeout", "timeout", 504, true],
    ["provider_unavailable", "unavailable", 503, true],
    ["provider_request_cancelled", "cancelled", 400, false],
    ["provider_unexpected_failure", "unexpected", 502, true],
  ] as const)(
    "maps %s to a registered public error",
    (code, category, status, retryable) => {
      const error = providerApiError({
        category,
        errorCode: code,
        status,
      });
      expect(error).toMatchObject({
        code,
        details: { category, retryable },
        status,
      });
      expect(publicApiErrorDefinition(error.code)).toMatchObject({
        retryable,
      });
    },
  );

  it("does not serialize malicious normalized-lookalike fields", () => {
    const secret = "SENTINEL_CORE_PROVIDER_SECRET";
    const error = providerApiError({
      category: "auth",
      errorCode: "provider_authentication_failed",
      message: secret,
      body: secret,
      headers: { authorization: secret },
      url: `https://${secret}.invalid`,
      prompt: secret,
    });

    expect(error).toMatchObject({
      code: "provider_authentication_failed",
      details: { category: "auth", retryable: false },
      status: 401,
    });
    expect(JSON.stringify(error)).not.toContain(secret);
  });
});
