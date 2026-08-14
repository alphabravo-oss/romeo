import { describe, expect, it } from "vitest";

import { ApiError } from "./errors";
import {
  publicApiErrorDefinition,
  publicApiErrorRegistry,
  requirePublicApiErrorCode,
  type PublicApiErrorCode,
} from "./public-api-error-registry";
import { providerApiError } from "./services/provider-api-error";

describe("public API error registry", () => {
  it("maps every code to bounded safe product and operator metadata", () => {
    expect(Object.keys(publicApiErrorRegistry).length).toBeGreaterThan(500);
    for (const [code, definition] of Object.entries(publicApiErrorRegistry)) {
      expect(definition).toMatchObject({
        code,
        copyKey: `api-errors:intents.${definition.localizationIntent}`,
      });
      expect(definition.acceptedHttpStatuses).toContain(definition.httpStatus);
      expect(typeof definition.retryable).toBe("boolean");
      expect(definition.localizationIntent.length).toBeGreaterThan(0);
      expect(definition.operatorRemediation.length).toBeGreaterThan(0);
    }
  });

  it("rejects unknown codes and status drift without echoing raw sentinels", () => {
    const secret = "postgres://user:password@private.example/token-secret";
    for (const construct of [
      () =>
        new ApiError(
          secret as PublicApiErrorCode,
          "must never be constructed",
          400,
        ),
      () => new ApiError("not_found", "must never be constructed", 502),
      () => requirePublicApiErrorCode(secret),
    ]) {
      expect(construct).toThrowError("Public API error");
      try {
        construct();
      } catch (error) {
        expect(String(error)).not.toContain(secret);
      }
    }
  });

  it("normalizes untrusted provider codes and metadata to a registered safe error", () => {
    const secret = "RAW_PROVIDER_CODE_AND_TYPE_SECRET";
    const error = providerApiError({ errorCode: secret, errorType: secret });

    expect(error).toMatchObject({
      code: "provider_unexpected_failure",
      details: { category: "unexpected", retryable: true },
      status: 502,
    });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(publicApiErrorDefinition(error.code)).toBeDefined();
  });
});
