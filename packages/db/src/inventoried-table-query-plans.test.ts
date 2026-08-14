import { describe, expect, it } from "vitest";

import { inventoriedTableIndexInventory } from "./inventoried-table-indexes";
import {
  inventoriedTablePlanExpectation,
  reviewInventoriedTableQueryPlan,
} from "./inventoried-table-query-plans";

describe("inventoried table query plans", () => {
  it("fails closed when representative volume misses the tenant-sort index", () => {
    const expected = inventoriedTablePlanExpectation("provider_models");
    expect(expected).toEqual([...inventoriedTableIndexInventory.provider_models]);
    expect(
      reviewInventoriedTableQueryPlan({
        expectedIndexes: expected!,
        observedIndexes: ["base_models_org_created_id_idx"],
        representativeVolume: true,
        sequentialScan: false,
      }),
    ).toEqual({ code: "missing_expected_index", outcome: "denied" });
    expect(
      reviewInventoriedTableQueryPlan({
        expectedIndexes: expected!,
        observedIndexes: [...expected!],
        representativeVolume: true,
        sequentialScan: true,
      }),
    ).toEqual({ code: "sequential_scan_at_volume", outcome: "denied" });
    expect(
      reviewInventoriedTableQueryPlan({
        expectedIndexes: expected!,
        observedIndexes: [],
        representativeVolume: false,
        sequentialScan: true,
      }),
    ).toEqual({ outcome: "accepted" });
  });
});
