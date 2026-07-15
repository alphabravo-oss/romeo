import type { QuotaBucket, UsageAlert } from '../domain/entities'

export function createQuotaUsageAlerts(buckets: QuotaBucket[]): UsageAlert[] {
  return buckets
    .map(toAlert)
    .filter((alert): alert is UsageAlert => alert !== undefined)
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || right.percentUsed - left.percentUsed)
}

function toAlert(bucket: QuotaBucket): UsageAlert | undefined {
  if (bucket.limit <= 0) return undefined
  const percentUsed = bucket.used / bucket.limit
  const severity = severityFor(percentUsed)
  if (severity === undefined) return undefined
  const alert: UsageAlert = {
    id: `usage_alert_${bucket.id}`,
    scopeType: bucket.scopeType,
    scopeId: bucket.scopeId,
    metric: bucket.metric,
    used: bucket.used,
    limit: bucket.limit,
    percentUsed,
    severity
  }
  if (bucket.resetAt !== undefined) alert.resetAt = bucket.resetAt
  return alert
}

function severityFor(percentUsed: number): UsageAlert['severity'] | undefined {
  if (percentUsed > 1) return 'exceeded'
  if (percentUsed >= 0.9) return 'critical'
  if (percentUsed >= 0.8) return 'warning'
  return undefined
}

function severityRank(severity: UsageAlert['severity']): number {
  if (severity === 'exceeded') return 3
  if (severity === 'critical') return 2
  return 1
}
