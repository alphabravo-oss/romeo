import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import type { UsageEvent } from "./domain/entities";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { testEnv } from "./test-support/env";

const env = testEnv({
  SESSION_SECRET: "usage-interval-api-test-session-secret-v1",
});

describe("usage interval API parity", () => {
  it("returns the same bounded population to rows, totals, and export", async () => {
    const repository = new InMemoryRomeoRepository();
    for (const event of [
      usageEvent("usage_before", "2026-08-01T00:00:00.000Z", 100),
      usageEvent("usage_from", "2026-08-02T00:00:00.000Z", 2),
      usageEvent("usage_inside", "2026-08-02T12:00:00.000Z", 3),
      usageEvent("usage_to", "2026-08-03T00:00:00.000Z", 100),
    ]) {
      await repository.createUsageEvent(event);
    }
    const api = createRomeoApi(repository, {
      env,
      startBackgroundWorkers: false,
    });
    const interval = new URLSearchParams({
      from: "2026-08-02T00:00:00.000Z",
      to: "2026-08-03T00:00:00.000Z",
    });
    const rowsResponse = await api.request(`/api/v1/usage/events?${interval}`);
    const summaryResponse = await api.request(
      `/api/v1/usage/summary?${interval}`,
    );
    const csvResponse = await api.request(
      `/api/v1/usage/events.csv?${interval}`,
    );
    const tableResponse = await api.request("/api/v1/admin/table-pages", {
      body: JSON.stringify({
        filters: [
          {
            field: "createdAt",
            operator: "gte",
            value: "2026-08-02T00:00:00.000Z",
          },
          {
            field: "createdAt",
            operator: "lt",
            value: "2026-08-03T00:00:00.000Z",
          },
        ],
        limit: 25,
        resource: "usage_events",
        sort: [],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect([
      rowsResponse.status,
      summaryResponse.status,
      csvResponse.status,
      tableResponse.status,
    ]).toEqual([200, 200, 200, 200]);
    const rows = (await rowsResponse.json()) as {
      data: Array<{ id: string }>;
    };
    const summary = (await summaryResponse.json()) as {
      data: { totals: Array<{ metric: string; quantity: number }> };
    };
    const table = (await tableResponse.json()) as {
      data: { items: Array<{ id: string }>; page: { estimatedTotal: number } };
    };
    const csv = await csvResponse.text();
    const expectedIds = ["usage_inside", "usage_from"];

    expect(rows.data.map((row) => row.id)).toEqual(expectedIds);
    expect(table.data.items.map((row) => row.id)).toEqual(expectedIds);
    expect(table.data.page.estimatedTotal).toBe(2);
    expect(summary.data.totals).toContainEqual(
      expect.objectContaining({ metric: "tool.call.success", quantity: 5 }),
    );
    for (const id of expectedIds) expect(csv).toContain(id);
    expect(csv).not.toContain("usage_before");
    expect(csv).not.toContain("usage_to");
  });

  it("rejects invalid and empty bounded intervals", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env,
      startBackgroundWorkers: false,
    });
    const reversed = new URLSearchParams({
      from: "2026-08-03T00:00:00.000Z",
      to: "2026-08-02T00:00:00.000Z",
    });
    const malformed = new URLSearchParams({ from: "not-a-date" });

    expect((await api.request(`/api/v1/usage/events?${reversed}`)).status).toBe(
      400,
    );
    expect(
      (await api.request(`/api/v1/usage/events?${malformed}`)).status,
    ).toBe(400);
  });
});

function usageEvent(
  id: string,
  createdAt: string,
  quantity: number,
): UsageEvent {
  return {
    actorId: "user_dev_admin",
    createdAt,
    id,
    metadata: {},
    metric: "tool.call.success",
    orgId: "org_default",
    quantity,
    sourceId: `source_${id}`,
    sourceType: "tool",
    unit: "call",
    workspaceId: "workspace_default",
  };
}
