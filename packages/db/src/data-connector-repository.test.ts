import { describe, expect, it } from "vitest";

import {
  toDataConnectorRecord,
  toDataConnectorSyncRecord,
} from "./data-connector-repository";

describe("data connector repository mappers", () => {
  it("maps connector scheduling fields and normalizes unknown states conservatively", () => {
    const connector = toDataConnectorRecord({
      id: "connector_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      knowledgeBaseId: "kb_1",
      type: "unknown",
      name: "Policy import",
      config: [],
      status: "stalled",
      syncIntervalMinutes: 60,
      nextSyncAt: new Date("2026-06-27T01:00:00.000Z"),
      createdBy: "user_1",
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:05:00.000Z"),
      lastSyncAt: null,
    });

    expect(connector).toEqual({
      id: "connector_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      knowledgeBaseId: "kb_1",
      type: "local_import",
      name: "Policy import",
      config: {},
      status: "disabled",
      syncIntervalMinutes: 60,
      nextSyncAt: "2026-06-27T01:00:00.000Z",
      createdBy: "user_1",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:05:00.000Z",
    });
  });

  it("maps sync source identifiers, summary metadata, and failure status", () => {
    const sync = toDataConnectorSyncRecord({
      id: "sync_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      knowledgeBaseId: "kb_1",
      connectorId: "connector_1",
      status: "unknown",
      createdBy: "user_1",
      itemCount: 3,
      sourceIds: ["source_1", 42, "source_2"],
      summary: { sourceCount: 2, secret: undefined },
      errorCode: "connector_failed",
      startedAt: new Date("2026-06-27T00:00:00.000Z"),
      completedAt: new Date("2026-06-27T00:01:00.000Z"),
    });

    expect(sync).toMatchObject({
      id: "sync_1",
      status: "failed",
      itemCount: 3,
      sourceIds: ["source_1", "source_2"],
      summary: { sourceCount: 2, secret: undefined },
      errorCode: "connector_failed",
      startedAt: "2026-06-27T00:00:00.000Z",
      completedAt: "2026-06-27T00:01:00.000Z",
    });
  });
});
