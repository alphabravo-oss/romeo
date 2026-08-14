import { describe, expect, it } from "vitest";

import {
  applyApiDeprecationsToOpenApiDocument,
  type ApiDeprecationDefinition,
} from "./api-deprecations";

const definition: ApiDeprecationDefinition = {
  deprecatedAt: "2026-01-01T00:00:00.000Z",
  documentationUrl: "/docs/api/legacy",
  method: "get",
  operationId: "example.getV1",
  path: "/api/v1/example/{resourceId}",
  replacementOperationId: "example.getV2",
  sinceVersion: "1.2.3",
  sunsetAt: "2026-04-15T00:00:00.000Z",
  telemetryMetric: "romeo_api_deprecated_requests_total",
  zeroUsageDaysRequired: 30,
};

describe("API deprecation OpenAPI registry", () => {
  it("adds metadata and standard headers to every successful response", () => {
    const document = fixture();
    applyApiDeprecationsToOpenApiDocument(document, [definition]);
    const operation = (document.paths as any)[definition.path].get;

    expect(operation).toMatchObject({
      deprecated: true,
      "x-romeo-deprecation": {
        deprecatedAt: definition.deprecatedAt,
        replacementOperationId: "example.getV2",
        sunsetAt: definition.sunsetAt,
      },
    });
    for (const status of ["200", "204"])
      expect(Object.keys(operation.responses[status].headers).sort()).toEqual([
        "Deprecation",
        "Link",
        "Sunset",
      ]);
    expect(operation.responses[400].headers).toBeUndefined();
  });

  it("fails generation when the runtime definition does not match a route", () => {
    expect(() =>
      applyApiDeprecationsToOpenApiDocument(fixture(), [
        { ...definition, operationId: "example.unknown" },
      ]),
    ).toThrow("does not match");
  });
});

function fixture(): Record<string, unknown> {
  return {
    paths: {
      [definition.path]: {
        get: {
          operationId: definition.operationId,
          responses: { 200: {}, 204: {}, 400: {} },
        },
      },
    },
  };
}
