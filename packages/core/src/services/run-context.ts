import { assertRunAuthorized, type AuthSubject } from '@romeo/auth'
import type { BaseModel, ProviderInstance } from '@romeo/providers'

import type { Agent, AgentVersion, Chat } from '../domain/entities'
import type { RomeoRepository } from '../domain/repository'
import { ApiError, notFound } from '../errors'
import { assertWorkspaceActive } from './workspace-guard'

export interface ResolvedRunContext {
  chat: Chat
  agent: Agent
  agentVersion: AgentVersion
  model: BaseModel
  provider: ProviderInstance
}

export async function resolveRunContext(
  repository: RomeoRepository,
  input: { subject: AuthSubject; chatId: string; agentId: string }
): Promise<ResolvedRunContext> {
  const [chat, agent] = await Promise.all([repository.getChat(input.chatId), repository.getAgent(input.agentId)])
  if (!chat) throw notFound('Chat')
  if (!agent) throw notFound('Agent')
  if (chat.archivedAt !== undefined) {
    throw new ApiError('chat_archived', 'Archived chats cannot start new runs.', 409)
  }
  await assertWorkspaceActive(repository, { orgId: chat.orgId, workspaceId: chat.workspaceId })
  if (!agent.publishedVersionId) {
    throw new ApiError('agent_version_required', 'Agent must be published before it can run.', 409)
  }

  const agentVersion = await repository.getAgentVersion(agent.publishedVersionId)
  if (!agentVersion || agentVersion.agentId !== agent.id) throw notFound('Agent version')

  const model = await repository.getModel(agentVersion.baseModelId)
  if (!model) throw notFound('Model')

  const provider = await repository.getProvider(model.providerId)
  if (!provider) throw notFound('Provider')

  const grants = await repository.listResourceGrants(input.subject.orgId)
  assertRunAuthorized({
    subject: input.subject,
    orgId: chat.orgId,
    workspaceId: chat.workspaceId,
    chatId: chat.id,
    agentId: agent.id,
    modelId: model.id,
    providerId: provider.id,
    grants
  })

  return { chat, agent, agentVersion, model, provider }
}
