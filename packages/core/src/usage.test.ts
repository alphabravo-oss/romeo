import { describe, expect, it } from 'vitest'

import { createRomeoApi } from './api'
import { InMemoryRomeoRepository } from './repositories/in-memory'

describe('Romeo usage summaries', () => {
  it('aggregates run usage by metric, actor, and provider', async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository())
    const pricingResponse = await api.request('/api/v1/models/model_openai_compatible_default/pricing', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputTokenUsd: 0.001, outputTokenUsd: 0.002 })
    })
    const chatResponse = await api.request('/api/v1/chats', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'workspace_default', title: 'Usage summary' })
    })
    const chat = await chatResponse.json()

    const runResponse = await api.request('/api/v1/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: chat.data.id, agentId: 'agent_default', content: 'Summarize this usage.' })
    })
    const run = await runResponse.json()

    const summary = await waitForCompletedSummary(api)
    const eventsResponse = await api.request('/api/v1/usage/events')
    const events = await eventsResponse.json()
    const exportResponse = await api.request('/api/v1/usage/events.csv')
    const exportedCsv = await exportResponse.text()

    expect(pricingResponse.status).toBe(200)
    expect(runResponse.status).toBe(202)
    expect(exportResponse.status).toBe(200)
    expect(exportResponse.headers.get('content-type')).toContain('text/csv')
    expect(exportedCsv).toContain('id,createdAt,actorId,workspaceId,sourceType,sourceId,metric,quantity,unit,providerId,modelId,agentId,estimatedCostUsd')
    expect(exportedCsv).toContain('llm.input_token.estimated')
    expect(exportedCsv).toContain('llm.input_token.reported')
    expect(exportedCsv).not.toContain('{')
    expect(summary.totals.some((item) => item.metric === 'run.started' && item.quantity === 1)).toBe(true)
    expect(summary.totals.some((item) => item.metric === 'run.completed' && item.quantity === 1)).toBe(true)
    expect(summary.totals.some((item) => item.metric === 'llm.input_token.estimated' && item.quantity > 0 && item.estimatedCostUsd > 0)).toBe(true)
    expect(summary.totals.some((item) => item.metric === 'llm.output_token.estimated' && item.quantity > 0 && item.estimatedCostUsd > 0)).toBe(true)
    expect(summary.totals.some((item) => item.metric === 'llm.input_token.reported' && item.quantity > 0 && item.estimatedCostUsd > 0)).toBe(true)
    expect(summary.totals.some((item) => item.metric === 'llm.output_token.reported' && item.quantity > 0 && item.estimatedCostUsd > 0)).toBe(true)
    expect(summary.totals.some((item) => item.metric === 'llm.total_token.reported' && item.quantity > 0)).toBe(true)
    expect(summary.byActor.some((item) => item.actorId === 'user_dev_admin' && item.metric === 'run.started')).toBe(true)
    expect(summary.byProvider.some((item) => item.providerId === 'provider_openai_compatible' && item.metric === 'run.started')).toBe(true)
    expect(summary.byProvider.some((item) => item.providerId === 'provider_openai_compatible' && item.metric === 'llm.input_token.estimated')).toBe(true)
    expect(summary.byProvider.some((item) => item.providerId === 'provider_openai_compatible' && item.metric === 'llm.input_token.reported')).toBe(true)
    expect(events.data.some((event: { metric: string; metadata: Record<string, unknown> }) => event.metric === 'llm.total_token.reported' && event.metadata.usageSource === 'dev-echo')).toBe(true)
    expect(run.data.id).toMatch(/^run_/)
  })

  it('reports quota usage alerts without persisting alert rows', async () => {
    const repository = new InMemoryRomeoRepository()
    const now = new Date().toISOString()
    await repository.createQuotaBucket({
      id: 'quota_warning',
      orgId: 'org_default',
      scopeType: 'workspace',
      scopeId: 'workspace_default',
      metric: 'storage.byte',
      limit: 100,
      used: 80,
      resetInterval: 'none',
      createdAt: now,
      updatedAt: now
    })
    await repository.createQuotaBucket({
      id: 'quota_critical',
      orgId: 'org_default',
      scopeType: 'agent',
      scopeId: 'agent_default',
      metric: 'tool.call',
      limit: 10,
      used: 9,
      resetInterval: 'daily',
      resetAt: new Date(Date.now() + 86_400_000).toISOString(),
      createdAt: now,
      updatedAt: now
    })
    const api = createRomeoApi(repository)

    const response = await api.request('/api/v1/usage/alerts')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toHaveLength(2)
    expect(body.data[0].severity).toBe('critical')
    expect(body.data[0].metric).toBe('tool.call')
    expect(body.data[1]).toMatchObject({ severity: 'warning', metric: 'storage.byte', percentUsed: 0.8 })
  })
})

async function waitForCompletedSummary(api: ReturnType<typeof createRomeoApi>) {
  let summary: {
    totals: Array<{ metric: string; quantity: number; estimatedCostUsd: number }>
    byActor: Array<{ actorId: string; metric: string }>
    byProvider: Array<{ providerId: string; metric: string }>
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await api.request('/api/v1/usage/summary')
    const body = await response.json()
    summary = body.data
    if (summary.totals.some((item) => item.metric === 'run.completed')) return summary
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return summary!
}
