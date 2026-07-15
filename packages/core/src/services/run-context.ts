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
  input: { subject: AuthSubject; chatId: string; agentId: string; modelId?: string }
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

  // A caller may override the agent's published model for this run. Resolve
  // it the same way as the default so every downstream check (org isolation,
  // enablement, grants) applies identically to both paths.
  const requestedModelId = input.modelId ?? agentVersion.baseModelId
  const model = await repository.getModel(requestedModelId)
  if (!model) throw notFound('Model')

  const provider = await repository.getProvider(model.providerId)
  if (!provider) throw notFound('Provider')

  // BaseModel has no orgId of its own -- its tenant is its provider's. A
  // model whose provider belongs to another org must be treated as if it
  // does not exist: respond with the same 404 used for an unknown model id,
  // never a 403. A 403 would confirm the id refers to a real model in some
  // other org, letting a caller enumerate cross-org model ids by probing
  // which ones flip from 404 to 403.
  if (provider.orgId !== chat.orgId) throw notFound('Model')

  // A disabled model/provider must never run, whether it was reached via an
  // explicit override or the agent's own published default -- making this
  // conditional on the override would leave the default path exploitable.
  if (!model.enabled) {
    throw new ApiError('model_disabled', 'This model is disabled and cannot be used to start a run.', 409)
  }
  if (!provider.enabled) {
    throw new ApiError('provider_disabled', 'This model provider is disabled and cannot be used to start a run.', 409)
  }

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
