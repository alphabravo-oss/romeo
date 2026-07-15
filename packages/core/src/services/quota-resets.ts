import type { QuotaBucket } from '../domain/entities'
import type { RomeoRepository } from '../domain/repository'

export async function resetDueQuotaBuckets(
  repository: RomeoRepository,
  buckets: QuotaBucket[],
  now = new Date()
): Promise<QuotaBucket[]> {
  const updated: QuotaBucket[] = []
  for (const bucket of buckets) {
    if (bucket.resetAt === undefined || new Date(bucket.resetAt).getTime() > now.getTime()) {
      updated.push(bucket)
      continue
    }
    const resetAt = nextResetAt(bucket.resetInterval, now)
    const resetBucket: QuotaBucket = {
      ...bucket,
      used: 0,
      updatedAt: now.toISOString()
    }
    if (resetAt === undefined) delete resetBucket.resetAt
    else resetBucket.resetAt = resetAt
    updated.push(await repository.updateQuotaBucket(resetBucket))
  }
  return updated
}

export function nextResetAt(interval: QuotaBucket['resetInterval'], from = new Date()): string | undefined {
  if (interval === 'none') return undefined
  const next = new Date(from)
  if (interval === 'daily') next.setUTCDate(next.getUTCDate() + 1)
  if (interval === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1)
  return next.toISOString()
}
