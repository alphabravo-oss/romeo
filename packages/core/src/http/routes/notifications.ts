import type { RomeoApi } from '../context'
import { createNotificationChannelSchema, updateNotificationPolicySchema } from '../schemas'

export function registerNotificationRoutes(app: RomeoApi): void {
  app.get('/api/v1/notifications', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').notifications.list(subject)
    return context.json({ data })
  })

  app.post('/api/v1/notifications/:notificationId/read', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').notifications.markRead(subject, context.req.param('notificationId'))
    return context.json({ data })
  })

  app.get('/api/v1/notification-channels', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').notifications.channels(subject)
    return context.json({ data })
  })

  app.post('/api/v1/notification-channels', async (context) => {
    const subject = context.get('subject')
    const body = createNotificationChannelSchema.parse(await context.req.json())
    const data = await context.get('services').notifications.createChannel({ subject, type: body.type, name: body.name, config: body.config })
    return context.json({ data }, 201)
  })

  app.get('/api/v1/notification-deliveries', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').notifications.deliveries(subject)
    return context.json({ data })
  })

  app.post('/api/v1/notification-deliveries/retry-due', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').notifications.retryDueDeliveries(subject)
    return context.json({ data }, 202)
  })

  app.get('/api/v1/admin/notification-policy', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').notifications.policy(subject)
    return context.json({ data })
  })

  app.patch('/api/v1/admin/notification-policy', async (context) => {
    const subject = context.get('subject')
    const body = updateNotificationPolicySchema.parse(await context.req.json())
    const data = await context.get('services').notifications.updatePolicy({ subject, policy: body })
    return context.json({ data })
  })
}
