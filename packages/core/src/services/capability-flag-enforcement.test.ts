import { seededSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { assertCapabilityFlagEnabled } from "./capability-flag-enforcement";
import { OrganizationCapabilityFlagService } from "./organization-capability-flag-service";

describe("capability flag consumer enforcement", () => {
  it("allows default-enabled enforced flags and denies a saved disable before side effects", async () => {
    const repository = new InMemoryRomeoRepository();
    const flags = new OrganizationCapabilityFlagService(repository, {
      disabledCapabilityIds: [],
    });
    await expect(
      assertCapabilityFlagEnabled(flags, seededSubject, "server_table_v2"),
    ).resolves.toBeUndefined();

    await flags.update({
      subject: seededSubject,
      flagId: "compute_artifacts_v1",
      state: "disabled",
      allowlistedSubjects: [],
      reason: "Turn off compute rollout",
      expectedVersion: 0,
    });
    await expect(
      assertCapabilityFlagEnabled(
        flags,
        seededSubject,
        "compute_artifacts_v1",
      ),
    ).rejects.toMatchObject({
      code: "capability_not_allowed",
      status: 403,
    });
  });

  it("keeps the platform kill above an organization enable", async () => {
    const flags = new OrganizationCapabilityFlagService(
      new InMemoryRomeoRepository(),
      { disabledCapabilityIds: ["secure_compute"] },
    );
    await expect(
      assertCapabilityFlagEnabled(
        flags,
        seededSubject,
        "compute_artifacts_v1",
      ),
    ).rejects.toMatchObject({
      code: "capability_platform_disabled",
    });
  });
});
