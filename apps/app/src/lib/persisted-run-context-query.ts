import {
  runsInspectPersistedContextOptions,
  type RunsInspectPersistedContextResponse,
} from "@romeo/api-client/generated/query";
import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";

import { queryCacheProfiles } from "./query-cache-policy";
import { devQueryDiagnosticMeta } from "./query-cache-diagnostics";

export function persistedRunContextQueryOptions(
  chatId: string | undefined,
  runId?: string,
  client?: GeneratedQueryClient,
) {
  return {
    ...runsInspectPersistedContextOptions({
      ...(client === undefined ? {} : { client }),
      path: { chatId: chatId ?? "" },
      ...(runId === undefined ? {} : { query: { runId } }),
    }),
    ...queryCacheProfiles.interactive,
    enabled: chatId !== undefined,
    meta: {
      ssr: false,
      ...devQueryDiagnosticMeta("persistedRunContext", { chatId, runId }),
    },
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
  };
}

export type PersistedRunContext = NonNullable<
  RunsInspectPersistedContextResponse["data"]
>;
