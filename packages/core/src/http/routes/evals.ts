import type { RomeoApi } from '../context'
import { compareEvalModelsSchema, createEvalSuiteSchema, rateEvalResultSchema, runEvalSuiteSchema } from '../schemas'

export function registerEvalRoutes(app: RomeoApi): void {
  app.get('/api/v1/agents/:agentId/eval-suites', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').evals.listSuites(subject, context.req.param('agentId'))
    return context.json({ data })
  })

  app.post('/api/v1/eval-suites', async (context) => {
    const subject = context.get('subject')
    const body = createEvalSuiteSchema.parse(await context.req.json())
    const data = await context.get('services').evals.createSuite({
      subject,
      agentId: body.agentId,
      name: body.name,
      cases: body.cases.map((testCase) => ({
        input: testCase.input,
        ...(testCase.expectedContains !== undefined ? { expectedContains: testCase.expectedContains } : {}),
        ...(testCase.rubric !== undefined ? { rubric: testCase.rubric } : {}),
        ...(testCase.requiresCitation !== undefined ? { requiresCitation: testCase.requiresCitation } : {})
      }))
    })
    return context.json({ data }, 201)
  })

  app.get('/api/v1/agents/:agentId/eval-runs', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').evals.listRuns(subject, context.req.param('agentId'))
    return context.json({ data })
  })

  app.get('/api/v1/agents/:agentId/eval-dashboard', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').evals.dashboard(subject, context.req.param('agentId'))
    return context.json({ data })
  })

  app.get('/api/v1/agents/:agentId/eval-release-candidate-evidence', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').evals.releaseCandidateEvidence(subject, context.req.param('agentId'))
    return context.json({ data })
  })

  app.post('/api/v1/eval-suites/:suiteId/runs', async (context) => {
    const subject = context.get('subject')
    const body = runEvalSuiteSchema.parse(await context.req.json().catch(() => ({})))
    const data = await context.get('services').evals.runSuite({
      subject,
      suiteId: context.req.param('suiteId'),
      ...(body.modelId !== undefined ? { modelId: body.modelId } : {})
    })
    return context.json({ data }, 202)
  })

  app.post('/api/v1/eval-suites/:suiteId/model-comparisons', async (context) => {
    const subject = context.get('subject')
    const body = compareEvalModelsSchema.parse(await context.req.json())
    const data = await context.get('services').evals.compareModels({
      subject,
      suiteId: context.req.param('suiteId'),
      modelIds: body.modelIds
    })
    return context.json({ data }, 202)
  })

  app.get('/api/v1/eval-runs/:runId/results', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').evals.results(subject, context.req.param('runId'))
    return context.json({ data })
  })

  app.get('/api/v1/eval-runs/:runId/ratings', async (context) => {
    const subject = context.get('subject')
    const data = await context.get('services').evals.ratings(subject, context.req.param('runId'))
    return context.json({ data })
  })

  app.post('/api/v1/eval-run-results/:resultId/rating', async (context) => {
    const subject = context.get('subject')
    const body = rateEvalResultSchema.parse(await context.req.json())
    const data = await context.get('services').evals.rateResult({
      subject,
      resultId: context.req.param('resultId'),
      rating: body.rating,
      ...(body.comment === undefined ? {} : { comment: body.comment })
    })
    return context.json({ data })
  })
}
