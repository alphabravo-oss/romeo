import type { UsageMetricDefinition } from "@romeo/api-client/generated/query";
import { createGeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import { isCancelledError } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { createRomeoQueryClient } from "../../lib/query-client";
import { queryCacheProfiles } from "../../lib/query-cache-policy";
import { usageMetricDefinitionsQueryOptions } from "./usage-metric-query-options";

const definition: UsageMetricDefinition = {
  aggregation: "sum",
  billable: true,
  category: "text_token",
  measurement: "reported",
  metric: "llm.input_token.reported",
  overlapPolicy: "component_of_total",
  sourceTypes: ["run"],
  unit: "token",
};

describe("usage metric definition query options", () => {
  it("owns its stable browser-only policy and selected data envelope", () => {
    const options = usageMetricDefinitionsQueryOptions();

    expect(options).toMatchObject({
      ...queryCacheProfiles.stable,
      meta: {
        ssr: false,
        queryDiagnostic: { resource: "usageMetricDefinitions" },
      },
    });
    expect(options.select?.({ data: [definition] })).toEqual([definition]);
    expect(JSON.stringify(options.queryKey)).toContain(
      "operationalGovernanceListUsageMetricDefinitions",
    );
  });

  it("forwards cancellation through the generated transport without retry", async () => {
    let requestSignal: AbortSignal | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      requestSignal = init?.signal ?? undefined;
      markStarted();
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    });
    const apiClient = createGeneratedQueryClient({
      baseUrl: "https://romeo.example/api/v1",
      fetchImpl,
    });
    const queryClient = createRomeoQueryClient();
    const options = usageMetricDefinitionsQueryOptions(apiClient);

    const pending = queryClient.fetchQuery(options);
    await started;
    await queryClient.cancelQueries({ queryKey: options.queryKey });
    const cancelled = await pending.then(
      () => false,
      (error: unknown) => isCancelledError(error),
    );

    expect(cancelled).toBe(true);
    expect(requestSignal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(options.queryKey)).toBeUndefined();
  });
});
