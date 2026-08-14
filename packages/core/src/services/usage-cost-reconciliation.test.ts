import { describe, expect, it } from "vitest";
import type { AuthSubject } from "@romeo/auth";

import type { UsageEvent } from "../domain/entities";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { selectUsageCostEventIds } from "./usage-cost-reconciliation";
import { formatUsageEventsCsv } from "./usage-export";
import { UsageService } from "./usage-service";

const subject: AuthSubject = {
  id: "user_default",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: [],
  scopes: ["usage:read"],
};

const event = (
  id: string,
  metric: string,
  createdAt: string,
  metadata: Record<string, unknown> = {},
): UsageEvent => ({
  id,
  orgId: "org_default",
  workspaceId: "workspace_default",
  actorId: "user_default",
  sourceType: "run",
  sourceId: "run_default",
  metric,
  quantity: 10,
  unit: metric === "image.cost.micro_usd" ? "micro_usd" : "token",
  metadata,
  createdAt,
});

describe("usage cost reconciliation", () => {
  it("prefers one reported token observation over estimates and retries", () => {
    const selected = selectUsageCostEventIds([
      event(
        "input_estimate",
        "llm.input_token.estimated",
        "2026-08-14T00:00:00Z",
      ),
      event(
        "input_reported_old",
        "llm.input_token.reported",
        "2026-08-14T00:00:01Z",
      ),
      event(
        "input_reported_new",
        "llm.input_token.reported",
        "2026-08-14T00:00:02Z",
      ),
      event(
        "output_estimate",
        "llm.output_token.estimated",
        "2026-08-14T00:00:03Z",
      ),
    ]);

    expect([...selected]).toEqual(["input_reported_new", "output_estimate"]);
  });

  it("prefers explicit integer image cost over legacy image metadata", () => {
    const generated = event(
      "image_generated",
      "image.generated",
      "2026-08-14T00:00:00Z",
      { estimatedCostUsd: 0.25 },
    );
    generated.unit = "image";
    generated.quantity = 1;
    const selected = selectUsageCostEventIds([
      generated,
      event("image_cost", "image.cost.micro_usd", "2026-08-14T00:00:01Z"),
    ]);

    expect([...selected]).toEqual(["image_cost"]);
  });

  it("never selects reasoning component cost in addition to output cost", () => {
    const output = event(
      "output_reported",
      "llm.output_token.reported",
      "2026-08-14T00:00:00Z",
      { estimatedCostUsd: 0.3 },
    );
    const reasoning = event(
      "reasoning_reported",
      "llm.reasoning_token.reported",
      "2026-08-14T00:00:01Z",
      {
        costIncludedIn: "llm.output_token.reported",
        estimatedComponentCostUsd: 0.2,
      },
    );

    expect([...selectUsageCostEventIds([output, reasoning])]).toEqual([
      "output_reported",
    ]);
  });

  it("selects every reported retry/fallback segment but only one estimate", () => {
    const estimate = event(
      "output_estimate",
      "llm.output_token.estimated",
      "2026-08-14T00:00:00Z",
      { estimatedCostUsd: 0.5 },
    );
    const primary = event(
      "output_primary",
      "llm.output_token.reported",
      "2026-08-14T00:00:01Z",
      { estimatedCostUsd: 0.2, usageSegmentIndex: 0 },
    );
    const fallback = event(
      "output_fallback",
      "llm.output_token.reported",
      "2026-08-14T00:00:02Z",
      { estimatedCostUsd: 0.3, usageSegmentIndex: 1 },
    );

    expect([...selectUsageCostEventIds([estimate, primary, fallback])]).toEqual(
      ["output_primary", "output_fallback"],
    );
  });

  it("reports reconciled costs once in usage summaries", async () => {
    const repository = new InMemoryRomeoRepository();
    const inputEstimate = event(
      "input_estimate",
      "llm.input_token.estimated",
      "2026-08-14T00:00:00Z",
      { estimatedCostUsd: 0.1 },
    );
    const inputReported = event(
      "input_reported",
      "llm.input_token.reported",
      "2026-08-14T00:00:01Z",
      { estimatedCostUsd: 0.2 },
    );
    const generated = event(
      "image_generated",
      "image.generated",
      "2026-08-14T00:00:02Z",
      { estimatedCostUsd: 0.25 },
    );
    generated.unit = "image";
    generated.quantity = 1;
    const imageCost = event(
      "image_cost",
      "image.cost.micro_usd",
      "2026-08-14T00:00:03Z",
    );
    imageCost.quantity = 250_000;
    await Promise.all(
      [inputEstimate, inputReported, generated, imageCost].map((usage) =>
        repository.createUsageEvent(usage),
      ),
    );

    const summary = await new UsageService(repository).summary(subject);
    const byMetric = new Map(summary.totals.map((item) => [item.metric, item]));
    expect(byMetric.get("llm.input_token.estimated")?.estimatedCostUsd).toBe(0);
    expect(byMetric.get("llm.input_token.reported")?.estimatedCostUsd).toBe(
      0.2,
    );
    expect(byMetric.get("image.generated")?.estimatedCostUsd).toBe(0);
    expect(byMetric.get("image.cost.micro_usd")?.estimatedCostUsd).toBe(0.25);
    expect(
      summary.totals.reduce((total, item) => total + item.estimatedCostUsd, 0),
    ).toBeCloseTo(0.45);

    const csv = formatUsageEventsCsv([
      inputEstimate,
      inputReported,
      generated,
      imageCost,
    ]);
    const [header, ...rows] = csv.split("\n");
    expect(header).toContain(
      "measurement,overlapPolicy,billable,costSelected,reconciledCostUsd",
    );
    expect(rows.find((row) => row.startsWith("input_estimate,"))).toMatch(
      /,false,$/u,
    );
    expect(rows.find((row) => row.startsWith("input_reported,"))).toMatch(
      /,true,0\.2$/u,
    );
    expect(rows.find((row) => row.startsWith("image_cost,"))).toMatch(
      /,true,0\.25$/u,
    );
  });
});
