import type { RomeoApi } from '../context'
import { createPromptTemplateSchema, shareResourceSchema, updatePromptTemplateSchema } from '../schemas'

export function registerPromptTemplateRoutes(app: RomeoApi): void {
  app.get('/api/v1/prompt-templates', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').prompts.list(subject, context.req.query('workspaceId') ?? '', context.req.query('query') ?? '')
    return context.json({ data })
  })

  app.post('/api/v1/prompt-templates', async (context) => {
    const subject = context.get('subject')
    const body = createPromptTemplateSchema.parse(await context.req.json())
    const data = await context.get('services').prompts.create(subject, body)
    return context.json({ data }, 201)
  })

  app.get('/api/v1/prompt-marketplace', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').prompts.marketplace(subject, context.req.query('workspaceId') ?? '', context.req.query('query') ?? '')
    return context.json({ data })
  })

  app.get('/api/v1/prompt-templates/:promptTemplateId', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').prompts.get(subject, context.req.param('promptTemplateId'))
    return context.json({ data })
  })

  app.patch('/api/v1/prompt-templates/:promptTemplateId', async (context) => {
    const subject = context.get('subject')
    const body = updatePromptTemplateSchema.parse(await context.req.json())
    const data = await context.get('services').prompts.update(subject, context.req.param('promptTemplateId'), body)
    return context.json({ data })
  })

  app.delete('/api/v1/prompt-templates/:promptTemplateId', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').prompts.delete(subject, context.req.param('promptTemplateId'))
    return context.json({ data })
  })

  app.get('/api/v1/prompt-templates/:promptTemplateId/shares', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').prompts.shares(subject, context.req.param('promptTemplateId'))
    return context.json({ data })
  })

  app.post('/api/v1/prompt-templates/:promptTemplateId/shares', async (context) => {
    const subject = context.get('subject')
    const body = shareResourceSchema.parse(await context.req.json())
    const data = await context.get('services').prompts.share({
      subject,
      promptTemplateId: context.req.param('promptTemplateId'),
      share: body
    })
    return context.json({ data }, 201)
  })
}
