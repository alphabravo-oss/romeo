import type { AuthSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import type { UsageEvent } from "../domain/entities";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { UsageService, usageEventsWithinInterval } from "./usage-service";

const subject: AuthSubject = {
  groupIds: [],
  id: "user_usage_interval",
  orgId: "org_usage_interval",
  scopes: ["usage:read"],
  type: "user",
  workspaceIds: ["workspace_usage_interval"],
};

describe("usage interval authority", () => {
  it("uses one inclusive-from/exclusive-to interval for rows, totals, and CSV", async () => {
    const repository = new InMemoryRomeoRepository();
    const events = [
      usageEvent("before", "2026-03-08T06:59:59.999Z", 100),
      usageEvent("at-from", "2026-03-08T07:00:00.000Z", 2),
      usageEvent("inside", "2026-03-08T07:30:00.000Z", 3),
      usageEvent("at-to", "2026-03-08T08:00:00.000Z", 100),
    ];
    for (const event of events) await repository.createUsageEvent(event);
    const service = new UsageService(repository);
    const interval = {
      // DST transition expressed as equivalent absolute instants.
      from: "2026-03-08T03:00:00.000-04:00",
      to: "2026-03-08T04:00:00.000-04:00",
    };

    await expect(service.list(subject, interval)).resolves.toMatchObject([
      { id: "inside" },
      { id: "at-from" },
    ]);
    const summary = await service.summary(subject, interval);
    expect(summary.totals).toMatchObject([
      { metric: "tool.call.success", quantity: 5 },
    ]);
    const csv = await service.exportEventsCsv(subject, interval);
    expect(csv).toContain("at-from");
    expect(csv).toContain("inside");
    expect(csv).not.toContain("before");
    expect(csv).not.toContain("at-to");
  });

  it("rejects empty or reversed intervals", () => {
    const events = [usageEvent("event", "2026-08-23T12:00:00.000Z", 1)];
    expect(() =>
      usageEventsWithinInterval(events, {
        from: "2026-08-23T12:00:00.000Z",
        to: "2026-08-23T12:00:00.000Z",
      }),
    ).toThrow(/from before to/u);
    expect(() =>
      usageEventsWithinInterval(events, {
        from: "not-a-date",
        to: "2026-08-23T12:00:00.000Z",
      }),
    ).toThrow(/valid instants/u);
  });

  it("requires usage authority for every bounded representation", async () => {
    const service = new UsageService(new InMemoryRomeoRepository());
    const unauthorized = { ...subject, scopes: [] };
    const interval = {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-02T00:00:00.000Z",
    };

    await expect(service.list(unauthorized, interval)).rejects.toThrow(
      /scope|authorized|forbidden/iu,
    );
    await expect(service.summary(unauthorized, interval)).rejects.toThrow(
      /scope|authorized|forbidden/iu,
    );
    await expect(
      service.exportEventsCsv(unauthorized, interval),
    ).rejects.toThrow(/scope|authorized|forbidden/iu);
  });
});

function usageEvent(
  id: string,
  createdAt: string,
  quantity: number,
): UsageEvent {
  return {
    actorId: subject.id,
    createdAt,
    id,
    metadata: {},
    metric: "tool.call.success",
    orgId: subject.orgId,
    quantity,
    sourceId: `source_${id}`,
    sourceType: "tool",
    unit: "call",
    workspaceId: subject.workspaceIds[0]!,
  };
}
