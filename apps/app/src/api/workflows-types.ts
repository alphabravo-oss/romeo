export type WorkflowStepType =
  | 'agent_handoff'
  | 'agent_room'
  | 'agent_run'
  | 'approval'
  | 'browser_task'
  | 'notification'
  | 'tool_approval'

export type WorkflowRunStatus = 'cancelled' | 'completed' | 'failed' | 'waiting_approval' | 'waiting_run'

export type WorkflowStepRunStatus = 'completed' | 'failed' | 'pending' | 'waiting_approval' | 'waiting_run'

export interface WorkflowStep {
  id: string
  type: WorkflowStepType
  name: string
  agentId?: string
  agentIds?: string[]
  handoffFromStepId?: string
  handoffPrompt?: string
  roomPrompt?: string
  approvalPrompt?: string
  toolChainName?: string
  riskLevel?: 'high' | 'low' | 'medium'
  inputKeys?: string[]
  targetUrl?: string
  task?: string
  message?: string
}

export interface WorkflowSchedule {
  enabled: boolean
  intervalMinutes: number
  nextRunAt: string
}

export interface Workflow {
  id: string
  orgId: string
  workspaceId: string
  name: string
  description?: string
  steps: WorkflowStep[]
  schedule?: WorkflowSchedule
  enabled: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  requiredInputs: Array<'agentId'>
  steps: Array<Omit<WorkflowStep, 'id' | 'agentId'> & { requiresAgentId?: boolean }>
}

export interface WorkflowStepRun {
  stepId: string
  type: WorkflowStepType
  status: WorkflowStepRunStatus
  output: Record<string, unknown>
  completedAt?: string
}

export interface WorkflowRun {
  id: string
  orgId: string
  workspaceId: string
  workflowId: string
  status: WorkflowRunStatus
  input: Record<string, unknown>
  steps: WorkflowStepRun[]
  currentStepId?: string
  createdBy: string
  approvedBy?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export interface CreateWorkflowFromTemplateInput {
  templateId: string
  workspaceId: string
  agentId?: string
  name?: string
}

// Request shape: intervalMinutes is required, enabled/nextRunAt are optional
// (the server defaults them). The response WorkflowSchedule has them populated.
export interface WorkflowScheduleInput {
  enabled?: boolean
  intervalMinutes: number
  nextRunAt?: string
}

export interface CreateWorkflowInput {
  workspaceId: string
  name: string
  description?: string
  steps: WorkflowStep[]
  schedule?: WorkflowScheduleInput
}

export interface StartWorkflowRunInput {
  workflowId: string
  input?: Record<string, unknown>
}
