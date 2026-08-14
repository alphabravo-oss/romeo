import {
  capabilityFlagsGetAdminReportOptions,
  capabilityFlagsGetHistoryOptions,
  type CapabilityFlagId,
  type CapabilityFlagsGetAdminReportResponse,
  type CapabilityFlagsGetHistoryResponse,
} from "@romeo/api-client/generated/query";
import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import { queryOptions } from "@tanstack/react-query";

import { serverQueryPolicy } from "../../lib/server-query-options";

export function capabilityFlagAdminReportQueryOptions(
  client: GeneratedQueryClient,
) {
  return queryOptions({
    ...capabilityFlagsGetAdminReportOptions({ client }),
    ...serverQueryPolicy("interactive", "capabilityFlagAdminReport"),
    select: (response: CapabilityFlagsGetAdminReportResponse) => response.data,
  });
}

export function capabilityFlagHistoryQueryOptions(
  flagId: CapabilityFlagId,
  enabled: boolean,
  client: GeneratedQueryClient,
) {
  return queryOptions({
    ...capabilityFlagsGetHistoryOptions({ client, path: { flagId } }),
    ...serverQueryPolicy("interactive", "capabilityFlagHistory", { flagId }),
    enabled,
    select: (response: CapabilityFlagsGetHistoryResponse) => response.data,
  });
}
