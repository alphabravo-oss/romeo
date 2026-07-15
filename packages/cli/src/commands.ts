import type {
  AuditLogFilter,
  BillingPlanQuotaTemplate,
  FolderItemResourceType,
  RomeoApiClient,
  RunEvent,
  Scope,
  SsoOidcProviderPresetId,
  UpdateNotificationPolicyInput,
} from "@romeo/api-client";
import { basename } from "node:path";

import { flagValue, hasFlag, type ParsedArgs } from "./args";
import type { CliIo } from "./io";
import { writeJson, writeLine } from "./io";
import {
  runBillingEntitlementReconciliationWorker,
  runBillingLifecycleEnforcementWorker,
} from "./billing-worker";
import { runBrowserAutomationWorker } from "./browser-automation-worker";
import { runDataConnectorSyncWorker } from "./data-connector-worker";
import { runKnowledgeExtractionWorker } from "./knowledge-worker";
import { runNotificationRetryWorker } from "./notification-worker";
import { runRetentionEnforcementWorker } from "./retention-worker";
import {
  createSecretValueResolver,
  type SecretValueResolverDriver,
} from "./secret-resolver";
import {
  runToolDispatchWorker,
  type ToolDispatchPayload,
  type ToolDispatchPayloadAuth,
} from "./tool-dispatch-worker";
import { runVoiceCatalogSyncWorker } from "./voice-worker";
import { runWebhookRetryWorker } from "./webhook-worker";
import { runWorkflowResumeWorker } from "./workflow-worker";

export interface CommandContext {
  client: RomeoApiClient;
  dnsLookup?: (
    host: string,
  ) => Promise<Array<{ address: string; family?: number }>>;
  fetchImpl: typeof fetch;
  io: CliIo;
  parsed: ParsedArgs;
  readFile: (path: string) => Promise<Uint8Array>;
}

