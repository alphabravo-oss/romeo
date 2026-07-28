import type { WorkflowDefinition, WorkflowSchedule } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";

export interface WorkflowScheduleInput {
  enabled?: boolean | undefined;
  intervalMinutes?: number | undefined;
  nextRunAt?: string | undefined;
}

export function normalizeWorkflowSchedule(
  schedule: WorkflowScheduleInput,
  now: string,
): WorkflowSchedule {
  const intervalMinutes = schedule.intervalMinutes;
  if (intervalMinutes === undefined) {
    throw new ApiError(
      "invalid_workflow_schedule",
      "Workflow schedules require intervalMinutes.",
      400,
    );
  }
  if (
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < 5 ||
    intervalMinutes > 43_200
  ) {
    throw new ApiError(
      "invalid_workflow_schedule",
      "Workflow schedule interval must be between 5 and 43200 minutes.",
      400,
    );
  }
  return {
    enabled: schedule.enabled ?? true,
    intervalMinutes,
    nextRunAt: schedule.nextRunAt ?? addMinutes(now, intervalMinutes),
  };
}

export async function advanceWorkflowSchedule(
  repository: RomeoRepository,
  workflow: WorkflowDefinition,
  checkedAt: string,
): Promise<void> {
  if (workflow.schedule === undefined) return;
  await repository.updateWorkflowDefinition({
    ...workflow,
    schedule: {
      ...workflow.schedule,
      nextRunAt: addMinutes(checkedAt, workflow.schedule.intervalMinutes),
    },
    updatedAt: new Date().toISOString(),
  });
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}
