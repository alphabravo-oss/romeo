import { describe, expect, it } from "vitest";

import { CapabilityAssignmentVersionConflictError } from "../domain/capabilities";
import { fixturePast } from "../test-support/fixture-clock";
import { InMemoryRomeoRepository } from "./in-memory";

describe("in-memory capability assignments", () => {
  it("appends immutable versions and exposes only the active revision", async () => {
    const repository = new InMemoryRomeoRepository();
    const first = await repository.replaceCapabilityAssignment({
      assignment: assignment({
        id: "capability_assignment_1",
        state: "enabled",
        createdAt: "2026-08-14T10:00:00.000Z",
      }),
    });
    expect(first).toMatchObject({ version: 1, state: "enabled" });

    await expect(
      repository.replaceCapabilityAssignment({
        assignment: assignment({
          id: "capability_assignment_stale",
          state: "disabled",
          createdAt: "2026-08-14T10:01:00.000Z",
        }),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "capability_assignment_version_conflict",
        currentVersion: 1,
        expectedVersion: undefined,
      }),
    );

    const second = await repository.replaceCapabilityAssignment({
      assignment: assignment({
        id: "capability_assignment_2",
        state: "disabled",
        createdAt: "2026-08-14T10:02:00.000Z",
      }),
      expectedVersion: 1,
    });
    expect(second).toMatchObject({
      supersedesId: first.id,
      version: 2,
      state: "disabled",
    });

    expect(
      await repository.listActiveCapabilityAssignments({
        orgId: "org_default",
        scopes: [{ scopeType: "organization", scopeId: "org_default" }],
        capabilityIds: ["image_generation"],
        at: "2026-08-14T10:03:00.000Z",
      }),
    ).toEqual([second]);
    expect(
      await repository.listCapabilityAssignmentHistory({
        orgId: "org_default",
        scope: { scopeType: "organization", scopeId: "org_default" },
        capabilityId: "image_generation",
        limit: 10,
      }),
    ).toEqual([second, { ...first, revokedAt: "2026-08-14T10:02:00.000Z" }]);
  });

  it("rejects cross-scope ownership and removes assignments on tenant purge", async () => {
    const repository = new InMemoryRomeoRepository();
    await expect(
      repository.replaceCapabilityAssignment({
        assignment: {
          ...assignment({ id: "capability_assignment_invalid" }),
          scopeType: "workspace",
          scopeId: "missing_workspace",
        },
      }),
    ).rejects.toThrow(
      "Workspace capability assignment scope does not belong to its organization.",
    );

    await repository.replaceCapabilityAssignment({
      assignment: assignment({ id: "capability_assignment_purge" }),
    });
    for (const [scopeType, scopeId] of [
      ["agent", "agent_default"],
      ["group", "group_admins"],
      ["user", "user_dev_admin"],
    ] as const) {
      await repository.replaceCapabilityAssignment({
        assignment: assignment({
          id: `capability_assignment_purge_${scopeType}`,
          scopeType,
          scopeId,
        }),
      });
    }
    const purge = await repository.purgeTenantData("org_default");
    expect(purge.recordCounts.capabilityAssignments).toBe(4);
  });

  it("returns the stable conflict error type", async () => {
    const repository = new InMemoryRomeoRepository();
    await expect(
      repository.replaceCapabilityAssignment({
        assignment: assignment({ id: "capability_assignment_conflict" }),
        expectedVersion: 4,
      }),
    ).rejects.toBeInstanceOf(CapabilityAssignmentVersionConflictError);
  });

  it("accepts zero as the explicit first-write version", async () => {
    const repository = new InMemoryRomeoRepository();
    await expect(
      repository.replaceCapabilityAssignment({
        assignment: assignment({ id: "capability_assignment_zero" }),
        expectedVersion: 0,
      }),
    ).resolves.toMatchObject({ version: 1 });
  });

  it("allows an expired assignment to be replaced without a stale version", async () => {
    const repository = new InMemoryRomeoRepository();
    const expiredAt = fixturePast(60_000);
    const createdAt = fixturePast(120_000);
    const replacementCreatedAt = new Date().toISOString();
    const first = await repository.replaceCapabilityAssignment({
      assignment: assignment({
        id: "capability_assignment_expiring",
        createdAt,
        effectiveAt: createdAt,
        expiresAt: expiredAt,
      }),
    });
    const replacement = await repository.replaceCapabilityAssignment({
      assignment: assignment({
        id: "capability_assignment_after_expiry",
        createdAt: replacementCreatedAt,
        effectiveAt: replacementCreatedAt,
      }),
    });

    expect(replacement).toMatchObject({
      supersedesId: first.id,
      version: 2,
    });
  });

  it("expires organization, workspace, agent, group, and user rows uniformly", async () => {
    const repository = new InMemoryRomeoRepository();
    const scopes = [
      ["organization", "org_default"],
      ["workspace", "workspace_default"],
      ["agent", "agent_default"],
      ["group", "group_admins"],
      ["user", "user_dev_admin"],
    ] as const;
    for (const [scopeType, scopeId] of scopes) {
      await repository.replaceCapabilityAssignment({
        assignment: assignment({
          id: `assignment_expiry_${scopeType}`,
          scopeType,
          scopeId,
          createdAt: "2026-08-14T09:00:00.000Z",
          effectiveAt: "2026-08-14T09:00:00.000Z",
          expiresAt: "2026-08-14T10:00:00.000Z", // deliberately-expired: expiry filter boundary
        }),
      });
    }
    await expect(
      repository.listActiveCapabilityAssignments({
        orgId: "org_default",
        scopes: scopes.map(([scopeType, scopeId]) => ({ scopeType, scopeId })),
        capabilityIds: ["image_generation"],
        at: "2026-08-14T10:00:00.000Z",
      }),
    ).resolves.toEqual([]);
  });
});

function assignment(
  overrides: Partial<
    Parameters<
      InMemoryRomeoRepository["replaceCapabilityAssignment"]
    >[0]["assignment"]
  > = {},
): Parameters<
  InMemoryRomeoRepository["replaceCapabilityAssignment"]
>[0]["assignment"] {
  return {
    id: "capability_assignment_default",
    orgId: "org_default",
    scopeType: "organization",
    scopeId: "org_default",
    capabilityId: "image_generation",
    state: "enabled",
    configuration: {},
    actorId: "user_dev_admin",
    reason: "Capability policy conformance test.",
    effectiveAt: "2026-08-14T10:00:00.000Z",
    createdAt: "2026-08-14T10:00:00.000Z",
    ...overrides,
  };
}
