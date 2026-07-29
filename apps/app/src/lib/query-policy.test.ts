import { describe, expect, it } from "vitest";

import { errorStatus, queryRetryDelay, shouldRetryQuery } from "./query-policy";

describe("browser query retry policy", () => {
  it.each([400, 401, 403, 404, 409, 422])(
    "does not retry permanent HTTP %s responses",
    (status) => {
      expect(shouldRetryQuery(0, { status })).toBe(false);
    },
  );

  it.each([408, 425, 429, 500, 502, 503])(
    "retries transient HTTP %s responses",
    (status) => {
      expect(shouldRetryQuery(0, { status })).toBe(true);
    },
  );

  it("retries unknown network failures but stops after the bounded limit", () => {
    expect(shouldRetryQuery(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryQuery(2, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryQuery(3, new TypeError("Failed to fetch"))).toBe(false);
  });

  it("never retries an aborted request", () => {
    expect(
      shouldRetryQuery(
        0,
        Object.assign(new Error("aborted"), {
          name: "AbortError",
        }),
      ),
    ).toBe(false);
  });

  it("extracts status from generated and wrapped client error shapes", () => {
    expect(errorStatus({ statusCode: 429 })).toBe(429);
    expect(errorStatus({ response: { status: 503 } })).toBe(503);
    expect(errorStatus({ cause: { status: 401 } })).toBe(401);
    const cycle: Record<string, unknown> = {};
    cycle.cause = cycle;
    expect(errorStatus(cycle)).toBeUndefined();
  });

  it("uses capped exponential backoff", () => {
    expect(queryRetryDelay(-1)).toBe(1_000);
    expect(queryRetryDelay(0)).toBe(1_000);
    expect(queryRetryDelay(1)).toBe(2_000);
    expect(queryRetryDelay(5)).toBe(30_000);
    expect(queryRetryDelay(100)).toBe(30_000);
  });
});
