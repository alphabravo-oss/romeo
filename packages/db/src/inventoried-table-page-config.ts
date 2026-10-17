import type { NativeInventoriedTableResource } from "@romeo/core";
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

import {
  backgroundJobs,
  governanceExportArtifacts,
  governanceExportJobs,
  notificationDeliveries,
  toolCalls,
  usageEvents,
  userNotifications,
} from "./schema";

export interface NativeField {
  column: SQLWrapper;
  kind: "date" | "number" | "string";
}

export interface NativeTableConfig {
  actorColumn?: SQLWrapper;
  createdColumn: SQLWrapper;
  fields: Readonly<Record<string, NativeField>>;
  orgColumn: SQLWrapper;
  parentColumn?: SQLWrapper;
  searchExpression: SQLWrapper;
  selection: Readonly<Record<string, SQLWrapper>>;
  table: SQLWrapper;
}

export const nativeTableConfigs: Record<
  NativeInventoriedTableResource,
  NativeTableConfig
> = {
  background_jobs: config({
    table: backgroundJobs,
    orgColumn: backgroundJobs.orgId,
    createdColumn: backgroundJobs.createdAt,
    searchExpression: searchText(
      backgroundJobs.id,
      backgroundJobs.type,
      backgroundJobs.status,
    ),
    selection: {
      id: backgroundJobs.id,
      orgId: backgroundJobs.orgId,
      workspaceId: backgroundJobs.workspaceId,
      type: backgroundJobs.type,
      status: backgroundJobs.status,
      createdAt: backgroundJobs.createdAt,
      updatedAt: backgroundJobs.updatedAt,
      completedAt: backgroundJobs.completedAt,
    },
    fields: {
      id: field(backgroundJobs.id, "string"),
      type: field(backgroundJobs.type, "string"),
      status: field(backgroundJobs.status, "string"),
      createdAt: field(backgroundJobs.createdAt, "date"),
    },
  }),
  governance_export_packages: governanceExportConfig(),
  notification_deliveries: config({
    table: notificationDeliveries,
    orgColumn: notificationDeliveries.orgId,
    actorColumn: notificationDeliveries.userId,
    createdColumn: notificationDeliveries.createdAt,
    searchExpression: searchText(
      notificationDeliveries.id,
      notificationDeliveries.status,
      notificationDeliveries.errorCode,
    ),
    selection: {
      id: notificationDeliveries.id,
      orgId: notificationDeliveries.orgId,
      userId: notificationDeliveries.userId,
      notificationId: notificationDeliveries.notificationId,
      channelId: notificationDeliveries.channelId,
      status: notificationDeliveries.status,
      attemptCount: notificationDeliveries.attemptCount,
      errorCode: notificationDeliveries.errorCode,
      createdAt: notificationDeliveries.createdAt,
      updatedAt: notificationDeliveries.updatedAt,
      deliveredAt: notificationDeliveries.deliveredAt,
    },
    fields: {
      id: field(notificationDeliveries.id, "string"),
      status: field(notificationDeliveries.status, "string"),
      errorCode: field(notificationDeliveries.errorCode, "string"),
      attemptCount: field(notificationDeliveries.attemptCount, "number"),
      createdAt: field(notificationDeliveries.createdAt, "date"),
    },
  }),
  notifications: config({
    table: userNotifications,
    orgColumn: userNotifications.orgId,
    actorColumn: userNotifications.userId,
    createdColumn: userNotifications.createdAt,
    searchExpression: searchText(
      userNotifications.id,
      userNotifications.type,
      userNotifications.resourceId,
    ),
    selection: {
      id: userNotifications.id,
      orgId: userNotifications.orgId,
      userId: userNotifications.userId,
      type: userNotifications.type,
      actorId: userNotifications.actorId,
      resourceType: userNotifications.resourceType,
      resourceId: userNotifications.resourceId,
      readAt: userNotifications.readAt,
      createdAt: userNotifications.createdAt,
    },
    fields: {
      id: field(userNotifications.id, "string"),
      type: field(userNotifications.type, "string"),
      resourceId: field(userNotifications.resourceId, "string"),
      createdAt: field(userNotifications.createdAt, "date"),
    },
  }),
  support_access_requests: supportRequestConfig(),
  support_sessions: supportSessionConfig(),
  tool_trace_calls: config({
    table: toolCalls,
    orgColumn: toolCalls.orgId,
    parentColumn: toolCalls.agentId,
    createdColumn: toolCalls.startedAt,
    searchExpression: searchText(
      toolCalls.id,
      toolCalls.toolId,
      toolCalls.runId,
      toolCalls.errorCode,
    ),
    selection: {
      id: toolCalls.id,
      orgId: toolCalls.orgId,
      workspaceId: toolCalls.workspaceId,
      agentId: toolCalls.agentId,
      actorId: toolCalls.actorId,
      toolId: toolCalls.toolId,
      status: toolCalls.status,
      riskLevel: toolCalls.riskLevel,
      approvalRequired: toolCalls.approvalRequired,
      inputKeys: toolCalls.inputKeys,
      outputKeys: toolCalls.outputKeys,
      errorCode: toolCalls.errorCode,
      runId: toolCalls.runId,
      startedAt: toolCalls.startedAt,
      completedAt: toolCalls.completedAt,
    },
    fields: {
      id: field(toolCalls.id, "string"),
      toolId: field(toolCalls.toolId, "string"),
      status: field(toolCalls.status, "string"),
      errorCode: field(toolCalls.errorCode, "string"),
      runId: field(toolCalls.runId, "string"),
      startedAt: field(toolCalls.startedAt, "date"),
      completedAt: field(toolCalls.completedAt, "date"),
    },
  }),
  usage_events: config({
    table: usageEvents,
    orgColumn: usageEvents.orgId,
    createdColumn: usageEvents.createdAt,
    searchExpression: searchText(usageEvents.id, usageEvents.metric),
    selection: {
      id: usageEvents.id,
      orgId: usageEvents.orgId,
      workspaceId: usageEvents.workspaceId,
      actorId: usageEvents.actorId,
      sourceType: usageEvents.sourceType,
      sourceId: usageEvents.sourceId,
      metric: usageEvents.metric,
      quantity: usageEvents.quantity,
      unit: usageEvents.unit,
      createdAt: usageEvents.createdAt,
    },
    fields: {
      id: field(usageEvents.id, "string"),
      metric: field(usageEvents.metric, "string"),
      quantity: field(usageEvents.quantity, "number"),
      createdAt: field(usageEvents.createdAt, "date"),
    },
  }),
};

