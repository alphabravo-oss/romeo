import { describe, expect, it } from "vitest";

import {
  toToolConnectorRecord,
  toToolOperationRecord,
} from "./tool-connector-repository";

describe("tool connector repository mappers", () => {
  it("maps connector JSON fields and normalizes network policy", () => {
    const connector = toToolConnectorRecord({
      id: "connector_1",
      orgId: "org_1",
      type: "openapi",
      name: "Tickets",
      description: "Ticketing API",
      schema: { source: "inline_openapi", operationCount: 2 },
      authConfig: {
        type: "api_key",
        configured: true,
        secretRef: "env://API_KEY",
      },
      networkPolicy: {
        mode: "allow_hosts",
        allowedHosts: ["api.example.com", 42],
        allowPrivateNetwork: false,
      },
      riskLevel: "medium",
      approvalPolicy: "external_side_effects",
      visibility: "org",
      enabled: false,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:05:00.000Z"),
    });

    expect(connector.networkPolicy).toEqual({
      mode: "allow_hosts",
      allowedHosts: ["api.example.com"],
      allowPrivateNetwork: false,
    });
    expect(connector.authConfig).toEqual({
      type: "api_key",
      configured: true,
      secretRef: "env://API_KEY",
    });
  });

  it("falls back to conservative operation risk and approval values", () => {
    const operation = toToolOperationRecord({
      id: "operation_1",
      orgId: "org_1",
      connectorId: "connector_1",
      operationId: "tickets.create",
      method: "post",
      path: "/tickets",
      name: "Create ticket",
      description: "",
      inputSchema: { type: "object" },
      outputSchema: [],
      riskLevel: "unknown",
      approvalPolicy: "sometimes",
      enabled: true,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(operation).toMatchObject({
      riskLevel: "high",
      approvalPolicy: "always",
      outputSchema: {},
    });
  });
});
