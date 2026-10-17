import { describe, expect, it } from "vitest";

import {
  DeviceAuthorizationSchema,
  FileLifecycleStatusSchema,
  KnowledgeSourceSchema,
  SyncExternalBillingEventSchema,
} from "./index";
import { contractOpenApiDocument } from "./document";
import { UpdateRetentionPolicyRequestSchema } from "./governance-data-schemas";
import { RunEventWireSchema } from "./run-event-contracts";

describe("additive public API compatibility", () => {
  it("keeps newly recommended billing and retention fields optional", () => {
    expect(
      SyncExternalBillingEventSchema.safeParse({
        provider: "stripe",
        eventType: "invoice.paid",
      }).success,
    ).toBe(true);
    expect(
      UpdateRetentionPolicyRequestSchema.safeParse({
        auditLogRetentionDays: 365,
      }).success,
    ).toBe(true);
  });

  it("keeps stable response envelopes while exposing additive typed details", () => {
    const document = contractOpenApiDocument() as any;
    const startRun = document.paths["/api/v1/runs"].post;
    const stream = document.paths["/api/v1/runs/{runId}/events"].get;
    const publish = document.paths["/api/v1/agents/{agentId}/versions"].post;

    expect(
      startRun.responses[202].content["application/json"].schema.properties.data
        .$ref,
    ).toBe("#/components/schemas/RunRecord");
    expect(stream.responses[200].content["text/event-stream"]).toMatchObject({
      schema: { $ref: "#/components/schemas/RunEvent" },
      "x-romeo-event-schema": {
        $ref: "#/components/schemas/TypedRunEvent",
      },
    });
    expect(publish.requestBody.required).toBe(false);
  });

  it("keeps response vocabularies extensible while mutation inputs stay closed", () => {
    expect(
      DeviceAuthorizationSchema.safeParse({
        id: "device_1",
        orgId: "org_1",
        userId: "user_1",
        name: "Future client",
        scopes: ["future:read"],
        accessApiKeyId: "key_1",
        expiresAt: "2026-09-23T00:00:00.000Z",
        createdAt: "2026-08-23T00:00:00.000Z",
        updatedAt: "2026-08-23T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(FileLifecycleStatusSchema.safeParse("future_state").success).toBe(
      true,
    );
    expect(
      KnowledgeSourceSchema.safeParse({
        id: "source_1",
        knowledgeBaseId: "kb_1",
        orgId: "org_1",
        workspaceId: "workspace_1",
        fileName: "future.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        status: "future_extraction_state",
        metadata: {},
        createdAt: "2026-08-23T00:00:00.000Z",
        updatedAt: "2026-08-23T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      RunEventWireSchema.safeParse({
        id: "event_1",
        runId: "run_1",
        sequence: 1,
        type: "future.event",
        data: {},
        createdAt: "2026-08-23T00:00:00.000Z",
      }).success,
    ).toBe(true);
    const document = contractOpenApiDocument() as any;
    const responseScope =
      document.components.schemas.DeviceAuthorization.properties.scopes.items;
    const requestScope =
      document.components.schemas.CreateDeviceAuthorizationRequest.properties
        .scopes.items;
    expect(responseScope).toMatchObject({
      type: "string",
      "x-extensible-enum": expect.arrayContaining(["me:read"]),
    });
    expect(responseScope).not.toHaveProperty("enum");
    expect(requestScope.enum).toContain("me:read");
    const alertCode =
      document.components.schemas.ProviderOperationalSummary.properties.alerts
        .items.properties.code;
    expect(alertCode).toMatchObject({
      type: "string",
      "x-extensible-enum": expect.arrayContaining(["provider_disabled"]),
    });
    expect(alertCode).not.toHaveProperty("enum");
    const knowledgeSourceStatus =
      document.components.schemas.KnowledgeSource.properties.status;
    expect(knowledgeSourceStatus).toMatchObject({
      type: "string",
      "x-extensible-enum": [
        "pending",
        "extracting",
        "indexed",
        "failed",
        "deletion_pending",
      ],
    });
    expect(knowledgeSourceStatus).not.toHaveProperty("enum");
  });
});
