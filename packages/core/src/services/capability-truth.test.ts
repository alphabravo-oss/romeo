import { seededSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import { ApiError } from "../errors";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import type { CapabilityAssignmentState } from "../domain/capabilities";
import { CapabilityService } from "./capability-resolver";

describe("capability truth on CapabilityService", () => {
  it("keeps a required parent effective and rejects a weakening child write", async () => {
    const repository = new InMemoryRomeoRepository();
    const capabilities = new CapabilityService(repository);
    await seedAssignment(repository, {
      capabilityId: "content_firewall",
      scopeType: "organization",
      scopeId: "org_default",
      state: "required",
    });
    await seedAssignment(repository, {
      capabilityId: "content_firewall",
      scopeType: "workspace",
      scopeId: "workspace_default",
      state: "disabled",
    });

    const effective = await capabilities.resolve({
      subject: seededSubject,
      capabilityId: "content_firewall",
      workspaceId: "workspace_default",
    });
    expect(effective.status).toBe("required");
    expect(effective.dimensions.allowed).toBe("yes");

    await expect(
      capabilities.updateAssignment({
        subject: seededSubject,
        capabilityId: "content_firewall",
        scope: { scopeType: "workspace", scopeId: "workspace_default" },
        state: "enabled",
        configuration: {},
        reason: "Child must not weaken a required parent",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({
      code: "capability_assignment_invalid",
      status: 400,
    });
  });

  it("requires a distinct approver before a high-risk enable takes effect", async () => {
    const repository = new InMemoryRomeoRepository();
    const capabilities = new CapabilityService(repository);
    const input = {
      subject: seededSubject,
      capabilityId: "secure_compute" as const,
      scope: {
        scopeType: "organization" as const,
        scopeId: "org_default",
      },
      state: "enabled" as const,
      configuration: {},
      reason: "Enable isolated compute",
      expectedVersion: 0,
    };

    let bundleId = "";
    try {
      await capabilities.updateAssignment(input);
      throw new Error("expected policy_bundle_approval_required");
    } catch (caught) {
      expect(caught).toMatchObject({
        code: "policy_bundle_approval_required",
        status: 403,
      });
      bundleId = String((caught as ApiError).details.bundleId);
    }
    expect(bundleId.startsWith("policy_bundle_")).toBe(true);
    expect(
      await repository.listActiveCapabilityAssignments({
        orgId: "org_default",
        scopes: [{ scopeType: "organization", scopeId: "org_default" }],
        capabilityIds: ["secure_compute"],
        at: new Date().toISOString(),
      }),
    ).toEqual([]);

    await expect(
      capabilities.approvePublication({
        subject: seededSubject,
        bundleId,
        reason: "Self-approval must fail closed",
      }),
    ).rejects.toMatchObject({
      code: "policy_bundle_self_approval_forbidden",
      status: 403,
    });

    const published = await capabilities.approvePublication({
      subject: { ...seededSubject, id: "user_security" },
      bundleId,
      reason: "Approve isolated compute",
    });
    expect(published).toMatchObject({
      state: "published",
      publicationRequired: true,
      capabilityId: "secure_compute",
      approverId: "user_security",
    });
    expect(
      (
        await repository.listActiveCapabilityAssignments({
          orgId: "org_default",
          scopes: [{ scopeType: "organization", scopeId: "org_default" }],
          capabilityIds: ["secure_compute"],
          at: new Date().toISOString(),
        })
      )[0],
    ).toMatchObject({ state: "enabled", actorId: "user_security" });
  });

  it("hits the versioned resolution cache and misses after an assignment write", async () => {
    const repository = new InMemoryRomeoRepository();
    const capabilities = new CapabilityService(repository);
    const first = await capabilities.resolve({
      subject: seededSubject,
      capabilityId: "image_generation",
      workspaceId: "workspace_default",
    });
    const second = await capabilities.resolve({
      subject: seededSubject,
      capabilityId: "image_generation",
      workspaceId: "workspace_default",
    });
    expect(second).toBe(first);

    await capabilities.updateAssignment({
      subject: seededSubject,
      capabilityId: "image_generation",
      scope: { scopeType: "workspace", scopeId: "workspace_default" },
      state: "disabled",
      configuration: {},
      reason: "Invalidate cached image decisions",
      expectedVersion: 0,
    });
    const third = await capabilities.resolve({
      subject: seededSubject,
      capabilityId: "image_generation",
      workspaceId: "workspace_default",
    });
    expect(third).not.toBe(first);
    expect(third.status).toBe("not_allowed");
  });

  it("summarizes current resolve against the proposed assignment", async () => {
    const repository = new InMemoryRomeoRepository();
    const capabilities = new CapabilityService(repository);
    const preview = await capabilities.previewImpact({
      subject: seededSubject,
      capabilityId: "web_retrieval",
      scope: { scopeType: "organization", scopeId: "org_default" },
      state: "disabled",
      configuration: {},
      samples: [
        { role: "member", workspaceClass: "default" },
        { role: "admin", workspaceClass: "regulated" },
      ],
    });
    expect(preview.sampleCount).toBe(3);
    expect(preview.counts.enabled).toBe(1);
    expect(preview.counts.not_allowed).toBe(2);
    expect(JSON.stringify(preview)).not.toContain("user_");
  });
});

async function seedAssignment(
  repository: InMemoryRomeoRepository,
  input: {
    capabilityId: string;
    scopeType: "organization" | "workspace";
    scopeId: string;
    state: CapabilityAssignmentState;
  },
): Promise<void> {
  await repository.replaceCapabilityAssignment({
    assignment: {
      id: `assignment_${input.scopeType}_${input.capabilityId}`,
      orgId: "org_default",
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      capabilityId: input.capabilityId,
      state: input.state,
      configuration: {},
      actorId: seededSubject.id,
      reason: "Seed required parent",
      effectiveAt: "2026-08-14T09:00:00.000Z",
      createdAt: "2026-08-14T09:00:00.000Z",
    },
  });
}
