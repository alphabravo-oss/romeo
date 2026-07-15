import type { WorkflowStep, WorkflowTemplate } from '../domain/entities'
import { ApiError } from '../errors'

export interface WorkflowTemplateCreateInput {
  templateId: string
  workspaceId: string
  agentId?: string | undefined
  name?: string | undefined
}

export interface WorkflowTemplateDefinition {
  template: WorkflowTemplate
  defaultName: string
  defaultDescription: string
}

const WORKFLOW_TEMPLATES: WorkflowTemplateDefinition[] = [
  {
    template: {
      id: 'agent_review_approval',
      name: 'Agent review with approval',
      description: 'Runs an agent draft step, waits for human approval, then records a notification ledger step.',
      requiredInputs: ['agentId'],
      steps: [
        { type: 'agent_run', name: 'Draft response', requiresAgentId: true },
        { type: 'approval', name: 'Human approval', approvalPrompt: 'Approve the agent draft before notification.' },
        { type: 'notification', name: 'Record approval notification', message: 'Workflow approved.' }
      ]
    },
    defaultName: 'Agent review with approval',
    defaultDescription: 'Template workflow: agent draft, human approval, notification ledger.'
  },
  {
    template: {
      id: 'agent_notify',
      name: 'Agent run with notification',
      description: 'Runs an agent step and records a notification ledger step without an approval gate.',
      requiredInputs: ['agentId'],
      steps: [
        { type: 'agent_run', name: 'Agent run', requiresAgentId: true },
        { type: 'notification', name: 'Record completion notification', message: 'Workflow completed.' }
      ]
    },
    defaultName: 'Agent run with notification',
    defaultDescription: 'Template workflow: agent run and notification ledger.'
  }
]

export function listWorkflowTemplates(): WorkflowTemplate[] {
  return WORKFLOW_TEMPLATES.map((entry) => entry.template)
}

export function buildWorkflowFromTemplate(input: WorkflowTemplateCreateInput): {
  name: string
  description: string
  steps: Array<Omit<WorkflowStep, 'id'>>
} {
  const definition = WORKFLOW_TEMPLATES.find((entry) => entry.template.id === input.templateId)
  if (definition === undefined) throw new ApiError('workflow_template_not_found', 'Workflow template not found.', 404)
  if (definition.template.requiredInputs.includes('agentId') && input.agentId === undefined) {
    throw new ApiError('invalid_workflow_template_input', 'This workflow template requires an agentId.', 400)
  }

  return {
    name: input.name ?? definition.defaultName,
    description: definition.defaultDescription,
    steps: definition.template.steps.map((step) => instantiateStep(step, input.agentId))
  }
}

function instantiateStep(
  step: WorkflowTemplate['steps'][number],
  agentId: string | undefined
): Omit<WorkflowStep, 'id'> {
  if (step.type === 'agent_run' || step.type === 'agent_handoff') {
    if (agentId === undefined) throw new ApiError('invalid_workflow_template_input', 'Agent run template steps require an agentId.', 400)
    return {
      type: step.type,
      name: step.name,
      agentId,
      ...(step.handoffFromStepId === undefined ? {} : { handoffFromStepId: step.handoffFromStepId }),
      ...(step.handoffPrompt === undefined ? {} : { handoffPrompt: step.handoffPrompt }),
      ...(step.retryPolicy === undefined ? {} : { retryPolicy: step.retryPolicy }),
      ...(step.recoveryPolicy === undefined ? {} : { recoveryPolicy: step.recoveryPolicy })
    }
  }
  if (step.type === 'approval') {
    return {
      type: step.type,
      name: step.name,
      ...(step.approvalPrompt === undefined ? {} : { approvalPrompt: step.approvalPrompt })
    }
  }
  if (step.type === 'tool_approval') {
    return {
      type: step.type,
      name: step.name,
      ...(step.toolChainName === undefined ? {} : { toolChainName: step.toolChainName }),
      ...(step.riskLevel === undefined ? {} : { riskLevel: step.riskLevel }),
      ...(step.approvalPrompt === undefined ? {} : { approvalPrompt: step.approvalPrompt }),
      ...(step.inputKeys === undefined ? {} : { inputKeys: step.inputKeys })
    }
  }
  if (step.type === 'browser_task') {
    return {
      type: step.type,
      name: step.name,
      targetUrl: step.targetUrl ?? '',
      task: step.task ?? '',
      ...(step.approvalPrompt === undefined ? {} : { approvalPrompt: step.approvalPrompt })
    }
  }
  if (step.type === 'agent_room') {
    throw new ApiError('invalid_workflow_template_input', 'Agent room template steps require explicit agent IDs.', 400)
  }
  return {
    type: step.type,
    name: step.name,
    ...(step.message === undefined ? {} : { message: step.message })
  }
}
