export type WorkflowStepTypeRecord =
  | "agent_handoff"
  | "agent_room"
  | "agent_run"
  | "approval"
  | "browser_task"
  | "notification"
  | "tool_approval";

export type WorkflowRunStatusRecord =
  | "cancelled"
  | "completed"
  | "failed"
  | "waiting_approval"
  | "waiting_run";

export type WorkflowStepRunStatusRecord =
  | "completed"
  | "failed"
  | "pending"
  | "waiting_approval"
  | "waiting_run";

export interface WorkflowStepConditionRecord {
  inputKey: string;
  equals: boolean | number | string | null;
}

export interface WorkflowStepRetryPolicyRecord {
  maxAttempts: number;
}

export interface WorkflowStepRecoveryPolicyRecord {
  onFailure: "continue" | "fail";
}

export interface WorkflowStepRecord {
  id: string;
  type: WorkflowStepTypeRecord;
  name: string;
  agentId?: string;
  agentIds?: string[];
  handoffFromStepId?: string;
  handoffPrompt?: string;
  roomPrompt?: string;
  retryPolicy?: WorkflowStepRetryPolicyRecord;
  recoveryPolicy?: WorkflowStepRecoveryPolicyRecord;
  approvalPrompt?: string;
  toolChainName?: string;
  riskLevel?: "high" | "low" | "medium";
  inputKeys?: string[];
  targetUrl?: string;
  task?: string;
  message?: string;
  condition?: WorkflowStepConditionRecord;
}

export interface WorkflowScheduleRecord {
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: string;
}

export interface WorkflowDefinitionRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  description?: string;
  steps: WorkflowStepRecord[];
  schedule?: WorkflowScheduleRecord;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStepRunRecord {
  stepId: string;
  type: WorkflowStepTypeRecord;
  status: WorkflowStepRunStatusRecord;
  output: Record<string, unknown>;
  completedAt?: string;
}

export interface WorkflowRunRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  workflowId: string;
  status: WorkflowRunStatusRecord;
  input: Record<string, unknown>;
  steps: WorkflowStepRunRecord[];
  currentStepId?: string;
  createdBy: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
