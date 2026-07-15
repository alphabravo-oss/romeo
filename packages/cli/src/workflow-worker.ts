import type { WorkflowDefinition, WorkflowRun } from "@romeo/api-client";

import type { CliIo } from "./io";
import { writeJson } from "./io";
import { workerSignalAborted } from "./worker-control";

export interface WorkflowResumeWorkerClient {
  workflows: {
    list(workspaceId?: string): Promise<WorkflowDefinition[]>;
    resumeRun(workflowRunId: string): Promise<WorkflowRun>;
    runs(workflowId: string): Promise<WorkflowRun[]>;
  };
}

export interface RunWorkflowResumeWorkerInput {
  client: WorkflowResumeWorkerClient;
  intervalMs: number;
  io: CliIo;
  maxIterations?: number;
  maxRunsPerIteration?: number;
  maxWorkflowsPerIteration?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  workspaceId?: string;
}

export async function runWorkflowResumeWorker(
  input: RunWorkflowResumeWorkerInput,
): Promise<number> {
  const sleep = input.sleep ?? sleepMs;
  let iteration = 0;

  while (!workerSignalAborted(input.signal)) {
    iteration += 1;
    const workflows = (await input.client.workflows.list(input.workspaceId))
      .filter((workflow) => workflow.enabled)
      .slice(0, input.maxWorkflowsPerIteration ?? 10);
    const resumedRuns: WorkflowRun[] = [];
    const errors: Array<{
      error: string;
      workflowId?: string;
      workflowRunId?: string;
    }> = [];
    let candidateCount = 0;

    for (const workflow of workflows) {
      try {
        const runs = await input.client.workflows.runs(workflow.id);
        const remaining = (input.maxRunsPerIteration ?? 10) - candidateCount;
        if (remaining <= 0) break;
        const waitingRuns = runs
          .filter((run) => run.status === "waiting_run")
          .slice(0, remaining);
        candidateCount += waitingRuns.length;
        for (const run of waitingRuns) {
          try {
            resumedRuns.push(await input.client.workflows.resumeRun(run.id));
          } catch (error) {
            errors.push({
              workflowId: workflow.id,
              workflowRunId: run.id,
              error:
                error instanceof Error
                  ? error.message
                  : "Unknown workflow resume error.",
            });
          }
        }
      } catch (error) {
        errors.push({
          workflowId: workflow.id,
          error:
            error instanceof Error
              ? error.message
              : "Unknown workflow run listing error.",
        });
      }
    }

    writeJson(input.io, {
      iteration,
      workflowCount: workflows.length,
      candidateCount,
      resumedCount: resumedRuns.length,
      failedCount: errors.length,
      runs: resumedRuns.map(workerRunSummary),
      errors,
    });

    if (input.maxIterations !== undefined && iteration >= input.maxIterations)
      return 0;
    if (workerSignalAborted(input.signal)) return 0;
    await sleep(input.intervalMs);
  }

  return 0;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function workerRunSummary(run: WorkflowRun) {
  const steps = Array.isArray(run.steps) ? run.steps : [];
  return {
    id: run.id,
    workflowId: run.workflowId,
    status: run.status,
    currentStepId: run.currentStepId,
    stepCount: steps.length,
    steps: steps.map((step) => ({
      stepId: step.stepId,
      type: step.type,
      status: step.status,
      outputKeys: Object.keys(step.output).sort(),
    })),
  };
}
