import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { ApiDeprecationDefinition } from "@romeo/contracts";

import { apiDeprecationMiddleware } from "./api-deprecation";
import { ApiDeprecationUsageStore } from "../services/api-deprecation-observability";

const definition: ApiDeprecationDefinition = {
  deprecatedAt: "2026-01-01T00:00:00.000Z",
  documentationUrl: "/docs/api/legacy",
  method: "get",
  operationId: "example.getV1",
  path: "/api/v1/legacy/{resourceId}",
  replacementOperationId: "example.getV2",
  sinceVersion: "1.2.3",
  sunsetAt: "2026-04-15T00:00:00.000Z",
  telemetryMetric: "romeo_api_deprecated_requests_total",
  zeroUsageDaysRequired: 30,
};
const operations = [
  { method: "get", operationId: "example.getV1", path: definition.path },
  { method: "get", operationId: "example.getV2", path: "/api/v1/current" },
] as const;

describe("API deprecation middleware", () => {
  it("emits standard headers and bounded metadata across response classes", async () => {
    let now = Date.parse("2026-02-01T00:00:00.000Z");
    const store = new ApiDeprecationUsageStore([definition], () => now);
    const app = new Hono();
    app.use(
      "*",
      apiDeprecationMiddleware({
        definitions: [definition],
        operations,
        store,
      }),
    );
    app.get("/api/v1/legacy/:resourceId", (context) => {
      const id = context.req.param("resourceId");
      if (id === "bad") return context.text("bad", 400);
      if (id === "fail") throw new Error("raw failure sentinel");
      return context.text("ok", 200);
    });
    app.onError((_error, context) => context.text("safe", 500));

    const rawSentinel = "RAW_QUERY_BODY_CREDENTIAL_SENTINEL";
    for (const [id, status] of [
      ["customer-123", 200],
      ["bad", 400],
      ["fail", 500],
    ] as const) {
      now += 1_000;
      const response = await app.request(
        `/api/v1/legacy/${id}?token=${rawSentinel}`,
        { headers: { authorization: `Bearer ${rawSentinel}` } },
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("Deprecation")).toBe("@1767225600");
      expect(response.headers.get("Sunset")).toBe(
        "Wed, 15 Apr 2026 00:00:00 GMT",
      );
      expect(response.headers.get("Link")).toBe(
        '</docs/api/legacy>; rel="deprecation", </api/v1/current>; rel="successor-version"',
      );
    }

    const snapshot = store.snapshot();
    expect(snapshot.operations).toEqual([
      expect.objectContaining({
        operationId: definition.operationId,
        requestCount: 3,
        responseClasses: {
          "1xx": 0,
          "2xx": 1,
          "3xx": 0,
          "4xx": 1,
          "5xx": 1,
          other: 0,
        },
      }),
    ]);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain(rawSentinel);
    expect(serialized).not.toContain("customer-123");
    expect(serialized).not.toContain("authorization");
  });

  it("does not create path-ID cardinality and exposes zero-use evidence", async () => {
    let now = Date.parse("2026-02-01T00:00:00.000Z");
    const store = new ApiDeprecationUsageStore([definition], () => now);
    const initial = store.snapshot();
    expect(initial.operations).toEqual([
      expect.objectContaining({
        operationId: definition.operationId,
        requestCount: 0,
        zeroUsageWindowSeconds: 0,
      }),
    ]);
    expect(initial.operations[0]).not.toHaveProperty("lastUsedAt");

    const app = new Hono();
    app.use(
      "*",
      apiDeprecationMiddleware({
        definitions: [definition],
        operations,
        store,
      }),
    );
    app.get("/api/v1/legacy/:resourceId", (context) => context.text("ok"));
    app.post("/api/v1/legacy/:resourceId", (context) => context.text("ok"));
    await app.request("/api/v1/legacy/id-one", { method: "POST" });
    await app.request("/api/v1/legacy/id-one/extra");
    now += 86_400_000;

    const snapshot = store.snapshot();
    expect(snapshot.operations).toHaveLength(1);
    expect(snapshot.operations[0]).toMatchObject({
      requestCount: 0,
      zeroUsageWindowSeconds: 86_400,
    });
  });
});
