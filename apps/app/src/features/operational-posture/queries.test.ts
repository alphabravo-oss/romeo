import { afterEach, describe, expect, it, vi } from "vitest";

import { getGaEvidencePosture, getPostgresOperationalPosture } from "./queries";
import { getJobsOperationalSummary } from "../jobs";
import { getQuotasDistributedStatus } from "../operational-governance";

function mockFetch(returnBody: unknown) {
  const fn = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(returnBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("operational posture generated queries", () => {
  it("gets and unwraps GA evidence posture", async () => {
    const fetchMock = mockFetch({
      data: { schema: "romeo.ga-evidence-posture.v1", status: "passed" },
    });

    const report = await getGaEvidencePosture();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/ga/evidence-posture",
      expect.objectContaining({ method: "GET" }),
    );
    expect(report).toMatchObject({
      schema: "romeo.ga-evidence-posture.v1",
      status: "passed",
    });
  });

  it("gets and unwraps Postgres operational posture", async () => {
    const fetchMock = mockFetch({
      data: {
        schema: "romeo.postgres-operational-posture.v1",
        status: "ready",
      },
    });

    const report = await getPostgresOperationalPosture();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/postgres/operational-posture",
      expect.objectContaining({ method: "GET" }),
    );
    expect(report.status).toBe("ready");
  });

  it("gets and unwraps the jobs operational summary", async () => {
    const fetchMock = mockFetch({
      data: { status: "healthy", totals: { total: 3 } },
    });
    const summary = await getJobsOperationalSummary();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/jobs/operational-summary",
      expect.objectContaining({ method: "GET" }),
    );
    expect(summary.status).toBe("healthy");
  });

  it("gets and unwraps distributed quota status", async () => {
    const fetchMock = mockFetch({
      data: { driver: "disabled", enabled: false, healthy: null },
    });
    const status = await getQuotasDistributedStatus();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/quotas/distributed-status",
      expect.objectContaining({ method: "GET" }),
    );
    expect(status.driver).toBe("disabled");
  });
});
