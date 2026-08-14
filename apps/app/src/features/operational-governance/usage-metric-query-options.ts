import {
  operationalGovernanceListUsageMetricDefinitionsOptions,
  type OperationalGovernanceListUsageMetricDefinitionsResponse,
} from "@romeo/api-client/generated/query";
import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import { queryOptions } from "@tanstack/react-query";

import { serverQueryPolicy } from "../../lib/server-query-options";

/** Feature-local generated query boundary, loaded only with the usage catalog. */
export function usageMetricDefinitionsQueryOptions(
  client?: GeneratedQueryClient,
) {
  return queryOptions({
    ...operationalGovernanceListUsageMetricDefinitionsOptions(
      client === undefined ? {} : { client },
    ),
    ...serverQueryPolicy("stable", "usageMetricDefinitions"),
    select: (
      response: OperationalGovernanceListUsageMetricDefinitionsResponse,
    ) => response.data,
  });
}
