import { describe, expect, it } from "vitest";

import { resolveSidebarQueryState } from "./sidebar-query-state";

describe("sidebar query presentation", () => {
  it("distinguishes no-cache failures from stale cached data", () => {
    expect(
      resolveSidebarQueryState({
        hasData: false,
        isError: true,
        isFetching: false,
        isPending: false,
      }),
    ).toBe("error");
    expect(
      resolveSidebarQueryState({
        hasData: true,
        isError: true,
        isFetching: false,
        isPending: false,
      }),
    ).toBe("ready");
  });

  it("represents initial loading, background refresh, and readiness", () => {
    expect(
      resolveSidebarQueryState({
        hasData: false,
        isError: false,
        isFetching: true,
        isPending: true,
      }),
    ).toBe("loading");
    expect(
      resolveSidebarQueryState({
        hasData: true,
        isError: false,
        isFetching: true,
        isPending: false,
      }),
    ).toBe("refreshing");
    expect(
      resolveSidebarQueryState({
        hasData: true,
        isError: false,
        isFetching: false,
        isPending: false,
      }),
    ).toBe("ready");
  });
});
