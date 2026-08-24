import { describe, expect, it } from "vitest";

import { workspaceContentPageQueryOptions } from "./query-options";

describe("workspace content query lifecycle", () => {
  it("polls transitional rows and stops after the content becomes actionable", () => {
    const options = workspaceContentPageQueryOptions({
      enabled: true,
      kind: "memories",
      page: 0,
      pageSize: 25,
      query: "",
      workspaceId: "workspace-1",
    });
    const interval = options.refetchInterval;
    expect(typeof interval).toBe("function");
    if (typeof interval !== "function") return;

    const query = (lifecycleStatus: string, ready: boolean) =>
      ({
        state: {
          data: {
            hasMore: false,
            items: [{ lifecycleStatus, ready }],
            limit: 25,
            offset: 0,
            total: 1,
          },
        },
      }) as never;

    expect(interval(query("scanning", false))).toBe(1_000);
    expect(interval(query("ready", true))).toBe(false);
    expect(interval(query("failed", false))).toBe(false);
  });
});