export async function executeCommand(context: CommandContext): Promise<number> {
  const [area, action, ...rest] = context.parsed.positionals;
  if (area === undefined || hasFlag(context.parsed.flags, "help", "h")) {
    printUsage(context.io);
    return 0;
  }

  if (area === "health")
    return jsonResult(context, context.client.system.health());
  if (area === "audit" && action === "list") return auditList(context);
  if (area === "audit" && action === "export") return auditExport(context);
  if (area === "billing" && action === "plan")
    return jsonResult(context, context.client.admin.billingPlan());
  if (area === "billing" && action === "entitlements")
    return jsonResult(context, context.client.admin.billingEntitlements());
  if (area === "billing" && action === "reconcile-entitlements")
    return jsonResult(
      context,
      context.client.admin.reconcileBillingEntitlements(),
    );
  if (area === "billing" && action === "lifecycle")
    return jsonResult(context, context.client.admin.billingLifecycle());
  if (area === "billing" && action === "enforce-lifecycle")
    return jsonResult(context, context.client.admin.enforceBillingLifecycle());
  if (area === "billing" && action === "apply-plan")
    return applyBillingPlan(context);
  if (area === "billing" && action === "sync-external")
    return syncExternalBilling(context);
  if (area === "access-review" && action === "export")
    return accessReviewExport(context);
  if (area === "access-review")
    return jsonResult(context, context.client.governance.accessReview());
  if (area === "workspaces" && action === "archive")
    return jsonResult(
      context,
      context.client.system.archiveWorkspace(
        requiredFlag(context.parsed, "workspace", "workspace-id"),
      ),
    );
  if (area === "workspaces" && action === "export")
    return jsonResult(
      context,
      context.client.system.exportWorkspace(
        requiredFlag(context.parsed, "workspace", "workspace-id"),
      ),
    );
  if (area === "readiness")
    return jsonResult(context, context.client.admin.readiness());
  if (area === "jobs" && action === "list")
    return jsonResult(context, context.client.admin.jobs());
  if (area === "jobs" && action === "summary")
    return jsonResult(context, context.client.admin.jobOperationalSummary());
  if (area === "providers" && action === "summary")
    return jsonResult(
      context,
      context.client.admin.providerOperationalSummary(),
    );
  if (area === "sso" && action === "settings")
    return jsonResult(context, context.client.admin.ssoSettings());
  if (area === "sso" && action === "update")
    return updateSsoSettingsCommand(context);
  if (area === "sso" && action === "test")
    return jsonResult(context, context.client.admin.testSsoSettings());
  if (area === "sso" && action === "deprovision-oidc")
    return deprovisionOidcUserCommand(context);
  if (area === "users" && action === "list")
    return jsonResult(context, context.client.admin.users());
  if (area === "users" && action === "disable")
    return jsonResult(
      context,
      context.client.admin.disableUser(
        requiredFlag(context.parsed, "user", "user-id"),
      ),
    );
  if (area === "groups" && action === "list")
    return jsonResult(context, context.client.admin.groups());
  if (area === "groups" && action === "create") return createGroup(context);
  if (area === "groups" && action === "members")
    return jsonResult(
      context,
      context.client.admin.groupMembers(requiredFlag(context.parsed, "group")),
    );
  if (area === "groups" && action === "add-member")
    return addGroupMember(context);
  if (area === "groups" && action === "remove-member") {
    return jsonResult(
      context,
      context.client.admin.removeGroupMember(
        requiredFlag(context.parsed, "group"),
        requiredFlag(context.parsed, "user", "user-id"),
      ),
    );
  }
  if (area === "gallery" && action === "agents")
    return jsonResult(
      context,
      context.client.collaboration.agentGallery(
        flagValue(context.parsed.flags, "workspace", "workspace-id"),
      ),
    );
  if (area === "favorites" && action === "list")
    return jsonResult(context, context.client.collaboration.favorites());
  if (area === "favorites" && action === "agent")
    return jsonResult(
      context,
      context.client.collaboration.favorite({
        resourceType: "agent",
        resourceId: requiredFlag(context.parsed, "agent", "agent-id"),
      }),
    );
  if (area === "prompts" && action === "list")
    return jsonResult(
      context,
      context.client.collaboration.promptTemplates(
        requiredFlag(context.parsed, "workspace", "workspace-id"),
        flagValue(context.parsed.flags, "query", "q"),
      ),
    );
  if (area === "prompts" && action === "marketplace")
    return jsonResult(
      context,
      context.client.collaboration.promptMarketplace(
        requiredFlag(context.parsed, "workspace", "workspace-id"),
        flagValue(context.parsed.flags, "query", "q"),
      ),
    );
  if (area === "prompts" && action === "create")
    return createPromptTemplate(context);
  if (area === "prompts" && action === "update")
    return updatePromptTemplate(context);
  if (area === "folders" && action === "list")
    return jsonResult(
      context,
      context.client.collaboration.folders(
        requiredFlag(context.parsed, "workspace", "workspace-id"),
      ),
    );
  if (area === "folders" && action === "create") return createFolder(context);
  if (area === "folders" && action === "share")
    return shareFolderCommand(context);
  if (area === "folders" && action === "items")
    return jsonResult(
      context,
      context.client.collaboration.folderItems(
        requiredFlag(context.parsed, "folder", "folder-id"),
      ),
    );
  if (area === "folders" && action === "add-item")
    return addFolderItem(context);
  if (area === "folders" && action === "delete-item") {
    return jsonResult(
      context,
      context.client.collaboration.deleteFolderItem(
        requiredFlag(context.parsed, "folder", "folder-id"),
        requiredFlag(context.parsed, "item", "item-id"),
      ),
    );
  }
  if (area === "share" && action === "targets")
    return shareTargetsCommand(context);
  if (area === "share" && action === "agent") return shareAgentCommand(context);
  if (area === "share" && action === "chat") return shareChatCommand(context);
  if (area === "share" && action === "kb")
    return shareKnowledgeBaseCommand(context);
  if (area === "share" && action === "prompt")
    return sharePromptTemplateCommand(context);
  if (area === "comments" && action === "list")
    return jsonResult(
      context,
      context.client.chatApi.comments(
        requiredFlag(context.parsed, "chat", "chat-id"),
      ),
    );
  if (area === "comments" && action === "create")
    return createChatComment(context);
  if (area === "notifications" && action === "list")
    return jsonResult(context, context.client.notifications.list());
  if (area === "notifications" && action === "read")
    return jsonResult(
      context,
      context.client.notifications.markRead(
        requiredFlag(context.parsed, "notification", "notification-id"),
      ),
    );
  if (area === "notifications" && action === "channels")
    return jsonResult(context, context.client.notifications.channels());
  if (area === "notifications" && action === "channel-create")
    return createNotificationChannel(context);
  if (area === "notifications" && action === "deliveries")
    return jsonResult(context, context.client.notifications.deliveries());
  if (area === "notifications" && action === "retry-due")
    return jsonResult(context, context.client.notifications.retryDue());
  if (area === "notifications" && action === "policy")
    return jsonResult(context, context.client.notifications.policy());
  if (area === "notifications" && action === "policy-update")
    return updateNotificationPolicy(context);
  if (area === "voices" && action === "list")
    return jsonResult(context, context.client.voice.list());
  if (area === "voices" && action === "sync")
    return jsonResult(context, context.client.voice.sync());
  if (area === "connectors" && action === "list")
    return jsonResult(
      context,
      context.client.dataConnectors.list(
        flagValue(context.parsed.flags, "workspace", "workspace-id"),
      ),
    );
  if (area === "connectors" && action === "create-local")
    return createLocalConnector(context);
  if (area === "connectors" && action === "create-website")
    return createWebsiteConnector(context);
  if (area === "connectors" && action === "create-rss")
    return createRssConnector(context);
  if (area === "connectors" && action === "create-s3")
    return createS3Connector(context);
  if (area === "connectors" && action === "sync-local")
    return syncLocalConnector(context);
  if (area === "connectors" && action === "sync")
    return jsonResult(
      context,
      context.client.dataConnectors.sync({
        connectorId: requiredFlag(context.parsed, "connector", "connector-id"),
      }),
    );
  if (area === "devices" && action === "list")
    return jsonResult(context, context.client.deviceAuthorizations.list());
  if (area === "devices" && action === "create")
    return createDeviceAuthorization(context);
  if (area === "devices" && action === "refresh")
    return jsonResult(
      context,
      context.client.deviceAuthorizations.refresh(
        requiredFlag(context.parsed, "refresh-token"),
      ),
    );
  if (area === "devices" && action === "revoke")
    return jsonResult(
      context,
      context.client.deviceAuthorizations.revoke(
        requiredFlag(context.parsed, "device", "device-authorization"),
      ),
    );
  if (area === "sessions" && action === "list")
    return jsonResult(context, context.client.sessions.list());
  if (area === "sessions" && action === "create") return createSession(context);
  if (area === "sessions" && action === "impersonate")
    return createSupportSession(context);
  if (area === "sessions" && action === "impersonation-report")
    return jsonResult(context, context.client.sessions.supportSessionReports());
  if (area === "sessions" && action === "impersonation-requests")
    return jsonResult(
      context,
      context.client.sessions.supportSessionRequests(),
    );
  if (area === "sessions" && action === "request-impersonation")
    return requestSupportSession(context);
  if (area === "sessions" && action === "approve-impersonation")
    return approveSupportSessionRequest(context);
  if (area === "sessions" && action === "reject-impersonation")
    return rejectSupportSessionRequest(context);
  if (area === "sessions" && action === "revoke-current")
    return jsonResult(context, context.client.sessions.revokeCurrent());
  if (area === "evals" && action === "list")
    return jsonResult(
      context,
      context.client.evals.suites(
        requiredFlag(context.parsed, "agent", "agent-id"),
      ),
    );
  if (area === "evals" && action === "runs")
    return jsonResult(
      context,
      context.client.evals.runs(
        requiredFlag(context.parsed, "agent", "agent-id"),
      ),
    );
  if (area === "evals" && action === "dashboard")
    return jsonResult(
      context,
      context.client.evals.dashboard(
        requiredFlag(context.parsed, "agent", "agent-id"),
      ),
    );
  if (area === "evals" && action === "create") return createEvalSuite(context);
  if (area === "evals" && action === "run")
    return jsonResult(
      context,
      context.client.evals.runSuite(
        requiredFlag(context.parsed, "suite", "suite-id"),
      ),
    );
  if (area === "evals" && action === "compare-models")
    return compareEvalModels(context);
  if (area === "evals" && action === "ratings")
    return jsonResult(
      context,
      context.client.evals.ratings(
        requiredFlag(context.parsed, "run", "run-id"),
      ),
    );
  if (area === "evals" && action === "rate") return rateEvalResult(context);
  if (area === "governance" && action === "retention")
    return governanceRetention(context);
  if (area === "governance" && action === "retention-enforce")
    return jsonResult(context, context.client.governance.enforceRetention());
  if (area === "governance" && action === "data-delete-preview")
    return governanceDataDeletePreview(context);
  if (area === "governance" && action === "data-delete")
    return governanceDataDelete(context);
  if (area === "governance" && action === "compliance-report")
    return jsonResult(context, context.client.governance.complianceReport());
  if (area === "governance" && action === "compliance-report-export")
    return complianceReportExport(context);
  if (area === "models" && action === "list")
    return jsonResult(context, context.client.provider.models());
  if (area === "models" && action === "sync")
    return jsonResult(
      context,
      context.client.provider.syncModels(
        requiredFlag(context.parsed, "provider", "provider-id"),
      ),
    );
  if (area === "agents" && action === "list") return listAgents(context);
  if (area === "tools" && action === "auth-check")
    return jsonResult(
      context,
      context.client.tool.checkConnectorAuth(
        requiredFlag(context.parsed, "connector", "connector-id"),
      ),
    );
  if (area === "tools" && action === "connector-enable")
    return jsonResult(
      context,
      context.client.tool.updateConnector({
        connectorId: requiredFlag(context.parsed, "connector", "connector-id"),
        enabled: true,
      }),
    );
  if (area === "tools" && action === "connector-disable")
    return jsonResult(
      context,
      context.client.tool.updateConnector({
        connectorId: requiredFlag(context.parsed, "connector", "connector-id"),
        enabled: false,
      }),
    );
  if (area === "tools" && action === "operation-enable")
    return updateToolOperation(context, true);
  if (area === "tools" && action === "operation-disable")
    return updateToolOperation(context, false);
  if (area === "tools" && action === "operation-dispatch")
    return dispatchToolOperation(context);
  if (area === "tools" && action === "operation-enqueue")
    return enqueueToolOperation(context);
  if (area === "tools" && action === "dispatch-request-claim")
    return claimToolDispatchRequest(context);
  if (area === "tools" && action === "dispatch-request-renew")
    return renewToolDispatchRequest(context);
  if (area === "tools" && action === "dispatch-requests-expire")
    return expireToolDispatchRequests(context);
  if (area === "tools" && action === "dispatch-request-complete")
    return completeToolDispatchRequest(context);
  if (area === "tools" && action === "dispatch-request-fail")
    return failToolDispatchRequest(context);
  if (area === "tools" && action === "dispatch-request-cancel")
    return cancelToolDispatchRequest(context);
  if (area === "agent" && action === "export") return exportAgent(context);
  if (area === "agent" && action === "import") return importAgent(context);
  if (area === "chat" && action === "archive") return archiveChat(context);
  if (area === "chat" && action === "legal-hold")
    return updateChatLegalHold(context);
  if (area === "chat" && action === "legal-hold-clear")
    return clearChatLegalHold(context);
  if (area === "chat" && action === "run") return runChat(context, rest);
  if (area === "knowledge" && action === "upload")
    return uploadKnowledgeFile(context);
  if (area === "knowledge" && action === "extract")
    return extractKnowledgeFile(context);
  if (area === "knowledge" && action === "index-embeddings")
    return indexKnowledgeEmbeddings(context);
  if (area === "webhooks" && action === "list")
    return jsonResult(context, context.client.webhooks.list());
  if (area === "webhooks" && action === "create") return createWebhook(context);
  if (area === "webhooks" && action === "disable")
    return disableWebhook(context);
  if (area === "webhooks" && action === "deliveries")
    return webhookDeliveries(context);
  if (area === "webhooks" && action === "retry-due")
    return jsonResult(context, context.client.webhooks.retryDue());
  if (area === "webhooks" && action === "test") return testWebhook(context);
  if (area === "workflows" && action === "list")
    return jsonResult(
      context,
      context.client.workflows.list(
        flagValue(context.parsed.flags, "workspace", "workspace-id"),
      ),
    );
  if (area === "workflows" && action === "templates")
    return jsonResult(context, context.client.workflows.templates());
  if (area === "workflows" && action === "create-template")
    return createWorkflowFromTemplate(context);
  if (area === "workflows" && action === "create")
    return createWorkflow(context);
  if (area === "workflows" && action === "run-due-schedules")
    return jsonResult(context, context.client.workflows.runDueSchedules());
  if (area === "workflows" && action === "run")
    return jsonResult(
      context,
      context.client.workflows.startRun(
        requiredFlag(context.parsed, "workflow"),
      ),
    );
  if (area === "workflows" && action === "approve")
    return approveWorkflow(context);
  if (area === "workflows" && action === "resume")
    return jsonResult(
      context,
      context.client.workflows.resumeRun(
        requiredFlag(context.parsed, "run", "workflow-run"),
      ),
    );
  if (area === "workflows" && action === "browser-task-claim")
    return claimBrowserAutomationTask(context);
  if (area === "workflows" && action === "browser-task-renew")
    return renewBrowserAutomationTask(context);
  if (area === "workflows" && action === "browser-artifact-upload")
    return uploadBrowserAutomationArtifact(context);
  if (area === "workflows" && action === "browser-tasks-expire")
    return expireBrowserAutomationTasks(context);
  if (area === "workflows" && action === "browser-task-complete")
    return completeBrowserAutomationTask(context);
  if (area === "workflows" && action === "browser-task-fail")
    return failBrowserAutomationTask(context);
  if (area === "workers" && action === "webhook-retry")
    return webhookRetryWorker(context);
  if (area === "workers" && action === "notification-retry")
    return notificationRetryWorker(context);
  if (area === "workers" && action === "knowledge-extraction")
    return knowledgeExtractionWorker(context);
  if (area === "workers" && action === "data-connector-sync")
    return dataConnectorSyncWorker(context);
  if (area === "workers" && action === "tool-dispatch")
    return toolDispatchWorker(context);
  if (area === "workers" && action === "browser-automation")
    return browserAutomationWorker(context);
  if (area === "workers" && action === "voice-catalog-sync")
    return voiceCatalogSyncWorker(context);
  if (area === "workers" && action === "workflow-resume")
    return workflowResumeWorker(context);
  if (area === "workers" && action === "retention-enforce")
    return retentionEnforcementWorker(context);
  if (area === "workers" && action === "billing-entitlement-reconcile")
    return billingEntitlementReconciliationWorker(context);
  if (area === "workers" && action === "billing-lifecycle-enforce")
    return billingLifecycleEnforcementWorker(context);

  throw new CliUsageError(
    `Unknown command: ${context.parsed.positionals.join(" ")}`,
  );
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

function listAgents(context: CommandContext): Promise<number> {
  const workspaceId = flagValue(
    context.parsed.flags,
    "workspace",
    "workspace-id",
  );
  return jsonResult(context, context.client.agent.list(workspaceId));
}

function auditList(context: CommandContext): Promise<number> {
  return jsonResult(
    context,
    context.client.admin.auditLogs(auditFilter(context)),
  );
}

async function auditExport(context: CommandContext): Promise<number> {
  const csv = await context.client.admin.auditLogsCsv(auditFilter(context));
  context.io.stdout.write(csv);
  return 0;
}

async function accessReviewExport(context: CommandContext): Promise<number> {
  const csv = await context.client.governance.accessReviewCsv();
  context.io.stdout.write(csv);
  return 0;
}

function updateSsoSettingsCommand(context: CommandContext): Promise<number> {
  if (
    hasFlag(context.parsed.flags, "enable") &&
    hasFlag(context.parsed.flags, "disable")
  ) {
    throw new CliUsageError("Use either --enable or --disable, not both.");
  }
  const enabled = hasFlag(context.parsed.flags, "enable")
    ? true
    : hasFlag(context.parsed.flags, "disable")
      ? false
      : undefined;
  const adminGroups = optionalCsvFlag(context.parsed, "admin-groups");
  const groupMap = optionalMappingFlag(context.parsed, "group-map");
  const workspaceGroupMap = optionalMappingFlag(
    context.parsed,
    "workspace-group-map",
  );
  return jsonResult(
    context,
    context.client.admin.updateSsoSettings({
      oidc: {
        ...(enabled === undefined ? {} : { enabled }),
        ...(flagValue(context.parsed.flags, "issuer-url") === undefined
          ? {}
          : { issuerUrl: requiredFlag(context.parsed, "issuer-url") }),
        ...(flagValue(context.parsed.flags, "client-id") === undefined
          ? {}
          : { clientId: requiredFlag(context.parsed, "client-id") }),
        ...(flagValue(context.parsed.flags, "group-claim") === undefined
          ? {}
          : { groupClaim: requiredFlag(context.parsed, "group-claim") }),
        ...(adminGroups === undefined ? {} : { adminGroups }),
        ...(groupMap === undefined ? {} : { groupMap }),
        ...(workspaceGroupMap === undefined ? {} : { workspaceGroupMap }),
        ...(flagValue(context.parsed.flags, "workspace-group-prefix") ===
        undefined
          ? {}
          : {
              workspaceGroupPrefix: requiredFlag(
                context.parsed,
                "workspace-group-prefix",
              ),
            }),
        ...(flagValue(context.parsed.flags, "provider-preset") === undefined
          ? {}
          : {
              providerPreset: requiredFlag(
                context.parsed,
                "provider-preset",
              ) as SsoOidcProviderPresetId,
            }),
      },
    }),
  );
}

function deprovisionOidcUserCommand(context: CommandContext): Promise<number> {
  const issuerUrl = flagValue(context.parsed.flags, "issuer-url");
  return jsonResult(
    context,
    context.client.admin.deprovisionOidcUser({
      oidcSubject: requiredFlag(context.parsed, "oidc-subject", "subject"),
      confirmOidcSubject: requiredFlag(
        context.parsed,
        "confirm-oidc-subject",
        "confirm-subject",
      ),
      ...(issuerUrl === undefined ? {} : { issuerUrl }),
    }),
  );
}

async function complianceReportExport(
  context: CommandContext,
): Promise<number> {
  const csv = await context.client.governance.complianceReportCsv();
  context.io.stdout.write(csv);
  return 0;
}

function governanceRetention(context: CommandContext): Promise<number> {
  const days = flagValue(context.parsed.flags, "days");
  if (days !== undefined)
    return jsonResult(
      context,
      context.client.governance.updateRetentionPolicy({
        auditLogRetentionDays: Number(days),
      }),
    );
  return jsonResult(context, context.client.governance.retentionPolicy());
}

function governanceDataDeletePreview(context: CommandContext): Promise<number> {
  return jsonResult(
    context,
    context.client.governance.previewDataDeletion({
      resourceType: "chat",
      resourceId: requiredFlag(context.parsed, "chat", "chat-id"),
    }),
  );
}

function governanceDataDelete(context: CommandContext): Promise<number> {
  const resourceId = requiredFlag(context.parsed, "chat", "chat-id");
  return jsonResult(
    context,
    context.client.governance.executeDataDeletion({
      resourceType: "chat",
      resourceId,
      confirmResourceId: requiredFlag(context.parsed, "confirm"),
    }),
  );
}

function applyBillingPlan(context: CommandContext): Promise<number> {
  const status = flagValue(context.parsed.flags, "status");
  const source = flagValue(context.parsed.flags, "source");
  const externalCustomerId = flagValue(
    context.parsed.flags,
    "external-customer",
  );
  const externalSubscriptionId = flagValue(
    context.parsed.flags,
    "external-subscription",
  );
  return jsonResult(
    context,
    context.client.admin.applyBillingPlan({
      code: requiredFlag(context.parsed, "code"),
      name: requiredFlag(context.parsed, "name"),
      quotaTemplates: billingQuotaTemplates(context.parsed),
      ...(status === undefined ? {} : { status: billingPlanStatus(status) }),
      ...(source === undefined ? {} : { source: billingPlanSource(source) }),
      ...(externalCustomerId === undefined ? {} : { externalCustomerId }),
      ...(externalSubscriptionId === undefined
        ? {}
        : { externalSubscriptionId }),
    }),
  );
}

function syncExternalBilling(context: CommandContext): Promise<number> {
  const status = flagValue(context.parsed.flags, "status");
  const externalCustomerId = flagValue(
    context.parsed.flags,
    "external-customer",
  );
  const externalSubscriptionId = flagValue(
    context.parsed.flags,
    "external-subscription",
  );
  const externalInvoiceId = flagValue(context.parsed.flags, "external-invoice");
  const invoiceStatus = flagValue(context.parsed.flags, "invoice-status");
  const amountCents = optionalNonNegativeIntegerFlag(
    context.parsed,
    "amount-cents",
  );
  const currency = flagValue(context.parsed.flags, "currency");
  const occurredAt = flagValue(context.parsed.flags, "occurred-at");
  const planCode = flagValue(context.parsed.flags, "plan-code", "code");
  const planName = flagValue(context.parsed.flags, "plan-name", "name");
  const quotaTemplates = billingQuotaTemplates(context.parsed, false);
  return jsonResult(
    context,
    context.client.admin.syncExternalBillingEvent({
      provider: requiredFlag(context.parsed, "provider"),
      eventType: billingExternalEventType(
        requiredFlag(context.parsed, "event", "event-type"),
      ),
      ...(externalCustomerId === undefined ? {} : { externalCustomerId }),
      ...(externalSubscriptionId === undefined
        ? {}
        : { externalSubscriptionId }),
      ...(externalInvoiceId === undefined ? {} : { externalInvoiceId }),
      ...(invoiceStatus === undefined ? {} : { invoiceStatus }),
      ...(amountCents === undefined ? {} : { amountCents }),
      ...(currency === undefined ? {} : { currency }),
      ...(occurredAt === undefined ? {} : { occurredAt }),
      ...(planCode === undefined ? {} : { planCode }),
      ...(planName === undefined ? {} : { planName }),
      ...(status === undefined ? {} : { status: billingPlanStatus(status) }),
      ...(quotaTemplates.length === 0 ? {} : { quotaTemplates }),
    }),
  );
}

function createEvalSuite(context: CommandContext): Promise<number> {
  const agentId = requiredFlag(context.parsed, "agent", "agent-id");
  const name = flagValue(context.parsed.flags, "name") ?? "Golden prompt";
  const input = requiredFlag(context.parsed, "prompt");
  const expectedContains = requiredFlag(context.parsed, "expected");
  const rubric = rubricFromFlags(context.parsed);
  return jsonResult(
    context,
    context.client.evals.createSuite({
      agentId,
      name,
      cases: [
        {
          input,
          expectedContains,
          ...(rubric === undefined ? {} : { rubric }),
        },
      ],
    }),
  );
}

function rateEvalResult(context: CommandContext): Promise<number> {
  const resultId = requiredFlag(context.parsed, "result", "result-id");
  const rating = requiredRating(context.parsed);
  const comment = flagValue(context.parsed.flags, "comment");
  return jsonResult(
    context,
    context.client.evals.rateResult(resultId, {
      rating,
      ...(comment === undefined ? {} : { comment }),
    }),
  );
}

function compareEvalModels(context: CommandContext): Promise<number> {
  const suiteId = requiredFlag(context.parsed, "suite", "suite-id");
  const modelIds = csvFlag(context.parsed, "models", "model-ids");
  if (modelIds.length === 0) throw new CliUsageError("Missing --models.");
  return jsonResult(
    context,
    context.client.evals.compareModels(suiteId, { modelIds }),
  );
}

function shareTargetsCommand(context: CommandContext): Promise<number> {
  return jsonResult(
    context,
    context.client.collaboration.shareTargets(
      flagValue(context.parsed.flags, "query", "q"),
      optionalIntegerFlag(context.parsed, "limit"),
    ),
  );
}

function createPromptTemplate(context: CommandContext): Promise<number> {
  const description = flagValue(context.parsed.flags, "description");
  return jsonResult(
    context,
    context.client.collaboration.createPromptTemplate({
      workspaceId: requiredFlag(context.parsed, "workspace", "workspace-id"),
      name: requiredFlag(context.parsed, "name"),
      body: requiredFlag(context.parsed, "body", "prompt"),
      tags: csvFlag(context.parsed, "tag", "tags"),
      visibility: promptVisibility(
        flagValue(context.parsed.flags, "visibility") ?? "private",
      ),
      ...(description === undefined ? {} : { description }),
    }),
  );
}

function createGroup(context: CommandContext): Promise<number> {
  const slug = flagValue(context.parsed.flags, "slug");
  return jsonResult(
    context,
    context.client.admin.createGroup({
      name: requiredFlag(context.parsed, "name"),
      ...(slug === undefined ? {} : { slug }),
    }),
  );
}

function addGroupMember(context: CommandContext): Promise<number> {
  return jsonResult(
    context,
    context.client.admin.addGroupMember(requiredFlag(context.parsed, "group"), {
      userId: requiredFlag(context.parsed, "user", "user-id"),
    }),
  );
}

function updateToolOperation(
  context: CommandContext,
  enabled: boolean,
): Promise<number> {
  return jsonResult(
    context,
    context.client.tool.updateOperation({
      connectorId: requiredFlag(context.parsed, "connector", "connector-id"),
      operationId: requiredFlag(context.parsed, "operation", "operation-id"),
      enabled,
    }),
  );
}

function dispatchToolOperation(context: CommandContext): Promise<number> {
  const parameters = optionalMappingFlag(context.parsed, "param", "parameter");
  const approvalRequestId = flagValue(
    context.parsed.flags,
    "approval-request",
    "approval-request-id",
  );
  return jsonResult(
    context,
    context.client.tool.dispatchOperation({
      connectorId: requiredFlag(context.parsed, "connector", "connector-id"),
      operationId: requiredFlag(context.parsed, "operation", "operation-id"),
      ...(hasFlag(context.parsed.flags, "approved") ? { approved: true } : {}),
      ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
      ...(parameters === undefined ? {} : { parameters }),
    }),
  );
}

function enqueueToolOperation(context: CommandContext): Promise<number> {
  const parameters = optionalMappingFlag(context.parsed, "param", "parameter");
  const approvalRequestId = flagValue(
    context.parsed.flags,
    "approval-request",
    "approval-request-id",
  );
  const idempotencyKey = flagValue(
    context.parsed.flags,
    "idempotency-key",
    "idempotency",
  );
  return jsonResult(
    context,
    context.client.tool.enqueueDispatchOperation({
      connectorId: requiredFlag(context.parsed, "connector", "connector-id"),
      operationId: requiredFlag(context.parsed, "operation", "operation-id"),
      ...(hasFlag(context.parsed.flags, "approved") ? { approved: true } : {}),
      ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      ...(parameters === undefined ? {} : { parameters }),
    }),
  );
}

function claimToolDispatchRequest(context: CommandContext): Promise<number> {
  const leaseSeconds = optionalIntegerFlag(context.parsed, "lease-seconds");
  return jsonResult(
    context,
    context.client.tool.claimDispatchRequest(
      leaseSeconds === undefined ? {} : { leaseSeconds },
    ),
  );
}

function renewToolDispatchRequest(context: CommandContext): Promise<number> {
  const leaseSeconds = optionalIntegerFlag(context.parsed, "lease-seconds");
  return jsonResult(
    context,
    context.client.tool.renewDispatchRequestLease({
      jobId: requiredFlag(context.parsed, "job"),
      ...(leaseSeconds === undefined ? {} : { leaseSeconds }),
    }),
  );
}

function expireToolDispatchRequests(context: CommandContext): Promise<number> {
  const queuedTimeoutSeconds = optionalIntegerFlag(
    context.parsed,
    "queued-timeout-seconds",
  );
  const runningTimeoutSeconds = optionalIntegerFlag(
    context.parsed,
    "running-timeout-seconds",
  );
  const limit = optionalIntegerFlag(context.parsed, "limit");
  return jsonResult(
    context,
    context.client.tool.expireDispatchRequests({
      ...(queuedTimeoutSeconds === undefined ? {} : { queuedTimeoutSeconds }),
      ...(runningTimeoutSeconds === undefined ? {} : { runningTimeoutSeconds }),
      ...(limit === undefined ? {} : { limit }),
    }),
  );
}

function completeToolDispatchRequest(context: CommandContext): Promise<number> {
  const status = requiredHttpStatusFlag(context.parsed, "status");
  const contentType = flagValue(context.parsed.flags, "content-type");
  const bodyBytes =
    optionalNonNegativeIntegerFlag(context.parsed, "body-bytes") ?? 0;
  const schemaStatus = toolResponseValidationStatus(
    flagValue(context.parsed.flags, "schema-validation") ?? "not_applicable",
  );
  const schemaErrorCode = flagValue(context.parsed.flags, "schema-error-code");
  return jsonResult(
    context,
    context.client.tool.completeDispatchRequest({
      jobId: requiredFlag(context.parsed, "job"),
      response: {
        ok: status >= 200 && status < 300,
        status,
        ...(contentType === undefined ? {} : { contentType }),
        bodyBytes,
        truncated: hasFlag(context.parsed.flags, "truncated"),
        schemaValidation: {
          status: schemaStatus,
          ...(schemaErrorCode === undefined
            ? {}
            : { errorCode: schemaErrorCode }),
        },
      },
    }),
  );
}

function failToolDispatchRequest(context: CommandContext): Promise<number> {
  return jsonResult(
    context,
    context.client.tool.failDispatchRequest({
      jobId: requiredFlag(context.parsed, "job"),
      errorCode: requiredFlag(context.parsed, "error-code"),
    }),
  );
}

function cancelToolDispatchRequest(context: CommandContext): Promise<number> {
  const reasonCode = flagValue(context.parsed.flags, "reason-code", "reason");
  return jsonResult(
    context,
    context.client.tool.cancelDispatchRequest({
      jobId: requiredFlag(context.parsed, "job"),
      ...(reasonCode === undefined ? {} : { reasonCode }),
    }),
  );
}

function updatePromptTemplate(context: CommandContext): Promise<number> {
  const name = flagValue(context.parsed.flags, "name");
  const body = flagValue(context.parsed.flags, "body");
  const description = flagValue(context.parsed.flags, "description");
  const visibility = flagValue(context.parsed.flags, "visibility");
  const tags = csvFlag(context.parsed, "tag", "tags");
  return jsonResult(
    context,
    context.client.collaboration.updatePromptTemplate(
      requiredFlag(context.parsed, "prompt", "prompt-template"),
      {
        ...(name === undefined ? {} : { name }),
        ...(body === undefined ? {} : { body }),
        ...(description === undefined ? {} : { description }),
        ...(tags.length === 0 ? {} : { tags }),
        ...(visibility === undefined
          ? {}
          : { visibility: promptVisibility(visibility) }),
      },
    ),
  );
}

function createDeviceAuthorization(context: CommandContext): Promise<number> {
  const name = requiredFlag(context.parsed, "name");
  const scopes = scopeCsvFlag(context.parsed, "scopes");
  const ttlDays = optionalIntegerFlag(context.parsed, "ttl-days");
  return jsonResult(
    context,
    context.client.deviceAuthorizations.create({
      name,
      scopes,
      ...(ttlDays === undefined ? {} : { ttlDays }),
    }),
  );
}

function createSession(context: CommandContext): Promise<number> {
  const name = flagValue(context.parsed.flags, "name");
  const ttlHours = optionalIntegerFlag(context.parsed, "ttl-hours");
  return jsonResult(
    context,
    context.client.sessions.create({
      ...(name === undefined ? {} : { name }),
      ...(ttlHours === undefined ? {} : { ttlHours }),
    }),
  );
}

function createSupportSession(context: CommandContext): Promise<number> {
  const ttlMinutes = optionalIntegerFlag(context.parsed, "ttl-minutes");
  const targetUserId = requiredFlag(
    context.parsed,
    "target-user",
    "target-user-id",
  );
  const ticketRef = flagValue(context.parsed.flags, "ticket", "ticket-ref");
  return jsonResult(
    context,
    context.client.sessions.createSupportSession({
      targetUserId,
      confirmTargetUserId: requiredFlag(
        context.parsed,
        "confirm-target-user",
        "confirm-target-user-id",
      ),
      reason: requiredFlag(context.parsed, "reason"),
      ...(ticketRef === undefined ? {} : { ticketRef }),
      ...(ttlMinutes === undefined ? {} : { ttlMinutes }),
    }),
  );
}

function requestSupportSession(context: CommandContext): Promise<number> {
  const ttlMinutes = optionalIntegerFlag(context.parsed, "ttl-minutes");
  const targetUserId = requiredFlag(
    context.parsed,
    "target-user",
    "target-user-id",
  );
  const ticketRef = flagValue(context.parsed.flags, "ticket", "ticket-ref");
  return jsonResult(
    context,
    context.client.sessions.requestSupportSession({
      targetUserId,
      confirmTargetUserId: requiredFlag(
        context.parsed,
        "confirm-target-user",
        "confirm-target-user-id",
      ),
      reason: requiredFlag(context.parsed, "reason"),
      ...(ticketRef === undefined ? {} : { ticketRef }),
      ...(ttlMinutes === undefined ? {} : { ttlMinutes }),
    }),
  );
}

function approveSupportSessionRequest(
  context: CommandContext,
): Promise<number> {
  return jsonResult(
    context,
    context.client.sessions.approveSupportSessionRequest(
      requiredFlag(context.parsed, "request", "request-id"),
    ),
  );
}

function rejectSupportSessionRequest(context: CommandContext): Promise<number> {
  return jsonResult(
    context,
    context.client.sessions.rejectSupportSessionRequest(
      requiredFlag(context.parsed, "request", "request-id"),
    ),
  );
}

function createWorkflow(context: CommandContext): Promise<number> {
  const name = requiredFlag(context.parsed, "name");
  const workspaceId = requiredFlag(context.parsed, "workspace", "workspace-id");
  const agentId = requiredFlag(context.parsed, "agent", "agent-id");
  const handoffAgentId = flagValue(
    context.parsed.flags,
    "handoff-agent",
    "handoff-agent-id",
  );
  const handoffPrompt = flagValue(context.parsed.flags, "handoff-prompt");
  const roomAgentIds = csvFlag(context.parsed, "room-agents");
  const roomPrompt = flagValue(context.parsed.flags, "room-prompt");
  const toolApproval = flagValue(
    context.parsed.flags,
    "tool-approval",
    "tool-chain",
  );
  const toolApprovalRisk = workflowRiskLevelFlag(context.parsed);
  const toolApprovalInputKeys = csvFlag(context.parsed, "tool-input-keys");
  const browserUrl = flagValue(context.parsed.flags, "browser-url");
  const browserTask = flagValue(context.parsed.flags, "browser-task");
  const retryAttempts = optionalIntegerFlag(context.parsed, "retry-attempts");
  const retryPolicy =
    retryAttempts === undefined ? undefined : { maxAttempts: retryAttempts };
  const recoveryPolicy = workflowRecoveryPolicyFlag(context.parsed);
  const approval = flagValue(context.parsed.flags, "approval");
  const steps: Array<{
    type:
      | "agent_handoff"
      | "agent_room"
      | "agent_run"
      | "approval"
      | "browser_task"
      | "tool_approval";
    name: string;
    agentId?: string;
    agentIds?: string[];
    approvalPrompt?: string;
    handoffPrompt?: string;
    inputKeys?: string[];
    riskLevel?: "high" | "low" | "medium";
    roomPrompt?: string;
    retryPolicy?: { maxAttempts: number };
    recoveryPolicy?: { onFailure: "continue" | "fail" };
    targetUrl?: string;
    task?: string;
    toolChainName?: string;
  }> = [
    {
      type: "agent_run",
      name: "Agent run",
      agentId,
      ...(retryPolicy === undefined ? {} : { retryPolicy }),
      ...(recoveryPolicy === undefined ? {} : { recoveryPolicy }),
    },
  ];
  if (handoffAgentId !== undefined) {
    steps.push({
      type: "agent_handoff",
      name: "Agent handoff",
      agentId: handoffAgentId,
      ...(handoffPrompt === undefined ? {} : { handoffPrompt }),
      ...(retryPolicy === undefined ? {} : { retryPolicy }),
      ...(recoveryPolicy === undefined ? {} : { recoveryPolicy }),
    });
  }
  if (roomAgentIds.length > 0) {
    steps.push({
      type: "agent_room",
      name: "Agent room",
      agentIds: roomAgentIds,
      ...(roomPrompt === undefined ? {} : { roomPrompt }),
      ...(recoveryPolicy === undefined ? {} : { recoveryPolicy }),
    });
  }
  if (toolApproval !== undefined) {
    steps.push({
      type: "tool_approval",
      name: "Tool approval",
      toolChainName: toolApproval,
      ...(toolApprovalRisk === undefined
        ? {}
        : { riskLevel: toolApprovalRisk }),
      ...(toolApprovalInputKeys.length === 0
        ? {}
        : { inputKeys: toolApprovalInputKeys }),
    });
  }
  if (browserUrl !== undefined || browserTask !== undefined) {
    if (browserUrl === undefined || browserTask === undefined)
      throw new CliUsageError(
        "--browser-url and --browser-task must be provided together.",
      );
    steps.push({
      type: "browser_task",
      name: "Browser task",
      targetUrl: browserUrl,
      task: browserTask,
    });
  }
  if (approval !== undefined)
    steps.push({
      type: "approval",
      name: "Approval",
      approvalPrompt: approval,
    });
  const schedule = workflowScheduleFromFlags(context);
  return jsonResult(
    context,
    context.client.workflows.create({
      workspaceId,
      name,
      steps,
      ...(schedule === undefined ? {} : { schedule }),
    }),
  );
}

function createWorkflowFromTemplate(context: CommandContext): Promise<number> {
  const templateId = requiredFlag(context.parsed, "template", "template-id");
  const workspaceId = requiredFlag(context.parsed, "workspace", "workspace-id");
  const agentId = flagValue(context.parsed.flags, "agent", "agent-id");
  const name = flagValue(context.parsed.flags, "name");
  const schedule = workflowScheduleFromFlags(context);
  return jsonResult(
    context,
    context.client.workflows.createFromTemplate(templateId, {
      workspaceId,
      ...(agentId === undefined ? {} : { agentId }),
      ...(name === undefined ? {} : { name }),
      ...(schedule === undefined ? {} : { schedule }),
    }),
  );
}

function approveWorkflow(context: CommandContext): Promise<number> {
  const comment = flagValue(context.parsed.flags, "comment");
  return jsonResult(
    context,
    context.client.workflows.approveRun(
      requiredFlag(context.parsed, "run", "workflow-run"),
      comment === undefined ? {} : { comment },
    ),
  );
}

function claimBrowserAutomationTask(context: CommandContext): Promise<number> {
  const leaseSeconds = optionalIntegerFlag(context.parsed, "lease-seconds");
  return jsonResult(
    context,
    context.client.workflows.claimBrowserTask(
      leaseSeconds === undefined ? {} : { leaseSeconds },
    ),
  );
}

function renewBrowserAutomationTask(context: CommandContext): Promise<number> {
  const leaseSeconds = optionalIntegerFlag(context.parsed, "lease-seconds");
  return jsonResult(
    context,
    context.client.workflows.renewBrowserTaskLease({
      jobId: requiredFlag(context.parsed, "job"),
      ...(leaseSeconds === undefined ? {} : { leaseSeconds }),
    }),
  );
}

async function uploadBrowserAutomationArtifact(
  context: CommandContext,
): Promise<number> {
  const filePath = requiredFlag(context.parsed, "file");
  const body = await context.readFile(filePath);
  const artifactType = browserArtifactType(
    requiredFlag(context.parsed, "type", "artifact-type"),
  );
  const contentType =
    flagValue(context.parsed.flags, "content-type", "mime-type", "mime") ??
    "application/octet-stream";
  const registration =
    await context.client.workflows.createBrowserTaskArtifactUpload({
      jobId: requiredFlag(context.parsed, "job"),
      type: artifactType,
      contentType,
      sizeBytes: body.byteLength,
    });
  const uploadResponse = await context.fetchImpl(registration.upload.url, {
    method: registration.upload.method,
    headers: registration.upload.headers,
    body: new Uint8Array(body).buffer,
  });
  if (!uploadResponse.ok) {
    throw new Error(
      `Browser automation artifact upload failed with ${uploadResponse.status}.`,
    );
  }
  writeJson(context.io, registration.artifact);
  return 0;
}

function expireBrowserAutomationTasks(
  context: CommandContext,
): Promise<number> {
  const queuedTimeoutSeconds = optionalIntegerFlag(
    context.parsed,
    "queued-timeout-seconds",
  );
  const runningTimeoutSeconds = optionalIntegerFlag(
    context.parsed,
    "running-timeout-seconds",
  );
  const limit = optionalIntegerFlag(context.parsed, "limit");
  return jsonResult(
    context,
    context.client.workflows.expireBrowserTasks({
      ...(queuedTimeoutSeconds === undefined ? {} : { queuedTimeoutSeconds }),
      ...(runningTimeoutSeconds === undefined ? {} : { runningTimeoutSeconds }),
      ...(limit === undefined ? {} : { limit }),
    }),
  );
}

function completeBrowserAutomationTask(
  context: CommandContext,
): Promise<number> {
  const finalOrigin = flagValue(
    context.parsed.flags,
    "final-url",
    "final-origin",
  );
  const artifactCount = optionalNonNegativeIntegerFlag(
    context.parsed,
    "artifact-count",
  );
  const capturedBytes = optionalNonNegativeIntegerFlag(
    context.parsed,
    "captured-bytes",
  );
  const durationMs = optionalNonNegativeIntegerFlag(
    context.parsed,
    "duration-ms",
  );
  const navigationCount = optionalNonNegativeIntegerFlag(
    context.parsed,
    "navigation-count",
  );
  const networkDeniedCount = optionalNonNegativeIntegerFlag(
    context.parsed,
    "network-denied-count",
  );
  const outputKeys = optionalCsvFlag(context.parsed, "output-keys");
  const redactionApplied = optionalBooleanFlag(
    context.parsed,
    "redaction-applied",
  );
  return jsonResult(
    context,
    context.client.workflows.completeBrowserTask({
      jobId: requiredFlag(context.parsed, "job"),
      result: {
        ...(artifactCount === undefined ? {} : { artifactCount }),
        ...(capturedBytes === undefined ? {} : { capturedBytes }),
        ...(durationMs === undefined ? {} : { durationMs }),
        ...(finalOrigin === undefined ? {} : { finalOrigin }),
        ...(navigationCount === undefined ? {} : { navigationCount }),
        ...(networkDeniedCount === undefined ? {} : { networkDeniedCount }),
        ...(outputKeys === undefined ? {} : { outputKeys }),
        ...(redactionApplied === undefined ? {} : { redactionApplied }),
      },
    }),
  );
}

function failBrowserAutomationTask(context: CommandContext): Promise<number> {
  return jsonResult(
    context,
    context.client.workflows.failBrowserTask({
      jobId: requiredFlag(context.parsed, "job"),
      errorCode: requiredFlag(context.parsed, "error-code"),
    }),
  );
}

function browserArtifactType(value: string): "screenshot" | "trace" {
  if (value === "screenshot" || value === "trace") return value;
  throw new CliUsageError("Browser artifact type must be screenshot or trace.");
}

function workflowScheduleFromFlags(
  context: CommandContext,
): { intervalMinutes: number; nextRunAt?: string } | undefined {
  const interval = optionalIntegerFlag(
    context.parsed,
    "schedule-interval-minutes",
  );
  if (interval === undefined) return undefined;
  const nextRunAt = flagValue(context.parsed.flags, "schedule-next-run-at");
  return {
    intervalMinutes: interval,
    ...(nextRunAt === undefined ? {} : { nextRunAt }),
  };
}

function workflowRiskLevelFlag(
  parsed: ParsedArgs,
): "high" | "low" | "medium" | undefined {
  const risk = flagValue(parsed.flags, "tool-risk", "risk");
  if (risk === undefined) return undefined;
  if (risk === "high" || risk === "low" || risk === "medium") return risk;
  throw new CliUsageError("--tool-risk must be low, medium, or high.");
}

function workflowRecoveryPolicyFlag(
  parsed: ParsedArgs,
): { onFailure: "continue" | "fail" } | undefined {
  const action = flagValue(parsed.flags, "on-failure");
  if (action === undefined) return undefined;
  if (action === "continue" || action === "fail") return { onFailure: action };
  throw new CliUsageError("--on-failure must be fail or continue.");
}

function shareAgentCommand(context: CommandContext): Promise<number> {
  const agentId = requiredFlag(context.parsed, "agent", "agent-id");
  const group = flagValue(context.parsed.flags, "group") ?? "group_reviewers";
  return jsonResult(
    context,
    context.client.collaboration.shareAgent(agentId, {
      principalType: "group",
      principalId: group,
      permissions: ["read", "run"],
    }),
  );
}

function shareKnowledgeBaseCommand(context: CommandContext): Promise<number> {
  const knowledgeBaseId = requiredFlag(context.parsed, "kb", "knowledge-base");
  const group = flagValue(context.parsed.flags, "group") ?? "group_reviewers";
  return jsonResult(
    context,
    context.client.collaboration.shareKnowledgeBase(knowledgeBaseId, {
      principalType: "group",
      principalId: group,
      permissions: ["read", "use"],
    }),
  );
}

function shareChatCommand(context: CommandContext): Promise<number> {
  const chatId = requiredFlag(context.parsed, "chat", "chat-id");
  const group = flagValue(context.parsed.flags, "group") ?? "group_reviewers";
  return jsonResult(
    context,
    context.client.collaboration.shareChat(chatId, {
      principalType: "group",
      principalId: group,
      permissions: ["read", "write"],
    }),
  );
}

function sharePromptTemplateCommand(context: CommandContext): Promise<number> {
  const promptTemplateId = requiredFlag(
    context.parsed,
    "prompt",
    "prompt-template",
  );
  const group = flagValue(context.parsed.flags, "group") ?? "group_reviewers";
  return jsonResult(
    context,
    context.client.collaboration.sharePromptTemplate(promptTemplateId, {
      principalType: "group",
      principalId: group,
      permissions: ["read", "use"],
    }),
  );
}

function createFolder(context: CommandContext): Promise<number> {
  return jsonResult(
    context,
    context.client.collaboration.createFolder({
      workspaceId: requiredFlag(context.parsed, "workspace", "workspace-id"),
      name: requiredFlag(context.parsed, "name"),
    }),
  );
}

function shareFolderCommand(context: CommandContext): Promise<number> {
  const folderId = requiredFlag(context.parsed, "folder", "folder-id");
  const group = flagValue(context.parsed.flags, "group") ?? "group_reviewers";
  return jsonResult(
    context,
    context.client.collaboration.shareFolder(folderId, {
      principalType: "group",
      principalId: group,
      permissions: ["read"],
    }),
  );
}

function addFolderItem(context: CommandContext): Promise<number> {
  return jsonResult(
    context,
    context.client.collaboration.addFolderItem(
      requiredFlag(context.parsed, "folder", "folder-id"),
      {
        resourceType: folderItemResourceType(
          requiredFlag(context.parsed, "type", "resource-type"),
        ),
        resourceId: requiredFlag(context.parsed, "resource", "resource-id"),
      },
    ),
  );
}

function createChatComment(context: CommandContext): Promise<number> {
  const chatId = requiredFlag(context.parsed, "chat", "chat-id");
  const body = requiredFlag(context.parsed, "body");
  return jsonResult(context, context.client.chatApi.comment(chatId, { body }));
}

function archiveChat(context: CommandContext): Promise<number> {
  return jsonResult(
    context,
    context.client.chatApi.archive(
      requiredFlag(context.parsed, "chat", "chat-id"),
    ),
  );
}

function updateChatLegalHold(context: CommandContext): Promise<number> {
  const reason = flagValue(context.parsed.flags, "reason");
  return jsonResult(
    context,
    context.client.chatApi.updateLegalHold(
      requiredFlag(context.parsed, "chat", "chat-id"),
      {
        legalHoldUntil: requiredFlag(context.parsed, "until"),
        ...(reason === undefined ? {} : { legalHoldReason: reason }),
      },
    ),
  );
}

function clearChatLegalHold(context: CommandContext): Promise<number> {
  return jsonResult(
    context,
    context.client.chatApi.updateLegalHold(
      requiredFlag(context.parsed, "chat", "chat-id"),
      { legalHoldUntil: null },
    ),
  );
}

function createNotificationChannel(context: CommandContext): Promise<number> {
  const type = flagValue(context.parsed.flags, "type") ?? "webhook";
  const enabledNotificationTypes = optionalCsvFlag(
    context.parsed,
    "enabled-notification-types",
    "notification-types",
  );
  if (type === "email") {
    return jsonResult(
      context,
      context.client.notifications.createChannel({
        type,
        name: flagValue(context.parsed.flags, "name") ?? "Email notifications",
        config: {
          to: requiredFlag(context.parsed, "to"),
          ...(enabledNotificationTypes === undefined
            ? {}
            : { enabledNotificationTypes: enabledNotificationTypes as never }),
        },
      }),
    );
  }
  if (type === "pagerduty") {
    return jsonResult(
      context,
      context.client.notifications.createChannel({
        type,
        name:
          flagValue(context.parsed.flags, "name") ?? "PagerDuty notifications",
        config: {
          routingKeyRef: requiredFlag(
            context.parsed,
            "routing-key-ref",
            "routing-key",
          ),
          ...(flagValue(context.parsed.flags, "severity") === undefined
            ? {}
            : {
                severity: flagValue(context.parsed.flags, "severity") as never,
              }),
          ...(enabledNotificationTypes === undefined
            ? {}
            : { enabledNotificationTypes: enabledNotificationTypes as never }),
        },
      }),
    );
  }
  if (type === "mobile_push") {
    const platform = flagValue(context.parsed.flags, "platform");
    const collapseKey = flagValue(context.parsed.flags, "collapse-key");
    return jsonResult(
      context,
      context.client.notifications.createChannel({
        type,
        name:
          flagValue(context.parsed.flags, "name") ??
          "Mobile push notifications",
        config: {
          tokenRef: requiredFlag(context.parsed, "token-ref", "token"),
          ...(platform === undefined
            ? {}
            : { platform: platform as never }),
          ...(collapseKey === undefined ? {} : { collapseKey }),
          ...(enabledNotificationTypes === undefined
            ? {}
            : { enabledNotificationTypes: enabledNotificationTypes as never }),
        },
      }),
    );
  }
  if (type === "slack") {
    return jsonResult(
      context,
      context.client.notifications.createChannel({
        type,
        name: flagValue(context.parsed.flags, "name") ?? "Slack notifications",
        config: {
          url: requiredFlag(context.parsed, "url"),
          ...(enabledNotificationTypes === undefined
            ? {}
            : { enabledNotificationTypes: enabledNotificationTypes as never }),
        },
      }),
    );
  }
  if (type === "teams") {
    return jsonResult(
      context,
      context.client.notifications.createChannel({
        type,
        name: flagValue(context.parsed.flags, "name") ?? "Teams notifications",
        config: {
          url: requiredFlag(context.parsed, "url"),
          ...(enabledNotificationTypes === undefined
            ? {}
            : { enabledNotificationTypes: enabledNotificationTypes as never }),
        },
      }),
    );
  }
  if (type !== "webhook")
    throw new CliUsageError(
      "--type must be email, mobile_push, pagerduty, slack, teams, or webhook.",
    );
  return jsonResult(
    context,
    context.client.notifications.createChannel({
      type,
      name: flagValue(context.parsed.flags, "name") ?? "Webhook notifications",
      config: {
        url: requiredFlag(context.parsed, "url"),
        ...(enabledNotificationTypes === undefined
          ? {}
          : { enabledNotificationTypes: enabledNotificationTypes as never }),
      },
    }),
  );
}

function updateNotificationPolicy(context: CommandContext): Promise<number> {
  const update: UpdateNotificationPolicyInput = {};
  const deliveryEnabled = optionalBooleanFlag(
    context.parsed,
    "delivery-enabled",
  );
  const allowedChannelTypes = optionalCsvFlag(
    context.parsed,
    "allowed-channel-types",
  );
  const allowedWebhookHosts = optionalCsvFlag(
    context.parsed,
    "allowed-webhook-hosts",
  );
  const allowedSlackHosts = optionalCsvFlag(
    context.parsed,
    "allowed-slack-hosts",
  );
  const allowedTeamsHosts = optionalCsvFlag(
    context.parsed,
    "allowed-teams-hosts",
  );
  const allowedEmailDomains = optionalCsvFlag(
    context.parsed,
    "allowed-email-domains",
  );
  const suppressedNotificationTypes = optionalCsvFlag(
    context.parsed,
    "suppressed-notification-types",
  );

  if (deliveryEnabled !== undefined) update.deliveryEnabled = deliveryEnabled;
  if (allowedChannelTypes !== undefined)
    update.allowedChannelTypes = allowedChannelTypes as never;
  if (allowedWebhookHosts !== undefined)
    update.allowedWebhookHosts = allowedWebhookHosts;
  if (allowedSlackHosts !== undefined)
    update.allowedSlackHosts = allowedSlackHosts;
  if (allowedTeamsHosts !== undefined)
    update.allowedTeamsHosts = allowedTeamsHosts;
  if (allowedEmailDomains !== undefined)
    update.allowedEmailDomains = allowedEmailDomains;
  if (suppressedNotificationTypes !== undefined)
    update.suppressedNotificationTypes = suppressedNotificationTypes as never;
  if (Object.keys(update).length === 0) {
    throw new CliUsageError(
      "notifications policy-update requires at least one policy flag.",
    );
  }
  return jsonResult(context, context.client.notifications.updatePolicy(update));
}

function createLocalConnector(context: CommandContext): Promise<number> {
  const sourceAccessMode = sourceAccessModeConfig(context);
  return jsonResult(
    context,
    context.client.dataConnectors.create({
      workspaceId: requiredFlag(context.parsed, "workspace", "workspace-id"),
      knowledgeBaseId: requiredFlag(context.parsed, "kb", "knowledge-base"),
      type: "local_import",
      name: flagValue(context.parsed.flags, "name") ?? "Local import",
      ...(sourceAccessMode === undefined ? {} : { config: sourceAccessMode }),
    }),
  );
}

function createWebsiteConnector(context: CommandContext): Promise<number> {
  const maxPages = optionalIntegerFlag(context.parsed, "max-pages");
  const syncIntervalMinutes = optionalIntegerFlag(
    context.parsed,
    "sync-interval-minutes",
  );
  const sourceAccessMode = sourceAccessModeConfig(context);
  return jsonResult(
    context,
    context.client.dataConnectors.create({
      workspaceId: requiredFlag(context.parsed, "workspace", "workspace-id"),
      knowledgeBaseId: requiredFlag(context.parsed, "kb", "knowledge-base"),
      type: "website",
      name: flagValue(context.parsed.flags, "name") ?? "Website",
      ...(syncIntervalMinutes === undefined ? {} : { syncIntervalMinutes }),
      config: {
        url: requiredFlag(context.parsed, "url"),
        ...(maxPages === undefined ? {} : { maxPages }),
        ...(sourceAccessMode ?? {}),
      },
    }),
  );
}

function createRssConnector(context: CommandContext): Promise<number> {
  const maxItems = optionalIntegerFlag(context.parsed, "max-items");
  const syncIntervalMinutes = optionalIntegerFlag(
    context.parsed,
    "sync-interval-minutes",
  );
  const sourceAccessMode = sourceAccessModeConfig(context);
  return jsonResult(
    context,
    context.client.dataConnectors.create({
      workspaceId: requiredFlag(context.parsed, "workspace", "workspace-id"),
      knowledgeBaseId: requiredFlag(context.parsed, "kb", "knowledge-base"),
      type: "rss",
      name: flagValue(context.parsed.flags, "name") ?? "RSS feed",
      ...(syncIntervalMinutes === undefined ? {} : { syncIntervalMinutes }),
      config: {
        url: requiredFlag(context.parsed, "url"),
        ...(maxItems === undefined ? {} : { maxItems }),
        ...(sourceAccessMode ?? {}),
      },
    }),
  );
}

function createS3Connector(context: CommandContext): Promise<number> {
  const maxItems = optionalIntegerFlag(context.parsed, "max-items");
  const syncIntervalMinutes = optionalIntegerFlag(
    context.parsed,
    "sync-interval-minutes",
  );
  const secretRef = flagValue(context.parsed.flags, "secret-ref", "secret");
  const sourceAccessMode = sourceAccessModeConfig(context);
  return jsonResult(
    context,
    context.client.dataConnectors.create({
      workspaceId: requiredFlag(context.parsed, "workspace", "workspace-id"),
      knowledgeBaseId: requiredFlag(context.parsed, "kb", "knowledge-base"),
      type: "s3",
      name: flagValue(context.parsed.flags, "name") ?? "S3 bucket",
      ...(syncIntervalMinutes === undefined ? {} : { syncIntervalMinutes }),
      config: {
        bucket: requiredFlag(context.parsed, "bucket"),
        prefix: flagValue(context.parsed.flags, "prefix") ?? "",
        region: flagValue(context.parsed.flags, "region") ?? "us-east-1",
        ...(maxItems === undefined ? {} : { maxItems }),
        ...(secretRef === undefined ? {} : { secretRef }),
        ...(sourceAccessMode ?? {}),
      },
    }),
  );
}

function sourceAccessModeConfig(
  context: CommandContext,
): { sourceAccessMode: "connector_owner" | "knowledge_base" } | undefined {
  const value = flagValue(context.parsed.flags, "source-access-mode");
  if (value === undefined) return undefined;
  if (value === "connector_owner" || value === "knowledge_base")
    return { sourceAccessMode: value };
  throw new CliUsageError(
    "--source-access-mode must be knowledge_base or connector_owner.",
  );
}

async function syncLocalConnector(context: CommandContext): Promise<number> {
  const connectorId = requiredFlag(context.parsed, "connector", "connector-id");
  const filePath = requiredFlag(context.parsed, "file");
  const content = new TextDecoder().decode(await context.readFile(filePath));
  const mimeType =
    flagValue(context.parsed.flags, "mime-type", "mime") ?? "text/plain";
  const fileName =
    flagValue(context.parsed.flags, "name") ?? basename(filePath);
  const sync = await context.client.dataConnectors.sync({
    connectorId,
    items: [
      {
        fileName,
        mimeType,
        content,
        sizeBytes: new TextEncoder().encode(content).length,
      },
    ],
  });
  writeJson(context.io, sync);
  return 0;
}

function exportAgent(context: CommandContext): Promise<number> {
  const agentId = requiredFlag(context.parsed, "agent", "agent-id");
  return jsonResult(context, context.client.agent.exportAgent(agentId));
}

async function importAgent(context: CommandContext): Promise<number> {
  const workspaceId = requiredFlag(context.parsed, "workspace", "workspace-id");
  const filePath = requiredFlag(context.parsed, "file");
  const document = JSON.parse(
    new TextDecoder().decode(await context.readFile(filePath)),
  ) as unknown;
  return jsonResult(
    context,
    context.client.agent.importAgent({
      workspaceId,
      document: document as never,
    }),
  );
}

async function runChat(
  context: CommandContext,
  rest: string[],
): Promise<number> {
  const workspaceId = requiredFlag(context.parsed, "workspace", "workspace-id");
  const agentId = requiredFlag(context.parsed, "agent", "agent-id");
  const prompt = flagValue(context.parsed.flags, "prompt") ?? rest.join(" ");
  if (prompt.length === 0)
    throw new CliUsageError("Missing --prompt or prompt text.");

  const title = flagValue(context.parsed.flags, "title") ?? prompt.slice(0, 60);
  const chat = await context.client.chatApi.create({ workspaceId, title });
  const run = await context.client.chatApi.startRun({
    chatId: chat.id,
    agentId,
    content: prompt,
  });

  const events: RunEvent[] = [];
  for await (const event of context.client.chatApi.events(run.id)) {
    events.push(event);
    if (
      !hasFlag(context.parsed.flags, "json") &&
      event.type === "message.delta" &&
      isTextDelta(event.data)
    ) {
      context.io.stdout.write(event.data.text);
    }
  }

  if (hasFlag(context.parsed.flags, "json"))
    writeJson(context.io, { chat, run, events });
  else writeLine(context.io, "");
  return 0;
}

async function uploadKnowledgeFile(context: CommandContext): Promise<number> {
  const knowledgeBaseId = requiredFlag(context.parsed, "knowledge-base", "kb");
  const filePath = requiredFlag(context.parsed, "file");
  const body = await context.readFile(filePath);
  const mimeType =
    flagValue(context.parsed.flags, "mime-type", "mime") ??
    "application/octet-stream";
  const fileName =
    flagValue(context.parsed.flags, "name") ?? basename(filePath);

  const registration = await context.client.knowledge.createUpload({
    knowledgeBaseId,
    fileName,
    mimeType,
    sizeBytes: body.byteLength,
  });
  const uploadResponse = await context.fetchImpl(registration.upload.url, {
    method: registration.upload.method,
    headers: registration.upload.headers,
    body: new Uint8Array(body).buffer,
  });
  if (!uploadResponse.ok)
    throw new Error(
      `Knowledge file upload failed with ${uploadResponse.status}.`,
    );

  const source = await context.client.knowledge.completeUpload(
    knowledgeBaseId,
    registration.source.id,
  );
  writeJson(context.io, source);
  return 0;
}

function extractKnowledgeFile(context: CommandContext): Promise<number> {
  return jsonResult(
    context,
    context.client.knowledge.extractUpload(
      requiredFlag(context.parsed, "knowledge-base", "kb"),
      requiredFlag(context.parsed, "source", "source-id"),
    ),
  );
}

function indexKnowledgeEmbeddings(context: CommandContext): Promise<number> {
  const batchSize = optionalIntegerFlag(context.parsed, "batch-size");
  return jsonResult(
    context,
    context.client.knowledge.indexEmbeddings({
      knowledgeBaseId: requiredFlag(context.parsed, "knowledge-base", "kb"),
      providerId: requiredFlag(context.parsed, "provider"),
      model: requiredFlag(context.parsed, "model"),
      ...(batchSize === undefined ? {} : { batchSize }),
    }),
  );
}

function createWebhook(context: CommandContext): Promise<number> {
  const url = requiredFlag(context.parsed, "url");
  const events = requiredFlag(context.parsed, "events")
    .split(",")
    .map((event) => event.trim())
    .filter((event) => event.length > 0);
  return jsonResult(
    context,
    context.client.webhooks.create({ url, eventTypes: events as never }),
  );
}

function disableWebhook(context: CommandContext): Promise<number> {
  const webhookId = requiredFlag(context.parsed, "webhook", "webhook-id");
  return jsonResult(context, context.client.webhooks.disable(webhookId));
}

function webhookDeliveries(context: CommandContext): Promise<number> {
  const webhookId = flagValue(context.parsed.flags, "webhook", "webhook-id");
  return jsonResult(context, context.client.webhooks.deliveries(webhookId));
}

function testWebhook(context: CommandContext): Promise<number> {
  const webhookId = requiredFlag(context.parsed, "webhook", "webhook-id");
  return jsonResult(
    context,
    context.client.webhooks.test({ subscriptionId: webhookId }),
  );
}

function webhookRetryWorker(context: CommandContext): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 60_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  const input =
    maxIterations === undefined
      ? { client: context.client, intervalMs, io: context.io }
      : { client: context.client, intervalMs, io: context.io, maxIterations };
  return runWebhookRetryWorker(input);
}

