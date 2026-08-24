import { describe, expect, it } from "vitest";

import {
  serverTableExportJobQueryOptions,
  serverTableViewsQueryOptions,
} from "./server-table-authority-query-options";

describe("server table view query options", () => {
  it("owns the complete scoped key, cache policy, and enablement", () => {
    const enabled = serverTableViewsQueryOptions(
      "workspace-1",
      "api_keys",
      "provider-1",
      true,
    );
    const disabled = serverTableViewsQueryOptions(
      undefined,
      "api_keys",
      undefined,
      true,
    );
    expect(enabled.enabled).toBe(true);
    expect(enabled.queryKey).toEqual([
      "tableViews",
      {
        parentId: "provider-1",
        resource: "api_keys",
        workspaceId: "workspace-1",
      },
    ]);
    expect(enabled.staleTime).toBeTypeOf("number");
    expect(disabled.enabled).toBe(false);
  });

  it("polls only while an export is queued or running", () => {
    const options = serverTableExportJobQueryOptions("export-job-1", true);
    const interval = options.refetchInterval;
    if (typeof interval !== "function") throw new Error("polling is missing");
    expect(options.queryKey).toEqual([
      "tableExport",
      { jobId: "export-job-1" },
    ]);
    expect(interval({ state: { data: { state: "running" } } } as never)).toBe(
      1_000,
    );
    expect(
      interval({ state: { data: { state: "artifact_ready" } } } as never),
    ).toBe(false);
  });
});
