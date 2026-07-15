import type { AgentMemoryPolicy, AgentSafetySettings } from '../../domain/entities'
import type { RomeoApi } from '../context'
import { cloneAgentSchema, createAgentSchema, importAgentSchema, updateAgentSchema } from '../schemas'

export function registerAgentRoutes(app: RomeoApi): void {
  app.get('/api/v1/agents', async (context) => {
    const subject = context.get('subject')
    const workspaceId = context.req.query('workspaceId') ?? subject.workspaceIds[0]
    const data = workspaceId ? await context.get('services').agents.list(workspaceId, subject) : []
    return context.json({ data })
  })

  app.post('/api/v1/agents', async (context) => {
    const subject = context.get('subject')
    const body = createAgentSchema.parse(await context.req.json())
    const input: {
      subject: typeof subject
      workspaceId: string
      name: string
      baseModelId: string
      systemPrompt: string
      parameters?: Record<string, unknown>
      memoryPolicy?: AgentMemoryPolicy
      safetySettings?: AgentSafetySettings
    } = { subject, workspaceId: body.workspaceId, name: body.name, baseModelId: body.baseModelId, systemPrompt: body.systemPrompt }
    if (body.parameters !== undefined) input.parameters = body.parameters
    if (body.memoryPolicy !== undefined) input.memoryPolicy = compactMemoryPolicy(body.memoryPolicy)
    if (body.safetySettings !== undefined) input.safetySettings = compactSafetySettings(body.safetySettings)

    const data = await context.get('services').agents.create(input)
    return context.json({ data }, 201)
  })

  app.get('/api/v1/agents/:agentId', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').agents.get(context.req.param('agentId'), subject)
    return context.json({ data })
  })

  app.patch('/api/v1/agents/:agentId', async (context) => {
    const subject = context.get('subject')
    const body = updateAgentSchema.parse(await context.req.json())
    const input: {
      subject: typeof subject
      agentId: string
      name?: string
      baseModelId?: string
      systemPrompt?: string
      parameters?: Record<string, unknown>
      memoryPolicy?: AgentMemoryPolicy
      safetySettings?: AgentSafetySettings
    } = { subject, agentId: context.req.param('agentId') }
    if (body.name !== undefined) input.name = body.name
    if (body.baseModelId !== undefined) input.baseModelId = body.baseModelId
    if (body.systemPrompt !== undefined) input.systemPrompt = body.systemPrompt
    if (body.parameters !== undefined) input.parameters = body.parameters
    if (body.memoryPolicy !== undefined) input.memoryPolicy = compactMemoryPolicy(body.memoryPolicy)
    if (body.safetySettings !== undefined) input.safetySettings = compactSafetySettings(body.safetySettings)

    const data = await context.get('services').agents.update(input)
    return context.json({ data })
  })

  app.post('/api/v1/agents/:agentId/clone', async (context) => {
    const subject = context.get('subject')
    const body = cloneAgentSchema.parse(await context.req.json())
    const input: { subject: typeof subject; agentId: string; name?: string; systemPrompt?: string } = {
      subject,
      agentId: context.req.param('agentId')
    }
    if (body.name !== undefined) input.name = body.name
    if (body.systemPrompt !== undefined) input.systemPrompt = body.systemPrompt

    const data = await context.get('services').agents.clone(input)
    return context.json({ data }, 201)
  })

  app.get('/api/v1/agents/:agentId/export', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').agents.exportAgent(context.req.param('agentId'), subject)
    return context.json({ data })
  })

  app.post('/api/v1/agents/import', async (context) => {
    const subject = context.get('subject')
    const body = importAgentSchema.parse(await context.req.json())
    const agent = {
      name: body.document.agent.name,
      baseModelId: body.document.agent.baseModelId,
      systemPrompt: body.document.agent.systemPrompt,
      parameters: body.document.agent.parameters,
      memoryPolicy: compactMemoryPolicy(body.document.agent.memoryPolicy),
      safetySettings: compactSafetySettings(body.document.agent.safetySettings),
      accessGrants: body.document.agent.accessGrants,
      knowledgeBaseBindings: body.document.agent.knowledgeBaseBindings,
      toolBindings: body.document.agent.toolBindings,
      ...(body.document.agent.voiceProfileId === undefined ? {} : { voiceProfileId: body.document.agent.voiceProfileId })
    }
    const data = await context.get('services').agents.importAgent({
      subject,
      workspaceId: body.workspaceId,
      agent
    })
    return context.json({ data }, 201)
  })

  app.get('/api/v1/agents/:agentId/versions', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').agents.listVersions(context.req.param('agentId'), subject)
    return context.json({ data })
  })

  app.post('/api/v1/agents/:agentId/versions', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').agents.publish(context.req.param('agentId'), subject)
    return context.json({ data }, 201)
  })

  app.get('/api/v1/agents/:agentId/versions/:versionId/diff', async (context) => {
    const subject = context.get('subject')
    const rightVersionId = context.req.query('compareTo') ?? ''
    const data = await context.get('services').agents.diff({
      subject,
      agentId: context.req.param('agentId'),
      leftVersionId: context.req.param('versionId'),
      rightVersionId
    })
    return context.json({ data })
  })

  app.post('/api/v1/agents/:agentId/versions/:versionId/rollback', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').agents.rollback({
      subject,
      agentId: context.req.param('agentId'),
      versionId: context.req.param('versionId')
    })
    return context.json({ data })
  })
}

function compactSafetySettings(input: {
  maxUserInputLength?: number | undefined
  blockedTerms?: string[] | undefined
  promptInjectionGuard?: { mode: 'disabled' | 'block'; scanUserInput?: boolean | undefined; scanRetrievedContext?: boolean | undefined } | undefined
}): AgentSafetySettings {
  const settings: AgentSafetySettings = {}
  if (input.maxUserInputLength !== undefined) settings.maxUserInputLength = input.maxUserInputLength
  if (input.blockedTerms !== undefined) settings.blockedTerms = input.blockedTerms
  if (input.promptInjectionGuard !== undefined && input.promptInjectionGuard.mode === 'block') {
    settings.promptInjectionGuard = {
      mode: 'block',
      scanUserInput: input.promptInjectionGuard.scanUserInput ?? true,
      scanRetrievedContext: input.promptInjectionGuard.scanRetrievedContext ?? true
    }
  }
  return settings
}

function compactMemoryPolicy(input: { mode: 'disabled' } | { mode: 'recent_messages'; maxMessages?: number | undefined }): AgentMemoryPolicy {
  if (input.mode === 'disabled') return { mode: 'disabled' }
  const policy: AgentMemoryPolicy = { mode: 'recent_messages' }
  if (input.maxMessages !== undefined) policy.maxMessages = input.maxMessages
  return policy
}
