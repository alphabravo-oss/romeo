import type { WorkflowDefinition, WorkflowStep, WorkflowStepRun } from '../domain/entities'
import type { RomeoRepository } from '../domain/repository'
import { ApiError } from '../errors'

const MAX_HANDOFF_CONTEXT_CHARACTERS = 4_000

export interface WorkflowHandoffPrompt {
  content: string
  sourceChatId: string
  sourceRunId: string
  contextCharacterCount: number
}

export async function buildWorkflowHandoffPrompt(input: {
  repository: RomeoRepository
  workflow: WorkflowDefinition
  step: WorkflowStep
  completedSteps: WorkflowStepRun[]
  runInput: Record<string, unknown>
}): Promise<WorkflowHandoffPrompt> {
  const sourceStep = resolveHandoffSourceStep(input.step, input.completedSteps)
  if (sourceStep === undefined) {
    throw new ApiError('workflow_handoff_invalid_state', 'Handoff steps require a completed upstream agent step.', 409)
  }

  const sourceChatId = stringValue(sourceStep.output.chatId)
  const sourceRunId = stringValue(sourceStep.output.runId)
  if (sourceChatId === undefined || sourceRunId === undefined) {
    throw new ApiError('workflow_handoff_invalid_state', 'Handoff source step is missing linked chat or run metadata.', 409)
  }

  const [sourceChat, sourceRun, sourceMessages] = await Promise.all([
    input.repository.getChat(sourceChatId),
    input.repository.getRun(sourceRunId),
    input.repository.listMessages(sourceChatId)
  ])
  if (
    sourceChat === undefined ||
    sourceRun === undefined ||
    sourceChat.orgId !== input.workflow.orgId ||
    sourceChat.workspaceId !== input.workflow.workspaceId ||
    sourceRun.orgId !== input.workflow.orgId ||
    sourceRun.workspaceId !== input.workflow.workspaceId ||
    sourceRun.chatId !== sourceChat.id
  ) {
    throw new ApiError('workflow_handoff_invalid_state', 'Handoff source step references an invalid upstream run.', 409)
  }

  const assistantContext = boundedLatestAssistantContent(sourceMessages)
  const instruction = input.step.handoffPrompt ?? workflowStepInstruction(input.workflow, input.step, input.runInput)
  return {
    content: [
      `Workflow "${input.workflow.name}" is handing work to step "${input.step.name}".`,
      `Source step: ${sourceStep.stepId}.`,
      `Instruction: ${instruction}`,
      assistantContext.length > 0 ? `Prior assistant output:\n${assistantContext}` : 'Prior assistant output was not available.'
    ].join('\n\n'),
    sourceChatId,
    sourceRunId,
    contextCharacterCount: assistantContext.length
  }
}

function resolveHandoffSourceStep(step: WorkflowStep, completedSteps: WorkflowStepRun[]): WorkflowStepRun | undefined {
  const candidates = completedSteps.filter((candidate) => isCompletedAgentStep(candidate))
  if (step.handoffFromStepId !== undefined) return candidates.find((candidate) => candidate.stepId === step.handoffFromStepId)
  return candidates.at(-1)
}

function isCompletedAgentStep(step: WorkflowStepRun): boolean {
  return step.status === 'completed' && (step.type === 'agent_run' || step.type === 'agent_handoff')
}

function boundedLatestAssistantContent(messages: Awaited<ReturnType<RomeoRepository['listMessages']>>): string {
  const latest = messages.filter((message) => message.role === 'assistant' && message.content.trim().length > 0).at(-1)
  if (latest === undefined) return ''
  const content = latest.content.trim()
  return content.length <= MAX_HANDOFF_CONTEXT_CHARACTERS ? content : content.slice(-MAX_HANDOFF_CONTEXT_CHARACTERS)
}

function workflowStepInstruction(workflow: WorkflowDefinition, step: WorkflowStep, runInput: Record<string, unknown>): string {
  return stringInput(runInput.prompt) ?? stringInput(runInput.content) ?? `Continue workflow "${workflow.name}" step "${step.name}".`
}

function stringInput(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
