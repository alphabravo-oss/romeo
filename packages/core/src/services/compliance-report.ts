import type { AuthSubject } from '@romeo/auth'

import type { ComplianceControl, ComplianceReport, RetentionPolicy } from '../domain/entities'
import type { RomeoRepository } from '../domain/repository'

export async function buildComplianceReport(repository: RomeoRepository, subject: AuthSubject): Promise<ComplianceReport> {
  const generatedAt = new Date().toISOString()
  const workspaces = await repository.listWorkspaces(subject.orgId)
  const [
    configuredRetention,
    auditLogs,
    resourceGrants,
    apiKeys,
    serviceAccounts,
    usageEvents,
    jobs,
    dataConnectors,
    dataConnectorSyncs,
    toolCalls,
    webhookSubscriptions,
    webhookDeliveries,
    workflowDefinitions,
    workflowRuns,
    quotaBuckets,
    billingPlan
  ] = await Promise.all([
    repository.getRetentionPolicy(subject.orgId),
    repository.listAuditLogs(subject.orgId),
    repository.listResourceGrants(subject.orgId),
    repository.listApiKeys(subject.orgId),
    repository.listServiceAccounts(subject.orgId),
    repository.listUsageEvents(subject.orgId),
    repository.listBackgroundJobs(subject.orgId),
    repository.listDataConnectors(subject.orgId),
    repository.listDataConnectorSyncs(subject.orgId),
    repository.listToolCalls(subject.orgId),
    repository.listWebhookSubscriptions(subject.orgId),
    repository.listWebhookDeliveries(subject.orgId),
    repository.listWorkflowDefinitions(subject.orgId),
    repository.listWorkflowRuns(subject.orgId),
    repository.listQuotaBuckets(subject.orgId),
    repository.getBillingPlan(subject.orgId)
  ])
  const workspaceCounts = await workspaceAggregateCounts(repository, workspaces.map((workspace) => workspace.id))
  const retention = configuredRetention ?? defaultRetention(subject, generatedAt)

  return {
    schema: 'romeo.compliance-report.v1',
    orgId: subject.orgId,
    generatedAt,
    controls: [
      control('retention_policy', 'Audit retention policy', configuredRetention === undefined ? 'attention' : 'pass', {
        configured: configuredRetention !== undefined,
        auditLogRetentionDays: retention.auditLogRetentionDays,
        updatedAt: retention.updatedAt
      }),
      control('audit_log_coverage', 'Audit log coverage', 'informational', {
        auditLogCount: auditLogs.length,
        uniqueActionCount: new Set(auditLogs.map((log) => log.action)).size,
        latestAuditAt: auditLogs[0]?.createdAt ?? null
      }),
      control('access_review', 'Access review surface', resourceGrants.length > 0 ? 'pass' : 'attention', {
        resourceGrantCount: resourceGrants.length,
        userGrantCount: resourceGrants.filter((grant) => grant.principalType === 'user').length,
        serviceAccountGrantCount: resourceGrants.filter((grant) => grant.principalType === 'service_account').length,
        groupGrantCount: resourceGrants.filter((grant) => grant.principalType === 'group').length
      }),
      control('credential_inventory', 'Credential inventory', 'informational', {
        apiKeyCount: apiKeys.length,
        revokedApiKeyCount: apiKeys.filter((key) => key.revokedAt !== undefined).length,
        serviceAccountCount: serviceAccounts.length,
        disabledServiceAccountCount: serviceAccounts.filter((account) => account.disabledAt !== undefined).length
      }),
      control('quota_controls', 'Quota controls', quotaBuckets.length > 0 ? 'pass' : 'attention', {
        quotaBucketCount: quotaBuckets.length,
        exceededQuotaCount: quotaBuckets.filter((bucket) => bucket.used > bucket.limit).length
      }),
      control('workspace_inventory', 'Workspace inventory', 'informational', {
        workspaceCount: workspaces.length,
        agentCount: workspaceCounts.agentCount,
        chatCount: workspaceCounts.chatCount,
        knowledgeBaseCount: workspaceCounts.knowledgeBaseCount
      }),
      control('connector_governance', 'Connector governance', 'informational', {
        dataConnectorCount: dataConnectors.length,
        scheduledConnectorCount: dataConnectors.filter((connector) => connector.syncIntervalMinutes !== undefined).length,
        connectorSyncCount: dataConnectorSyncs.length,
        failedConnectorSyncCount: dataConnectorSyncs.filter((sync) => sync.status === 'failed').length
      }),
      control('automation_and_tooling', 'Automation and tooling', 'informational', {
        backgroundJobCount: jobs.length,
        failedBackgroundJobCount: jobs.filter((job) => job.status === 'failed').length,
        toolCallCount: toolCalls.length,
        failedToolCallCount: toolCalls.filter((call) => call.status === 'failure').length
      }),
      control('webhook_delivery', 'Webhook delivery', webhookDeliveries.some((delivery) => delivery.status === 'failed') ? 'attention' : 'pass', {
        webhookSubscriptionCount: webhookSubscriptions.length,
        webhookDeliveryCount: webhookDeliveries.length,
        failedWebhookDeliveryCount: webhookDeliveries.filter((delivery) => delivery.status === 'failed').length
      }),
      control('workflow_governance', 'Workflow governance', 'informational', {
        workflowDefinitionCount: workflowDefinitions.length,
        workflowRunCount: workflowRuns.length,
        waitingWorkflowRunCount: workflowRuns.filter((run) => run.status === 'waiting_approval').length
      }),
      control('billing_controls', 'Billing controls', billingPlan === undefined ? 'informational' : 'pass', {
        billingPlanConfigured: billingPlan !== undefined,
        billingPlanStatus: billingPlan?.status ?? null
      }),
      control('usage_evidence', 'Usage evidence', 'informational', {
        usageEventCount: usageEvents.length,
        uniqueUsageMetricCount: new Set(usageEvents.map((event) => event.metric)).size
      })
    ]
  }
}

