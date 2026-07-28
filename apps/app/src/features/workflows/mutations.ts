import {
  workflowsApproveRun,
  workflowsCreate,
  workflowsCreateFromTemplate,
  workflowsResumeRun,
  workflowsRunDueSchedules,
  workflowsStartRun,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  CreateWorkflowFromTemplateInput,
  CreateWorkflowInput,
  StartWorkflowRunInput,
} from "./types";

export async function createWorkflowFromTemplate({
  templateId,
  ...body
}: CreateWorkflowFromTemplateInput) {
  configureBrowserApiClients();
  const response = await workflowsCreateFromTemplate({
    path: { templateId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function createWorkflow(input: CreateWorkflowInput) {
  configureBrowserApiClients();
  const response = await workflowsCreate({
    body: {
      ...input,
      steps: input.steps.map(({ id: _id, ...step }) => step),
    },
    throwOnError: true,
  });
  return response.data.data;
}

export async function startWorkflowRun({
  workflowId,
  ...body
}: StartWorkflowRunInput) {
  configureBrowserApiClients();
  const response = await workflowsStartRun({
    path: { workflowId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function approveWorkflowRun(workflowRunId: string) {
  configureBrowserApiClients();
  const response = await workflowsApproveRun({
    path: { workflowRunId },
    body: {},
    throwOnError: true,
  });
  return response.data.data;
}

export async function resumeWorkflowRun(workflowRunId: string) {
  configureBrowserApiClients();
  const response = await workflowsResumeRun({
    path: { workflowRunId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function runDueWorkflowSchedules() {
  configureBrowserApiClients();
  const response = await workflowsRunDueSchedules({ throwOnError: true });
  return response.data.data;
}
