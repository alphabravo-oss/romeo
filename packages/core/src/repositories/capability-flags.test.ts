import { CapabilityFlagVersionConflictError } from "../domain/capability-flags";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "./in-memory";

describe("in-memory organization capability flags", () => {
  it("provides CAS history, same-state idempotency, tenant isolation, and purge", async () => {
    const repository = new InMemoryRomeoRepository();
    const first = await repository.replaceOrganizationCapabilityFlag({
      flag: flag({ id: "capability_flag_1", state: "disabled" }),
      expectedVersion: 0,
    });
    const repeated = await repository.replaceOrganizationCapabilityFlag({
      flag: flag({ id: "capability_flag_repeat", state: "disabled" }),
      expectedVersion: 0,
    });
    expect(repeated.id).toBe(first.id);
    await expect(
      repository.replaceOrganizationCapabilityFlag({
        flag: flag({ id: "capability_flag_stale", state: "enabled" }),
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(CapabilityFlagVersionConflictError);
    const second = await repository.replaceOrganizationCapabilityFlag({
      flag: flag({ id: "capability_flag_2", state: "enabled" }),
      expectedVersion: 1,
    });
    expect(second).toMatchObject({ version: 2, supersedesId: first.id });
    expect(
      await repository.listActiveOrganizationCapabilityFlags({
        orgId: "org_foreign",
      }),
    ).toEqual([]);
    expect(
      await repository.listOrganizationCapabilityFlagHistory({
        orgId: "org_default",
        flagId: "image_jobs_v2",
        limit: 10,
      }),
    ).toHaveLength(2);
    const purge = await repository.purgeTenantData("org_default");
    expect(purge.recordCounts.organizationCapabilityFlags).toBe(2);
  });

  it("allows only one distinct concurrent replacement for a version", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.replaceOrganizationCapabilityFlag({
      flag: flag({ id: "capability_flag_base", state: "disabled" }),
      expectedVersion: 0,
    });
    const settled = await Promise.allSettled([
      repository.replaceOrganizationCapabilityFlag({
        flag: flag({ id: "capability_flag_race_enabled", state: "enabled" }),
        expectedVersion: 1,
      }),
      repository.replaceOrganizationCapabilityFlag({
        flag: flag({
          id: "capability_flag_race_preview",
          state: "preview",
          allowlistedSubjects: [
            { subjectType: "user", subjectId: "user_dev_admin" },
          ],
        }),
        expectedVersion: 1,
      }),
    ]);
    expect(
      settled.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      settled.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });
});

function flag(
  overrides: Partial<
    Parameters<
      InMemoryRomeoRepository["replaceOrganizationCapabilityFlag"]
    >[0]["flag"]
  > = {},
): Parameters<
  InMemoryRomeoRepository["replaceOrganizationCapabilityFlag"]
>[0]["flag"] {
  return {
    id: "capability_flag_default",
    orgId: "org_default",
    flagId: "image_jobs_v2",
    state: "enabled",
    allowlistedSubjects: [],
    actorId: "user_dev_admin",
    reason: "Capability flag repository test.",
    createdAt: "2026-08-14T10:00:00.000Z",
    ...overrides,
  };
}
