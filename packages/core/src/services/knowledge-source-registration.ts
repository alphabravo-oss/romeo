import type { AuthSubject } from '@romeo/auth'
import { canExtractKnowledgeText } from '@romeo/rag'

import type { KnowledgeBase, KnowledgeSource } from '../domain/entities'
import type { RomeoRepository } from '../domain/repository'
import { ApiError } from '../errors'
import { createId } from '../ids'
import { assertAbuseControlsAllow } from './abuse-control-service'
import { consumeQuota } from './consume-quota'
import { isDeferredExtractionMimeType } from './knowledge-extraction-worker'
import type { QuotaCoordinator } from './quota-coordination'
import type { WebhookEmitter } from './webhook-service'

export async function registerKnowledgeSource(
  repository: RomeoRepository,
  subject: AuthSubject,
  knowledgeBase: KnowledgeBase,
  input: { fileName: string; metadata?: Record<string, unknown>; mimeType: string; sizeBytes: number },
  options: { quotaCoordinator?: QuotaCoordinator | undefined; webhooks?: WebhookEmitter | undefined } = {}
): Promise<KnowledgeSource> {
  const mimeType = normalizeMimeType(input.mimeType)
  if (!canExtractKnowledgeText(mimeType) && !isDeferredExtractionMimeType(mimeType)) {
    throw new ApiError('unsupported_media_type', 'Knowledge source type is not supported yet.', 415, { mimeType: input.mimeType })
  }
  await assertAbuseControlsAllow(repository, subject, {
    action: 'knowledge.ingest',
    workspaceId: knowledgeBase.workspaceId,
    workerClass: 'knowledge.ingest'
  })
  await consumeQuota(repository, subject, { metric: 'storage.byte', quantity: input.sizeBytes, workspaceId: knowledgeBase.workspaceId }, { quotaCoordinator: options.quotaCoordinator, webhooks: options.webhooks })
  const now = new Date().toISOString()
  const sourceId = createId('kb_source')
  return repository.createKnowledgeSource({
    id: sourceId,
    knowledgeBaseId: knowledgeBase.id,
    orgId: knowledgeBase.orgId,
    workspaceId: knowledgeBase.workspaceId,
    fileName: input.fileName,
    mimeType,
    sizeBytes: input.sizeBytes,
    status: 'pending',
    objectKey: `knowledge/${knowledgeBase.id}/${sourceId}/${input.fileName}`,
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now
  })
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}
