import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { snapshotAgentCapabilityDefaults } from "./agent-version-capability-defaults";

describe("agent version capability defaults", () => {
  it("copies the active mutable agent assignment into an immutable publish snapshot", async () => {
    const repository = new InMemoryRomeoRepository();
    const base = {
      orgId: "org_default",
      scopeType: "agent" as const,
      scopeId: "agent_default",
      capabilityId: "web_retrieval",
      actorId: "user_dev_admin",
      reason: "Published capability default",
      effectiveAt: "2026-08-14T10:00:00.000Z",
    };
    await repository.replaceCapabilityAssignment({
      assignment: {
        ...base,
        id: "assignment_agent_snapshot_v1",
        state: "enabled",
        configuration: { maxSearchResults: 2 },
        createdAt: "2026-08-14T10:00:00.000Z",
      },
    });
    const snapshot = await snapshotAgentCapabilityDefaults(repository, {
      agentId: "agent_default",
      orgId: "org_default",
      at: "2026-08-14T10:01:00.000Z",
    });
    await repository.replaceCapabilityAssignment({
      assignment: {
        ...base,
        id: "assignment_agent_snapshot_v2",
        state: "disabled",
        configuration: {},
        createdAt: "2026-08-14T10:02:00.000Z",
        effectiveAt: "2026-08-14T10:02:00.000Z",
      },
      expectedVersion: 1,
    });

    expect(snapshot).toEqual([
      {
        capabilityId: "web_retrieval",
        state: "enabled",
        configuration: { maxSearchResults: 2 },
        assignmentVersion: 1,
      },
    ]);
  });
});