function notificationRetryWorker(context: CommandContext): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 60_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  const input =
    maxIterations === undefined
      ? { client: context.client, intervalMs, io: context.io }
      : { client: context.client, intervalMs, io: context.io, maxIterations };
  return runNotificationRetryWorker(input);
}

function knowledgeExtractionWorker(context: CommandContext): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 60_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  const maxSourcesPerIteration = optionalIntegerFlag(
    context.parsed,
    "max-sources",
  );
  const baseInput = {
    client: context.client,
    intervalMs,
    io: context.io,
    knowledgeBaseId: requiredFlag(context.parsed, "knowledge-base", "kb"),
  };
  const input = {
    ...baseInput,
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(maxSourcesPerIteration === undefined ? {} : { maxSourcesPerIteration }),
  };
  return runKnowledgeExtractionWorker(input);
}

function dataConnectorSyncWorker(context: CommandContext): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 60_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  const maxConnectorsPerIteration = optionalIntegerFlag(
    context.parsed,
    "max-connectors",
  );
  const workspaceId = flagValue(
    context.parsed.flags,
    "workspace",
    "workspace-id",
  );
  const input = {
    client: context.client,
    intervalMs,
    io: context.io,
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(maxConnectorsPerIteration === undefined
      ? {}
      : { maxConnectorsPerIteration }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
  };
  return runDataConnectorSyncWorker(input);
}