function governanceExportConfig(): NativeTableConfig {
  const column = (name: string) =>
    sql`governance_export_rows.${sql.identifier(name)}`;
  const table = sql`(
    select job.id as "id", job.id as "packageId", job.org_id as "orgId",
      job.request as "request",
      case
        when job.state = 'artifact_ready'
          and (
            artifact.id is null
            or artifact.deleted_at is not null
            or artifact.expires_at <= now()
          ) then 'expired'
        else job.state
      end as "state",
      job.percent as "percent",
      coalesce((job.checkpoint ->> 'processedRows')::integer, 0)
        as "processedRows",
      job.lease_attempt as "attemptCount", job.counts as "counts",
      job.limits as "limits", job.warnings as "warnings",
      job.exclusions as "exclusions", job.error_code as "errorCode",
      job.created_at as "createdAt", job.updated_at as "updatedAt",
      job.completed_at as "completedAt", artifact.expires_at as "expiresAt",
      artifact.object_key as "__objectKey",
      artifact.content_type as "__contentType",
      artifact.file_name as "__fileName",
      artifact.size_bytes as "__sizeBytes",
      artifact.sha256 as "__sha256"
    from ${governanceExportJobs} job
    left join ${governanceExportArtifacts} artifact
      on artifact.org_id = job.org_id and artifact.job_id = job.id
    where job.deleted_at is null
  ) as governance_export_rows`;
  return config({
    table,
    orgColumn: column("orgId"),
    createdColumn: column("createdAt"),
    searchExpression: searchText(column("id"), column("packageId")),
    selection: Object.fromEntries(
      [
        "id",
        "packageId",
        "orgId",
        "request",
        "state",
        "percent",
        "processedRows",
        "attemptCount",
        "counts",
        "limits",
        "warnings",
        "exclusions",
        "errorCode",
        "createdAt",
        "updatedAt",
        "completedAt",
        "expiresAt",
        "__objectKey",
        "__contentType",
        "__fileName",
        "__sizeBytes",
        "__sha256",
      ].map((name) => [name, column(name)]),
    ),
    fields: {
      id: field(column("id"), "string"),
      packageId: field(column("packageId"), "string"),
      state: field(column("state"), "string"),
      percent: field(column("percent"), "number"),
      processedRows: field(column("processedRows"), "number"),
      attemptCount: field(column("attemptCount"), "number"),
      createdAt: field(column("createdAt"), "date"),
    },
  });
}