export function complianceReportCsv(report: ComplianceReport): string {
  return [
    ['schema', 'org_id', 'generated_at', 'control_id', 'title', 'status', 'evidence_json'],
    ...report.controls.map((controlRow) => [
      report.schema,
      report.orgId,
      report.generatedAt,
      controlRow.id,
      controlRow.title,
      controlRow.status,
      JSON.stringify(controlRow.evidence)
    ])
  ].map((row) => row.map(csvCell).join(',')).join('\n') + '\n'
}

function control(id: string, title: string, status: ComplianceControl['status'], evidence: ComplianceControl['evidence']): ComplianceControl {
  return { id, title, status, evidence }
}

async function workspaceAggregateCounts(repository: RomeoRepository, workspaceIds: string[]): Promise<{
  agentCount: number
  chatCount: number
  knowledgeBaseCount: number
}> {
  const rows = await Promise.all(
    workspaceIds.map(async (workspaceId) => {
      const [agents, chats, knowledgeBases] = await Promise.all([
        repository.listAgents(workspaceId),
        repository.listChats(workspaceId),
        repository.listKnowledgeBases(workspaceId)
      ])
      return { agentCount: agents.length, chatCount: chats.length, knowledgeBaseCount: knowledgeBases.length }
    })
  )
  return rows.reduce(
    (total, row) => ({
      agentCount: total.agentCount + row.agentCount,
      chatCount: total.chatCount + row.chatCount,
      knowledgeBaseCount: total.knowledgeBaseCount + row.knowledgeBaseCount
    }),
    { agentCount: 0, chatCount: 0, knowledgeBaseCount: 0 }
  )
}

function defaultRetention(subject: AuthSubject, generatedAt: string): RetentionPolicy {
  return {
    orgId: subject.orgId,
    auditLogRetentionDays: 365,
    updatedBy: subject.id,
    updatedAt: generatedAt
  }
}

function csvCell(value: string): string {
  if (!/[",\n\r]/u.test(value)) return value
  return `"${value.replace(/"/gu, '""')}"`
}
