export type WorkflowStepType = 'agent_handoff' | 'agent_room' | 'agent_run' | 'approval' | 'browser_task' | 'notification' | 'tool_approval'
export type WorkflowRunStatus = 'cancelled' | 'completed' | 'failed' | 'waiting_approval' | 'waiting_run'
export type WorkflowStepRunStatus = 'completed' | 'failed' | 'pending' | 'waiting_approval' | 'waiting_run'

export interface WorkflowStepCondition {
  inputKey: string
  equals: string | number | boolean | null
}

export interface WorkflowStepRetryPolicy {
  maxAttempts: number
}

export interface WorkflowStepRecoveryPolicy {
  onFailure: 'continue' | 'fail'
}

export interface WorkflowStep {
  id: string
  type: WorkflowStepType
  name: string
  agentId?: string | undefined
  agentIds?: string[] | undefined
  handoffFromStepId?: string | undefined
  handoffPrompt?: string | undefined
  roomPrompt?: string | undefined
  retryPolicy?: WorkflowStepRetryPolicy | undefined
  recoveryPolicy?: WorkflowStepRecoveryPolicy | undefined
  approvalPrompt?: string | undefined
  toolChainName?: string | undefined
  riskLevel?: 'high' | 'low' | 'medium' | undefined
  inputKeys?: string[] | undefined
  targetUrl?: string | undefined
  task?: string | undefined
  message?: string | undefined
  condition?: WorkflowStepCondition | undefined
}

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  requiredInputs: Array<'agentId'>
  steps: Array<Omit<WorkflowStep, 'id' | 'agentId'> & { requiresAgentId?: boolean | undefined }>
}

export interface WorkflowSchedule {
  enabled: boolean
  intervalMinutes: number
  nextRunAt: string
}

export interface WorkflowDefinition {
  id: string
  orgId: string
  workspaceId: string
  name: string
  description?: string | undefined
  steps: WorkflowStep[]
  schedule?: WorkflowSchedule | undefined
  enabled: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowStepRun {
  stepId: string
  type: WorkflowStepType
  status: WorkflowStepRunStatus
  output: Record<string, unknown>
  completedAt?: string | undefined
}

export interface WorkflowScheduleRunResult {
  checkedAt: string
  dueWorkflowCount: number
  startedRuns: WorkflowRun[]
}

export interface WorkflowRun {
  id: string
  orgId: string
  workspaceId: string
  workflowId: string
  status: WorkflowRunStatus
  input: Record<string, unknown>
  steps: WorkflowStepRun[]
  currentStepId?: string | undefined
  createdBy: string
  approvedBy?: string | undefined
  createdAt: string
  updatedAt: string
  completedAt?: string | undefined
}