async function toolDispatchWorker(context: CommandContext): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 10_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  const maxJobsPerIteration = optionalIntegerFlag(context.parsed, "max-jobs");
  const leaseSeconds =
    optionalIntegerFlag(context.parsed, "lease-seconds") ?? 300;
  const timeoutMs = optionalIntegerFlag(context.parsed, "timeout-ms") ?? 10_000;
  const maxBytes =
    optionalIntegerFlag(context.parsed, "max-bytes") ?? 1_000_000;
  const payloadFile = flagValue(context.parsed.flags, "payload-file");
  const payloads =
    payloadFile === undefined
      ? undefined
      : parseToolDispatchPayloadFile(
          new TextDecoder().decode(await context.readFile(payloadFile)),
        );
  const secretResolverDriver = toolDispatchSecretResolverDriver(context);
  return runToolDispatchWorker({
    client: context.client,
    ...(context.dnsLookup === undefined
      ? {}
      : { dnsLookup: context.dnsLookup }),
    fetchImpl: context.fetchImpl,
    intervalMs,
    io: context.io,
    leaseSeconds,
    maxBytes,
    timeoutMs,
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(maxJobsPerIteration === undefined ? {} : { maxJobsPerIteration }),
    ...(payloads === undefined ? {} : { payloads }),
    secretResolver: createSecretValueResolver(secretResolverDriver, {
      fetchImpl: context.fetchImpl,
    }),
    ...(hasFlag(context.parsed.flags, "allow-private-network")
      ? { allowPrivateNetwork: true }
      : {}),
  });
}

