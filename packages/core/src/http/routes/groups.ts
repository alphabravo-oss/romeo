import type { RomeoApi } from '../context'
import { addGroupMemberSchema, createGroupSchema } from '../schemas'

export function registerGroupRoutes(app: RomeoApi): void {
  app.get('/api/v1/groups', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').groups.list(subject)
    return context.json({ data })
  })

  app.post('/api/v1/groups', async (context) => {
    const subject = context.get('subject')
    const body = createGroupSchema.parse(await context.req.json())
    const data = await context.get('services').groups.create({ subject, name: body.name, slug: body.slug })
    return context.json({ data }, 201)
  })

  app.get('/api/v1/groups/:groupId/members', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').groups.members(subject, context.req.param('groupId'))
    return context.json({ data })
  })

  app.post('/api/v1/groups/:groupId/members', async (context) => {
    const subject = context.get('subject')
    const body = addGroupMemberSchema.parse(await context.req.json())
    const data = await context.get('services').groups.addMember({ subject, groupId: context.req.param('groupId'), userId: body.userId })
    return context.json({ data }, 201)
  })

  app.delete('/api/v1/groups/:groupId/members/:userId', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').groups.removeMember({
      subject,
      groupId: context.req.param('groupId'),
      userId: context.req.param('userId')
    })
    return context.json({ data })
  })
}