function supportRequestConfig(): NativeTableConfig {
  const column = (name: string) =>
    sql`support_request_rows.${sql.identifier(name)}`;
  const table = sql`(
    select created.resource_id as "id", created.org_id as "orgId",
      created.actor_id as "requestedByUserId",
      coalesce(created.metadata ->> 'targetUserId', '') as "targetUserId",
      coalesce((created.metadata ->> 'ttlMinutes')::integer, 15) as "ttlMinutes",
      created.metadata ->> 'ticketRef' as "ticketRef",
      created.metadata ->> 'reasonHash' as "reasonHash",
      (created.metadata ->> 'reasonLength')::integer as "reasonLength",
      created.created_at as "createdAt",
      case when decision.action = 'support.impersonation.request.approve' then 'approved'
        when decision.action = 'support.impersonation.request.reject' then 'rejected'
        else 'pending' end as "status",
      case when decision.action = 'support.impersonation.request.approve' then decision.created_at end as "approvedAt",
      case when decision.action = 'support.impersonation.request.approve' then decision.actor_id end as "approvedByUserId",
      case when decision.action = 'support.impersonation.request.approve' then decision.resource_id end as "sessionId",
      case when decision.action = 'support.impersonation.request.reject' then decision.created_at end as "rejectedAt",
      case when decision.action = 'support.impersonation.request.reject' then decision.actor_id end as "rejectedByUserId"
    from audit_logs created
    left join lateral (
      select decided.action, decided.actor_id, decided.resource_id, decided.created_at
      from audit_logs decided
      where decided.org_id = created.org_id
        and decided.action in ('support.impersonation.request.approve', 'support.impersonation.request.reject')
        and decided.metadata ->> 'approvalRequestId' = created.resource_id
      order by decided.created_at desc, decided.id desc limit 1
    ) decision on true
    where created.action = 'support.impersonation.request.create'
      and created.resource_type = 'support_impersonation_request'
  ) as support_request_rows`;
  return config({
    table,
    orgColumn: column("orgId"),
    createdColumn: column("createdAt"),
    searchExpression: searchText(
      column("id"),
      column("targetUserId"),
      column("requestedByUserId"),
    ),
    selection: Object.fromEntries(
      [
        "id",
        "requestedByUserId",
        "targetUserId",
        "ttlMinutes",
        "ticketRef",
        "reasonHash",
        "reasonLength",
        "createdAt",
        "status",
        "approvedAt",
        "approvedByUserId",
        "sessionId",
        "rejectedAt",
        "rejectedByUserId",
      ].map((name) => [name, column(name)]),
    ),
    fields: {
      id: field(column("id"), "string"),
      targetUserId: field(column("targetUserId"), "string"),
      requestedByUserId: field(column("requestedByUserId"), "string"),
      status: field(column("status"), "string"),
      createdAt: field(column("createdAt"), "date"),
    },
  });
}

function supportSessionConfig(): NativeTableConfig {
  const column = (name: string) =>
    sql`support_session_rows.${sql.identifier(name)}`;
  const table = sql`(
    select session.id as "id", session.org_id as "orgId",
      session.created_at as "createdAt", created.actor_id as "adminUserId",
      coalesce(created.metadata ->> 'targetUserId', session.user_id) as "targetUserId",
      created.metadata ->> 'approvalRequestId' as "approvalRequestId",
      created.metadata ->> 'requestedByUserId' as "requestedByUserId",
      (created.metadata ->> 'ttlMinutes')::integer as "ttlMinutes",
      created.metadata ->> 'ticketRef' as "ticketRef",
      created.metadata ->> 'reasonHash' as "reasonHash",
      (created.metadata ->> 'reasonLength')::integer as "reasonLength",
      created.id as "createdAuditLogId",
      case when session.revoked_at is not null then 'revoked'
        when session.expires_at <= now() then 'expired' else 'active' end as "status",
      jsonb_strip_nulls(jsonb_build_object(
        'id', session.id, 'orgId', session.org_id, 'userId', session.user_id,
        'name', session.name, 'scopes', session.scopes, 'isAdmin', session.is_admin,
        'expiresAt', session.expires_at, 'revokedAt', session.revoked_at,
        'lastSeenAt', session.last_seen_at, 'createdAt', session.created_at
      )) as "session"
    from audit_logs created
    join user_sessions session on session.org_id = created.org_id
      and session.id = created.resource_id
    where created.action = 'support.impersonation.create'
      and created.resource_type = 'session'
  ) as support_session_rows`;
  return config({
    table,
    orgColumn: column("orgId"),
    createdColumn: column("createdAt"),
    searchExpression: searchText(
      column("id"),
      column("targetUserId"),
      column("adminUserId"),
    ),
    selection: Object.fromEntries(
      [
        "id",
        "createdAt",
        "adminUserId",
        "targetUserId",
        "approvalRequestId",
        "requestedByUserId",
        "ttlMinutes",
        "ticketRef",
        "reasonHash",
        "reasonLength",
        "createdAuditLogId",
        "status",
        "session",
      ].map((name) => [name, column(name)]),
    ),
    fields: {
      id: field(column("id"), "string"),
      targetUserId: field(column("targetUserId"), "string"),
      adminUserId: field(column("adminUserId"), "string"),
      status: field(column("status"), "string"),
      createdAt: field(column("createdAt"), "date"),
    },
  });
}

function config(value: NativeTableConfig): NativeTableConfig {
  return value;
}

function field(column: SQLWrapper, kind: NativeField["kind"]): NativeField {
  return { column, kind };
}

function searchText(...columns: SQLWrapper[]): SQL {
  return sql`lower(${sql.join(
    columns.map((column) => sql`coalesce(${column}, '')`),
    sql` || chr(31) || `,
  )})`;
}