function browserAutomationWorker(context: CommandContext): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 10_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  const maxJobsPerIteration = optionalIntegerFlag(context.parsed, "max-jobs");
  const leaseSeconds =
    optionalIntegerFlag(context.parsed, "lease-seconds") ?? 300;
  const timeoutMs = optionalIntegerFlag(context.parsed, "timeout-ms") ?? 30_000;
  const maxBytes = optionalIntegerFlag(context.parsed, "max-bytes") ?? 20_000;
  return runBrowserAutomationWorker({
    client: context.client,
    fetchImpl: context.fetchImpl,
    intervalMs,
    io: context.io,
    leaseSeconds,
    maxBytes,
    runnerUrl: requiredFlag(context.parsed, "runner-url"),
    timeoutMs,
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(maxJobsPerIteration === undefined ? {} : { maxJobsPerIteration }),
  });
}

function retentionEnforcementWorker(context: CommandContext): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 86_400_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  const input =
    maxIterations === undefined
      ? { client: context.client, intervalMs, io: context.io }
      : { client: context.client, intervalMs, io: context.io, maxIterations };
  return runRetentionEnforcementWorker(input);
}

function billingEntitlementReconciliationWorker(
  context: CommandContext,
): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 300_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  const input =
    maxIterations === undefined
      ? { client: context.client, intervalMs, io: context.io }
      : { client: context.client, intervalMs, io: context.io, maxIterations };
  return runBillingEntitlementReconciliationWorker(input);
}

