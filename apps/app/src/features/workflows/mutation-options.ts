import * as appQueryKeys from "../../lib/app-query-keys";
import { serverMutationOptions } from "../../lib/server-mutation-options";
import {
  approveWorkflowRun,
  createWorkflow,
  createWorkflowFromTemplate,
  resumeWorkflowRun,
  startWorkflowRun,
} from "./mutations";
import type { Workflow, WorkflowRun } from "./types";

function createWorkflowPolicy<TInput extends { workspaceId: string }>(
  resource: string,
  mutationFn: (input: TInput) => Promise<Workflow>,
) {
  return serverMutationOptions({
    resource,
    mutationFn,
    reconcile: (client, workflow) => {
      client.setQueryData<Workflow[]>(
        appQueryKeys.workflows(workflow.workspaceId),
        (current) =>
          current === undefined
            ? undefined
            : [
                ...current.filter((entry) => entry.id !== workflow.id),
                workflow,
              ],
      );
    },
    invalidations: (_workflow, variables) => [
      {
        exact: true,
        queryKey: appQueryKeys.workflows(variables.workspaceId),
      },
    ],
  });
}

export function createWorkflowMutationOptions() {
  return createWorkflowPolicy("workflow.create", createWorkflow);
}

export function createWorkflowFromTemplateMutationOptions() {
  return createWorkflowPolicy(
    "workflow.createFromTemplate",
    createWorkflowFromTemplate,
  );
}

export function startWorkflowRunMutationOptions() {
  return serverMutationOptions({
    resource: "workflow.run.start",
    mutationFn: startWorkflowRun,
    reconcile: (client, run: WorkflowRun, variables) => {
      client.setQueryData<WorkflowRun[]>(
        appQueryKeys.workflowRuns(variables.workflowId),
        (current) =>
          current === undefined
            ? undefined
            : [...current.filter((entry) => entry.id !== run.id), run],
      );
    },
    invalidations: (_run, variables) => [
      {
        exact: true,
        queryKey: appQueryKeys.workflowRuns(variables.workflowId),
      },
    ],
  });
}

type RunActionInput = { workflowId: string; workflowRunId: string };

export function approveWorkflowRunMutationOptions() {
  return workflowRunActionMutationOptions(
    "workflow.run.approve",
    ({ workflowRunId }) => approveWorkflowRun(workflowRunId),
  );
}

export function resumeWorkflowRunMutationOptions() {
  return workflowRunActionMutationOptions(
    "workflow.run.resume",
    ({ workflowRunId }) => resumeWorkflowRun(workflowRunId),
  );
}

function workflowRunActionMutationOptions(
  resource: string,
  mutationFn: (input: RunActionInput) => Promise<WorkflowRun>,
) {
  return serverMutationOptions({
    resource,
    mutationFn,
    reconcile: (client, run, variables) => {
      client.setQueryData<WorkflowRun[]>(
        appQueryKeys.workflowRuns(variables.workflowId),
        (current) =>
          current?.map((entry) => (entry.id === run.id ? run : entry)),
      );
    },
    invalidations: (_run, variables) => [
      {
        exact: true,
        queryKey: appQueryKeys.workflowRuns(variables.workflowId),
      },
    ],
  });
}
