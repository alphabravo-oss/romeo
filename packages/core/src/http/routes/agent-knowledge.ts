import type { RomeoApi } from '../context'
import { updateAgentKnowledgeBindingSchema } from '../schemas'

export function registerAgentKnowledgeRoutes(app: RomeoApi): void {
  app.get('/api/v1/agents/:agentId/knowledge-bases', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').agentKnowledge.list(context.req.param('agentId'), subject)
    return context.json({ data })
  })

  app.patch('/api/v1/agents/:agentId/knowledge-bases/:knowledgeBaseId', async (context) => {
    const subject = context.get('subject')
    const body = updateAgentKnowledgeBindingSchema.parse(await context.req.json())
    const data = await context.get('services').agentKnowledge.update({
      subject,
      agentId: context.req.param('agentId'),
      knowledgeBaseId: context.req.param('knowledgeBaseId'),
      enabled: body.enabled
    })
    return context.json({ data })
  })
}
