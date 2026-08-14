import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import { describe, expect, it } from "vitest";

import {
  capabilityFlagAdminReportQueryOptions,
  capabilityFlagHistoryQueryOptions,
} from "./query-options";

const client = {
  getConfig: () => ({ baseUrl: "/api/v1" }),
} as unknown as GeneratedQueryClient;

describe("capability flag query options", () => {
  it("owns a stable report key and shared interactive cache policy", () => {
    const first = capabilityFlagAdminReportQueryOptions(client);
    const second = capabilityFlagAdminReportQueryOptions(client);
    expect(first.queryKey).toEqual(second.queryKey);
    expect(first.staleTime).toBe(10_000);
    expect(first.meta).toMatchObject({
      queryDiagnostic: { resource: "capabilityFlagAdminReport" },
      ssr: false,
    });
  });

  it("keeps each bounded history request dormant until disclosure", () => {
    const hidden = capabilityFlagHistoryQueryOptions(
      "image_jobs_v2",
      false,
      client,
    );
    const visible = capabilityFlagHistoryQueryOptions(
      "image_jobs_v2",
      true,
      client,
    );
    expect(hidden.enabled).toBe(false);
    expect(visible.enabled).toBe(true);
    expect(hidden.queryKey).toEqual(visible.queryKey);
    expect(JSON.stringify(hidden.queryKey)).toContain("image_jobs_v2");
  });
});