function billingLifecycleEnforcementWorker(
  context: CommandContext,
): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 900_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  const input =
    maxIterations === undefined
      ? { client: context.client, intervalMs, io: context.io }
      : { client: context.client, intervalMs, io: context.io, maxIterations };
  return runBillingLifecycleEnforcementWorker(input);
}

function voiceCatalogSyncWorker(context: CommandContext): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 86_400_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  const input =
    maxIterations === undefined
      ? { client: context.client, intervalMs, io: context.io }
      : { client: context.client, intervalMs, io: context.io, maxIterations };
  return runVoiceCatalogSyncWorker(input);
}

function workflowResumeWorker(context: CommandContext): Promise<number> {
  const intervalMs = numberFlag(context.parsed, 60_000, "interval-ms");
  const maxIterations = hasFlag(context.parsed.flags, "once")
    ? 1
    : optionalIntegerFlag(context.parsed, "max-iterations");
  const maxRunsPerIteration = optionalIntegerFlag(context.parsed, "max-runs");
  const maxWorkflowsPerIteration = optionalIntegerFlag(
    context.parsed,
    "max-workflows",
  );
  const workspaceId = flagValue(
    context.parsed.flags,
    "workspace",
    "workspace-id",
  );
  const input = {
    client: context.client,
    intervalMs,
    io: context.io,
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(maxRunsPerIteration === undefined ? {} : { maxRunsPerIteration }),
    ...(maxWorkflowsPerIteration === undefined
      ? {}
      : { maxWorkflowsPerIteration }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
  };
  return runWorkflowResumeWorker(input);
}

function toolDispatchSecretResolverDriver(
  context: CommandContext,
): SecretValueResolverDriver {
  const value =
    flagValue(context.parsed.flags, "secret-resolver") ??
    process.env.TOOL_DISPATCH_SECRET_RESOLVER_DRIVER ??
    "disabled";
  if (
    value === "disabled" ||
    value === "env" ||
    value === "vault" ||
    value === "aws-sm" ||
    value === "gcp-sm" ||
    value === "azure-kv" ||
    value === "cloud"
  )
    return value;
  throw new CliUsageError(
    "--secret-resolver must be disabled, env, vault, aws-sm, gcp-sm, azure-kv, or cloud.",
  );
}

function parseToolDispatchPayloadFile(
  content: string,
): Record<string, ToolDispatchPayload> {
  const parsed = JSON.parse(content) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CliUsageError("--payload-file must contain a JSON object.");
  }
  const payloads: Record<string, ToolDispatchPayload> = {};
  for (const [jobId, value] of Object.entries(parsed)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new CliUsageError(
        "--payload-file entries must be JSON objects keyed by dispatch job ID.",
      );
    }
    const record = value as Record<string, unknown>;
    const payload: ToolDispatchPayload = {};
    if (record.parameters !== undefined)
      payload.parameters = jsonObject(record.parameters, "parameters");
    if (record.body !== undefined)
      payload.body = jsonObject(record.body, "body");
    if (record.headers !== undefined)
      payload.headers = stringRecord(record.headers, "headers");
    if (record.auth !== undefined)
      payload.auth = toolDispatchPayloadAuth(record.auth);
    payloads[jobId] = payload;
  }
  return payloads;
}

