import { describe, expect, it } from "vitest";

import {
  toAuditLogRecord,
  toBackgroundJobRecord,
  toSystemSettingRecord,
  toUsageEventRecord,
} from "./operational-repository";

describe("operational repository mappers", () => {
  it("maps audit metadata and treats unknown outcomes as failures", () => {
    const log = toAuditLogRecord({
      id: "audit_1",
      orgId: "org_1",
      actorId: "user_1",
      action: "tool.call",
      resourceType: "tool",
      resourceId: "tool_1",
      outcome: "partial",
      metadata: { redacted: true },
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(log).toEqual({
      id: "audit_1",
      orgId: "org_1",
      actorId: "user_1",
      action: "tool.call",
      resourceType: "tool",
      resourceId: "tool_1",
      outcome: "failure",
      metadata: { redacted: true },
      createdAt: "2026-06-27T00:00:00.000Z",
    });
  });

  it("maps optional usage workspace ids and normalizes unknown source types", () => {
    const event = toUsageEventRecord({
      id: "usage_1",
      orgId: "org_1",
      workspaceId: null,
      actorId: "user_1",
      sourceType: "unknown",
      sourceId: "run_1",
      metric: "run.started",
      quantity: 1,
      unit: "count",
      metadata: [],
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(event).toEqual({
      id: "usage_1",
      orgId: "org_1",
      actorId: "user_1",
      sourceType: "storage",
      sourceId: "run_1",
      metric: "run.started",
      quantity: 1,
      unit: "count",
      metadata: {},
      createdAt: "2026-06-27T00:00:00.000Z",
    });
  });

  it("maps background job completion and fails closed on unknown status", () => {
    const job = toBackgroundJobRecord({
      id: "job_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      type: "tool.approval",
      status: "paused",
      payload: { approvalRequired: true },
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:01:00.000Z"),
      completedAt: new Date("2026-06-27T00:02:00.000Z"),
    });

    expect(job).toMatchObject({
      id: "job_1",
      workspaceId: "workspace_1",
      status: "failed",
      payload: { approvalRequired: true },
      completedAt: "2026-06-27T00:02:00.000Z",
    });
  });

  it("maps system settings as JSON records for product configuration", () => {
    const setting = toSystemSettingRecord({
      key: "auth_provider_settings.global.v1",
      value: {
        version: 1,
        providers: {
          keycloak: {
            enabled: true,
            secretRef: "env://KEYCLOAK_CLIENT_SECRET",
          },
        },
      },
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    });

    expect(setting).toEqual({
      key: "auth_provider_settings.global.v1",
      value: {
        version: 1,
        providers: {
          keycloak: {
            enabled: true,
            secretRef: "env://KEYCLOAK_CLIENT_SECRET",
          },
        },
      },
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
  });
});
