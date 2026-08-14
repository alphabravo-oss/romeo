import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import {
  getEvalDashboard,
  getEvalReasoningComparison,
  listEvalRatings,
  listEvalResults,
  listEvalRuns,
  listEvalSuites,
} from "./queries";

function agentOptions<T>(
  resource: "evalDashboard" | "evalRuns" | "evalSuites",
  agentId: string | undefined,
  queryKey: readonly unknown[],
  queryFn: (agentId: string) => Promise<T>,
) {
  return queryOptions({
    ...serverQueryPolicy("interactive", resource, { agentId }),
    queryKey,
    queryFn: ({ signal }) => abortableQuery(signal, () => queryFn(agentId!)),
    enabled: agentId !== undefined,
  });
}

export const evalSuitesQueryOptions = (agentId?: string) =>
  agentOptions(
    "evalSuites",
    agentId,
    appQueryKeys.evalSuites(agentId),
    listEvalSuites,
  );
export const evalRunsQueryOptions = (agentId?: string) =>
  agentOptions(
    "evalRuns",
    agentId,
    appQueryKeys.evalRuns(agentId),
    listEvalRuns,
  );
export const evalDashboardQueryOptions = (agentId?: string) =>
  agentOptions(
    "evalDashboard",
    agentId,
    appQueryKeys.evalDashboard(agentId),
    getEvalDashboard,
  );

export const evalReasoningComparisonQueryOptions = (suiteId?: string) =>
  queryOptions({
    ...serverQueryPolicy("interactive", "evalReasoningComparison", {
      suiteId,
    }),
    queryKey: appQueryKeys.evalReasoningComparison(suiteId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => getEvalReasoningComparison(suiteId!)),
    enabled: suiteId !== undefined,
  });

function runOptions<T>(
  resource: "evalRatings" | "evalResults",
  runId: string | undefined,
  queryKey: readonly unknown[],
  queryFn: (runId: string) => Promise<T>,
) {
  return queryOptions({
    ...serverQueryPolicy("interactive", resource, { runId }),
    queryKey,
    queryFn: ({ signal }) => abortableQuery(signal, () => queryFn(runId!)),
    enabled: runId !== undefined,
  });
}

export const evalResultsQueryOptions = (runId?: string) =>
  runOptions(
    "evalResults",
    runId,
    appQueryKeys.evalResults(runId),
    listEvalResults,
  );
export const evalRatingsQueryOptions = (runId?: string) =>
  runOptions(
    "evalRatings",
    runId,
    appQueryKeys.evalRatings(runId),
    listEvalRatings,
  );