function toolDispatchPayloadAuth(value: unknown): ToolDispatchPayloadAuth {
  const record = jsonObject(value, "auth");
  const type = record.type;
  const secretRef = record.secretRef;
  if (typeof secretRef !== "string" || secretRef.length === 0) {
    throw new CliUsageError("--payload-file auth.secretRef must be a string.");
  }
  if (type === "bearer") return { type, secretRef };
  if (type === "api_key") {
    const apiKeyIn = record.apiKeyIn;
    const apiKeyName = record.apiKeyName;
    if (
      apiKeyIn !== undefined &&
      apiKeyIn !== "header" &&
      apiKeyIn !== "query"
    ) {
      throw new CliUsageError(
        "--payload-file auth.apiKeyIn must be header or query.",
      );
    }
    if (apiKeyName !== undefined && typeof apiKeyName !== "string") {
      throw new CliUsageError(
        "--payload-file auth.apiKeyName must be a string.",
      );
    }
    return {
      type,
      secretRef,
      ...(apiKeyIn === undefined ? {} : { apiKeyIn }),
      ...(apiKeyName === undefined ? {} : { apiKeyName }),
    };
  }
  if (type === "oauth2_client_credentials") return { type, secretRef };
  throw new CliUsageError(
    "--payload-file auth.type must be bearer, api_key, or oauth2_client_credentials.",
  );
}

function jsonObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value))
    return value as Record<string, unknown>;
  throw new CliUsageError(`--payload-file ${name} entries must be objects.`);
}

function stringRecord(value: unknown, name: string): Record<string, string> {
  const record = jsonObject(value, name);
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== "string") {
      throw new CliUsageError(
        `--payload-file ${name}.${key} must be a string.`,
      );
    }
  }
  return record as Record<string, string>;
}

async function jsonResult(
  context: CommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}

function requiredFlag(parsed: ParsedArgs, ...names: string[]): string {
  const value = flagValue(parsed.flags, ...names);
  if (value === undefined) throw new CliUsageError(`Missing --${names[0]}.`);
  return value;
}

function rubricFromFlags(parsed: ParsedArgs) {
  const mustContain = csvFlag(parsed, "must-contain");
  const mustNotContain = csvFlag(parsed, "must-not-contain");
  const expectedTools = csvFlag(parsed, "expected-tool", "expected-tools");
  const requiredCitations = csvFlag(
    parsed,
    "required-citation",
    "required-citations",
  );
  const minLength = optionalNonNegativeIntegerFlag(parsed, "min-length");
  const maxLength = optionalIntegerFlag(parsed, "max-length");
  if (
    minLength !== undefined &&
    maxLength !== undefined &&
    minLength > maxLength
  ) {
    throw new CliUsageError(
      "--min-length must be less than or equal to --max-length.",
    );
  }
  if (
    mustContain.length === 0 &&
    mustNotContain.length === 0 &&
    expectedTools.length === 0 &&
    requiredCitations.length === 0 &&
    minLength === undefined &&
    maxLength === undefined
  ) {
    return undefined;
  }
  return {
    ...(mustContain.length > 0 ? { mustContain } : {}),
    ...(mustNotContain.length > 0 ? { mustNotContain } : {}),
    ...(expectedTools.length > 0
      ? { expectedToolCalls: expectedTools.map((name) => ({ name })) }
      : {}),
    ...(requiredCitations.length > 0 ? { requiredCitations } : {}),
    ...(minLength === undefined ? {} : { minLength }),
    ...(maxLength === undefined ? {} : { maxLength }),
  };
}

function csvFlag(parsed: ParsedArgs, ...names: string[]): string[] {
  return (flagValue(parsed.flags, ...names) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function optionalCsvFlag(
  parsed: ParsedArgs,
  ...names: string[]
): string[] | undefined {
  return flagValue(parsed.flags, ...names) === undefined
    ? undefined
    : csvFlag(parsed, ...names);
}

function optionalMappingFlag(
  parsed: ParsedArgs,
  ...names: string[]
): Record<string, string> | undefined {
  const values = optionalCsvFlag(parsed, ...names);
  if (values === undefined) return undefined;
  const output: Record<string, string> = {};
  for (const value of values) {
    const [external, internal] = value.split("=", 2);
    if (
      external === undefined ||
      internal === undefined ||
      external.length === 0 ||
      internal.length === 0
    ) {
      throw new CliUsageError(
        `--${names[0]} entries must use external=internal.`,
      );
    }
    output[external] = internal;
  }
  return output;
}

function billingQuotaTemplates(
  parsed: ParsedArgs,
  required = true,
): BillingPlanQuotaTemplate[] {
  const quotas = csvFlag(parsed, "quota", "quotas");
  if (!required && quotas.length === 0) return [];
  if (quotas.length === 0) throw new CliUsageError("Missing --quota.");
  return quotas.map((quota) => {
    const [metric, limitRaw, resetInterval = "monthly"] = quota.split(":");
    if (
      metric !== "run.started" &&
      metric !== "tool.call" &&
      metric !== "storage.byte"
    ) {
      throw new CliUsageError(
        "--quota metric must be run.started, tool.call, or storage.byte.",
      );
    }
    if (
      resetInterval !== "none" &&
      resetInterval !== "daily" &&
      resetInterval !== "monthly"
    ) {
      throw new CliUsageError(
        "--quota reset interval must be none, daily, or monthly.",
      );
    }
    const limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 0)
      throw new CliUsageError("--quota limit must be a non-negative integer.");
    return { metric, limit, resetInterval };
  });
}

function billingPlanStatus(
  value: string,
): "active" | "canceled" | "past_due" | "trialing" {
  if (
    value === "active" ||
    value === "canceled" ||
    value === "past_due" ||
    value === "trialing"
  )
    return value;
  throw new CliUsageError(
    "--status must be active, canceled, past_due, or trialing.",
  );
}

function billingPlanSource(value: string): "external" | "manual" {
  if (value === "external" || value === "manual") return value;
  throw new CliUsageError("--source must be external or manual.");
}

function billingExternalEventType(
  value: string,
):
  | "customer.updated"
  | "invoice.paid"
  | "invoice.payment_failed"
  | "subscription.canceled"
  | "subscription.created"
  | "subscription.updated" {
  if (
    value === "customer.updated" ||
    value === "invoice.paid" ||
    value === "invoice.payment_failed" ||
    value === "subscription.canceled" ||
    value === "subscription.created" ||
    value === "subscription.updated"
  ) {
    return value;
  }
  throw new CliUsageError(
    "--event must be a supported billing external event type.",
  );
}

function folderItemResourceType(value: string): FolderItemResourceType {
  if (value === "agent" || value === "chat" || value === "knowledge_base")
    return value;
  throw new CliUsageError("--type must be agent, chat, or knowledge_base.");
}

function promptVisibility(
  value: string,
): "marketplace" | "private" | "workspace" {
  if (value === "marketplace" || value === "private" || value === "workspace")
    return value;
  throw new CliUsageError(
    "--visibility must be private, workspace, or marketplace.",
  );
}

function scopeCsvFlag(parsed: ParsedArgs, name: string): Scope[] {
  const scopes = csvFlag(parsed, name);
  if (scopes.length === 0) throw new CliUsageError(`Missing --${name}.`);
  return scopes as Scope[];
}

function requiredRating(parsed: ParsedArgs): "fail" | "neutral" | "pass" {
  const rating = requiredFlag(parsed, "rating");
  if (rating === "fail" || rating === "neutral" || rating === "pass")
    return rating;
  throw new CliUsageError("--rating must be pass, neutral, or fail.");
}

function toolResponseValidationStatus(
  value: string,
): "failed" | "not_applicable" | "passed" | "skipped" {
  if (
    value === "failed" ||
    value === "not_applicable" ||
    value === "passed" ||
    value === "skipped"
  )
    return value;
  throw new CliUsageError(
    "--schema-validation must be failed, not_applicable, passed, or skipped.",
  );
}

function requiredHttpStatusFlag(parsed: ParsedArgs, name: string): number {
  const raw = requiredFlag(parsed, name);
  const parsedValue = Number(raw);
  if (!Number.isInteger(parsedValue) || parsedValue < 100 || parsedValue > 599)
    throw new CliUsageError(`--${name} must be an HTTP status code.`);
  return parsedValue;
}

function numberFlag(
  parsed: ParsedArgs,
  defaultValue: number,
  name: string,
): number {
  const raw = flagValue(parsed.flags, name);
  if (raw === undefined) return defaultValue;
  const parsedValue = Number(raw);
  if (!Number.isFinite(parsedValue) || parsedValue < 0)
    throw new CliUsageError(`--${name} must be a non-negative number.`);
  return parsedValue;
}

function optionalBooleanFlag(
  parsed: ParsedArgs,
  name: string,
): boolean | undefined {
  const raw = flagValue(parsed.flags, name);
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new CliUsageError(`--${name} must be true or false.`);
}

function optionalIntegerFlag(
  parsed: ParsedArgs,
  name: string,
): number | undefined {
  const raw = flagValue(parsed.flags, name);
  if (raw === undefined) return undefined;
  const parsedValue = Number(raw);
  if (!Number.isInteger(parsedValue) || parsedValue < 1)
    throw new CliUsageError(`--${name} must be a positive integer.`);
  return parsedValue;
}

function optionalNonNegativeIntegerFlag(
  parsed: ParsedArgs,
  name: string,
): number | undefined {
  const raw = flagValue(parsed.flags, name);
  if (raw === undefined) return undefined;
  const parsedValue = Number(raw);
  if (!Number.isInteger(parsedValue) || parsedValue < 0)
    throw new CliUsageError(`--${name} must be a non-negative integer.`);
  return parsedValue;
}

function auditFilter(context: CommandContext): AuditLogFilter {
  const action = flagValue(context.parsed.flags, "action");
  const outcome = flagValue(context.parsed.flags, "outcome");
  const resourceType = flagValue(context.parsed.flags, "resource-type");
  const filter: AuditLogFilter = {};
  if (action !== undefined) filter.action = action;
  if (outcome === "success" || outcome === "failure") filter.outcome = outcome;
  if (resourceType !== undefined) filter.resourceType = resourceType;
  return filter;
}

function isTextDelta(value: unknown): value is { text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string"
  );
}

