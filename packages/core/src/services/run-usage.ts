import type { BaseModel, ProviderTokenUsage } from '@romeo/providers'

import type { RunRecord } from '../domain/entities'
import type { RomeoRepository } from '../domain/repository'
import { recordUsage } from './record-usage'

export async function recordRunStartedUsage(
  repository: RomeoRepository,
  input: { run: RunRecord; inputText: string; model: BaseModel }
): Promise<void> {
  const metadata = runMetadata(input.run)
  const inputTokens = estimateTokens(input.inputText)
  await Promise.all([
    recordUsage(repository, {
      orgId: input.run.orgId,
      workspaceId: input.run.workspaceId,
      actorId: input.run.createdBy,
      sourceType: 'run',
      sourceId: input.run.id,
      metric: 'run.started',
      quantity: 1,
      unit: 'run',
      metadata
    }),
    recordUsage(repository, {
      orgId: input.run.orgId,
      workspaceId: input.run.workspaceId,
      actorId: input.run.createdBy,
      sourceType: 'run',
      sourceId: input.run.id,
      metric: 'llm.input_token.estimated',
      quantity: inputTokens,
      unit: 'token',
      metadata: withCost(metadata, costFor(input.model, 'input', inputTokens))
    })
  ])
}

export async function recordRunTerminalUsage(
  repository: RomeoRepository,
  input: { run: RunRecord; status: RunRecord['status']; assistantContent: string; model: BaseModel; providerUsage?: ProviderTokenUsage }
): Promise<void> {
  const metadata = runMetadata(input.run)
  const writes: Array<Promise<unknown>> = [
    recordUsage(repository, {
      orgId: input.run.orgId,
      workspaceId: input.run.workspaceId,
      actorId: input.run.createdBy,
      sourceType: 'run' as const,
      sourceId: input.run.id,
      metric: `run.${input.status}`,
      quantity: 1,
      unit: 'run',
      metadata
    })
  ]

  if (input.assistantContent.length > 0) {
    const outputTokens = estimateTokens(input.assistantContent)
    writes.push(
      recordUsage(repository, {
        orgId: input.run.orgId,
        workspaceId: input.run.workspaceId,
        actorId: input.run.createdBy,
        sourceType: 'run',
        sourceId: input.run.id,
        metric: 'llm.output_token.estimated',
        quantity: outputTokens,
        unit: 'token',
        metadata: withCost(metadata, costFor(input.model, 'output', outputTokens))
      })
    )
  }

  if (input.providerUsage !== undefined) {
    writes.push(...reportedUsageEvents(repository, input.run, input.model, metadata, input.providerUsage))
  }

  await Promise.all(writes)
}

function reportedUsageEvents(
  repository: RomeoRepository,
  run: RunRecord,
  model: BaseModel,
  metadata: Record<string, unknown>,
  usage: ProviderTokenUsage
): Array<Promise<unknown>> {
  const usageMetadata = { ...metadata, usageSource: usage.source ?? 'provider' }
  const writes: Array<Promise<unknown>> = []
  if (usage.inputTokens !== undefined) writes.push(recordTokenUsage(repository, run, model, usageMetadata, 'input', usage.inputTokens, 'llm.input_token.reported'))
  if (usage.outputTokens !== undefined) writes.push(recordTokenUsage(repository, run, model, usageMetadata, 'output', usage.outputTokens, 'llm.output_token.reported'))
  if (usage.totalTokens !== undefined) {
    writes.push(
      recordUsage(repository, {
        orgId: run.orgId,
        workspaceId: run.workspaceId,
        actorId: run.createdBy,
        sourceType: 'run',
        sourceId: run.id,
        metric: 'llm.total_token.reported',
        quantity: usage.totalTokens,
        unit: 'token',
        metadata: usageMetadata
      })
    )
  }
  return writes
}

function recordTokenUsage(
  repository: RomeoRepository,
  run: RunRecord,
  model: BaseModel,
  metadata: Record<string, unknown>,
  side: 'input' | 'output',
  tokens: number,
  metric: string
): Promise<unknown> {
  return recordUsage(repository, {
    orgId: run.orgId,
    workspaceId: run.workspaceId,
    actorId: run.createdBy,
    sourceType: 'run',
    sourceId: run.id,
    metric,
    quantity: tokens,
    unit: 'token',
    metadata: withCost(metadata, costFor(model, side, tokens))
  })
}

function runMetadata(run: RunRecord): Record<string, unknown> {
  return { providerId: run.providerId, modelId: run.modelId, agentId: run.agentId, agentVersionId: run.agentVersionId }
}

function estimateTokens(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return Math.max(1, Math.ceil(trimmed.length / 4))
}

function costFor(model: BaseModel, side: 'input' | 'output', tokens: number): number | undefined {
  const unitCost = side === 'input' ? model.pricing?.inputTokenUsd : model.pricing?.outputTokenUsd
  if (unitCost === undefined) return undefined
  return unitCost * tokens
}

function withCost(metadata: Record<string, unknown>, estimatedCostUsd: number | undefined): Record<string, unknown> {
  if (estimatedCostUsd === undefined) return metadata
  return { ...metadata, estimatedCostUsd }
}
