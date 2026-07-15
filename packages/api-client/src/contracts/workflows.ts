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

export interface WorkflowScheduleRunResult {
  checkedAt: string
  dueWorkflowCount: number
  startedRuns: WorkflowRun[]
}

export interface CreateWorkflowInput {
  workspaceId: string
  name: string
  description?: string | undefined
  steps: Array<Omit<WorkflowStep, 'id'>>
  schedule?: Partial<WorkflowSchedule> | undefined
}

export interface CreateWorkflowFromTemplateInput {
  workspaceId: string
  agentId?: string | undefined
  name?: string | undefined
  schedule?: Partial<WorkflowSchedule> | undefined
}

export interface StartWorkflowRunInput {
  input?: Record<string, unknown> | undefined
}

export interface ApproveWorkflowRunInput {
  comment?: string | undefined
}

export interface BrowserAutomationWorkerLease {
  attempt: number
  claimedAt: string
  expiresAt: string
  leaseSeconds: number
  renewedAt: string
  workerId: string
}

export interface BrowserTaskSandboxPolicy {
  artifactCapture: 'metadata_only' | 'screenshots_and_traces'
  downloadPolicy: 'blocked' | 'metadata_only'
  executionDriver: 'disabled' | 'external_worker'
  network: 'target_origin_only'
  uploadPolicy: 'blocked'
}

export interface BrowserAutomationArtifactSummary {
  artifactId: string
  type: 'download' | 'screenshot' | 'trace'
  artifactUrl?: string | undefined
  contentType?: string | undefined
  sizeBytes?: number | undefined
}

export interface BrowserAutomationPresignedUpload {
  key: string
  url: string
  method: 'PUT'
  expiresAt: string
  headers: Record<string, string>
}

export interface BrowserAutomationArtifactUploadRegistration {
  artifact: BrowserAutomationArtifactSummary
  upload: BrowserAutomationPresignedUpload
}

export interface BrowserAutomationCompletionResult {
  artifactCount?: number | undefined
  artifacts?: BrowserAutomationArtifactSummary[] | undefined
  capturedBytes?: number | undefined
  durationMs?: number | undefined
  finalHost?: string | undefined
  finalOrigin?: string | undefined
  finalPath?: string | undefined
  navigationCount?: number | undefined
  networkDeniedCount?: number | undefined
  outputKeys?: string[] | undefined
  redactionApplied?: boolean | undefined
}

export interface BrowserAutomationTaskClaimResult {
  claimed: boolean
  workerQueue: 'browser_automation'
  job?: { id: string; status: 'completed' | 'failed' | 'queued' | 'running'; type: string } | undefined
  lease?: BrowserAutomationWorkerLease | undefined
  request?: {
    targetHost: string
    targetOrigin: string
    targetUrl: string
    task: string
    taskHash: string
    taskLength: number
  } | undefined
  sandboxPolicy?: BrowserTaskSandboxPolicy | undefined
  workflow?: {
    stepId: string
    workflowId: string
    workflowRunId: string
    workspaceId: string
  } | undefined
}

export interface BrowserAutomationTaskReadbackResult {
  job: { id: string; status: 'completed' | 'failed' | 'queued' | 'running'; type: string }
  outcome: 'cancelled' | 'completed' | 'failed'
  workerQueue: 'browser_automation'
  workflow: {
    stepId: string
    workflowId: string
    workflowRunId: string
    workspaceId: string
  }
  errorCode?: string | undefined
  result?: BrowserAutomationCompletionResult | undefined
}

export interface BrowserAutomationTaskExpiryResult {
  expired: number
  jobs: Array<BrowserAutomationTaskReadbackResult & { reasonCode: 'queued_timeout' | 'running_lease_timeout' }>
  workerQueue: 'browser_automation'
}

export interface ClaimBrowserAutomationTaskInput {
  leaseSeconds?: number | undefined
}

export interface RenewBrowserAutomationTaskLeaseInput extends ClaimBrowserAutomationTaskInput {
  jobId: string
}

export interface CompleteBrowserAutomationTaskInput {
  jobId: string
  result: BrowserAutomationCompletionResult
}

export interface CreateBrowserAutomationArtifactUploadInput {
  contentType: string
  jobId: string
  sizeBytes: number
  type: 'screenshot' | 'trace'
}

export interface FailBrowserAutomationTaskInput {
  errorCode: string
  jobId: string
}

export interface ExpireBrowserAutomationTasksInput {
  limit?: number | undefined
  queuedTimeoutSeconds?: number | undefined
  runningTimeoutSeconds?: number | undefined
}
