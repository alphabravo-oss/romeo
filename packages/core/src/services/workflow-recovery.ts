import type {
  RunRecord,
  WorkflowStep,
  WorkflowStepRun,
} from "../domain/entities";

export interface WorkflowPreviousAttempt {
  runId: string;
  status: RunRecord["status"];
}

export function workflowStepMaxAttempts(step: WorkflowStep): number {
  return step.retryPolicy?.maxAttempts ?? 1;
}

export function workflowStepAttempt(stepRun: WorkflowStepRun): number {
  const value = stepRun.output.attempt;
  return Number.isInteger(value) && typeof value === "number" && value > 0
    ? value
    : 1;
}

export function workflowStepCanRetry(
  step: WorkflowStep,
  stepRun: WorkflowStepRun,
): boolean {
  return workflowStepAttempt(stepRun) < workflowStepMaxAttempts(step);
}

export function workflowStepOnFailure(step: WorkflowStep): "continue" | "fail" {
  return step.recoveryPolicy?.onFailure ?? "fail";
}

export function appendWorkflowPreviousAttempt(
  stepRun: WorkflowStepRun,
  attempt: WorkflowPreviousAttempt,
): WorkflowPreviousAttempt[] {
  const existing = Array.isArray(stepRun.output.previousAttempts)
    ? stepRun.output.previousAttempts
    : [];
  const sanitized = existing
    .map((item) => sanitizePreviousAttempt(item))
    .filter((item): item is WorkflowPreviousAttempt => item !== undefined);
  return [...sanitized, attempt].slice(-5);
}

function sanitizePreviousAttempt(
  value: unknown,
): WorkflowPreviousAttempt | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const runId = (value as { runId?: unknown }).runId;
  const status = (value as { status?: unknown }).status;
  if (typeof runId !== "string" || !isRunStatus(status)) return undefined;
  return { runId, status };
}

function isRunStatus(value: unknown): value is RunRecord["status"] {
  return (
    value === "cancelled" ||
    value === "completed" ||
    value === "failed" ||
    value === "queued" ||
    value === "running" ||
    value === "waiting_tool_approval"
  );
}
