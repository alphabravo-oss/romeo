import type { RomeoApi } from '../context'
import { approveWorkflowRunSchema, createWorkflowFromTemplateSchema, createWorkflowSchema, startWorkflowRunSchema } from '../schemas'

export function registerWorkflowRoutes(app: RomeoApi): void {
  app.get('/api/v1/workflow-templates', async (context) => {
    const subject = context.get('subject')
    const data = context.get('services').workflows.listTemplates(subject)
    return context.json({ data })
  })

  app.post('/api/v1/workflow-templates/:templateId/create', async (context) => {
    const subject = context.get('subject')
    const body = createWorkflowFromTemplateSchema.parse(await context.req.json())
    const data = await context.get('services').workflows.createFromTemplate({
      subject,
      templateId: context.req.param('templateId'),
      workspaceId: body.workspaceId,
      ...(body.agentId === undefined ? {} : { agentId: body.agentId }),
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.schedule === undefined ? {} : { schedule: body.schedule })
    })
    return context.json({ data }, 201)
  })

  app.get('/api/v1/workflows', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').workflows.list(subject, context.req.query('workspaceId'))
    return context.json({ data })
  })

  app.post('/api/v1/workflows', async (context) => {
    const subject = context.get('subject')
    const body = createWorkflowSchema.parse(await context.req.json())
    const data = await context.get('services').workflows.create({
      subject,
      workspaceId: body.workspaceId,
      name: body.name,
      ...(body.description === undefined ? {} : { description: body.description }),
      steps: body.steps,
      ...(body.schedule === undefined ? {} : { schedule: body.schedule })
    })
    return context.json({ data }, 201)
  })

  app.post('/api/v1/workflows/schedules/run-due', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').workflows.runDueSchedules(subject)
    return context.json({ data })
  })

  app.get('/api/v1/workflows/:workflowId/runs', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').workflows.listRuns(subject, context.req.param('workflowId'))
    return context.json({ data })
  })

  app.post('/api/v1/workflows/:workflowId/runs', async (context) => {
    const subject = context.get('subject')
    const body = startWorkflowRunSchema.parse(await context.req.json().catch(() => ({})))
    const data = await context.get('services').workflows.startRun({
      subject,
      workflowId: context.req.param('workflowId'),
      ...(body.input === undefined ? {} : { runInput: body.input })
    })
    return context.json({ data }, 201)
  })

  app.post('/api/v1/workflow-runs/:workflowRunId/approve', async (context) => {
    const subject = context.get('subject')
    const body = approveWorkflowRunSchema.parse(await context.req.json().catch(() => ({})))
    const data = await context.get('services').workflows.approve({
      subject,
      workflowRunId: context.req.param('workflowRunId'),
      ...(body.comment === undefined ? {} : { comment: body.comment })
    })
    return context.json({ data })
  })

  app.post('/api/v1/workflow-runs/:workflowRunId/resume', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').workflows.resume({
      subject,
      workflowRunId: context.req.param('workflowRunId')
    })
    return context.json({ data })
  })
}
