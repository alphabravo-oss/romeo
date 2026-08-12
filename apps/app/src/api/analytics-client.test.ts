import { afterEach, describe, expect, it, vi } from "vitest";

import {
  exportAdminAnalyticsSummaryCsv,
  getAdminAnalyticsSummary,
} from "../features/admin-insights";

function mockFetch(returnBody: unknown = { data: {} }) {
  const fn = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(
        typeof returnBody === "string"
          ? returnBody
          : JSON.stringify(returnBody),
        {
          status: 200,
          headers: {
            "content-type":
              typeof returnBody === "string" ? "text/csv" : "application/json",
          },
        },
      ),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

function lastCall(fn: ReturnType<typeof mockFetch>) {
  const call = fn.mock.calls.at(-1);
  const url = call?.[0] ?? "";
  const init = call?.[1] ?? {};
  return {
    url,
    method: init.method,
    body: init.body
      ? (JSON.parse(init.body as string) as Record<string, unknown>)
      : undefined,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("analytics-client — admin analytics summary", () => {
  it("getAdminAnalyticsSummary GETs the summary route and unwraps the envelope", async () => {
    const fn = mockFetch({ data: { orgId: "o1", status: "healthy" } });
    const summary = await getAdminAnalyticsSummary({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-12T00:00:00.000Z",
    });
    expect(lastCall(fn).url).toBe(
      "/api/v1/admin/analytics/summary?from=2026-08-01T00%3A00%3A00.000Z&to=2026-08-12T00%3A00%3A00.000Z",
    );
    expect(lastCall(fn).method).toBe("GET");
    expect(summary.orgId).toBe("o1");
  });

  it("exportAdminAnalyticsSummaryCsv fetches the .csv route with a text/csv accept header", async () => {
    const fn = mockFetch("category,dimension,id,metric,value\n");
    const csv = await exportAdminAnalyticsSummaryCsv({
      from: "2026-08-01T00:00:00.000Z",
    });
    const call = fn.mock.calls.at(-1);
    expect(call?.[0]).toBe(
      "/api/v1/admin/analytics/summary.csv?from=2026-08-01T00%3A00%3A00.000Z",
    );
    expect(new Headers(call?.[1]?.headers).get("accept")).toBe("text/csv");
    expect(csv).toBe("category,dimension,id,metric,value\n");
  });
});
