export type RunEventType =
  | "run.started"
  | "message.started"
  | "message.delta"
  | "message.completed"
  | "retrieval.completed"
  | "tool.requested"
  | "tool.started"
  | "tool.approval_required"
  | "tool.completed"
  | "tool.failed"
  | "run.cancelled"
  | "run.completed"
  | "run.failed"
  | "run.continuing"
  | "run.waiting_tool_approval"
  | "run.waiting_tool_dispatch";

export interface RunEvent<TData = unknown> {
  id: string;
  runId: string;
  sequence: number;
  type: RunEventType;
  data: TData;
  createdAt: string;
}

export function createRunEvent<TData>(input: {
  runId: string;
  sequence: number;
  type: RunEventType;
  data: TData;
}): RunEvent<TData> {
  return {
    id: `evt_${input.runId}_${input.sequence}`,
    runId: input.runId,
    sequence: input.sequence,
    type: input.type,
    data: input.data,
    createdAt: new Date().toISOString(),
  };
}
