import type { AuthSubject } from "@romeo/auth";
import { describe, expect, it, vi } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { createSeedData } from "../repositories/seed-data";
import { InventoriedTablePageService } from "./inventoried-table-page-service";

const subject: AuthSubject = {
  groupIds: [],
  id: "user_dev_admin",
  isAdmin: true,
  orgId: "org_default",
  scopes: ["admin:read", "usage:read"],
  type: "user",
  workspaceIds: ["workspace_default"],
};

describe("InventoriedTablePageService native paging", () => {
  it("uses the bounded repository adapter and carries totals in the signed cursor", async () => {
    const seed = createSeedData();
    seed.usageEvents = Array.from({ length: 10_000 }, (_, index) => ({
      actorId: subject.id,
      createdAt: `2026-08-23T12:${String(Math.floor(index / 60) % 60).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
      id: `usage_scale_${String(index).padStart(5, "0")}`,
      metadata: {},
      metric: index % 2 === 0 ? "tokens" : "cost",
      orgId: subject.orgId,
      quantity: index,
      sourceId: `run_${index}`,
      sourceType: "run" as const,
      unit: "count" as const,
      workspaceId: "workspace_default",
    }));
    const repository = new InMemoryRomeoRepository(seed);
    const nativeQuery = vi.spyOn(repository, "queryInventoriedTableRows");
    const loadAll = vi.spyOn(repository, "listUsageEvents");
    const service = new InventoriedTablePageService(repository, {
      cursorSecrets: ["native-table-page-test-secret-1234567890"],
    });

    const first = await service.query(subject, {
      filters: [],
      limit: 100,
      resource: "usage_events",
      sort: [{ direction: "desc", field: "createdAt" }],
    });
    expect(first.items).toHaveLength(100);
    expect(first.page.estimatedTotal).toBe(10_000);
    expect(first.page.nextCursor).toEqual(expect.any(String));
    expect(nativeQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeTotals: true, limit: 101 }),
    );
    expect(loadAll).not.toHaveBeenCalled();

    const second = await service.query(subject, {
      cursor: first.page.nextCursor!,
      filters: [],
      limit: 100,
      resource: "usage_events",
      sort: [{ direction: "desc", field: "createdAt" }],
    });
    expect(second.items).toHaveLength(100);
    expect(second.page.estimatedTotal).toBe(10_000);
    expect(nativeQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        includeTotals: false,
        limit: 101,
        position: expect.objectContaining({ id: expect.any(String) }),
      }),
    );
    expect(loadAll).not.toHaveBeenCalled();
  });

  it("rejects predicates that are not declared for the native resource", async () => {
    const service = new InventoriedTablePageService(
      new InMemoryRomeoRepository(),
    );
    await expect(
      service.query(subject, {
        filters: [{ field: "status", operator: "eq", value: "active" }],
        limit: 25,
        resource: "usage_events",
        sort: [],
      }),
    ).rejects.toThrow("Table page query is invalid");
  });

  it("applies the frozen export boundary before counting and paging", async () => {
    const seed = createSeedData();
    seed.usageEvents = [
      usage("usage_before", "2026-08-23T11:59:59.000Z"),
      usage("usage_after", "2026-08-23T12:00:01.000Z"),
    ];
    const service = new InventoriedTablePageService(
      new InMemoryRomeoRepository(seed),
    );
    const page = await service.query(subject, {
      filters: [],
      limit: 25,
      resource: "usage_events",
      snapshotAt: "2026-08-23T12:00:00.000Z",
      sort: [],
    });
    expect(page.items.map((row) => row.id)).toEqual(["usage_before"]);
    expect(page.page.estimatedTotal).toBe(1);
  });
});

function usage(id: string, createdAt: string) {
  return {
    actorId: subject.id,
    createdAt,
    id,
    metadata: {},
    metric: "tokens",
    orgId: subject.orgId,
    quantity: 1,
    sourceId: "run_1",
    sourceType: "run" as const,
    unit: "count" as const,
    workspaceId: "workspace_default",
  };
}
