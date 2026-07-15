import { pathId, withQuery } from '../path'
import type { RomeoTransport } from '../transport'
import type {
  ApproveWorkflowRunInput,
  BrowserAutomationArtifactUploadRegistration,
  BrowserAutomationTaskClaimResult,
  BrowserAutomationTaskExpiryResult,
  BrowserAutomationTaskReadbackResult,
  ClaimBrowserAutomationTaskInput,
  CreateBrowserAutomationArtifactUploadInput,
  CompleteBrowserAutomationTaskInput,
  CreateWorkflowFromTemplateInput,
  CreateWorkflowInput,
  ExpireBrowserAutomationTasksInput,
  FailBrowserAutomationTaskInput,
  RenewBrowserAutomationTaskLeaseInput,
  StartWorkflowRunInput,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowScheduleRunResult,
  WorkflowTemplate
} from '../types'

export function createWorkflowResource(transport: RomeoTransport) {
  return {
    templates: () => transport.data<WorkflowTemplate[]>('GET', '/api/v1/workflow-templates'),
    createFromTemplate: (templateId: string, input: CreateWorkflowFromTemplateInput) =>
      transport.data<WorkflowDefinition>('POST', `/api/v1/workflow-templates/${pathId(templateId)}/create`, input),
    list: (workspaceId?: string) => transport.data<WorkflowDefinition[]>('GET', withQuery('/api/v1/workflows', { workspaceId })),
    create: (input: CreateWorkflowInput) => transport.data<WorkflowDefinition>('POST', '/api/v1/workflows', input),
    runDueSchedules: () => transport.data<WorkflowScheduleRunResult>('POST', '/api/v1/workflows/schedules/run-due'),
    runs: (workflowId: string) => transport.data<WorkflowRun[]>('GET', `/api/v1/workflows/${pathId(workflowId)}/runs`),
    startRun: (workflowId: string, input: StartWorkflowRunInput = {}) =>
      transport.data<WorkflowRun>('POST', `/api/v1/workflows/${pathId(workflowId)}/runs`, input),
    approveRun: (workflowRunId: string, input: ApproveWorkflowRunInput = {}) =>
      transport.data<WorkflowRun>('POST', `/api/v1/workflow-runs/${pathId(workflowRunId)}/approve`, input),
    resumeRun: (workflowRunId: string) => transport.data<WorkflowRun>('POST', `/api/v1/workflow-runs/${pathId(workflowRunId)}/resume`),
    claimBrowserTask: (input: ClaimBrowserAutomationTaskInput = {}) =>
      transport.data<BrowserAutomationTaskClaimResult>('POST', '/api/v1/browser-automation-tasks/claim', input),
    renewBrowserTaskLease: (input: RenewBrowserAutomationTaskLeaseInput) => {
      const { jobId, ...body } = input
      return transport.data<BrowserAutomationTaskClaimResult>(
        'POST',
        `/api/v1/browser-automation-tasks/${pathId(jobId)}/renew-lease`,
        body
      )
    },
    createBrowserTaskArtifactUpload: (input: CreateBrowserAutomationArtifactUploadInput) => {
      const { jobId, ...body } = input
      return transport.data<BrowserAutomationArtifactUploadRegistration>(
        'POST',
        `/api/v1/browser-automation-tasks/${pathId(jobId)}/artifacts/uploads`,
        body
      )
    },
    completeBrowserTask: (input: CompleteBrowserAutomationTaskInput) => {
      const { jobId, ...body } = input
      return transport.data<BrowserAutomationTaskReadbackResult>(
        'POST',
        `/api/v1/browser-automation-tasks/${pathId(jobId)}/complete`,
        body
      )
    },
    failBrowserTask: (input: FailBrowserAutomationTaskInput) => {
      const { jobId, ...body } = input
      return transport.data<BrowserAutomationTaskReadbackResult>(
        'POST',
        `/api/v1/browser-automation-tasks/${pathId(jobId)}/fail`,
        body
      )
    },
    expireBrowserTasks: (input: ExpireBrowserAutomationTasksInput = {}) =>
      transport.data<BrowserAutomationTaskExpiryResult>('POST', '/api/v1/browser-automation-tasks/expire', input)
  }
}