function printUsage(io: CliIo): void {
  io.stdout.write(`Romeo CLI

Usage:
  romeo health [--base-url URL] [--api-key KEY]
  romeo providers summary
  romeo models list
  romeo models sync --provider ID
  romeo billing plan
  romeo billing entitlements
  romeo billing reconcile-entitlements
  romeo billing lifecycle
  romeo billing enforce-lifecycle
  romeo billing apply-plan --code pro --name "Pro" --quota run.started:1000:monthly,tool.call:5000:monthly
  romeo billing sync-external --provider stripe --event invoice.paid --external-customer cus_123 --external-subscription sub_123 --plan-code pro --plan-name "Pro" --quota run.started:1000:monthly
  romeo sessions request-impersonation --target-user user_123 --confirm-target-user user_123 --reason "Support ticket investigation" --ticket TICKET-123 --ttl-minutes 15
  romeo sessions approve-impersonation --request support_request_123
  romeo sessions impersonate --target-user user_123 --confirm-target-user user_123 --reason "Support ticket investigation" --ticket TICKET-123 --ttl-minutes 15
  romeo sessions impersonation-report
  romeo sessions impersonation-requests
  romeo groups list
  romeo groups create --name "Reviewers" [--slug reviewers]
  romeo groups members --group group_reviewers
  romeo groups add-member --group group_reviewers --user user_123
  romeo groups remove-member --group group_reviewers --user user_123
  romeo audit list [--action ACTION] [--outcome success|failure]
  romeo audit export [--action ACTION]
  romeo evals create --agent ID --prompt TEXT --expected TEXT [--must-contain TEXT[,TEXT]] [--must-not-contain TEXT[,TEXT]] [--expected-tool NAME[,NAME]] [--required-citation ID[,ID]] [--min-length N] [--max-length N]
  romeo evals run --suite ID
  romeo evals compare-models --suite ID --models MODEL_ID,MODEL_ID
  romeo evals dashboard --agent ID
  romeo evals ratings --run ID
  romeo evals rate --result ID --rating pass|neutral|fail [--comment TEXT]
  romeo share agent --agent ID [--group group_reviewers]
  romeo share chat --chat ID [--group group_reviewers]
  romeo share kb --kb ID [--group group_reviewers]
  romeo share prompt --prompt ID [--group group_reviewers]
  romeo share targets [--query TEXT] [--limit N]
  romeo prompts list --workspace ID [--query TEXT]
  romeo prompts marketplace --workspace ID [--query TEXT]
  romeo prompts create --workspace ID --name NAME --body TEXT [--tags tag,tag] [--visibility private|workspace|marketplace]
  romeo prompts update --prompt ID [--name NAME] [--body TEXT] [--tags tag,tag] [--visibility private|workspace|marketplace]
  romeo comments list --chat ID
  romeo comments create --chat ID --body TEXT
  romeo notifications list
  romeo notifications read --notification ID
  romeo notifications channels
  romeo notifications channel-create [--type webhook] --url https://example.com/notifications [--name NAME] [--enabled-notification-types chat_mention]
  romeo notifications channel-create --type email --to user@example.com [--name NAME] [--enabled-notification-types chat_mention]
  romeo notifications channel-create --type mobile_push --token-ref romeo-secret://secret_device_token [--platform android|ios|web] [--collapse-key KEY] [--name NAME] [--enabled-notification-types chat_mention]
  romeo notifications channel-create --type slack --url https://hooks.slack.com/services/... [--name NAME] [--enabled-notification-types chat_mention]
  romeo notifications channel-create --type teams --url https://example.webhook.office.com/... [--name NAME] [--enabled-notification-types chat_mention]
  romeo notifications channel-create --type pagerduty --routing-key-ref vault://romeo/pagerduty-routing-key [--severity info|warning|error|critical] [--name NAME] [--enabled-notification-types chat_mention]
  romeo notifications deliveries
  romeo notifications retry-due
  romeo notifications policy
  romeo notifications policy-update [--delivery-enabled true|false] [--allowed-channel-types webhook,email,mobile_push,slack,teams,pagerduty] [--allowed-webhook-hosts hooks.example.com,*.example.net] [--allowed-slack-hosts hooks.slack.com] [--allowed-teams-hosts example.webhook.office.com] [--allowed-email-domains example.com] [--suppressed-notification-types chat_mention]
  romeo voices list
  romeo voices sync
  romeo gallery agents [--workspace ID]
  romeo favorites agent --agent ID
  romeo folders list --workspace ID
  romeo folders create --workspace ID --name NAME
  romeo folders share --folder ID [--group group_reviewers]
  romeo folders items --folder ID
  romeo folders add-item --folder ID --type agent|chat|knowledge_base --resource ID
  romeo folders delete-item --folder ID --item ID
  romeo devices list
  romeo devices create --name NAME --scopes me:read,chats:read [--ttl-days 90]
  romeo devices refresh --refresh-token TOKEN
  romeo devices revoke --device ID
  romeo connectors list [--workspace ID]
  romeo connectors create-local --workspace ID --kb ID [--name NAME] [--source-access-mode connector_owner]
  romeo connectors create-website --workspace ID --kb ID --url https://docs.example.com [--name NAME] [--sync-interval-minutes 60] [--source-access-mode connector_owner]
  romeo connectors create-rss --workspace ID --kb ID --url https://docs.example.com/feed.xml [--name NAME] [--max-items 20] [--sync-interval-minutes 60] [--source-access-mode connector_owner]
  romeo connectors sync --connector ID
  romeo connectors sync-local --connector ID --file path --mime-type text/markdown
  romeo workflows list [--workspace ID]
  romeo workflows templates
  romeo workflows create-template --template ID --workspace ID [--agent ID] [--name NAME] [--schedule-interval-minutes N]
  romeo workflows create --workspace ID --name NAME --agent ID [--handoff-agent ID] [--handoff-prompt TEXT] [--room-agents agent_a,agent_b] [--room-prompt TEXT] [--tool-approval NAME] [--tool-risk low|medium|high] [--tool-input-keys key1,key2] [--browser-url https://example.com/path] [--browser-task TEXT] [--retry-attempts 2] [--on-failure fail|continue] [--approval TEXT] [--schedule-interval-minutes N]
  romeo workflows run-due-schedules
  romeo workflows run --workflow ID
  romeo workflows resume --run ID
  romeo workflows approve --run ID [--comment TEXT]
  romeo workflows browser-task-claim [--lease-seconds 300]
  romeo workflows browser-task-renew --job ID [--lease-seconds 300]
  romeo workflows browser-artifact-upload --job ID --file path --type screenshot|trace --content-type image/png
  romeo workflows browser-tasks-expire [--queued-timeout-seconds 86400] [--running-timeout-seconds 3600] [--limit 100]
  romeo workflows browser-task-complete --job ID [--final-url https://example.com/path] [--artifact-count N] [--duration-ms N] [--navigation-count N] [--network-denied-count N] [--captured-bytes N] [--output-keys key,key] [--redaction-applied true|false]
  romeo workflows browser-task-fail --job ID --error-code browser_failed
  romeo governance retention [--days 365]
  romeo governance retention-enforce
  romeo governance data-delete-preview --chat ID
  romeo governance data-delete --chat ID --confirm ID
  romeo governance compliance-report
  romeo governance compliance-report-export
  romeo workspaces archive --workspace ID
  romeo workspaces export --workspace ID
  romeo access-review
  romeo access-review export
  romeo readiness
  romeo jobs list
  romeo jobs summary
  romeo sso settings
  romeo sso update [--enable|--disable] [--provider-preset keycloak] [--issuer-url URL] [--client-id ID] [--group-claim groups] [--admin-groups group_a,group_b] [--group-map external=group_id] [--workspace-group-map external=workspace_id] [--workspace-group-prefix workspace:]
  romeo sso test
  romeo sso deprovision-oidc --oidc-subject SUBJECT --confirm-oidc-subject SUBJECT [--issuer-url URL]
  romeo users list
  romeo users disable --user ID
  romeo agents list [--workspace ID]
  romeo tools auth-check --connector ID
  romeo tools connector-enable --connector ID
  romeo tools connector-disable --connector ID
  romeo tools operation-enable --connector ID --operation ID
  romeo tools operation-disable --connector ID --operation ID
  romeo tools operation-dispatch --connector ID --operation ID [--param key=value] [--approved --approval-request ID]
  romeo tools operation-enqueue --connector ID --operation ID [--param key=value] [--approved --approval-request ID] [--idempotency-key KEY]
  romeo tools dispatch-request-claim [--lease-seconds 300]
  romeo tools dispatch-request-renew --job ID [--lease-seconds 300]
  romeo tools dispatch-requests-expire [--queued-timeout-seconds 86400] [--running-timeout-seconds 3600] [--limit 100]
  romeo tools dispatch-request-complete --job ID --status 200 [--content-type application/json] [--body-bytes 0] [--truncated] [--schema-validation passed]
  romeo tools dispatch-request-fail --job ID --error-code worker_failed
  romeo tools dispatch-request-cancel --job ID [--reason-code operator_cancelled]
  romeo chat archive --chat ID
  romeo chat legal-hold --chat ID --until ISO_TIMESTAMP [--reason TEXT]
  romeo chat legal-hold-clear --chat ID
  romeo chat run --workspace ID --agent ID --prompt TEXT [--json]
  romeo agent export --agent ID
  romeo agent import --workspace ID --file agent.json
  romeo knowledge upload --kb ID --file path --mime-type text/markdown
  romeo knowledge extract --kb ID --source ID
  romeo knowledge index-embeddings --kb ID --provider ID --model MODEL [--batch-size 16]
  romeo connectors create-s3 --workspace ID --kb ID --bucket BUCKET [--prefix PREFIX] [--region us-east-1] [--secret-ref env://S3_TOKEN] [--source-access-mode connector_owner]
  romeo webhooks create --url https://hooks.example/romeo --events run.completed,run.failed
  romeo webhooks test --webhook ID
  romeo webhooks deliveries [--webhook ID]
  romeo webhooks retry-due
  romeo workers webhook-retry [--once] [--interval-ms 60000] [--max-iterations N]
  romeo workers notification-retry [--once] [--interval-ms 60000] [--max-iterations N]
  romeo workers tool-dispatch [--payload-file payloads.json] [--secret-resolver disabled|env|vault|aws-sm|gcp-sm|azure-kv|cloud] [--once] [--interval-ms 10000] [--max-iterations N] [--max-jobs N] [--lease-seconds 300] [--timeout-ms 10000] [--max-bytes 1000000]
  romeo workers browser-automation --runner-url https://browser-runner.internal/tasks [--once] [--interval-ms 10000] [--max-iterations N] [--max-jobs N] [--lease-seconds 300] [--timeout-ms 30000] [--max-bytes 20000]
  romeo workers knowledge-extraction --kb ID [--once] [--interval-ms 60000] [--max-iterations N] [--max-sources N]
  romeo workers data-connector-sync [--workspace ID] [--once] [--interval-ms 60000] [--max-iterations N] [--max-connectors N]
  romeo workers voice-catalog-sync [--once] [--interval-ms 86400000] [--max-iterations N]
  romeo workers workflow-resume [--workspace ID] [--once] [--interval-ms 60000] [--max-iterations N] [--max-workflows N] [--max-runs N]
  romeo workers retention-enforce [--once] [--interval-ms 86400000] [--max-iterations N]
  romeo workers billing-entitlement-reconcile [--once] [--interval-ms 300000] [--max-iterations N]
  romeo workers billing-lifecycle-enforce [--once] [--interval-ms 900000] [--max-iterations N]
`);
}
