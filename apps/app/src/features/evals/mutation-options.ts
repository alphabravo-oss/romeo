import * as appQueryKeys from "../../lib/app-query-keys";
import { serverMutationOptions } from "../../lib/server-mutation-options";
import { createEvalSuite, rateEvalResult, runEvalSuite } from "./mutations";
import type {
  EvalResultHumanRating,
  EvalRun,
  EvalSuite,
  RateEvalResultRequest,
} from "./types";

export function createEvalSuiteMutationOptions() {
  return serverMutationOptions({
    resource: "evalSuite.create",
    mutationFn: createEvalSuite,
    reconcile: (client, created) => {
      client.setQueryData<EvalSuite[]>(
        appQueryKeys.evalSuites(created.suite.agentId),
        (current) =>
          current === undefined
            ? undefined
            : [
                ...current.filter((suite) => suite.id !== created.suite.id),
                created.suite,
              ],
      );
    },
    invalidations: (_created, variables) => [
      { exact: true, queryKey: appQueryKeys.evalSuites(variables.agentId) },
      { exact: true, queryKey: appQueryKeys.evalDashboard(variables.agentId) },
    ],
  });
}

export function runEvalSuiteMutationOptions(agentId?: string) {
  return serverMutationOptions({
    resource: "evalSuite.run",
    mutationFn: runEvalSuite,
    reconcile: (client, completed) => {
      if (agentId === undefined) return;
      client.setQueryData<EvalRun[]>(
        appQueryKeys.evalRuns(agentId),
        (current) =>
          current === undefined
            ? undefined
            : [
                ...current.filter((run) => run.id !== completed.run.id),
                completed.run,
              ],
      );
    },
    invalidations: (_completed, variables) =>
      agentId === undefined
        ? []
        : [
            { exact: true, queryKey: appQueryKeys.evalRuns(agentId) },
            { exact: true, queryKey: appQueryKeys.evalDashboard(agentId) },
            {
              exact: true,
              queryKey: appQueryKeys.evalReasoningComparison(variables.suiteId),
            },
          ],
  });
}

type RateEvalInput = RateEvalResultRequest & {
  resultId: string;
  runId: string;
};

export function rateEvalResultMutationOptions() {
  return serverMutationOptions<EvalResultHumanRating, Error, RateEvalInput>({
    resource: "evalResult.rate",
    mutationFn: ({ runId: _runId, ...input }) => rateEvalResult(input),
    reconcile: (client, rating, variables) => {
      client.setQueryData<EvalResultHumanRating[]>(
        appQueryKeys.evalRatings(variables.runId),
        (current) =>
          current === undefined
            ? undefined
            : [...current.filter((entry) => entry.id !== rating.id), rating],
      );
    },
    invalidations: (_rating, variables) => [
      { exact: true, queryKey: appQueryKeys.evalRatings(variables.runId) },
    ],
  });
}
