import { seededSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { CapabilityService } from "./capability-resolver";
import {
  reasoningPolicySettingKey,
  resolveReasoningCapabilityMaximum,
} from "./reasoning-capability-policy";

describe("reasoning capability policy", () => {
  it("merges organization and workspace ceilings restrictively and deny-dominantly", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new CapabilityService(repository);
    await service.updateAssignment({
      subject: seededSubject,
      capabilityId: "reasoning_policy",
      scope: { scopeType: "organization", scopeId: "org_default" },
      state: "enabled",
      configuration: {
        reasoningModeMaximum: "summary",
        reasoningEffortMaximum: "high",
        maxReasoningTokens: 20_000,
        allowReasoningSummaryRetention: true,
      },
      reason: "Organization reasoning ceiling",
      expectedVersion: 0,
    });
    await service.updateAssignment({
      subject: seededSubject,
      capabilityId: "reasoning_policy",
      scope: { scopeType: "workspace", scopeId: "workspace_default" },
      state: "enabled",
      configuration: {
        reasoningModeMaximum: "auto",
        reasoningEffortMaximum: "low",
        maxReasoningTokens: 5_000,
        allowReasoningSummaryRetention: false,
      },
      reason: "Workspace reasoning ceiling",
      expectedVersion: 0,
    });

    await expect(
      resolveReasoningCapabilityMaximum(repository, {
        orgId: "org_default",
        workspaceId: "workspace_default",
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      mode: "auto",
      effort: "low",
      maxReasoningTokens: 5_000,
    });

    await service.updateAssignment({
      subject: seededSubject,
      capabilityId: "reasoning_policy",
      scope: { scopeType: "workspace", scopeId: "workspace_default" },
      state: "disabled",
      configuration: {},
      reason: "Disable workspace reasoning",
      expectedVersion: 1,
    });
    await expect(
      resolveReasoningCapabilityMaximum(repository, {
        orgId: "org_default",
        workspaceId: "workspace_default",
      }),
    ).resolves.toEqual({ schemaVersion: 1, mode: "off" });
  });

  it("keeps the deployment deny outermost and supports immutable rollback revisions", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new CapabilityService(repository);
    const scope = {
      scopeType: "organization" as const,
      scopeId: "org_default",
    };
    await service.updateAssignment({
      subject: seededSubject,
      capabilityId: "reasoning_policy",
      scope,
      state: "disabled",
      configuration: {},
      reason: "Temporary incident restriction",
      expectedVersion: 0,
    });
    const restored = await service.updateAssignment({
      subject: seededSubject,
      capabilityId: "reasoning_policy",
      scope,
      state: "enabled",
      configuration: { reasoningModeMaximum: "auto" },
      reason: "Rollback incident restriction",
      expectedVersion: 1,
    });
    expect(restored.version).toBe(2);
    expect(
      await service.history({
        subject: seededSubject,
        capabilityId: "reasoning_policy",
        scope,
      }),
    ).toHaveLength(2);
    await expect(
      resolveReasoningCapabilityMaximum(repository, {
        orgId: "org_default",
        workspaceId: "workspace_default",
        platformPolicy: { disabledCapabilityIds: ["reasoning_policy"] },
      }),
    ).resolves.toEqual({ schemaVersion: 1, mode: "off" });
  });

  it("uses the legacy organization setting only until a versioned org assignment exists", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.upsertSystemSetting({
      key: reasoningPolicySettingKey("org_default"),
      value: {
        policy: { schemaVersion: 1, mode: "auto", effort: "low" },
      },
      updatedAt: new Date().toISOString(),
    });
    await expect(
      resolveReasoningCapabilityMaximum(repository, {
        orgId: "org_default",
        workspaceId: "workspace_default",
      }),
    ).resolves.toMatchObject({ mode: "auto", effort: "low" });

    await new CapabilityService(repository).updateAssignment({
      subject: seededSubject,
      capabilityId: "reasoning_policy",
      scope: { scopeType: "organization", scopeId: "org_default" },
      state: "enabled",
      configuration: { reasoningEffortMaximum: "high" },
      reason: "Migrate to versioned reasoning policy",
      expectedVersion: 0,
    });
    await expect(
      resolveReasoningCapabilityMaximum(repository, {
        orgId: "org_default",
        workspaceId: "workspace_default",
      }),
    ).resolves.toMatchObject({ mode: "summary", effort: "high" });
  });
});
