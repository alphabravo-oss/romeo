import { apiJson } from './http'
import type { Envelope } from './types'
import type {
  CreateWorkflowFromTemplateInput,
  CreateWorkflowInput,
  StartWorkflowRunInput,
  Workflow,
  WorkflowRun,
  WorkflowTemplate
} from './workflows-types'

export async function listWorkflows(workspaceId?: string): Promise<Workflow[]> {
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''
  const response = await apiJson<Envelope<Workflow[]>>(`/api/v1/workflows${query}`)
  return response.data
}

export async function listWorkflowTemplates(): Promise<WorkflowTemplate[]> {
  const response = await apiJson<Envelope<WorkflowTemplate[]>>('/api/v1/workflow-templates')
  return response.data
}

export async function createWorkflowFromTemplate(input: CreateWorkflowFromTemplateInput): Promise<Workflow> {
  const body: Record<string, unknown> = { workspaceId: input.workspaceId }
  if (input.agentId !== undefined) body.agentId = input.agentId
  if (input.name !== undefined) body.name = input.name
  const response = await apiJson<Envelope<Workflow>>(`/api/v1/workflow-templates/${encodeURIComponent(input.templateId)}/create`, {
    method: 'POST',
    body: JSON.stringify(body)
  })
  return response.data
}

export async function createWorkflow(input: CreateWorkflowInput): Promise<Workflow> {
  const body: Record<string, unknown> = {
    workspaceId: input.workspaceId,
    name: input.name,
    // The backend assigns step ids; mirror the schema by sending steps without `id`.
    steps: input.steps.map(({ id: _id, ...step }) => step)
  }
  if (input.description !== undefined) body.description = input.description
  if (input.schedule !== undefined) body.schedule = input.schedule
  const response = await apiJson<Envelope<Workflow>>('/api/v1/workflows', {
    method: 'POST',
    body: JSON.stringify(body)
  })
  return response.data
}

export async function startWorkflowRun(input: StartWorkflowRunInput): Promise<WorkflowRun> {
  const body: Record<string, unknown> = {}
  if (input.input !== undefined) body.input = input.input
  const response = await apiJson<Envelope<WorkflowRun>>(`/api/v1/workflows/${encodeURIComponent(input.workflowId)}/runs`, {
    method: 'POST',
    body: JSON.stringify(body)
  })
  return response.data
}

export async function listWorkflowRuns(workflowId: string): Promise<WorkflowRun[]> {
  const response = await apiJson<Envelope<WorkflowRun[]>>(`/api/v1/workflows/${encodeURIComponent(workflowId)}/runs`)
  return response.data
}

export async function approveWorkflowRun(workflowRunId: string): Promise<WorkflowRun> {
  const response = await apiJson<Envelope<WorkflowRun>>(`/api/v1/workflow-runs/${encodeURIComponent(workflowRunId)}/approve`, {
    method: 'POST'
  })
  return response.data
}

export async function resumeWorkflowRun(workflowRunId: string): Promise<WorkflowRun> {
  const response = await apiJson<Envelope<WorkflowRun>>(`/api/v1/workflow-runs/${encodeURIComponent(workflowRunId)}/resume`, {
    method: 'POST'
  })
  return response.data
}
