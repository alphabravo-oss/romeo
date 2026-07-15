import type { AuthSubject } from '@romeo/auth'

import type { QuotaBucket, UsageAlert } from '../domain/entities'
import type { RomeoRepository } from '../domain/repository'
import { ApiError } from '../errors'
import {
  toQuotaReservationBucket,
  type QuotaCoordinator,
} from './quota-coordination'
import { resetDueQuotaBuckets } from './quota-resets'
import { emitWebhookEvent } from './webhook-events'
import type { WebhookEmitter } from './webhook-service'

export async function consumeQuota(
  repository: RomeoRepository,
  subject: AuthSubject,
  input: { agentId?: string; metric: string; providerId?: string; quantity: number; workspaceId?: string },
  options: { quotaCoordinator?: QuotaCoordinator | undefined; webhooks?: WebhookEmitter | undefined } = {}
): Promise<void> {
  const buckets = await resetDueQuotaBuckets(repository, await repository.listQuotaBuckets(subject.orgId))
  const matching = buckets.filter((bucket) => bucket.metric === input.metric && matchesQuotaScope(bucket, subject, input))

  for (const bucket of matching) {
    if (bucket.used + input.quantity > bucket.limit) {
      throw new ApiError('quota_exceeded', `Quota exceeded for ${input.metric}.`, 429, {
        metric: input.metric,
        limit: bucket.limit,
        used: bucket.used,
        requested: input.quantity
      })
    }
  }

  const reservation =
    options.quotaCoordinator === undefined
      ? undefined
      : await options.quotaCoordinator.reserve({
          buckets: matching.map(toQuotaReservationBucket),
          quantity: input.quantity
        })
  if (reservation?.allowed === false) {
    const bucket = matching.find((item) => item.id === reservation.bucketId)
    throw new ApiError('quota_exceeded', `Quota exceeded for ${input.metric}.`, 429, {
      metric: input.metric,
      limit: reservation.limit,
      used: reservation.used,
      requested: input.quantity,
      ...(bucket === undefined ? {} : { quotaBucketId: bucket.id, scopeType: bucket.scopeType })
    })
  }
  const reservedUsage = new Map(
    reservation?.allowed === true
      ? reservation.reservations.map((item) => [item.bucketId, item.used])
      : []
  )
  const updated = await Promise.all(
    matching.map(async (bucket) => ({
      before: bucket,
      after: await repository.updateQuotaBucket({
        ...bucket,
        used: Math.max(bucket.used + input.quantity, reservedUsage.get(bucket.id) ?? 0),
        updatedAt: new Date().toISOString()
      })
    }))
  )
  for (const bucket of updated) emitQuotaAlert(subject, bucket.before, bucket.after, options.webhooks)
}

function matchesQuotaScope(
  bucket: { scopeId: string; scopeType: string },
  subject: AuthSubject,
  input: { agentId?: string; providerId?: string; workspaceId?: string }
): boolean {
  if (bucket.scopeType === 'org') return bucket.scopeId === subject.orgId
  if (bucket.scopeType === 'user') return bucket.scopeId === subject.id
  if (bucket.scopeType === 'workspace') return bucket.scopeId === input.workspaceId
  if (bucket.scopeType === 'provider') return bucket.scopeId === input.providerId
  if (bucket.scopeType === 'agent') return bucket.scopeId === input.agentId
  if (bucket.scopeType === 'api_key') return bucket.scopeId === subject.apiKeyId
  return false
}

function emitQuotaAlert(subject: AuthSubject, before: QuotaBucket, after: QuotaBucket, webhooks: WebhookEmitter | undefined): void {
  const severity = severityFor(after)
  if (severity === undefined || severityRank(severity) <= severityRank(severityFor(before))) return
  emitWebhookEvent(webhooks, {
    orgId: after.orgId,
    eventType: 'quota.alert',
    payload: {
      quotaBucketId: after.id,
      actorId: subject.id,
      scopeType: after.scopeType,
      scopeId: after.scopeId,
      metric: after.metric,
      used: after.used,
      limit: after.limit,
      percentUsed: after.used / after.limit,
      severity,
      resetAt: after.resetAt
    }
  })
}

function severityFor(bucket: QuotaBucket): UsageAlert['severity'] | undefined {
  if (bucket.limit <= 0) return undefined
  const percentUsed = bucket.used / bucket.limit
  if (percentUsed > 1) return 'exceeded'
  if (percentUsed >= 0.9) return 'critical'
  if (percentUsed >= 0.8) return 'warning'
  return undefined
}

function severityRank(severity: UsageAlert['severity'] | undefined): number {
  if (severity === 'exceeded') return 3
  if (severity === 'critical') return 2
  if (severity === 'warning') return 1
  return 0
}
