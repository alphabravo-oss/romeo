import { createHash } from "node:crypto";

import type { RunEvent } from "@romeo/ai-runtime";
import type { AuthSubject } from "@romeo/auth";
import { readEnv } from "@romeo/config";
import { defaultProviderCapabilities, type BaseModel } from "@romeo/providers";
import { disabledRagProvider } from "@romeo/rag";
import {
  MemoryObjectStore,
  type ObjectStore,
  type PutObjectInput,
} from "@romeo/storage";
import type { VoiceProvider } from "@romeo/voices";
import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { fixtureFuture, fixturePast } from "./test-support/fixture-clock";
import type {
  AuditLog,
  KnowledgeSource,
  RunRecord,
  ToolConnector,
  ToolOperation,
  UserNotification,
  UsageEvent,
  WorkflowDefinition,
  WorkflowRun,
} from "./domain/entities";
import type { RomeoRepository } from "./domain/repository";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { ApiKeyService } from "./services/api-key-service";
import { AbuseControlService } from "./services/abuse-control-service";
import { BillingService } from "./services/billing-service";
import { ChannelService } from "./services/channel-service";
import { ChatService } from "./services/chat-service";
import { CollaborationService } from "./services/collaboration-service";
import { DataConnectorService } from "./services/data-connector-service";
import { DelegatedOAuthService } from "./services/delegated-oauth-service";
import { DelegatedOAuthTokenVault } from "./services/delegated-oauth-token-vault";
import { DeviceAuthorizationService } from "./services/device-authorization-service";
import { DirectorySyncService } from "./services/directory-sync-service";
import { EvalService } from "./services/eval-service";
import { FileService } from "./services/file-service";
import { AgentKnowledgeService } from "./services/agent-knowledge-service";
import { GovernanceService } from "./services/governance-service";
import { ChatCommentService } from "./services/chat-comment-service";
import { GroupService } from "./services/group-service";
import { KnowledgeService } from "./services/knowledge-service";
import type { KnowledgeVectorStore } from "./services/knowledge-vector-store";
import { LocalAuthService } from "./services/local-auth-service";
import { LocalMfaSecretVault } from "./services/local-mfa-secret-vault";
import { LdapAuthService } from "./services/ldap-auth-service";
import type {
  LdapDirectoryClient,
  LdapDirectoryEntry,
  LdapDirectorySearchOptions,
} from "./services/ldap-directory-client";
import { ManagedSecretService } from "./services/managed-secret-service";
import { oidcUserId } from "./services/oidc-client";
import { OpenWebUiCompatibilityService } from "./services/openwebui-compatibility-service";
import { PromptTemplateService } from "./services/prompt-template-service";
import { ProviderService } from "./services/provider-service";
import { QuotaService } from "./services/quota-service";
import { RunEventSequencer } from "./services/run-event-sequencer";
import { RunService } from "./services/run-service";
import { SecretRotationService } from "./services/secret-rotation-service";
import { EnvironmentSecretResolver } from "./services/secret-resolver";
import { SessionService } from "./services/session-service";
import { ServiceAccountService } from "./services/service-account-service";
import { ScimService } from "./services/scim-service";
import { SsoSettingsService } from "./services/sso-settings-service";
import { AuthProviderSettingsService } from "./services/auth-provider-settings-service";
import { TenantAdminService } from "./services/tenant-admin-service";
import { ToolConnectorService } from "./services/tool-connector-service";
import { ToolService } from "./services/tool-service";
import { enqueueToolOperationDispatch } from "./services/tool-operation-dispatch";
import { completeToolOperationDispatchRequest } from "./services/tool-operation-dispatch-requests";
import { UserLifecycleService } from "./services/user-lifecycle-service";
import { VoiceService } from "./services/voice-service";
import { WebhookService } from "./services/webhook-service";
import { WorkspaceService } from "./services/workspace-service";
import { WorkflowService } from "./services/workflow-service";

describe("durable transaction boundaries", () => {
  it("rolls back agent publish when the publish audit write fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(
      failAuditRepository(repository, "agent.version.publish"),
    );

    const response = await api.request(
      "/api/v1/agents/agent_default/versions",
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(500);
    expect(await repository.listAgentVersions("agent_default")).toHaveLength(1);
    expect(await repository.getAgent("agent_default")).toMatchObject({
      publishedVersionId: "agent_version_default_v1",
    });
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "agent.version.publish",
      ),
    ).toBe(false);
  });

  it("rolls back dispatch request completion when readback audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createBackgroundJob({
      id: "job_dispatch_readback_rollback",
      orgId: "org_default",
      type: "tool.operation.dispatch_request",
      status: "queued",
      payload: {
        connectorId: "connector_1",
        operationId: "create-ticket",
        method: "POST",
        path: "/tickets",
        host: "tickets.example.com",
        parameterKeys: [],
        bodyKeys: ["title"],
      },
      createdAt: "2026-06-30T15:00:00.000Z",
      updatedAt: "2026-06-30T15:00:00.000Z",
    });
    await repository.claimBackgroundJob({
      orgId: "org_default",
      type: "tool.operation.dispatch_request",
      workerId: workerSubject().id,
      leaseSeconds: 300,
    });

    await expect(
      completeToolOperationDispatchRequest({
        repository: failAuditRepository(
          repository,
          "tool.operation.dispatch_request.complete",
        ),
        subject: workerSubject(),
        jobId: "job_dispatch_readback_rollback",
        response: {
          ok: true,
          status: 200,
          contentType: "application/json",
          bodyBytes: 32,
          truncated: false,
          schemaValidation: { status: "passed" },
        },
      }),
    ).rejects.toThrow(
      "Injected audit failure: tool.operation.dispatch_request.complete",
    );

    const job = (await repository.listBackgroundJobs("org_default")).find(
      (item) => item.id === "job_dispatch_readback_rollback",
    );
    expect(job).toMatchObject({ status: "running" });
    expect(job?.completedAt).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "tool.operation.dispatch_request.complete",
      ),
    ).toBe(false);
  });

  it("rolls back dispatch request enqueue and approval consumption when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const { connector, operation } = dispatchFixture("enqueue_rollback");
    const approvalRequestId = "job_dispatch_enqueue_approval_rollback";
    await repository.createBackgroundJob({
      id: approvalRequestId,
      orgId: "org_default",
      type: "tool.operation.approval_request",
      status: "completed",
      payload: {
        actorId: toolManageSubject().id,
        connectorId: connector.id,
        operationId: operation.operationId,
        method: operation.method,
        path: operation.path,
        approvalPolicy: operation.approvalPolicy,
        riskLevel: operation.riskLevel,
        parameterKeys: ["issueId"],
        bodyKeys: ["title"],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    await expect(
      enqueueToolOperationDispatch({
        repository: failAuditRepository(
          repository,
          "tool.operation.dispatch.enqueue",
        ),
        subject: toolManageSubject(),
        connector,
        operation,
        externalExecutionEnabled: true,
        fetchImpl: fetch,
        maxBytes: 1024,
        secretResolver: {} as never,
        timeoutMs: 1000,
        approved: true,
        approvalRequestId,
        parameters: { issueId: "ISSUE-ROLLBACK" },
        body: { title: "dispatch enqueue rollback" },
      }),
    ).rejects.toThrow(
      "Injected audit failure: tool.operation.dispatch.enqueue",
    );

    const jobs = await repository.listBackgroundJobs("org_default");
    const approvalRequest = jobs.find((job) => job.id === approvalRequestId);
    expect(approvalRequest?.payload.consumedAt).toBeUndefined();
    expect(approvalRequest?.payload.consumedBy).toBeUndefined();
    expect(
      jobs.some((job) => job.type === "tool.operation.dispatch_request"),
    ).toBe(false);
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "tool.operation.dispatch.enqueue",
      ),
    ).toBe(false);
  });

  it("rolls back operation approval decisions when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const { connector, operation } = dispatchFixture("approval_rollback");
    const approvalRequestId = "job_operation_approval_decision_rollback";
    await repository.createBackgroundJob({
      id: approvalRequestId,
      orgId: "org_default",
      type: "tool.operation.approval_request",
      status: "completed",
      payload: {
        actorId: toolUseSubject().id,
        connectorId: connector.id,
        operationId: operation.operationId,
        method: operation.method,
        path: operation.path,
        approvalPolicy: operation.approvalPolicy,
        riskLevel: operation.riskLevel,
        parameterKeys: ["issueId"],
        bodyKeys: ["title"],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    const service = new ToolService(
      failAuditRepository(repository, "tool.operation.approval.reject"),
      {} as never,
    );

    await expect(
      service.rejectApproval(toolUseSubject(), approvalRequestId),
    ).rejects.toThrow("Injected audit failure: tool.operation.approval.reject");

    const jobs = await repository.listBackgroundJobs("org_default");
    const approvalRequest = jobs.find((job) => job.id === approvalRequestId);
    expect(approvalRequest?.payload.decision).toBeUndefined();
    expect(approvalRequest?.payload.rejectedAt).toBeUndefined();
    expect(approvalRequest?.payload.rejectedBy).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "tool.operation.approval.reject",
      ),
    ).toBe(false);
  });

  it("rolls back agent tool binding updates when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = toolBindingService(
      failAuditRepository(repository, "agent.tool_binding.update"),
    );

    await expect(
      service.updateBinding({
        subject: agentCapabilityAdminSubject(),
        agentId: "agent_default",
        toolId: "tool_datetime",
        approvalRequired: false,
      }),
    ).rejects.toThrow("Injected audit failure: agent.tool_binding.update");

    expect(
      (await repository.listAgentToolBindings("agent_default")).find(
        (binding) => binding.toolId === "tool_datetime",
      ),
    ).toMatchObject({ approvalRequired: true });
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "agent.tool_binding.update",
      ),
    ).toBe(false);
  });

  it("rolls back agent knowledge binding updates when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new AgentKnowledgeService(
      failAuditRepository(repository, "agent.knowledge_binding.update"),
    );

    await expect(
      service.update({
        subject: agentCapabilityAdminSubject(),
        agentId: "agent_default",
        knowledgeBaseId: "kb_default",
        enabled: false,
      }),
    ).rejects.toThrow("Injected audit failure: agent.knowledge_binding.update");

    expect(
      (await repository.listAgentKnowledgeBindings("agent_default")).find(
        (binding) => binding.knowledgeBaseId === "kb_default",
      ),
    ).toMatchObject({ enabled: true });
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "agent.knowledge_binding.update",
      ),
    ).toBe(false);
  });

  it("rolls back delegated OAuth revocation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const env = delegatedOAuthEnv();
    const now = "2026-07-03T13:00:00.000Z";
    const tokenVault = new DelegatedOAuthTokenVault(
      env.DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY,
    );
    await repository.createDelegatedOAuthConnection({
      id: "delegated_oauth_revoke_rollback",
      orgId: "org_default",
      workspaceId: "workspace_default",
      userId: "user_dev_admin",
      providerId: "github",
      connectorType: "github",
      providerAccountId: "provider-account-rollback",
      providerAccountLogin: "provider-login-rollback",
      scopes: ["repo"],
      status: "active",
      token: tokenVault.encrypt({
        accessToken: "gho_revoke_rollback",
        obtainedAt: now,
        scopes: ["repo"],
        tokenType: "bearer",
      }),
      createdAt: now,
      updatedAt: now,
    });
    const service = new DelegatedOAuthService(
      failAuditRepository(repository, "delegated_oauth.revoke"),
      env,
      {
        fetchImpl: async () => new Response(null, { status: 204 }),
      },
    );

    await expect(
      service.revoke({
        subject: delegatedOAuthSubject(),
        connectionId: "delegated_oauth_revoke_rollback",
      }),
    ).rejects.toThrow("Injected audit failure: delegated_oauth.revoke");

    const connection = await repository.getDelegatedOAuthConnection(
      "delegated_oauth_revoke_rollback",
    );
    expect(connection?.status).toBe("active");
    expect(connection?.revokedAt).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "delegated_oauth.revoke",
      ),
    ).toBe(false);
  });

  it("rolls back quota bucket creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new QuotaService(
      failAuditRepository(repository, "quota.create"),
    );

    await expect(
      service.create({
        subject: apiKeyAdminSubject(),
        scopeType: "org",
        metric: "run.started",
        limit: 100,
        resetInterval: "monthly",
      }),
    ).rejects.toThrow("Injected audit failure: quota.create");

    expect(await repository.listQuotaBuckets("org_default")).toHaveLength(0);
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "quota.create",
      ),
    ).toBe(false);
  });

  it("rolls back quota bucket updates when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedQuotaBucket(repository, "quota_update_rollback", {
      limit: 100,
      used: 7,
    });
    const service = new QuotaService(
      failAuditRepository(repository, "quota.update"),
    );

    await expect(
      service.update({
        subject: apiKeyAdminSubject(),
        quotaBucketId: "quota_update_rollback",
        limit: 200,
        resetUsage: true,
      }),
    ).rejects.toThrow("Injected audit failure: quota.update");

    expect(
      (await repository.listQuotaBuckets("org_default")).find(
        (bucket) => bucket.id === "quota_update_rollback",
      ),
    ).toMatchObject({ limit: 100, used: 7 });
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "quota.update",
      ),
    ).toBe(false);
  });

  it("rolls back quota bucket deletion when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedQuotaBucket(repository, "quota_delete_rollback", {
      limit: 100,
      used: 3,
    });
    const service = new QuotaService(
      failAuditRepository(repository, "quota.delete"),
    );

    await expect(
      service.delete(apiKeyAdminSubject(), "quota_delete_rollback"),
    ).rejects.toThrow("Injected audit failure: quota.delete");

    expect(
      (await repository.listQuotaBuckets("org_default")).find(
        (bucket) => bucket.id === "quota_delete_rollback",
      ),
    ).toMatchObject({ limit: 100, used: 3 });
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "quota.delete",
      ),
    ).toBe(false);
  });

  it("rolls back tool connector auth updates when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const { connector } = dispatchFixture("auth_update_rollback");
    await repository.createToolConnector(connector);

    await expect(
      new ToolConnectorService(
        failAuditRepository(repository, "tool.connector.auth.update"),
      ).updateAuth({
        subject: toolManageSubject(),
        connectorId: connector.id,
        type: "bearer",
        secretRef: "env://TOOL_CONNECTOR_TOKEN",
      }),
    ).rejects.toThrow("Injected audit failure: tool.connector.auth.update");

    expect(
      (await repository.listToolConnectors("org_default")).find(
        (item) => item.id === connector.id,
      )?.authConfig,
    ).toEqual(connector.authConfig);
  });

  it("rolls back tool connector enablement when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const { connector } = dispatchFixture("connector_update_rollback");
    await repository.createToolConnector(connector);

    await expect(
      new ToolConnectorService(
        failAuditRepository(repository, "tool.connector.update"),
      ).updateConnector({
        subject: toolManageSubject(),
        connectorId: connector.id,
        enabled: false,
      }),
    ).rejects.toThrow("Injected audit failure: tool.connector.update");

    expect(
      (await repository.listToolConnectors("org_default")).find(
        (item) => item.id === connector.id,
      )?.enabled,
    ).toBe(connector.enabled);
  });

  it("rolls back tool connector network policy updates when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const { connector } = dispatchFixture("network_policy_rollback");
    await repository.createToolConnector(connector);

    await expect(
      new ToolConnectorService(
        failAuditRepository(repository, "tool.connector.network_policy.update"),
      ).updateNetworkPolicy({
        subject: toolManageSubject(),
        connectorId: connector.id,
        policy: {
          mode: "allow_hosts",
          allowedHosts: ["api2.example.com"],
          allowPrivateNetwork: false,
        },
      }),
    ).rejects.toThrow(
      "Injected audit failure: tool.connector.network_policy.update",
    );

    expect(
      (await repository.listToolConnectors("org_default")).find(
        (item) => item.id === connector.id,
      )?.networkPolicy,
    ).toEqual(connector.networkPolicy);
  });

  it("rolls back tool operation enablement when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const { connector, operation } = dispatchFixture(
      "operation_update_rollback",
    );
    await repository.createToolConnector(connector);
    await repository.createToolOperations([operation]);

    await expect(
      new ToolConnectorService(
        failAuditRepository(repository, "tool.operation.update"),
      ).updateOperation({
        subject: toolManageSubject(),
        connectorId: connector.id,
        operationId: operation.operationId,
        enabled: false,
      }),
    ).rejects.toThrow("Injected audit failure: tool.operation.update");

    expect(
      (await repository.listToolOperations(connector.id)).find(
        (item) => item.id === operation.id,
      )?.enabled,
    ).toBe(operation.enabled);
  });

  it("rolls back run completion when terminal usage write fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const model = await repository.getModel("model_openai_compatible_default");
    if (!model) throw new Error("Missing default model fixture.");

    const run: RunRecord = {
      id: "run_terminal_usage_rollback",
      orgId: "org_default",
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      modelId: model.id,
      providerId: model.providerId,
      status: "running",
      createdBy: "user_dev_admin",
      createdAt: "2026-06-30T15:10:00.000Z",
    };
    await repository.createRun(run);

    const service = new RunService(
      failUsageRepository(repository, "run.completed"),
      {} as never,
    );
    const completeRun = (
      service as unknown as {
        completeRun: (
          run: RunRecord,
          event: RunEvent,
          assistantContent: string,
          model: BaseModel,
          citations: [],
        ) => Promise<void>;
      }
    ).completeRun.bind(service);

    await expect(
      completeRun(
        run,
        {
          id: "evt_terminal_usage_rollback",
          runId: run.id,
          sequence: 1,
          type: "run.completed",
          data: {},
          createdAt: "2026-06-30T15:11:00.000Z",
        },
        "Durable answer.",
        model,
        [],
      ),
    ).rejects.toThrow("Injected usage failure: run.completed");

    expect(await repository.getRun(run.id)).toMatchObject({
      status: "running",
    });
    expect((await repository.getRun(run.id))?.completedAt).toBeUndefined();
    expect(
      (await repository.listMessages(run.chatId)).some(
        (message) => message.role === "assistant",
      ),
    ).toBe(false);
    expect(
      (await repository.listUsageEvents("org_default")).some(
        (event) => event.sourceId === run.id,
      ),
    ).toBe(false);
  });

  it("rolls back run start ledger writes when started usage write fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const createdRunIds: string[] = [];
    const service = new RunService(
      failUsageRepository(repository, "run.started", { createdRunIds }),
      new RunEventSequencer(),
    );
    const beforeMessageCount = (await repository.listMessages("chat_welcome"))
      .length;
    const beforeUsageCount = (await repository.listUsageEvents("org_default"))
      .length;

    await expect(
      service.start({
        subject: runCreateSubject(),
        chatId: "chat_welcome",
        agentId: "agent_default",
        content: "Rollback this run start if usage cannot be recorded.",
      }),
    ).rejects.toThrow("Injected usage failure: run.started");

    expect(createdRunIds).toHaveLength(1);
    expect(await repository.getRun(createdRunIds[0]!)).toBeUndefined();
    expect(await repository.listRunEvents(createdRunIds[0]!)).toHaveLength(0);
    expect(await repository.listMessages("chat_welcome")).toHaveLength(
      beforeMessageCount,
    );
    expect(await repository.listUsageEvents("org_default")).toHaveLength(
      beforeUsageCount,
    );
  });

  it("rolls back data connector creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new DataConnectorService(
      failAuditRepository(repository, "data_connector.create"),
      new KnowledgeService(repository),
    );
    const beforeConnectors = await repository.listDataConnectors(
      "org_default",
      "workspace_default",
    );

    await expect(
      service.create({
        subject: knowledgeAdminSubject(),
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "local_import",
        name: "Rollback connector create",
        config: { mode: "manual" },
      }),
    ).rejects.toThrow("Injected audit failure: data_connector.create");

    expect(
      await repository.listDataConnectors("org_default", "workspace_default"),
    ).toHaveLength(beforeConnectors.length);
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "data_connector.create",
      ),
    ).toBe(false);
  });

  it("rolls back connector sync finalization when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const failingRepository = failAuditRepository(
      repository,
      "data_connector.sync",
    );
    const service = new DataConnectorService(
      failingRepository,
      new KnowledgeService(failingRepository),
    );
    const connector = await repository.createDataConnector({
      id: "connector_sync_finalization_rollback",
      orgId: "org_default",
      workspaceId: "workspace_default",
      knowledgeBaseId: "kb_default",
      type: "local_import",
      name: "Rollback local docs",
      config: { mode: "manual" },
      status: "active",
      createdBy: "user_dev_admin",
      createdAt: "2026-06-30T15:20:00.000Z",
      updatedAt: "2026-06-30T15:20:00.000Z",
    });

    await expect(
      service.sync({
        subject: knowledgeAdminSubject(),
        connectorId: connector.id,
        items: [
          {
            fileName: "rollback.md",
            mimeType: "text/markdown",
            content: "Romeo connector sync finalization should stay retryable.",
          },
        ],
      }),
    ).rejects.toThrow("Injected audit failure: data_connector.sync");

    const [sync] = await repository.listDataConnectorSyncs(
      "org_default",
      connector.id,
    );
    const updatedConnector = await repository.getDataConnector(connector.id);
    expect(sync).toMatchObject({
      status: "running",
      sourceIds: [],
      summary: { connectorType: "local_import" },
    });
    expect(sync?.completedAt).toBeUndefined();
    expect(updatedConnector).toMatchObject({
      config: { mode: "manual" },
    });
    expect(updatedConnector?.lastSyncAt).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "data_connector.sync",
      ),
    ).toBe(false);
  });

  it("rolls back chat title updates when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new ChatService(
      failAuditRepository(repository, "chat.update"),
    );
    const before = await repository.getChat("chat_welcome");

    await expect(
      service.update({
        subject: chatWriteSubject(),
        chatId: "chat_welcome",
        title: "Rollback chat title",
      }),
    ).rejects.toThrow("Injected audit failure: chat.update");

    const after = await repository.getChat("chat_welcome");
    expect(after?.title).toBe(before?.title);
    expect(after?.updatedAt).toBe(before?.updatedAt);
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "chat.update",
      ),
    ).toBe(false);
  });

  it("rolls back chat archives when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new ChatService(
      failAuditRepository(repository, "chat.archive"),
    );

    await expect(
      service.archive({
        subject: chatWriteSubject(),
        chatId: "chat_welcome",
      }),
    ).rejects.toThrow("Injected audit failure: chat.archive");

    const after = await repository.getChat("chat_welcome");
    expect(after?.archivedAt).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "chat.archive",
      ),
    ).toBe(false);
  });

  it("rolls back chat unarchives when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const chat = await repository.getChat("chat_welcome");
    if (chat === undefined) throw new Error("Expected default chat");
    await repository.updateChat({
      ...chat,
      archivedAt: "2026-07-04T12:00:00.000Z",
      updatedAt: "2026-07-04T12:00:00.000Z",
    });
    const service = new ChatService(
      failAuditRepository(repository, "chat.unarchive"),
    );

    await expect(
      service.unarchive({
        subject: chatWriteSubject(),
        chatId: "chat_welcome",
      }),
    ).rejects.toThrow("Injected audit failure: chat.unarchive");

    const after = await repository.getChat("chat_welcome");
    expect(after?.archivedAt).toBe("2026-07-04T12:00:00.000Z");
    expect(after?.updatedAt).toBe("2026-07-04T12:00:00.000Z");
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "chat.unarchive",
      ),
    ).toBe(false);
  });

  it("rolls back chat legal hold updates when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new ChatService(
      failAuditRepository(repository, "chat.legal_hold.update"),
    );

    await expect(
      service.updateLegalHold({
        subject: governanceAdminSubject(),
        chatId: "chat_welcome",
        legalHoldUntil: "2026-08-01T00:00:00.000Z",
        legalHoldReason: "Do not persist this reason when audit fails.",
      }),
    ).rejects.toThrow("Injected audit failure: chat.legal_hold.update");

    const after = await repository.getChat("chat_welcome");
    expect(after?.legalHoldUntil).toBeUndefined();
    expect(after?.legalHoldReason).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "chat.legal_hold.update",
      ),
    ).toBe(false);
  });

  it("rolls back chat legal hold clears when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const chat = await repository.getChat("chat_welcome");
    if (chat === undefined) throw new Error("Expected default chat");
    await repository.updateChat({
      ...chat,
      legalHoldUntil: "2026-08-01T00:00:00.000Z",
      legalHoldReason: "Existing hold reason",
      updatedAt: "2026-07-04T12:00:00.000Z",
    });
    const service = new ChatService(
      failAuditRepository(repository, "chat.legal_hold.clear"),
    );

    await expect(
      service.updateLegalHold({
        subject: governanceAdminSubject(),
        chatId: "chat_welcome",
        legalHoldUntil: null,
      }),
    ).rejects.toThrow("Injected audit failure: chat.legal_hold.clear");

    const after = await repository.getChat("chat_welcome");
    expect(after?.legalHoldUntil).toBe("2026-08-01T00:00:00.000Z");
    expect(after?.legalHoldReason).toBe("Existing hold reason");
    expect(after?.updatedAt).toBe("2026-07-04T12:00:00.000Z");
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "chat.legal_hold.clear",
      ),
    ).toBe(false);
  });

  it("rolls back directory sync apply when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createUser({
      id: "user_directory_sync_rollback",
      orgId: "org_default",
      email: "directory-sync-rollback@example.com",
      name: "Directory Sync Rollback",
      role: "user",
    });
    await repository.createApiKey({
      id: "api_key_directory_sync_rollback",
      orgId: "org_default",
      userId: "user_directory_sync_rollback",
      name: "Directory sync rollback key",
      hashedToken: sha256ForTest("directory-sync-rollback-key"),
      scopes: ["admin:read"],
      createdAt: "2026-07-07T15:00:00.000Z",
    });
    await repository.createGroup({
      id: "group_directory_sync_rollback",
      orgId: "org_default",
      name: "Directory sync rollback",
      slug: "directory_sync_rollback",
      createdAt: "2026-07-07T15:01:00.000Z",
    });
    await repository.createGroupMembership({
      groupId: "group_directory_sync_rollback",
      userId: "user_directory_sync_rollback",
      orgId: "org_default",
      createdAt: "2026-07-07T15:02:00.000Z",
    });
    const failingRepository = failAuditRepository(
      repository,
      "directory_sync.apply",
    );

    await expect(
      new DirectorySyncService(
        failingRepository,
        new UserLifecycleService(failingRepository),
      ).reconcile(apiKeyAdminSubject(), {
        source: "manual",
        dryRun: false,
        confirmApply: "apply-directory-sync",
        disableMissingUsers: true,
        presentUserIds: ["user_dev_admin"],
        removeMissingGroupMembers: true,
        groupMemberships: [
          { groupId: "group_directory_sync_rollback", presentUserIds: [] },
        ],
      }),
    ).rejects.toThrow("Injected audit failure: directory_sync.apply");

    expect(
      (await repository.getCurrentUser("user_directory_sync_rollback"))
        ?.disabledAt,
    ).toBeUndefined();
    expect(
      (await repository.getApiKey("api_key_directory_sync_rollback"))
        ?.revokedAt,
    ).toBeUndefined();
    expect(
      await repository.listGroupMemberships(
        "org_default",
        "group_directory_sync_rollback",
        "user_directory_sync_rollback",
      ),
    ).toHaveLength(1);
    expect(
      (await repository.listAuditLogs("org_default")).some((log) =>
        ["directory_sync.apply", "user.disable"].includes(log.action),
      ),
    ).toBe(false);
  });

  it("rolls back SCIM user creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const beforeUsers = await repository.listUsers("org_default");

    await expect(
      new ScimService(failAuditRepository(repository, "scim.user.create"), {
        enabled: true,
      }).createUser({
        subject: apiKeyAdminSubject(),
        baseUrl: "https://romeo.example/api/v1/scim/v2",
        body: {
          userName: "scim-create-rollback@example.com",
          displayName: "SCIM Create Rollback",
        },
      }),
    ).rejects.toThrow("Injected audit failure: scim.user.create");

    expect(await repository.listUsers("org_default")).toHaveLength(
      beforeUsers.length,
    );
    expect(
      (await repository.listUsers("org_default")).some(
        (user) => user.email === "scim-create-rollback@example.com",
      ),
    ).toBe(false);
  });

  it("rolls back SCIM user deactivation and credential revocation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createUser({
      id: "user_scim_deactivate_rollback",
      orgId: "org_default",
      email: "scim-deactivate-rollback@example.com",
      name: "SCIM Deactivate Rollback",
      role: "user",
    });
    await repository.createApiKey({
      id: "api_key_scim_deactivate_rollback",
      orgId: "org_default",
      userId: "user_scim_deactivate_rollback",
      name: "SCIM deactivate rollback key",
      hashedToken: sha256ForTest("scim-deactivate-rollback-key"),
      scopes: ["admin:read"],
      createdAt: "2026-07-07T15:10:00.000Z",
    });

    await expect(
      new ScimService(failAuditRepository(repository, "scim.user.patch"), {
        enabled: true,
      }).patchUser({
        subject: apiKeyAdminSubject(),
        userId: "user_scim_deactivate_rollback",
        baseUrl: "https://romeo.example/api/v1/scim/v2",
        body: { Operations: [{ op: "replace", path: "active", value: false }] },
      }),
    ).rejects.toThrow("Injected audit failure: scim.user.patch");

    expect(
      (await repository.getCurrentUser("user_scim_deactivate_rollback"))
        ?.disabledAt,
    ).toBeUndefined();
    expect(
      (await repository.getApiKey("api_key_scim_deactivate_rollback"))
        ?.revokedAt,
    ).toBeUndefined();
  });

  it("rolls back SCIM group creation and membership writes when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createUser({
      id: "user_scim_group_create_rollback",
      orgId: "org_default",
      email: "scim-group-create-rollback@example.com",
      name: "SCIM Group Create Rollback",
      role: "user",
    });

    await expect(
      new ScimService(failAuditRepository(repository, "scim.group.create"), {
        enabled: true,
      }).createGroup({
        subject: apiKeyAdminSubject(),
        baseUrl: "https://romeo.example/api/v1/scim/v2",
        body: {
          displayName: "SCIM Group Rollback",
          members: [{ value: "user_scim_group_create_rollback" }],
        },
      }),
    ).rejects.toThrow("Injected audit failure: scim.group.create");

    expect(
      await repository.getGroup("group_scim_group_rollback"),
    ).toBeUndefined();
    expect(
      await repository.listGroupMemberships(
        "org_default",
        "group_scim_group_rollback",
      ),
    ).toHaveLength(0);
  });

  it("rolls back inline knowledge source import when usage write fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const createdSources: KnowledgeSource[] = [];
    const service = new KnowledgeService(
      failUsageRepository(repository, "storage.source_registered", {
        createdSources,
      }),
      disabledRagProvider,
      objectStore,
    );
    const beforeSources = await repository.listKnowledgeSources("kb_default");
    const beforeChunks = await repository.listKnowledgeChunks("kb_default");
    const beforeUsage = await repository.listUsageEvents("org_default");

    await expect(
      service.createSource({
        subject: knowledgeAdminSubject(),
        knowledgeBaseId: "kb_default",
        fileName: "rollback-import.md",
        mimeType: "text/markdown",
        sizeBytes: 61,
        content:
          "Rollback this imported knowledge source when usage cannot persist.",
      }),
    ).rejects.toThrow("Injected usage failure: storage.source_registered");

    expect(createdSources).toHaveLength(1);
    expect(
      (await repository.listKnowledgeSources("kb_default")).map(
        (source) => source.id,
      ),
    ).toEqual(beforeSources.map((source) => source.id));
    expect(await repository.listKnowledgeChunks("kb_default")).toHaveLength(
      beforeChunks.length,
    );
    expect(await repository.listUsageEvents("org_default")).toHaveLength(
      beforeUsage.length,
    );
    expect(
      await objectStore.getObject(createdSources[0]!.objectKey ?? ""),
    ).toBeUndefined();
  });

  it("rolls back uploaded knowledge source completion when usage write fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const objectKey = "knowledge/kb_default/kb_source_upload_rollback/doc.md";
    const source: KnowledgeSource = {
      id: "kb_source_upload_rollback",
      knowledgeBaseId: "kb_default",
      orgId: "org_default",
      workspaceId: "workspace_default",
      fileName: "uploaded-rollback.md",
      mimeType: "text/markdown",
      sizeBytes: 58,
      status: "pending",
      objectKey,
      metadata: {},
      createdAt: "2026-06-30T15:25:00.000Z",
      updatedAt: "2026-06-30T15:25:00.000Z",
    };
    await repository.createKnowledgeSource(source);
    await objectStore.putObject({
      key: objectKey,
      body: new TextEncoder().encode(
        "Rollback uploaded source completion on usage failure.",
      ),
      contentType: "text/markdown",
    });
    const service = new KnowledgeService(
      failUsageRepository(repository, "storage.source_completed"),
      disabledRagProvider,
      objectStore,
    );
    const beforeUsage = await repository.listUsageEvents("org_default");

    await expect(
      service.completeUpload({
        subject: knowledgeAdminSubject(),
        knowledgeBaseId: "kb_default",
        sourceId: source.id,
      }),
    ).rejects.toThrow("Injected usage failure: storage.source_completed");

    expect(
      (await repository.listKnowledgeSources("kb_default")).find(
        (item) => item.id === source.id,
      ),
    ).toMatchObject({ status: "pending" });
    expect(
      (await repository.listKnowledgeChunks("kb_default")).filter(
        (chunk) => chunk.sourceId === source.id,
      ),
    ).toHaveLength(0);
    expect(await repository.listUsageEvents("org_default")).toHaveLength(
      beforeUsage.length,
    );
    expect(await objectStore.getObject(objectKey)).toBeDefined();
  });

  it("rolls back knowledge source upload registration when usage write fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const createdSources: KnowledgeSource[] = [];
    const service = new KnowledgeService(
      failUsageRepository(repository, "storage.source_registered", {
        createdSources,
      }),
      disabledRagProvider,
      objectStore,
    );
    const beforeSources = await repository.listKnowledgeSources("kb_default");
    const beforeUsage = await repository.listUsageEvents("org_default");

    await expect(
      service.createUpload({
        subject: knowledgeAdminSubject(),
        knowledgeBaseId: "kb_default",
        fileName: "upload-register-rollback.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      }),
    ).rejects.toThrow("Injected usage failure: storage.source_registered");

    expect(createdSources).toHaveLength(1);
    expect(
      (await repository.listKnowledgeSources("kb_default")).map(
        (source) => source.id,
      ),
    ).toEqual(beforeSources.map((source) => source.id));
    expect(await repository.listUsageEvents("org_default")).toHaveLength(
      beforeUsage.length,
    );
  });

  it("rolls back deferred knowledge extraction indexing when usage write fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const objectKey = "knowledge/kb_default/kb_source_extract_rollback/doc.pdf";
    const source: KnowledgeSource = {
      id: "kb_source_extract_rollback",
      knowledgeBaseId: "kb_default",
      orgId: "org_default",
      workspaceId: "workspace_default",
      fileName: "extract-rollback.pdf",
      mimeType: "application/pdf",
      sizeBytes: 64,
      status: "pending",
      objectKey,
      metadata: {},
      createdAt: "2026-06-30T15:27:00.000Z",
      updatedAt: "2026-06-30T15:27:00.000Z",
    };
    await repository.createKnowledgeSource(source);
    await objectStore.putObject({
      key: objectKey,
      body: new TextEncoder().encode("deferred extraction rollback"),
      contentType: "application/pdf",
    });
    const service = new KnowledgeService(
      failUsageRepository(repository, "storage.source_extracted"),
      disabledRagProvider,
      objectStore,
      {
        async extract() {
          return {
            content:
              "Rollback deferred extraction chunks when usage cannot persist.",
            metadata: { extractor: "test-pdf-worker" },
          };
        },
      },
    );
    const beforeUsage = await repository.listUsageEvents("org_default");

    await expect(
      service.extractUpload({
        subject: knowledgeAdminSubject(),
        knowledgeBaseId: "kb_default",
        sourceId: source.id,
      }),
    ).rejects.toThrow("Injected usage failure: storage.source_extracted");

    const failedSource = (
      await repository.listKnowledgeSources("kb_default")
    ).find((item) => item.id === source.id);
    expect(failedSource).toMatchObject({ status: "failed" });
    expect(failedSource?.chunkCount).toBeUndefined();
    expect(
      (await repository.listKnowledgeChunks("kb_default")).filter(
        (chunk) => chunk.sourceId === source.id,
      ),
    ).toHaveLength(0);
    expect(
      (await repository.listBackgroundJobs("org_default")).find(
        (job) => job.type === "knowledge.extract",
      ),
    ).toMatchObject({ status: "failed" });
    expect(await repository.listUsageEvents("org_default")).toHaveLength(
      beforeUsage.length,
    );
    expect(await objectStore.getObject(objectKey)).toBeDefined();
  });

  it("rolls back knowledge source reindexing when usage write fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const objectKey =
      "knowledge/kb_default/kb_source_reindex_rollback/reindex-rollback.md";
    const source: KnowledgeSource = {
      id: "kb_source_reindex_rollback",
      knowledgeBaseId: "kb_default",
      orgId: "org_default",
      workspaceId: "workspace_default",
      fileName: "reindex-rollback.md",
      mimeType: "text/markdown",
      sizeBytes: 48,
      status: "indexed",
      objectKey,
      metadata: {},
      chunkCount: 1,
      contentHash: "old-content-hash",
      createdAt: "2026-06-30T15:28:00.000Z",
      updatedAt: "2026-06-30T15:28:00.000Z",
    };
    await repository.createKnowledgeSource(source);
    await repository.createKnowledgeChunks([
      {
        id: "chunk_reindex_rollback_old",
        knowledgeBaseId: "kb_default",
        sourceId: source.id,
        orgId: "org_default",
        workspaceId: "workspace_default",
        sequence: 1,
        content: "Original reindex rollback chunk should remain.",
        tokenCount: 9,
        metadata: {},
        createdAt: "2026-06-30T15:28:01.000Z",
      },
    ]);
    await objectStore.putObject({
      key: objectKey,
      body: new TextEncoder().encode(
        "Original reindex rollback object content.",
      ),
      contentType: "text/markdown",
    });
    const vectorDeletes: string[] = [];
    const vectorStore: KnowledgeVectorStore = {
      async deleteEmbeddingsForSource(input) {
        vectorDeletes.push(input.sourceId);
      },
      async search() {
        return [];
      },
      async upsertEmbeddings() {},
    };
    const service = new KnowledgeService(
      failUsageRepository(repository, "storage.source_reindexed"),
      disabledRagProvider,
      objectStore,
      undefined,
      undefined,
      undefined,
      undefined,
      vectorStore,
    );
    const beforeUsage = await repository.listUsageEvents("org_default");

    await expect(
      service.reindexSource({
        subject: knowledgeAdminSubject(),
        knowledgeBaseId: "kb_default",
        sourceId: source.id,
        content:
          "New reindex rollback content must not replace chunks after usage failure.",
        sizeBytes: 72,
      }),
    ).rejects.toThrow("Injected usage failure: storage.source_reindexed");

    expect(
      (await repository.listKnowledgeSources("kb_default")).find(
        (item) => item.id === source.id,
      ),
    ).toMatchObject({
      status: "indexed",
      chunkCount: 1,
      contentHash: "old-content-hash",
    });
    const chunks = (await repository.listKnowledgeChunks("kb_default")).filter(
      (chunk) => chunk.sourceId === source.id,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain("Original reindex rollback");
    expect(chunks[0]?.content).not.toContain("New reindex rollback");
    expect(
      (await repository.listBackgroundJobs("org_default")).find(
        (job) => job.type === "knowledge.reindex",
      ),
    ).toMatchObject({ status: "failed" });
    expect(await repository.listUsageEvents("org_default")).toHaveLength(
      beforeUsage.length,
    );
    const restoredObject = await objectStore.getObject(objectKey);
    expect(restoredObject).toBeDefined();
    expect(new TextDecoder().decode(restoredObject!)).toBe(
      "Original reindex rollback object content.",
    );
    expect(vectorDeletes).toHaveLength(0);
  });

  it("rolls back knowledge source deletion when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const source: KnowledgeSource = {
      id: "kb_source_delete_rollback",
      knowledgeBaseId: "kb_default",
      orgId: "org_default",
      workspaceId: "workspace_default",
      fileName: "delete-rollback.md",
      mimeType: "text/markdown",
      sizeBytes: 64,
      status: "indexed",
      metadata: {},
      chunkCount: 1,
      createdAt: "2026-06-30T15:26:00.000Z",
      updatedAt: "2026-06-30T15:26:00.000Z",
    };
    await repository.createKnowledgeSource(source);
    await repository.createKnowledgeChunks([
      {
        id: "chunk_delete_rollback",
        knowledgeBaseId: "kb_default",
        sourceId: source.id,
        orgId: "org_default",
        workspaceId: "workspace_default",
        sequence: 1,
        content: "Rollback source deletion when audit cannot persist.",
        tokenCount: 8,
        metadata: {},
        createdAt: "2026-06-30T15:26:01.000Z",
      },
    ]);
    await repository.upsertKnowledgeChunkEmbeddings([
      {
        id: "embedding_delete_rollback",
        knowledgeBaseId: "kb_default",
        sourceId: source.id,
        chunkId: "chunk_delete_rollback",
        orgId: "org_default",
        workspaceId: "workspace_default",
        embeddingProvider: "test",
        embeddingModel: "unit",
        dimensions: 3,
        embedding: [1, 0, 0],
        metadata: {},
        createdAt: "2026-06-30T15:26:02.000Z",
        updatedAt: "2026-06-30T15:26:02.000Z",
      },
    ]);
    const beforeUsage = await repository.listUsageEvents("org_default");
    const service = new KnowledgeService(
      failAuditRepository(repository, "knowledge.source.delete"),
    );

    await expect(
      service.deleteSource({
        subject: knowledgeAdminSubject(),
        knowledgeBaseId: "kb_default",
        sourceId: source.id,
      }),
    ).rejects.toThrow("Injected audit failure: knowledge.source.delete");

    expect(
      (await repository.listKnowledgeSources("kb_default")).some(
        (item) => item.id === source.id,
      ),
    ).toBe(true);
    expect(
      (await repository.listKnowledgeChunks("kb_default")).some(
        (chunk) => chunk.id === "chunk_delete_rollback",
      ),
    ).toBe(true);
    expect(
      (await repository.listKnowledgeChunkEmbeddings("kb_default")).some(
        (embedding) => embedding.id === "embedding_delete_rollback",
      ),
    ).toBe(true);
    expect(await repository.listUsageEvents("org_default")).toHaveLength(
      beforeUsage.length,
    );
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "knowledge.source.delete",
      ),
    ).toBe(false);
  });

  it("rolls back knowledge base creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new KnowledgeService(
      failAuditRepository(repository, "knowledge_base.create"),
    );
    const beforeKnowledgeBases =
      await repository.listKnowledgeBases("workspace_default");
    const beforeGrants = await repository.listResourceGrants("org_default");

    await expect(
      service.create({
        subject: knowledgeAdminSubject(),
        workspaceId: "workspace_default",
        name: "Rollback knowledge base create",
        description: "This KB should only exist when audit commits.",
      }),
    ).rejects.toThrow("Injected audit failure: knowledge_base.create");

    expect(
      await repository.listKnowledgeBases("workspace_default"),
    ).toHaveLength(beforeKnowledgeBases.length);
    expect(await repository.listResourceGrants("org_default")).toHaveLength(
      beforeGrants.length,
    );
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "knowledge_base.create",
      ),
    ).toBe(false);
  });

  it("rolls back knowledge base updates when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const before = await repository.getKnowledgeBase("kb_default");
    const service = new KnowledgeService(
      failAuditRepository(repository, "knowledge_base.update"),
    );

    await expect(
      service.update({
        subject: knowledgeAdminSubject(),
        knowledgeBaseId: "kb_default",
        name: "Rollback updated knowledge base",
      }),
    ).rejects.toThrow("Injected audit failure: knowledge_base.update");

    expect(await repository.getKnowledgeBase("kb_default")).toMatchObject({
      name: before?.name,
      updatedAt: before?.updatedAt,
    });
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "knowledge_base.update",
      ),
    ).toBe(false);
  });

  it("rolls back chat comments when mention notification creation fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new ChatCommentService(
      failNotificationRepository(repository, "chat_mention"),
    );
    const beforeComments = await repository.listChatComments("chat_welcome");
    const beforeNotifications = await repository.listUserNotifications(
      "org_default",
      "user_dev_admin",
    );

    await expect(
      service.create({
        subject: chatWriteSubject(),
        chatId: "chat_welcome",
        body: "@user_dev_admin this comment should roll back with notification failure.",
      }),
    ).rejects.toThrow("Injected notification failure: chat_mention");

    expect(await repository.listChatComments("chat_welcome")).toHaveLength(
      beforeComments.length,
    );
    expect(
      await repository.listUserNotifications("org_default", "user_dev_admin"),
    ).toHaveLength(beforeNotifications.length);
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "chat.comment",
      ),
    ).toBe(false);
  });

  it("rolls back prompt template creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new PromptTemplateService(
      failAuditRepository(repository, "prompt_template.create"),
    );
    const beforeTemplates = await repository.listPromptTemplates(
      "org_default",
      "workspace_default",
    );
    const beforeGrants = await repository.listResourceGrants("org_default");

    await expect(
      service.create(promptTemplateSubject(), {
        workspaceId: "workspace_default",
        name: "Rollback prompt",
        body: "Create this prompt only when audit commits.",
        visibility: "workspace",
      }),
    ).rejects.toThrow("Injected audit failure: prompt_template.create");

    expect(
      await repository.listPromptTemplates("org_default", "workspace_default"),
    ).toHaveLength(beforeTemplates.length);
    expect(await repository.listResourceGrants("org_default")).toHaveLength(
      beforeGrants.length,
    );
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "prompt_template.create",
      ),
    ).toBe(false);
  });

  it("rolls back prompt template update, share, and delete when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new PromptTemplateService(repository);
    const template = await service.create(promptTemplateSubject(), {
      workspaceId: "workspace_default",
      name: "Transactional prompt",
      body: "Original prompt body.",
      tags: ["ops"],
    });
    const beforeShareGrants =
      await repository.listResourceGrants("org_default");

    await expect(
      new PromptTemplateService(
        failAuditRepository(repository, "prompt_template.update"),
      ).update(promptTemplateSubject(), template.id, {
        name: "Updated transactional prompt",
      }),
    ).rejects.toThrow("Injected audit failure: prompt_template.update");
    expect(await repository.getPromptTemplate(template.id)).toMatchObject({
      name: template.name,
      updatedAt: template.updatedAt,
    });

    await expect(
      new PromptTemplateService(
        failAuditRepository(repository, "prompt_template.share"),
      ).share({
        subject: promptTemplateSubject(),
        promptTemplateId: template.id,
        share: {
          principalType: "group",
          principalId: "group_reviewers",
          permissions: ["read", "use"],
        },
      }),
    ).rejects.toThrow("Injected audit failure: prompt_template.share");
    expect(await repository.listResourceGrants("org_default")).toHaveLength(
      beforeShareGrants.length,
    );

    await expect(
      new PromptTemplateService(
        failAuditRepository(repository, "prompt_template.delete"),
      ).delete(promptTemplateSubject(), template.id),
    ).rejects.toThrow("Injected audit failure: prompt_template.delete");
    expect(await repository.getPromptTemplate(template.id)).toBeDefined();
    expect(
      (await repository.listAuditLogs("org_default")).some((log) =>
        [
          "prompt_template.update",
          "prompt_template.share",
          "prompt_template.delete",
        ].includes(log.action),
      ),
    ).toBe(false);
  });

  it("rolls back user API key creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new ApiKeyService(
      failAuditRepository(repository, "api_key.create"),
    );
    const beforeApiKeys = await repository.listApiKeys("org_default");

    await expect(
      service.create({
        subject: apiKeyAdminSubject(),
        name: "Rollback API key",
        scopes: ["admin:read"],
      }),
    ).rejects.toThrow("Injected audit failure: api_key.create");

    expect(await repository.listApiKeys("org_default")).toHaveLength(
      beforeApiKeys.length,
    );
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "api_key.create",
      ),
    ).toBe(false);
  });

  it("rolls back service-account API key creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createServiceAccount({
      id: "service_account_api_key_create_rollback",
      orgId: "org_default",
      name: "API key rollback service account",
      scopes: ["admin:read"],
      createdBy: "user_dev_admin",
      createdAt: "2026-07-07T14:00:00.000Z",
    });
    const service = new ApiKeyService(
      failAuditRepository(repository, "api_key.create"),
    );
    const beforeApiKeys = await repository.listApiKeys("org_default");

    await expect(
      service.createForServiceAccount({
        subject: apiKeyAdminSubject(),
        serviceAccountId: "service_account_api_key_create_rollback",
        name: "Rollback service account key",
        scopes: ["admin:read"],
      }),
    ).rejects.toThrow("Injected audit failure: api_key.create");

    expect(await repository.listApiKeys("org_default")).toHaveLength(
      beforeApiKeys.length,
    );
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "api_key.create",
      ),
    ).toBe(false);
  });

  it("rolls back API key revocation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createApiKey({
      id: "api_key_revoke_rollback",
      orgId: "org_default",
      userId: "user_dev_admin",
      name: "Rollback revoke key",
      hashedToken: sha256ForTest("rollback-revoke-key"),
      scopes: ["admin:read"],
      createdAt: "2026-07-07T14:05:00.000Z",
    });

    await expect(
      new ApiKeyService(
        failAuditRepository(repository, "api_key.revoke"),
      ).revoke({
        subject: apiKeyAdminSubject(),
        apiKeyId: "api_key_revoke_rollback",
      }),
    ).rejects.toThrow("Injected audit failure: api_key.revoke");

    expect(
      (await repository.getApiKey("api_key_revoke_rollback"))?.revokedAt,
    ).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "api_key.revoke",
      ),
    ).toBe(false);
  });

  it("rolls back service account creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new ServiceAccountService(
      failAuditRepository(repository, "service_account.create"),
    );
    const beforeServiceAccounts =
      await repository.listServiceAccounts("org_default");

    await expect(
      service.create({
        subject: apiKeyAdminSubject(),
        name: "Rollback service account",
        scopes: ["admin:read"],
      }),
    ).rejects.toThrow("Injected audit failure: service_account.create");

    expect(await repository.listServiceAccounts("org_default")).toHaveLength(
      beforeServiceAccounts.length,
    );
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "service_account.create",
      ),
    ).toBe(false);
  });

  it("rolls back service account disable and key revocation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createServiceAccount({
      id: "service_account_disable_rollback",
      orgId: "org_default",
      name: "Disable rollback service account",
      scopes: ["admin:read"],
      createdBy: "user_dev_admin",
      createdAt: "2026-07-07T14:10:00.000Z",
    });
    await repository.createApiKey({
      id: "api_key_service_account_disable_rollback",
      orgId: "org_default",
      serviceAccountId: "service_account_disable_rollback",
      name: "Disable rollback service account key",
      hashedToken: sha256ForTest("service-account-disable-rollback"),
      scopes: ["admin:read"],
      createdAt: "2026-07-07T14:11:00.000Z",
    });

    await expect(
      new ServiceAccountService(
        failAuditRepository(repository, "service_account.disable"),
      ).disable({
        subject: apiKeyAdminSubject(),
        serviceAccountId: "service_account_disable_rollback",
      }),
    ).rejects.toThrow("Injected audit failure: service_account.disable");

    expect(
      (await repository.getServiceAccount("service_account_disable_rollback"))
        ?.disabledAt,
    ).toBeUndefined();
    expect(
      (await repository.getApiKey("api_key_service_account_disable_rollback"))
        ?.revokedAt,
    ).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "service_account.disable",
      ),
    ).toBe(false);
  });

  it("rolls back group creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new GroupService(
      failAuditRepository(repository, "group.create"),
    );
    const beforeGroups = await repository.listGroups("org_default");

    await expect(
      service.create({
        subject: apiKeyAdminSubject(),
        name: "Rollback Group",
        slug: "rollback_group",
      }),
    ).rejects.toThrow("Injected audit failure: group.create");

    expect(await repository.listGroups("org_default")).toHaveLength(
      beforeGroups.length,
    );
    expect(await repository.getGroup("group_rollback_group")).toBeUndefined();
  });

  it("rolls back group member addition when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createGroup({
      id: "group_member_add_rollback",
      orgId: "org_default",
      name: "Member add rollback",
      slug: "member_add_rollback",
      createdAt: "2026-07-07T14:20:00.000Z",
    });

    await expect(
      new GroupService(
        failAuditRepository(repository, "group.member.add"),
      ).addMember({
        subject: apiKeyAdminSubject(),
        groupId: "group_member_add_rollback",
        userId: "user_dev_admin",
      }),
    ).rejects.toThrow("Injected audit failure: group.member.add");

    expect(
      await repository.listGroupMemberships(
        "org_default",
        "group_member_add_rollback",
      ),
    ).toHaveLength(0);
  });

  it("rolls back group member removal when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createGroup({
      id: "group_member_remove_rollback",
      orgId: "org_default",
      name: "Member remove rollback",
      slug: "member_remove_rollback",
      createdAt: "2026-07-07T14:25:00.000Z",
    });
    await repository.createGroupMembership({
      groupId: "group_member_remove_rollback",
      userId: "user_dev_admin",
      orgId: "org_default",
      createdAt: "2026-07-07T14:26:00.000Z",
    });

    await expect(
      new GroupService(
        failAuditRepository(repository, "group.member.remove"),
      ).removeMember({
        subject: apiKeyAdminSubject(),
        groupId: "group_member_remove_rollback",
        userId: "user_dev_admin",
      }),
    ).rejects.toThrow("Injected audit failure: group.member.remove");

    expect(
      await repository.listGroupMemberships(
        "org_default",
        "group_member_remove_rollback",
      ),
    ).toHaveLength(1);
  });

  it("rolls back provider creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new ProviderService(
      failAuditRepository(repository, "provider.create"),
    );
    const beforeProviders = await repository.listProviders("org_default");

    await expect(
      service.create({
        subject: providerAdminSubject(),
        type: "openai-compatible",
        name: "Rollback provider",
        baseUrl: "https://provider.example.com/v1",
      }),
    ).rejects.toThrow("Injected audit failure: provider.create");

    expect(await repository.listProviders("org_default")).toHaveLength(
      beforeProviders.length,
    );
  });

  it("rolls back model pricing updates when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();

    await expect(
      new ProviderService(
        failAuditRepository(repository, "model.pricing.update"),
      ).updateModelPricing({
        subject: apiKeyAdminSubject(),
        modelId: "model_openai_compatible_default",
        pricing: { inputTokenUsd: 0.01, outputTokenUsd: 0.03 },
      }),
    ).rejects.toThrow("Injected audit failure: model.pricing.update");

    expect(
      (await repository.getModel("model_openai_compatible_default"))?.pricing,
    ).toBeUndefined();
  });

  it("rolls back provider model sync when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createProvider({
      id: "provider_sync_rollback",
      orgId: "org_default",
      type: "openai-compatible",
      name: "Sync rollback provider",
      baseUrl: "https://provider.example.com/v1",
      enabled: true,
      capabilities: defaultProviderCapabilities("openai-compatible"),
    });

    await expect(
      new ProviderService(
        failAuditRepository(repository, "provider.models.sync"),
      ).syncModels(providerAdminSubject(), "provider_sync_rollback"),
    ).rejects.toThrow("Injected audit failure: provider.models.sync");

    expect(
      await repository.getModel("model_provider_sync_rollback_default"),
    ).toBeUndefined();
  });

  it("rolls back workspace creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const beforeWorkspaces = await repository.listWorkspaces("org_default");

    await expect(
      new WorkspaceService(
        failAuditRepository(repository, "workspace.create"),
      ).create({
        subject: apiKeyAdminSubject(),
        name: "Rollback Workspace",
        slug: "rollback_workspace",
      }),
    ).rejects.toThrow("Injected audit failure: workspace.create");

    expect(await repository.listWorkspaces("org_default")).toHaveLength(
      beforeWorkspaces.length,
    );
    expect(
      await repository.getWorkspace("workspace_rollback_workspace"),
    ).toBeUndefined();
  });

  it("rolls back workspace archive when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();

    await expect(
      new WorkspaceService(
        failAuditRepository(repository, "workspace.archive"),
      ).archive({
        subject: apiKeyAdminSubject(),
        workspaceId: "workspace_default",
      }),
    ).rejects.toThrow("Injected audit failure: workspace.archive");

    expect(
      (await repository.getWorkspace("workspace_default"))?.archivedAt,
    ).toBeUndefined();
  });

  it("rolls back local managed-secret creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const beforeSecretSettings = (await repository.listSystemSettings()).filter(
      (setting) => setting.key.startsWith("managed_secret.v1:"),
    );

    await expect(
      new ManagedSecretService(
        failAuditRepository(repository, "admin.managed_secret.create"),
        managedSecretEnv(),
      ).create({
        subject: apiKeyAdminSubject(),
        request: {
          name: "Rollback managed secret",
          purpose: "model_provider_credential",
          storageDriver: "local",
          value: "super-secret-provider-token",
        },
      }),
    ).rejects.toThrow("Injected audit failure: admin.managed_secret.create");

    expect(
      (await repository.listSystemSettings()).filter((setting) =>
        setting.key.startsWith("managed_secret.v1:"),
      ),
    ).toHaveLength(beforeSecretSettings.length);
  });

  it("rolls back secret rotation rewrap when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const oldLocalMfaKey = "old-local-auth-secret-key-32-bytes";
    const newLocalMfaKey = "new-local-auth-secret-key-32-bytes";
    const oldManagedSecretKey = "old-managed-secret-key-32-bytes-long";
    const newManagedSecretKey = "new-managed-secret-key-32-bytes-long";
    const rawTotpSecret = "JBSWY3DPEHPK3PXP";
    const rawManagedSecret = "ROTATION-ROLLBACK-MANAGED-SECRET";
    const oldMfaVault = new LocalMfaSecretVault(oldLocalMfaKey);
    await repository.createLocalMfaFactor({
      id: "mfa_factor_rotation_rollback",
      orgId: "org_default",
      userId: "user_dev_admin",
      type: "totp",
      name: "Rotation rollback authenticator",
      status: "active",
      secretEncrypted: oldMfaVault.encrypt(rawTotpSecret),
      createdAt: "2026-07-07T12:00:00.000Z",
      updatedAt: "2026-07-07T12:00:00.000Z",
      confirmedAt: "2026-07-07T12:00:00.000Z",
    });
    const oldSecretEnv = readEnv({
      MANAGED_SECRET_ENCRYPTION_KEY: oldManagedSecretKey,
      SESSION_SECRET: "prod-session-secret-32-bytes-long",
      WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
    });
    const managedSecret = await new ManagedSecretService(
      repository,
      oldSecretEnv,
    ).create({
      subject: apiKeyAdminSubject(),
      request: {
        name: "Rotation rollback managed secret",
        purpose: "auth_provider_client_secret",
        scope: "org",
        storageDriver: "local",
        value: rawManagedSecret,
      },
    });
    const beforeFactor = await repository.getLocalMfaFactor(
      "mfa_factor_rotation_rollback",
    );
    const beforeSecretSettings = (await repository.listSystemSettings()).filter(
      (setting) => setting.key.startsWith("managed_secret.v1:"),
    );
    const rotationEnv = readEnv({
      LOCAL_AUTH_SECRET_ENCRYPTION_KEY: newLocalMfaKey,
      LOCAL_AUTH_SECRET_ENCRYPTION_KEY_PREVIOUS: oldLocalMfaKey,
      MANAGED_SECRET_ENCRYPTION_KEY: newManagedSecretKey,
      MANAGED_SECRET_ENCRYPTION_KEY_PREVIOUS: oldManagedSecretKey,
      SESSION_SECRET: "prod-session-secret-32-bytes-long",
      WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
    });
    const failingRepository = failAuditRepository(
      repository,
      "admin.secret_rotation.rewrap",
    );

    await expect(
      new SecretRotationService(
        failingRepository,
        rotationEnv,
        new ManagedSecretService(failingRepository, rotationEnv),
      ).execute({
        subject: apiKeyAdminSubject(),
        request: { confirmRewrap: "rewrap-secret-envelopes" },
      }),
    ).rejects.toThrow("Injected audit failure: admin.secret_rotation.rewrap");

    const afterFactor = await repository.getLocalMfaFactor(
      "mfa_factor_rotation_rollback",
    );
    const afterSecretSettings = (await repository.listSystemSettings()).filter(
      (setting) => setting.key.startsWith("managed_secret.v1:"),
    );
    const oldResolved = await new ManagedSecretService(
      repository,
      oldSecretEnv,
    ).resolveValue(managedSecret.secretRef);
    const staleResolved = await new ManagedSecretService(
      repository,
      readEnv({
        MANAGED_SECRET_ENCRYPTION_KEY: newManagedSecretKey,
        SESSION_SECRET: "prod-session-secret-32-bytes-long",
        WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
      }),
    ).resolveValue(managedSecret.secretRef);

    expect(afterFactor?.secretEncrypted).toBe(beforeFactor?.secretEncrypted);
    expect(oldMfaVault.decrypt(afterFactor!.secretEncrypted)).toBe(
      rawTotpSecret,
    );
    expect(() =>
      new LocalMfaSecretVault(newLocalMfaKey).decrypt(
        afterFactor!.secretEncrypted,
      ),
    ).toThrow();
    expect(afterSecretSettings).toEqual(beforeSecretSettings);
    expect(oldResolved).toMatchObject({
      available: true,
      value: rawManagedSecret,
    });
    expect(staleResolved).toMatchObject({
      available: false,
      failureCode: "managed_secret_decryption_failed",
    });
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "admin.secret_rotation.rewrap",
      ),
    ).toBe(false);
  });

  it("rolls back SSO settings updates when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();

    await expect(
      new SsoSettingsService(
        failAuditRepository(repository, "admin.sso_settings.update"),
        localAuthEnv(),
      ).update({
        subject: apiKeyAdminSubject(),
        oidc: {
          enabled: true,
          issuerUrl: "https://idp.example.com/realms/rollback",
          clientId: "romeo-rollback",
          groupClaim: "groups",
        },
      }),
    ).rejects.toThrow("Injected audit failure: admin.sso_settings.update");

    expect(await repository.getSsoOidcSettings("org_default")).toBeUndefined();
  });

  it("rolls back SSO OIDC deprovisioning when deprovision audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const issuerUrl = "https://idp.example.com/realms/rollback";
    const oidcSubject = "external-user-rollback";
    const userId = oidcUserId(issuerUrl, oidcSubject);
    const now = "2026-07-03T12:00:00.000Z";
    await repository.upsertSsoOidcSettings({
      orgId: "org_default",
      enabled: true,
      issuerUrl,
      clientId: "romeo-rollback",
      groupClaim: "groups",
      adminGroups: [],
      groupMap: {},
      workspaceGroupMap: {},
      workspaceGroupPrefix: "",
      createdBy: "user_dev_admin",
      updatedBy: "user_dev_admin",
      createdAt: now,
      updatedAt: now,
    });
    await repository.createUser({
      id: userId,
      orgId: "org_default",
      email: "external-user-rollback@romeo.local",
      name: "External User Rollback",
    });
    const failingRepository = failAuditRepository(
      repository,
      "admin.sso_oidc.deprovision",
    );
    const service = new SsoSettingsService(
      failingRepository,
      localAuthEnv(),
      fetch,
      new UserLifecycleService(failingRepository),
    );

    await expect(
      service.deprovisionOidcUser({
        subject: userLifecycleAdminSubject(),
        oidcSubject,
        confirmOidcSubject: oidcSubject,
        issuerUrl,
      }),
    ).rejects.toThrow("Injected audit failure: admin.sso_oidc.deprovision");

    expect(
      (await repository.getCurrentUser(userId))?.disabledAt,
    ).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) =>
          log.action === "admin.sso_oidc.deprovision" ||
          log.action === "user.disable",
      ),
    ).toBe(false);
  });

  it("rolls back LDAP login provisioning when success audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const rawSecret = "LDAP-BIND-SECRET-SHOULD-NOT-LEAK";
    const directoryPassword = "directory-user-password";
    const bindDn = "cn=romeo,ou=svc,dc=example,dc=com";
    const userDn = "uid=ldap.rollback,ou=people,dc=example,dc=com";
    const env = localAuthEnv();
    const secretResolver = new EnvironmentSecretResolver({
      LDAP_BIND_PASSWORD: rawSecret,
    });
    const ldapClientFactory = () =>
      fakeLdapClient({
        bind: async (dn, password) => {
          if (dn === bindDn && password === rawSecret) return;
          if (dn === userDn && password === directoryPassword) return;
          throw new Error("invalid bind");
        },
        search: async (baseDn, options) => {
          if (options.filter === "(objectClass=*)") return [{ dn: baseDn }];
          if (options.filter === "(mail=ldap.rollback@example.com)") {
            return [
              {
                dn: userDn,
                cn: "LDAP Rollback User",
                mail: "ldap.rollback@example.com",
                uid: "ldap-rollback",
              },
            ];
          }
          if (options.filter === `(member=${userDn})`) {
            return [
              {
                dn: "cn=engineers,ou=groups,dc=example,dc=com",
                cn: "engineers",
              },
            ];
          }
          return [];
        },
      });
    await repository.createGroup({
      id: "group_ldap_rollback",
      orgId: "org_default",
      name: "LDAP Rollback",
      slug: "ldap-rollback",
      createdAt: "2026-07-07T12:00:00.000Z",
    });
    await new AuthProviderSettingsService(
      repository,
      env,
      fetch,
      secretResolver,
      ldapClientFactory,
    ).update({
      subject: tenantGlobalAdminSubject(),
      settings: {
        global: {
          providers: [
            {
              providerId: "ldap",
              enabled: true,
              allowedEmailDomains: ["example.com"],
              secretRef: "env://LDAP_BIND_PASSWORD",
              ldap: {
                url: "ldaps://ldap.example.com",
                baseDn: "dc=example,dc=com",
                bindDn,
                userSearchFilter: "(mail={identifier})",
                groupSearchBaseDn: "ou=groups,dc=example,dc=com",
                groupSearchFilter: "(member={userDn})",
                groupMap: {
                  "ldap:group:engineers": "group_ldap_rollback",
                },
                requiredGroups: ["engineers"],
              },
            },
          ],
        },
      },
    });
    const failingRepository = failAuditRepository(
      repository,
      "auth.ldap.login.success",
    );
    const service = new LdapAuthService(
      failingRepository,
      new SessionService(failingRepository),
      new AuthProviderSettingsService(
        failingRepository,
        env,
        fetch,
        secretResolver,
        ldapClientFactory,
      ),
      secretResolver,
      env,
      { clientFactory: ldapClientFactory },
    );

    await expect(
      service.login({
        identifier: "ldap.rollback@example.com",
        password: directoryPassword,
        providerId: "ldap",
      }),
    ).rejects.toThrow("LDAP login is invalid.");

    const users = await repository.listUsers("org_default");
    const audits = await repository.listAuditLogs("org_default");
    expect(
      users.some((user) => user.email === "ldap.rollback@example.com"),
    ).toBe(false);
    expect(
      await repository.listGroupMemberships(
        "org_default",
        "group_ldap_rollback",
      ),
    ).toHaveLength(0);
    expect(audits.some((log) => log.action === "auth.ldap.login.success")).toBe(
      false,
    );
    expect(audits.some((log) => log.action === "session.create")).toBe(false);
  });

  it("rolls back tenant organization updates when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const before = await repository.getOrganization("org_default");

    await expect(
      tenantAdminService(
        failAuditRepository(repository, "admin.organization.update"),
      ).update({
        subject: tenantGlobalAdminSubject(),
        orgId: "org_default",
        name: "Rollback Org Name",
      }),
    ).rejects.toThrow("Injected audit failure: admin.organization.update");

    expect(await repository.getOrganization("org_default")).toEqual(before);
  });

  it("rolls back tenant suspension when tenant audit fails", async () => {
    const repository = new InMemoryRomeoRepository();

    await expect(
      tenantAdminService(
        failAuditRepository(repository, "admin.organization.suspend"),
      ).suspend({
        subject: tenantGlobalAdminSubject(),
        orgId: "org_default",
        confirmOrgId: "org_default",
        reasonCode: "rollback_suspend",
      }),
    ).rejects.toThrow("Injected audit failure: admin.organization.suspend");

    expect(
      (await new AbuseControlService(repository).report(apiKeyAdminSubject()))
        .suspension.suspended,
    ).toBe(false);
  });

  it("rolls back tenant reactivation when tenant audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await new AbuseControlService(repository).updateForOrg({
      subject: tenantGlobalAdminSubject(),
      orgId: "org_default",
      policy: { suspension: { suspended: true, reasonCode: "setup" } },
    });

    await expect(
      tenantAdminService(
        failAuditRepository(repository, "admin.organization.reactivate"),
      ).reactivate({
        subject: tenantGlobalAdminSubject(),
        orgId: "org_default",
        confirmOrgId: "org_default",
      }),
    ).rejects.toThrow("Injected audit failure: admin.organization.reactivate");

    expect(
      (await new AbuseControlService(repository).report(apiKeyAdminSubject()))
        .suspension,
    ).toMatchObject({ suspended: true, reasonCode: "setup" });
  });

  it("rolls back tenant deletion requests and suspension when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();

    await expect(
      tenantAdminService(
        failAuditRepository(repository, "admin.organization.deletion_request"),
      ).requestDeletion({
        subject: tenantGlobalAdminSubject(),
        orgId: "org_default",
        confirmOrgId: "org_default",
        reasonCode: "rollback_delete",
      }),
    ).rejects.toThrow(
      "Injected audit failure: admin.organization.deletion_request",
    );

    expect(
      await repository.getSystemSetting(
        "tenant_lifecycle.deletion_request.v1:org_default",
      ),
    ).toBeUndefined();
    expect(
      (await new AbuseControlService(repository).report(apiKeyAdminSubject()))
        .suspension.suspended,
    ).toBe(false);
  });

  it("rolls back tenant deletion request cancellation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = tenantAdminService(repository);
    await service.requestDeletion({
      subject: tenantGlobalAdminSubject(),
      orgId: "org_default",
      confirmOrgId: "org_default",
      reasonCode: "setup_delete",
    });

    await expect(
      tenantAdminService(
        failAuditRepository(
          repository,
          "admin.organization.deletion_request.cancel",
        ),
      ).cancelDeletionRequest({
        subject: tenantGlobalAdminSubject(),
        orgId: "org_default",
        confirmOrgId: "org_default",
      }),
    ).rejects.toThrow(
      "Injected audit failure: admin.organization.deletion_request.cancel",
    );

    expect(
      (
        await service.get({
          subject: tenantGlobalAdminSubject(),
          orgId: "org_default",
        })
      ).deletionRequest,
    ).toMatchObject({ status: "requested", reasonCode: "setup_delete" });
  });

  it("rolls back tenant deletion finalization evidence when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();

    await expect(
      tenantAdminService(
        failAuditRepository(
          repository,
          "admin.organization.deletion_finalization_evidence",
        ),
      ).recordDeletionFinalizationEvidence({
        subject: tenantGlobalAdminSubject(),
        orgId: "org_default",
        confirmOrgId: "org_default",
        controls: [{ control: "postgres_purge_plan_review", status: "passed" }],
      }),
    ).rejects.toThrow(
      "Injected audit failure: admin.organization.deletion_finalization_evidence",
    );

    const preview = await tenantAdminService(
      repository,
    ).deletionFinalizationPreview({
      subject: tenantGlobalAdminSubject(),
      orgId: "org_default",
    });
    expect(preview.evidence.controls).toHaveLength(0);
    expect(preview.evidence.missingControls).toContain(
      "postgres_purge_plan_review",
    );
  });

  it("rolls back webhook subscription creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const beforeSubscriptions =
      await repository.listWebhookSubscriptions("org_default");

    await expect(
      new WebhookService(failAuditRepository(repository, "webhook.create"), {
        signingKey: "prod-webhook-signing-key-32-bytes",
      }).create({
        subject: webhookAdminSubject(),
        url: "https://hooks.example/rollback",
        eventTypes: ["run.completed"],
      }),
    ).rejects.toThrow("Injected audit failure: webhook.create");

    expect(
      await repository.listWebhookSubscriptions("org_default"),
    ).toHaveLength(beforeSubscriptions.length);
  });

  it("rolls back webhook disable when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createWebhookSubscription({
      id: "webhook_disable_rollback",
      orgId: "org_default",
      url: "https://hooks.example/disable-rollback",
      eventTypes: ["run.completed"],
      createdBy: "user_dev_admin",
      createdAt: "2026-07-07T14:30:00.000Z",
      updatedAt: "2026-07-07T14:30:00.000Z",
    });

    await expect(
      new WebhookService(failAuditRepository(repository, "webhook.disable"), {
        signingKey: "prod-webhook-signing-key-32-bytes",
      }).disable({
        subject: webhookAdminSubject(),
        subscriptionId: "webhook_disable_rollback",
      }),
    ).rejects.toThrow("Injected audit failure: webhook.disable");

    expect(
      (await repository.getWebhookSubscription("webhook_disable_rollback"))
        ?.disabledAt,
    ).toBeUndefined();
  });

  it("rolls back webhook bulk disable when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createWebhookSubscription({
      id: "webhook_bulk_disable_rollback",
      orgId: "org_default",
      url: "https://hooks.example/bulk-disable-rollback",
      eventTypes: ["run.completed"],
      createdBy: "user_dev_admin",
      createdAt: "2026-07-07T14:35:00.000Z",
      updatedAt: "2026-07-07T14:35:00.000Z",
    });

    await expect(
      new WebhookService(
        failAuditRepository(repository, "webhook.bulk_disable"),
        {
          signingKey: "prod-webhook-signing-key-32-bytes",
        },
      ).bulkDisable({
        subject: webhookAdminSubject(),
        webhookIds: ["webhook_bulk_disable_rollback"],
      }),
    ).rejects.toThrow("Injected audit failure: webhook.bulk_disable");

    expect(
      (await repository.getWebhookSubscription("webhook_bulk_disable_rollback"))
        ?.disabledAt,
    ).toBeUndefined();
  });

  it("rolls back device authorization creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new DeviceAuthorizationService(
      failAuditRepository(repository, "device_authorization.create"),
    );
    const beforeApiKeys = await repository.listApiKeys("org_default");
    const beforeAuthorizations = await repository.listDeviceAuthorizations(
      "org_default",
      "user_dev_admin",
    );

    await expect(
      service.create({
        subject: deviceAuthorizationSubject(),
        name: "Rollback laptop",
        scopes: ["me:read"],
      }),
    ).rejects.toThrow("Injected audit failure: device_authorization.create");

    expect(await repository.listApiKeys("org_default")).toHaveLength(
      beforeApiKeys.length,
    );
    expect(
      await repository.listDeviceAuthorizations(
        "org_default",
        "user_dev_admin",
      ),
    ).toHaveLength(beforeAuthorizations.length);
  });

  it("rolls back device authorization refresh when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new DeviceAuthorizationService(repository);
    const created = await service.create({
      subject: deviceAuthorizationSubject(),
      name: "Refresh rollback laptop",
      scopes: ["me:read"],
    });
    const beforeAuthorization = await repository.getDeviceAuthorization(
      created.authorization.id,
    );
    const beforeApiKey = await repository.getApiKey(
      created.authorization.accessApiKeyId,
    );
    const beforeApiKeys = await repository.listApiKeys("org_default");

    await expect(
      new DeviceAuthorizationService(
        failAuditRepository(repository, "device_authorization.refresh"),
      ).refresh(created.refreshToken),
    ).rejects.toThrow("Injected audit failure: device_authorization.refresh");

    const afterAuthorization = await repository.getDeviceAuthorization(
      created.authorization.id,
    );
    expect(afterAuthorization).toMatchObject({
      hashedRefreshToken: beforeAuthorization?.hashedRefreshToken,
      accessApiKeyId: beforeAuthorization?.accessApiKeyId,
    });
    expect(afterAuthorization?.lastRefreshedAt).toBe(
      beforeAuthorization?.lastRefreshedAt,
    );
    expect(
      (await repository.getApiKey(created.authorization.accessApiKeyId))
        ?.revokedAt,
    ).toBe(beforeApiKey?.revokedAt);
    expect(await repository.listApiKeys("org_default")).toHaveLength(
      beforeApiKeys.length,
    );
  });

  it("rolls back device authorization revocation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new DeviceAuthorizationService(repository);
    const created = await service.create({
      subject: deviceAuthorizationSubject(),
      name: "Revoke rollback laptop",
      scopes: ["me:read"],
    });

    await expect(
      new DeviceAuthorizationService(
        failAuditRepository(repository, "device_authorization.revoke"),
      ).revoke({
        subject: deviceAuthorizationSubject(),
        deviceAuthorizationId: created.authorization.id,
      }),
    ).rejects.toThrow("Injected audit failure: device_authorization.revoke");

    expect(
      (await repository.getDeviceAuthorization(created.authorization.id))
        ?.revokedAt,
    ).toBeUndefined();
    expect(
      (await repository.getApiKey(created.authorization.accessApiKeyId))
        ?.revokedAt,
    ).toBeUndefined();
  });

  it("rolls back voice profile creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new VoiceService(
      failAuditRepository(repository, "voice.profile.create"),
    );
    const beforeProfiles = await repository.listVoiceProfiles("org_default");
    const beforeGrants = await repository.listResourceGrants("org_default");

    await expect(
      service.create({
        subject: voiceManageSubject(),
        name: "Rollback voice",
        providerVoiceId: "voice_rollback",
        language: "en",
        styleTags: ["clear"],
      }),
    ).rejects.toThrow("Injected audit failure: voice.profile.create");

    expect(await repository.listVoiceProfiles("org_default")).toHaveLength(
      beforeProfiles.length,
    );
    expect(await repository.listResourceGrants("org_default")).toHaveLength(
      beforeGrants.length,
    );
  });

  it("rolls back voice catalog sync imports when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new VoiceService(
      failAuditRepository(repository, "voice.catalog_sync"),
      catalogVoiceProvider(),
    );
    const beforeProfiles = await repository.listVoiceProfiles("org_default");
    const beforeGrants = await repository.listResourceGrants("org_default");

    await expect(service.syncCatalog(voiceManageSubject())).rejects.toThrow(
      "Injected audit failure: voice.catalog_sync",
    );

    expect(await repository.listVoiceProfiles("org_default")).toHaveLength(
      beforeProfiles.length,
    );
    expect(await repository.listResourceGrants("org_default")).toHaveLength(
      beforeGrants.length,
    );
  });

  it("rolls back voice artifact deletion when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = trackingObjectStore();
    const storageKey = "voice/org_default/voice_artifact_delete_rollback.wav";
    await objectStore.store.putObject({
      key: storageKey,
      body: new Uint8Array([1, 2, 3, 4]),
      contentType: "audio/wav",
    });
    await repository.createUsageEvent({
      id: "usage_voice_artifact_delete_rollback",
      orgId: "org_default",
      workspaceId: "workspace_default",
      actorId: "user_dev_admin",
      sourceType: "voice",
      sourceId: "voice_default",
      metric: "voice.preview.generated",
      quantity: 1,
      unit: "ms",
      metadata: {
        artifactId: "voice_artifact_delete_rollback",
        storageKey,
        contentType: "audio/wav",
      },
      createdAt: "2026-07-07T12:00:00.000Z",
    });
    const service = new VoiceService(
      failAuditRepository(repository, "voice.artifact.delete"),
      undefined,
      objectStore.store,
    );

    await expect(
      service.deleteArtifact({
        subject: voiceUseSubject(),
        artifactId: "voice_artifact_delete_rollback",
      }),
    ).rejects.toThrow("Injected audit failure: voice.artifact.delete");

    const events = await repository.listUsageEvents("org_default");
    const event = events.find(
      (candidate) => candidate.id === "usage_voice_artifact_delete_rollback",
    );
    expect(event?.metadata.storageKey).toBe(storageKey);
    expect(event?.metadata.artifactDeletedAt).toBeUndefined();
    expect(await objectStore.store.getObject(storageKey)).toBeDefined();
    expect(objectStore.deleteKeys).toHaveLength(0);
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "voice.artifact.delete",
      ),
    ).toBe(false);
  });

  it("rolls back billing plan application when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new BillingService(
      failAuditRepository(repository, "billing.plan_applied"),
    );
    const beforeQuotas = await repository.listQuotaBuckets("org_default");

    await expect(
      service.applyPlan({
        subject: billingAdminSubject(),
        code: "rollback",
        name: "Rollback",
        status: "active",
        source: "manual",
        quotaTemplates: [
          { metric: "run.started", limit: 100, resetInterval: "monthly" },
        ],
        metadata: {},
      }),
    ).rejects.toThrow("Injected audit failure: billing.plan_applied");

    expect(await repository.getBillingPlan("org_default")).toBeUndefined();
    expect(await repository.listQuotaBuckets("org_default")).toHaveLength(
      beforeQuotas.length,
    );
  });

  it("rolls back external billing sync when external-event audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new BillingService(
      failAuditRepository(repository, "billing.external_event_synced"),
    );

    await expect(
      service.syncExternalEvent({
        subject: billingAdminSubject(),
        event: {
          provider: "stripe",
          eventType: "invoice.paid",
          planCode: "team",
          planName: "Team",
          status: "active",
          externalCustomerId: "cus_rollback",
          quotaTemplates: [
            { metric: "run.started", limit: 100, resetInterval: "monthly" },
          ],
        },
      }),
    ).rejects.toThrow("Injected audit failure: billing.external_event_synced");

    expect(await repository.getBillingPlan("org_default")).toBeUndefined();
    expect(await repository.listQuotaBuckets("org_default")).toHaveLength(0);
    expect(
      (await repository.listAuditLogs("org_default")).some((log) =>
        ["billing.plan_applied", "billing.external_event_synced"].includes(
          log.action,
        ),
      ),
    ).toBe(false);
  });

  it("rolls back billing entitlement reconciliation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new BillingService(repository);
    const applied = await service.applyPlan({
      subject: billingAdminSubject(),
      code: "team",
      name: "Team",
      status: "active",
      source: "manual",
      quotaTemplates: [
        { metric: "run.started", limit: 100, resetInterval: "monthly" },
        { metric: "tool.call", limit: 50, resetInterval: "monthly" },
      ],
      metadata: {},
    });
    const runQuota = applied.quotas.find(
      (quota) => quota.metric === "run.started",
    );
    const toolQuota = applied.quotas.find(
      (quota) => quota.metric === "tool.call",
    );
    if (runQuota === undefined || toolQuota === undefined) {
      throw new Error("Missing billing rollback quota fixture.");
    }
    await repository.updateQuotaBucket({
      ...runQuota,
      limit: 1,
      resetInterval: "daily",
    });
    await repository.deleteQuotaBucket(toolQuota.id);
    const beforeQuotas = await repository.listQuotaBuckets("org_default");

    await expect(
      new BillingService(
        failAuditRepository(repository, "billing.entitlements_reconciled"),
      ).reconcileEntitlements(billingAdminSubject()),
    ).rejects.toThrow(
      "Injected audit failure: billing.entitlements_reconciled",
    );

    expect(await repository.listQuotaBuckets("org_default")).toEqual(
      beforeQuotas,
    );
  });

  it("rolls back billing lifecycle enforcement when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new BillingService(repository);
    const applied = await service.applyPlan({
      subject: billingAdminSubject(),
      code: "trial",
      name: "Trial",
      status: "trialing",
      source: "manual",
      quotaTemplates: [
        { metric: "run.started", limit: 100, resetInterval: "monthly" },
      ],
      metadata: {},
      lifecycle: {
        trialEndsAt: "2020-01-01T00:00:00.000Z",
        currentPeriodEndsAt: "2099-01-01T00:00:00.000Z",
      },
    });

    await expect(
      new BillingService(
        failAuditRepository(repository, "billing.lifecycle_enforced"),
      ).enforceLifecycle(billingAdminSubject()),
    ).rejects.toThrow("Injected audit failure: billing.lifecycle_enforced");

    expect(await repository.getBillingPlan("org_default")).toMatchObject({
      id: applied.plan.id,
      status: "trialing",
      metadata: applied.plan.metadata,
    });
  });

  it("rolls back inline file creation and removes the uploaded object when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = trackingObjectStore();
    const service = new FileService(
      failAuditRepository(repository, "file.create"),
      objectStore.store,
    );
    const beforeFiles = await repository.listFileObjects("org_default");
    const beforeGrants = await repository.listResourceGrants("org_default");

    await expect(
      service.create(fileWriteSubject(), {
        workspaceId: "workspace_default",
        fileName: "rollback.txt",
        mimeType: "text/plain",
        sizeBytes: 13,
        dataBase64: Buffer.from("rollback file").toString("base64"),
      }),
    ).rejects.toThrow("Injected audit failure: file.create");

    expect(await repository.listFileObjects("org_default")).toHaveLength(
      beforeFiles.length,
    );
    expect(await repository.listResourceGrants("org_default")).toHaveLength(
      beforeGrants.length,
    );
    expect(objectStore.putKeys).toHaveLength(1);
    expect(objectStore.deleteKeys).toEqual(objectStore.putKeys);
    expect(
      await objectStore.store.getObject(objectStore.putKeys[0]!),
    ).toBeUndefined();
  });

  it("rolls back direct file upload session creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new FileService(
      failAuditRepository(repository, "file.upload_session.create"),
      new MemoryObjectStore(),
    );
    const beforeFiles = await repository.listFileObjects("org_default");
    const beforeGrants = await repository.listResourceGrants("org_default");

    await expect(
      service.createUploadSession(fileWriteSubject(), {
        workspaceId: "workspace_default",
        fileName: "direct-rollback.txt",
        mimeType: "text/plain",
        sizeBytes: 5,
        sha256: sha256ForTest("hello"),
      }),
    ).rejects.toThrow("Injected audit failure: file.upload_session.create");

    expect(await repository.listFileObjects("org_default")).toHaveLength(
      beforeFiles.length,
    );
    expect(await repository.listResourceGrants("org_default")).toHaveLength(
      beforeGrants.length,
    );
  });

  it("rolls back direct file upload completion when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const service = new FileService(repository, objectStore);
    const session = await service.createUploadSession(fileWriteSubject(), {
      workspaceId: "workspace_default",
      fileName: "complete-rollback.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      sha256: sha256ForTest("hello"),
    });
    const file = await repository.getFileObject(session.file.id);
    if (file === undefined) throw new Error("Missing file rollback fixture.");
    await objectStore.putObject({
      key: file.objectKey,
      body: new TextEncoder().encode("hello"),
      contentType: "text/plain",
    });

    await expect(
      new FileService(
        failAuditRepository(repository, "file.upload_session.complete"),
        objectStore,
      ).completeUploadSession(fileWriteSubject(), file.id),
    ).rejects.toThrow("Injected audit failure: file.upload_session.complete");

    expect(await repository.getFileObject(file.id)).toMatchObject({
      status: "uploading",
      updatedAt: file.updatedAt,
    });
    expect(await objectStore.getObject(file.objectKey)).toBeDefined();
  });

  it("rolls back file deletion before object removal when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const service = new FileService(repository, objectStore);
    const created = await service.create(fileWriteSubject(), {
      workspaceId: "workspace_default",
      fileName: "delete-rollback.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      dataBase64: Buffer.from("hello").toString("base64"),
    });
    const file = await repository.getFileObject(created.id);
    if (file === undefined) throw new Error("Missing file delete fixture.");

    await expect(
      new FileService(
        failAuditRepository(repository, "file.delete"),
        objectStore,
      ).delete(fileWriteSubject(), file.id),
    ).rejects.toThrow("Injected audit failure: file.delete");

    const afterDeleteFailure = await repository.getFileObject(file.id);
    expect(afterDeleteFailure).toMatchObject({ status: "available" });
    expect(afterDeleteFailure?.deletedAt).toBe(file.deletedAt);
    expect(await objectStore.getObject(file.objectKey)).toBeDefined();
  });

  it("rolls back local password credential creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const failingRepository = failAuditRepository(
      repository,
      "local_auth.password.set",
    );
    const service = new LocalAuthService(
      failingRepository,
      new SessionService(failingRepository),
      localAuthEnv(),
    );

    await expect(
      service.setOwnPassword({
        subject: localAuthSubject(),
        newPassword: "new-local-password-123",
      }),
    ).rejects.toThrow("Injected audit failure: local_auth.password.set");

    expect(
      await repository.getLocalPasswordCredentialByUserId("user_dev_admin"),
    ).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "local_auth.password.set",
      ),
    ).toBe(false);
  });

  it("rolls back local TOTP enrollment when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const failingRepository = failAuditRepository(
      repository,
      "local_auth.mfa.enroll",
    );
    const service = new LocalAuthService(
      failingRepository,
      new SessionService(failingRepository),
      localAuthEnv(),
    );
    const beforeFactors = await repository.listLocalMfaFactors(
      "org_default",
      "user_dev_admin",
    );

    await expect(
      service.startTotpEnrollment({
        subject: localAuthSubject(),
        name: "Rollback authenticator",
      }),
    ).rejects.toThrow("Injected audit failure: local_auth.mfa.enroll");

    expect(
      await repository.listLocalMfaFactors("org_default", "user_dev_admin"),
    ).toHaveLength(beforeFactors.length);
  });

  it("rolls back user disable and credential revocation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createUser({
      id: "user_disable_rollback",
      orgId: "org_default",
      email: "disable-rollback@example.com",
      name: "Disable Rollback",
      role: "user",
    });
    await repository.createApiKey({
      id: "api_key_disable_rollback",
      orgId: "org_default",
      userId: "user_disable_rollback",
      name: "Disable rollback key",
      hashedToken: "hashed-disable-rollback",
      scopes: ["me:read"],
      createdAt: "2026-07-07T12:00:00.000Z",
    });
    await repository.createUserSession({
      id: "session_disable_rollback",
      orgId: "org_default",
      userId: "user_disable_rollback",
      name: "Disable rollback session",
      hashedToken: "hashed-session-disable-rollback",
      scopes: ["me:read"],
      isAdmin: false,
      expiresAt: fixtureFuture(),
      createdAt: fixturePast(),
    });

    await expect(
      new UserLifecycleService(
        failAuditRepository(repository, "user.disable"),
      ).disable({
        subject: userLifecycleAdminSubject(),
        userId: "user_disable_rollback",
      }),
    ).rejects.toThrow("Injected audit failure: user.disable");

    expect(
      (await repository.getCurrentUser("user_disable_rollback"))?.disabledAt,
    ).toBeUndefined();
    expect(
      (await repository.getApiKey("api_key_disable_rollback"))?.revokedAt,
    ).toBeUndefined();
    expect(
      (await repository.getUserSession("session_disable_rollback"))?.revokedAt,
    ).toBeUndefined();
  });

  it("rolls back user role updates and credential revocation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createUser({
      id: "user_role_rollback",
      orgId: "org_default",
      email: "role-rollback@example.com",
      name: "Role Rollback",
      role: "user",
    });
    await repository.createApiKey({
      id: "api_key_role_rollback",
      orgId: "org_default",
      userId: "user_role_rollback",
      name: "Role rollback key",
      hashedToken: "hashed-role-rollback",
      scopes: ["me:read"],
      createdAt: "2026-07-07T12:00:00.000Z",
    });

    await expect(
      new UserLifecycleService(
        failAuditRepository(repository, "user.role.update"),
      ).updateRole({
        subject: userLifecycleAdminSubject(),
        userId: "user_role_rollback",
        confirmUserId: "user_role_rollback",
        role: "org_admin",
      }),
    ).rejects.toThrow("Injected audit failure: user.role.update");

    expect(await repository.getCurrentUser("user_role_rollback")).toMatchObject(
      { role: "user" },
    );
    expect(
      (await repository.getApiKey("api_key_role_rollback"))?.revokedAt,
    ).toBeUndefined();
  });

  it("rolls back workflow resume finalization when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const workflow: WorkflowDefinition = {
      id: "workflow_resume_rollback",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Resume rollback",
      steps: [
        {
          id: "step_1",
          type: "agent_run",
          name: "Draft",
          agentId: "agent_default",
        },
      ],
      enabled: true,
      createdBy: "user_dev_admin",
      createdAt: "2026-06-30T15:30:00.000Z",
      updatedAt: "2026-06-30T15:30:00.000Z",
    };
    const linkedRun: RunRecord = {
      id: "run_workflow_resume_linked",
      orgId: "org_default",
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      modelId: "model_openai_compatible_default",
      providerId: "provider_openai_compatible",
      status: "completed",
      createdBy: "user_dev_admin",
      createdAt: "2026-06-30T15:31:00.000Z",
      completedAt: "2026-06-30T15:32:00.000Z",
    };
    const workflowRun: WorkflowRun = {
      id: "workflow_run_resume_rollback",
      orgId: "org_default",
      workspaceId: "workspace_default",
      workflowId: workflow.id,
      status: "waiting_run",
      input: {},
      steps: [
        {
          stepId: "step_1",
          type: "agent_run",
          status: "waiting_run",
          output: { runId: linkedRun.id },
        },
      ],
      currentStepId: "step_1",
      createdBy: "user_dev_admin",
      createdAt: "2026-06-30T15:30:00.000Z",
      updatedAt: "2026-06-30T15:31:00.000Z",
    };
    await repository.createWorkflowDefinition(workflow);
    await repository.createRun(linkedRun);
    await repository.createWorkflowRun(workflowRun);

    const service = new WorkflowService(
      failAuditRepository(repository, "workflow.run.resume"),
      {} as never,
    );

    await expect(
      service.resume({
        subject: workflowAdminSubject(),
        workflowRunId: workflowRun.id,
      }),
    ).rejects.toThrow("Injected audit failure: workflow.run.resume");

    const storedRun = await repository.getWorkflowRun(workflowRun.id);
    expect(storedRun).toMatchObject({
      status: "waiting_run",
      currentStepId: "step_1",
      steps: [
        {
          stepId: "step_1",
          status: "waiting_run",
          output: { runId: linkedRun.id },
        },
      ],
    });
    expect(storedRun?.completedAt).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "workflow.run.resume",
      ),
    ).toBe(false);
  });

  it("rolls back workflow retry linked run creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const workflow: WorkflowDefinition = {
      id: "workflow_retry_linked_run_rollback",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Retry linked run rollback",
      steps: [
        {
          id: "step_1",
          type: "agent_run",
          name: "Draft",
          agentId: "agent_default",
          retryPolicy: { maxAttempts: 2 },
        },
      ],
      enabled: true,
      createdBy: "user_dev_admin",
      createdAt: "2026-06-30T15:35:00.000Z",
      updatedAt: "2026-06-30T15:35:00.000Z",
    };
    const failedLinkedRun: RunRecord = {
      id: "run_workflow_retry_failed_linked",
      orgId: "org_default",
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      modelId: "model_openai_compatible_default",
      providerId: "provider_openai_compatible",
      status: "failed",
      createdBy: "user_dev_admin",
      createdAt: "2026-06-30T15:36:00.000Z",
      completedAt: "2026-06-30T15:37:00.000Z",
    };
    const workflowRun: WorkflowRun = {
      id: "workflow_run_retry_linked_run_rollback",
      orgId: "org_default",
      workspaceId: "workspace_default",
      workflowId: workflow.id,
      status: "waiting_run",
      input: { prompt: "Retry this only if the transaction commits." },
      steps: [
        {
          stepId: "step_1",
          type: "agent_run",
          status: "waiting_run",
          output: { runId: failedLinkedRun.id, attempt: 1 },
        },
      ],
      currentStepId: "step_1",
      createdBy: "user_dev_admin",
      createdAt: "2026-06-30T15:35:00.000Z",
      updatedAt: "2026-06-30T15:36:00.000Z",
    };
    await repository.createWorkflowDefinition(workflow);
    await repository.createRun(failedLinkedRun);
    await repository.createWorkflowRun(workflowRun);
    const chatCount = (await repository.listChats("workspace_default")).length;
    const usageCount = (await repository.listUsageEvents("org_default")).length;
    const failingRepository = failAuditRepository(
      repository,
      "workflow.run.retry",
    );
    const service = new WorkflowService(
      failingRepository,
      new RunService(failingRepository, new RunEventSequencer()),
    );

    await expect(
      service.resume({
        subject: workflowAdminSubject(),
        workflowRunId: workflowRun.id,
      }),
    ).rejects.toThrow("Injected audit failure: workflow.run.retry");

    const storedRun = await repository.getWorkflowRun(workflowRun.id);
    expect(storedRun).toMatchObject({
      status: "waiting_run",
      currentStepId: "step_1",
      steps: [
        {
          stepId: "step_1",
          status: "waiting_run",
          output: { runId: failedLinkedRun.id, attempt: 1 },
        },
      ],
    });
    expect(await repository.getRun(failedLinkedRun.id)).toMatchObject({
      status: "failed",
    });
    expect(await repository.listChats("workspace_default")).toHaveLength(
      chatCount,
    );
    expect(await repository.listUsageEvents("org_default")).toHaveLength(
      usageCount,
    );
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "workflow.run.retry",
      ),
    ).toBe(false);
  });

  it("rolls back support access requests when notification enqueue fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createUser({
      id: "user_support_request_rollback_target",
      orgId: "org_default",
      email: "support-request-rollback-target@example.com",
      name: "Support Request Rollback Target",
    });
    const service = new SessionService(
      failNotificationRepository(
        repository,
        "support_impersonation_request_created",
      ),
    );

    await expect(
      service.requestSupportSession({
        subject: supportAdminSubject(),
        targetUserId: "user_support_request_rollback_target",
        confirmTargetUserId: "user_support_request_rollback_target",
        reason: "Support request rollback investigation",
        ticketRef: "SUPPORT-REQ-ROLLBACK",
        ttlMinutes: 15,
      }),
    ).rejects.toThrow(
      "Injected notification failure: support_impersonation_request_created",
    );

    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "support.impersonation.request.create",
      ),
    ).toBe(false);
    expect(
      (
        await repository.listUserNotifications(
          "org_default",
          "user_support_request_rollback_target",
        )
      ).some(
        (notification) =>
          notification.type === "support_impersonation_request_created",
      ),
    ).toBe(false);
  });

  it("rolls back local session creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new SessionService(
      failAuditRepository(repository, "session.create"),
    );

    await expect(
      service.create({
        subject: localSessionSubject(),
        name: "Rollback local session",
        ttlHours: 8,
      }),
    ).rejects.toThrow("Injected audit failure: session.create");

    expect(
      (await repository.listUserSessions("org_default", "user_dev_admin")).some(
        (session) => session.name === "Rollback local session",
      ),
    ).toBe(false);
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "session.create",
      ),
    ).toBe(false);
  });

  it("rolls back current local session revocation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedLocalSession(repository, "session_current_revoke_rollback");
    const service = new SessionService(
      failAuditRepository(repository, "session.revoke"),
    );

    await expect(
      service.revokeCurrent(
        localSessionSubject("session_current_revoke_rollback"),
      ),
    ).rejects.toThrow("Injected audit failure: session.revoke");

    expect(
      (await repository.getUserSession("session_current_revoke_rollback"))
        ?.revokedAt,
    ).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "session.revoke",
      ),
    ).toBe(false);
  });

  it("rolls back targeted local session revocation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedLocalSession(repository, "session_target_revoke_rollback");
    const service = new SessionService(
      failAuditRepository(repository, "session.revoke"),
    );

    await expect(
      service.revoke({
        subject: localSessionSubject(),
        sessionId: "session_target_revoke_rollback",
      }),
    ).rejects.toThrow("Injected audit failure: session.revoke");

    expect(
      (await repository.getUserSession("session_target_revoke_rollback"))
        ?.revokedAt,
    ).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "session.revoke",
      ),
    ).toBe(false);
  });

  it("rolls back revoke-other local sessions as one batch when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedLocalSession(repository, "session_keep_current");
    await seedLocalSession(repository, "session_other_revoke_rollback_a");
    await seedLocalSession(repository, "session_other_revoke_rollback_b");
    const service = new SessionService(
      failAuditRepository(repository, "session.revoke"),
    );

    await expect(
      service.revokeOthers(localSessionSubject("session_keep_current")),
    ).rejects.toThrow("Injected audit failure: session.revoke");

    expect(
      (await repository.getUserSession("session_other_revoke_rollback_a"))
        ?.revokedAt,
    ).toBeUndefined();
    expect(
      (await repository.getUserSession("session_other_revoke_rollback_b"))
        ?.revokedAt,
    ).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "session.revoke",
      ),
    ).toBe(false);
  });

  it("rolls back support approval session creation when notification enqueue fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createUser({
      id: "user_support_approval_rollback_target",
      orgId: "org_default",
      email: "support-approval-rollback-target@example.com",
      name: "Support Approval Rollback Target",
    });
    await repository.createUser({
      id: "user_support_approval_rollback_approver",
      orgId: "org_default",
      email: "support-approval-rollback-approver@example.com",
      name: "Support Approval Rollback Approver",
      role: "org_admin",
    });
    const service = new SessionService(repository);
    const request = await service.requestSupportSession({
      subject: supportAdminSubject(),
      targetUserId: "user_support_approval_rollback_target",
      confirmTargetUserId: "user_support_approval_rollback_target",
      reason: "Support approval rollback investigation",
      ticketRef: "SUPPORT-APPROVAL-ROLLBACK",
      ttlMinutes: 20,
    });
    const failingService = new SessionService(
      failNotificationRepository(
        repository,
        "support_impersonation_request_approved",
      ),
    );

    await expect(
      failingService.approveSupportSessionRequest({
        subject: supportApproverSubject(
          "user_support_approval_rollback_approver",
        ),
        requestId: request.id,
      }),
    ).rejects.toThrow(
      "Injected notification failure: support_impersonation_request_approved",
    );

    expect(
      (await service.listSupportSessionRequests(supportAdminSubject())).find(
        (item) => item.id === request.id,
      ),
    ).toMatchObject({ status: "pending" });
    expect(
      (
        await repository.listUserSessions(
          "org_default",
          "user_support_approval_rollback_target",
        )
      ).filter((session) => session.name.startsWith("Support session")),
    ).toHaveLength(0);
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) =>
          log.action === "support.impersonation.create" ||
          log.action === "support.impersonation.request.approve",
      ),
    ).toBe(false);
    expect(
      (
        await repository.listUserNotifications(
          "org_default",
          "user_support_approval_rollback_target",
        )
      ).some(
        (notification) =>
          notification.type === "support_impersonation_session_created",
      ),
    ).toBe(false);
  });

  it("rolls back support session revocation when notification enqueue fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createUser({
      id: "user_support_revoke_rollback_target",
      orgId: "org_default",
      email: "support-revoke-rollback-target@example.com",
      name: "Support Revoke Rollback Target",
    });
    const service = new SessionService(repository);
    const created = await service.createSupportSession({
      subject: supportAdminSubject(),
      targetUserId: "user_support_revoke_rollback_target",
      confirmTargetUserId: "user_support_revoke_rollback_target",
      reason: "Support revoke rollback investigation",
      ticketRef: "SUPPORT-REVOKE-ROLLBACK",
      ttlMinutes: 15,
    });
    const failingService = new SessionService(
      failNotificationRepository(
        repository,
        "support_impersonation_session_revoked",
      ),
    );

    await expect(
      failingService.revokeSupportSession({
        subject: supportAdminSubject(),
        sessionId: created.session.id,
      }),
    ).rejects.toThrow(
      "Injected notification failure: support_impersonation_session_revoked",
    );

    expect(
      (await repository.getUserSession(created.session.id))?.revokedAt,
    ).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) =>
          log.action === "support.impersonation.revoke" &&
          log.resourceId === created.session.id,
      ),
    ).toBe(false);
    expect(
      (
        await repository.listUserNotifications(
          "org_default",
          "user_support_revoke_rollback_target",
        )
      ).some(
        (notification) =>
          notification.type === "support_impersonation_session_revoked",
      ),
    ).toBe(false);
  });

  it("rolls back retention policy updates when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const beforePolicy = await repository.getRetentionPolicy("org_default");
    const service = new GovernanceService(
      failAuditRepository(repository, "governance.retention.update"),
      new MemoryObjectStore(),
    );

    await expect(
      service.updateRetentionPolicy({
        subject: governanceAdminSubject(),
        auditLogRetentionDays: 730,
      }),
    ).rejects.toThrow("Injected audit failure: governance.retention.update");

    expect(await repository.getRetentionPolicy("org_default")).toEqual(
      beforePolicy,
    );
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "governance.retention.update",
      ),
    ).toBe(false);
  });

  it("rolls back audit-log retention deletion when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.upsertRetentionPolicy({
      orgId: "org_default",
      auditLogRetentionDays: 30,
      updatedBy: "user_dev_admin",
      updatedAt: "2026-07-07T12:00:00.000Z",
    });
    await repository.createAuditLog({
      id: "audit_retention_old_rollback",
      orgId: "org_default",
      actorId: "user_dev_admin",
      action: "rollback.retention.old",
      resourceType: "organization",
      resourceId: "org_default",
      outcome: "success",
      metadata: { rollbackFixture: true },
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    const service = new GovernanceService(
      failAuditRepository(repository, "governance.retention.enforce"),
      new MemoryObjectStore(),
    );

    await expect(
      service.enforceRetention(governanceAdminSubject()),
    ).rejects.toThrow("Injected audit failure: governance.retention.enforce");

    const auditLogs = await repository.listAuditLogs("org_default");
    expect(
      auditLogs.some((log) => log.id === "audit_retention_old_rollback"),
    ).toBe(true);
    expect(
      auditLogs.some((log) => log.action === "governance.retention.enforce"),
    ).toBe(false);
  });

  it("rolls back data export package creation and removes the package object when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = trackingObjectStore();
    const service = new GovernanceService(
      failAuditRepository(repository, "governance.data_export.package.create"),
      objectStore.store,
    );

    await expect(
      service.createDataExportPackage({
        subject: governanceAdminSubject(),
        request: { scope: "org" },
      }),
    ).rejects.toThrow(
      "Injected audit failure: governance.data_export.package.create",
    );

    const packages = await new GovernanceService(
      repository,
      objectStore.store,
    ).listDataExportPackages(governanceAdminSubject());
    expect(packages.packages).toHaveLength(0);
    expect(objectStore.putKeys).toHaveLength(1);
    expect(objectStore.deleteKeys).toEqual(objectStore.putKeys);
    expect(
      await objectStore.store.getObject(objectStore.putKeys[0]!),
    ).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "governance.data_export.package.create",
      ),
    ).toBe(false);
  });

  it("rolls back data export package deletion when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = trackingObjectStore();
    const service = new GovernanceService(repository, objectStore.store);
    const packaged = await service.createDataExportPackage({
      subject: governanceAdminSubject(),
      request: { scope: "org" },
    });
    const failingService = new GovernanceService(
      failAuditRepository(repository, "governance.data_export.package.delete"),
      objectStore.store,
    );

    await expect(
      failingService.deleteDataExportPackage({
        subject: governanceAdminSubject(),
        packageId: packaged.packageId,
        confirmPackageId: packaged.packageId,
      }),
    ).rejects.toThrow(
      "Injected audit failure: governance.data_export.package.delete",
    );

    const packages = await service.listDataExportPackages(
      governanceAdminSubject(),
    );
    expect(packages.packages).toHaveLength(1);
    expect(packages.packages[0]?.packageId).toBe(packaged.packageId);
    expect(objectStore.deleteKeys).toHaveLength(0);
    expect(
      await objectStore.store.getObject(objectStore.putKeys[0]!),
    ).toBeDefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "governance.data_export.package.delete",
      ),
    ).toBe(false);
  });

  it("rolls back governed data deletion when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createChat({
      id: "chat_governed_delete_rollback",
      orgId: "org_default",
      workspaceId: "workspace_default",
      title: "Deletion rollback",
      createdBy: "user_dev_admin",
      updatedAt: "2026-06-30T15:40:00.000Z",
    });
    await repository.createMessage({
      id: "msg_governed_delete_rollback",
      chatId: "chat_governed_delete_rollback",
      role: "user",
      content: "delete me only if audit commits",
      createdAt: "2026-06-30T15:40:00.000Z",
    });

    const service = new GovernanceService(
      failAuditRepository(repository, "governance.data_deletion.execute"),
      new MemoryObjectStore(),
    );

    await expect(
      service.executeDataDeletion({
        subject: governanceAdminSubject(),
        resourceType: "chat",
        resourceId: "chat_governed_delete_rollback",
        confirmResourceId: "chat_governed_delete_rollback",
      }),
    ).rejects.toThrow(
      "Injected audit failure: governance.data_deletion.execute",
    );

    expect(
      await repository.getChat("chat_governed_delete_rollback"),
    ).toBeDefined();
    expect(
      await repository.listMessages("chat_governed_delete_rollback"),
    ).toHaveLength(1);
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "governance.data_deletion.execute",
      ),
    ).toBe(false);
  });

  it("rolls back eval suite and case creation when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new EvalService(
      failAuditRepository(repository, "eval.suite.create"),
    );

    await expect(
      service.createSuite({
        subject: evalAdminSubject(),
        agentId: "agent_default",
        name: "Rollback suite",
        cases: [{ input: "Answer only if the audit can commit." }],
      }),
    ).rejects.toThrow("Injected audit failure: eval.suite.create");

    expect(await repository.listEvalSuites("agent_default")).toHaveLength(0);
    expect(await repository.listEvalCases("eval_suite_rollback")).toHaveLength(
      0,
    );
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "eval.suite.create",
      ),
    ).toBe(false);
  });

  it("rolls back eval result ratings when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = "2026-07-03T10:00:00.000Z";
    await repository.createEvalRun({
      id: "eval_run_rating_rollback",
      orgId: "org_default",
      workspaceId: "workspace_default",
      agentId: "agent_default",
      suiteId: "eval_suite_rating_rollback",
      modelId: "model_openai_compatible_default",
      status: "passed",
      score: 1,
      createdBy: "user_dev_admin",
      createdAt: now,
      completedAt: now,
    });
    await repository.createEvalRunResults([
      {
        id: "eval_result_rating_rollback",
        orgId: "org_default",
        runId: "eval_run_rating_rollback",
        caseId: "eval_case_rating_rollback",
        status: "passed",
        score: 1,
        output: "passed",
        checks: {},
        createdAt: now,
      },
    ]);
    const service = new EvalService(
      failAuditRepository(repository, "eval.result.rate"),
    );

    await expect(
      service.rateResult({
        subject: evalAdminSubject(),
        resultId: "eval_result_rating_rollback",
        rating: "pass",
        comment: "Looks good only if audit commits.",
      }),
    ).rejects.toThrow("Injected audit failure: eval.result.rate");

    expect(
      await repository.listEvalResultHumanRatings("eval_run_rating_rollback"),
    ).toHaveLength(0);
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "eval.result.rate",
      ),
    ).toBe(false);
  });

  it("rolls back collaboration share grants when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new CollaborationService(
      failAuditRepository(repository, "agent.share"),
    );

    await expect(
      service.shareAgent({
        subject: collaborationAdminSubject(),
        agentId: "agent_default",
        share: {
          principalType: "group",
          principalId: "group_reviewers",
          permissions: ["read", "run"],
        },
      }),
    ).rejects.toThrow("Injected audit failure: agent.share");

    expect(
      (await repository.listResourceGrants("org_default")).some(
        (grant) =>
          grant.resourceType === "agent" &&
          grant.resourceId === "agent_default" &&
          grant.principalType === "group" &&
          grant.principalId === "group_reviewers",
      ),
    ).toBe(false);
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "agent.share",
      ),
    ).toBe(false);
  });

  it("rolls back folder creation, owner grants, and audit together", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new CollaborationService(
      failAuditRepository(repository, "folder.create"),
    );

    await expect(
      service.createFolder({
        subject: collaborationAdminSubject(),
        workspaceId: "workspace_default",
        name: "Rollback folder",
      }),
    ).rejects.toThrow("Injected audit failure: folder.create");

    expect(
      (
        await repository.listWorkspaceFolders(
          "org_default",
          "workspace_default",
        )
      ).length,
    ).toBe(0);
    expect(
      (await repository.listResourceGrants("org_default")).some(
        (grant) => grant.resourceType === "folder",
      ),
    ).toBe(false);
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "folder.create",
      ),
    ).toBe(false);
  });

  it("rolls back channel creation and initial members when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = channelService(
      failAuditRepository(repository, "channel.create"),
    );

    await expect(
      service.create(channelAdminSubject(), {
        name: "Rollback channel",
        type: "group",
      }),
    ).rejects.toThrow("Injected audit failure: channel.create");

    expect(
      await repository.listCollaborationChannels("org_default"),
    ).toHaveLength(0);
    expect(
      await repository.listCollaborationChannelMembers("org_default"),
    ).toHaveLength(0);
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "channel.create",
      ),
    ).toBe(false);
  });

  it("rolls back channel update and member additions when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedChannelPeer(repository, "user_channel_update_peer");
    await seedNativeChannel(repository, "channel_update_rollback");
    const service = channelService(
      failAuditRepository(repository, "channel.update"),
    );

    await expect(
      service.update(channelAdminSubject(), "channel_update_rollback", {
        name: "Updated channel",
        userIds: ["user_channel_update_peer"],
      }),
    ).rejects.toThrow("Injected audit failure: channel.update");

    expect(
      await repository.getCollaborationChannel("channel_update_rollback"),
    ).toMatchObject({ name: "Rollback channel" });
    expect(
      await repository.getCollaborationChannelMember(
        "channel_update_rollback",
        "user_channel_update_peer",
      ),
    ).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "channel.update",
      ),
    ).toBe(false);
  });

  it("rolls back channel deletion and member cleanup when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedNativeChannel(repository, "channel_delete_rollback");
    const service = channelService(
      failAuditRepository(repository, "channel.delete"),
    );

    await expect(
      service.delete(channelAdminSubject(), "channel_delete_rollback"),
    ).rejects.toThrow("Injected audit failure: channel.delete");

    expect(
      await repository.getCollaborationChannel("channel_delete_rollback"),
    ).toBeDefined();
    expect(
      await repository.getCollaborationChannelMember(
        "channel_delete_rollback",
        "user_dev_admin",
      ),
    ).toBeDefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "channel.delete",
      ),
    ).toBe(false);
  });

  it("rolls back channel member additions when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedChannelPeer(repository, "user_channel_add_peer");
    await seedNativeChannel(repository, "channel_add_member_rollback");
    const service = channelService(
      failAuditRepository(repository, "channel.members.add"),
    );

    await expect(
      service.addMembers(channelAdminSubject(), "channel_add_member_rollback", {
        userIds: ["user_channel_add_peer"],
      }),
    ).rejects.toThrow("Injected audit failure: channel.members.add");

    expect(
      await repository.getCollaborationChannelMember(
        "channel_add_member_rollback",
        "user_channel_add_peer",
      ),
    ).toBeUndefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "channel.members.add",
      ),
    ).toBe(false);
  });

  it("rolls back channel member removals when audit fails", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedChannelPeer(repository, "user_channel_remove_peer");
    await seedNativeChannel(repository, "channel_remove_member_rollback", [
      "user_channel_remove_peer",
    ]);
    const service = channelService(
      failAuditRepository(repository, "channel.members.remove"),
    );

    await expect(
      service.removeMember(
        channelAdminSubject(),
        "channel_remove_member_rollback",
        "user_channel_remove_peer",
      ),
    ).rejects.toThrow("Injected audit failure: channel.members.remove");

    expect(
      await repository.getCollaborationChannelMember(
        "channel_remove_member_rollback",
        "user_channel_remove_peer",
      ),
    ).toBeDefined();
    expect(
      (await repository.listAuditLogs("org_default")).some(
        (log) => log.action === "channel.members.remove",
      ),
    ).toBe(false);
  });
});

function failAuditRepository(
  repository: RomeoRepository,
  action: string,
): RomeoRepository {
  return new Proxy(repository, {
    get(target, property) {
      if (property === "transaction") {
        return async <T>(
          work: (transactionalRepository: RomeoRepository) => Promise<T>,
        ): Promise<T> =>
          target.transaction((transactionalRepository) =>
            work(failAuditRepository(transactionalRepository, action)),
          );
      }
      if (property === "createAuditLog") {
        return async (log: AuditLog): Promise<AuditLog> => {
          if (log.action === action) {
            throw new Error(`Injected audit failure: ${action}`);
          }
          return target.createAuditLog(log);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as RomeoRepository;
}

function failUsageRepository(
  repository: RomeoRepository,
  metric: string,
  options: {
    createdRunIds?: string[];
    createdSources?: KnowledgeSource[];
  } = {},
): RomeoRepository {
  return new Proxy(repository, {
    get(target, property) {
      if (property === "transaction") {
        return async <T>(
          work: (transactionalRepository: RomeoRepository) => Promise<T>,
        ): Promise<T> =>
          target.transaction((transactionalRepository) =>
            work(failUsageRepository(transactionalRepository, metric, options)),
          );
      }
      if (property === "createRun") {
        return async (run: RunRecord): Promise<RunRecord> => {
          options.createdRunIds?.push(run.id);
          return target.createRun(run);
        };
      }
      if (property === "createKnowledgeSource") {
        return async (source: KnowledgeSource): Promise<KnowledgeSource> => {
          options.createdSources?.push(source);
          return target.createKnowledgeSource(source);
        };
      }
      if (property === "createUsageEvent") {
        return async (event: UsageEvent): Promise<UsageEvent> => {
          if (event.metric === metric) {
            throw new Error(`Injected usage failure: ${metric}`);
          }
          return target.createUsageEvent(event);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as RomeoRepository;
}

function failNotificationRepository(
  repository: RomeoRepository,
  type: UserNotification["type"],
): RomeoRepository {
  return new Proxy(repository, {
    get(target, property) {
      if (property === "transaction") {
        return async <T>(
          work: (transactionalRepository: RomeoRepository) => Promise<T>,
        ): Promise<T> =>
          target.transaction((transactionalRepository) =>
            work(failNotificationRepository(transactionalRepository, type)),
          );
      }
      if (property === "createUserNotification") {
        return async (
          notification: UserNotification,
        ): Promise<UserNotification> => {
          if (notification.type === type) {
            throw new Error(`Injected notification failure: ${type}`);
          }
          return target.createUserNotification(notification);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as RomeoRepository;
}

function workerSubject(): AuthSubject {
  return {
    id: "service_account_worker",
    type: "service_account",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: [],
    scopes: ["tools:manage"],
    isAdmin: true,
  };
}

function toolManageSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["tools:manage", "tools:use"],
    isAdmin: true,
  };
}

function toolUseSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["tools:use"],
    isAdmin: true,
  };
}

function agentCapabilityAdminSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["agents:write", "knowledge:read", "tools:manage", "tools:use"],
    isAdmin: true,
  };
}

function toolBindingService(repository: RomeoRepository): ToolService {
  return new ToolService(repository, new RunEventSequencer());
}

function delegatedOAuthSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["knowledge:write"],
    isAdmin: false,
  };
}

function knowledgeAdminSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["knowledge:read", "knowledge:write"],
    isAdmin: true,
  };
}

function chatWriteSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["chats:write"],
    isAdmin: true,
  };
}

function evalAdminSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["agents:read", "agents:write", "agents:run"],
    isAdmin: true,
  };
}

function collaborationAdminSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["agents:write", "me:read"],
    isAdmin: true,
  };
}

function channelAdminSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["chats:write"],
    isAdmin: true,
  };
}

function channelService(repository: RomeoRepository): ChannelService {
  return new ChannelService(
    repository,
    new OpenWebUiCompatibilityService(repository),
  );
}

async function seedChannelPeer(
  repository: RomeoRepository,
  userId: string,
): Promise<void> {
  await repository.createUser({
    id: userId,
    orgId: "org_default",
    email: `${userId}@romeo.local`,
    name: userId,
  });
}

async function seedNativeChannel(
  repository: RomeoRepository,
  channelId: string,
  extraUserIds: string[] = [],
): Promise<void> {
  const now = "2026-07-03T11:00:00.000Z";
  await repository.createCollaborationChannel({
    id: channelId,
    orgId: "org_default",
    workspaceId: "workspace_default",
    userId: "user_dev_admin",
    type: "group",
    name: "Rollback channel",
    isPrivate: false,
    createdAt: now,
    updatedAt: now,
  });
  await Promise.all(
    ["user_dev_admin", ...extraUserIds].map((userId) =>
      repository.createCollaborationChannelMember({
        id: `channel_member_${channelId}_${userId}`,
        orgId: "org_default",
        channelId,
        userId,
        role: userId === "user_dev_admin" ? "manager" : "member",
        isActive: true,
        isChannelMuted: false,
        isChannelPinned: false,
        createdAt: now,
        updatedAt: now,
        joinedAt: now,
      }),
    ),
  );
}

function promptTemplateSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["agents:read", "agents:write"],
    isAdmin: true,
  };
}

function deviceAuthorizationSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["me:read"],
    isAdmin: false,
  };
}

function voiceManageSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["voices:manage"],
    isAdmin: true,
  };
}

function voiceUseSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["voices:use"],
    isAdmin: false,
  };
}

function billingAdminSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["admin:read", "admin:write"],
    isAdmin: true,
  };
}

function apiKeyAdminSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["admin:read", "admin:write"],
    isAdmin: true,
  };
}

function tenantGlobalAdminSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["admin:read", "admin:write"],
    isAdmin: true,
    adminRole: "global_admin",
  };
}

function tenantAdminService(repository: RomeoRepository): TenantAdminService {
  return new TenantAdminService(
    repository,
    new AbuseControlService(repository),
  );
}

function providerAdminSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["providers:read", "providers:write", "models:read"],
    isAdmin: true,
  };
}

function webhookAdminSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["webhooks:read", "webhooks:write"],
    isAdmin: true,
  };
}

function fileWriteSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["files:write", "files:read"],
    isAdmin: true,
  };
}

function localAuthSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["me:read"],
    isAdmin: false,
  };
}

function localSessionSubject(sessionId?: string): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["me:read"],
    isAdmin: false,
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

function userLifecycleAdminSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["admin:write"],
    isAdmin: true,
    adminRole: "org_admin",
  };
}

async function seedLocalSession(
  repository: RomeoRepository,
  sessionId: string,
): Promise<void> {
  await repository.createUserSession({
    id: sessionId,
    orgId: "org_default",
    userId: "user_dev_admin",
    name: sessionId,
    hashedToken: `hash_${sessionId}`,
    scopes: ["me:read"],
    isAdmin: false,
    expiresAt: fixtureFuture(),
    createdAt: fixturePast(),
  });
}

async function seedQuotaBucket(
  repository: RomeoRepository,
  quotaBucketId: string,
  input: { limit: number; used: number },
): Promise<void> {
  await repository.createQuotaBucket({
    id: quotaBucketId,
    orgId: "org_default",
    scopeType: "org",
    scopeId: "org_default",
    metric: "run.started",
    limit: input.limit,
    used: input.used,
    resetInterval: "monthly",
    createdAt: "2026-07-07T12:00:00.000Z",
    updatedAt: "2026-07-07T12:00:00.000Z",
  });
}

function localAuthEnv() {
  return readEnv({
    DEV_SEEDED_LOGIN: "false",
    LOCAL_AUTH_SECRET_ENCRYPTION_KEY: "prod-local-auth-key-32-bytes-long",
    SESSION_SECRET: "prod-session-secret-32-bytes-long",
    WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
  });
}

function managedSecretEnv() {
  return readEnv({
    MANAGED_SECRET_ENCRYPTION_KEY: "prod-managed-secret-key-32-bytes",
    SESSION_SECRET: "prod-session-secret-32-bytes-long",
    WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
  });
}

function delegatedOAuthEnv() {
  return readEnv({
    APP_ORIGIN: "https://romeo.example",
    DELEGATED_OAUTH_GITHUB_CLIENT_ID: "github-client-id",
    DELEGATED_OAUTH_GITHUB_CLIENT_SECRET: "github-client-secret",
    DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY: "delegated-oauth-test-token-key-32",
    SESSION_SECRET: "prod-session-secret-32-bytes-long",
    WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
  });
}

function catalogVoiceProvider(): VoiceProvider {
  return {
    async listVoices() {
      return [
        {
          id: "provider_voice_rollback_one",
          providerId: "voice_provider_rollback",
          providerVoiceId: "rollback_one",
          name: "Rollback One",
          language: "en",
          styleTags: ["clear"],
          cloningAllowed: false,
        },
        {
          id: "provider_voice_rollback_two",
          providerId: "voice_provider_rollback",
          providerVoiceId: "rollback_two",
          name: "Rollback Two",
          language: "en",
          styleTags: ["warm"],
          cloningAllowed: false,
        },
      ];
    },
    async synthesize() {
      throw new Error("not used");
    },
    async transcribe() {
      throw new Error("not used");
    },
  };
}

function trackingObjectStore(): {
  deleteKeys: string[];
  putKeys: string[];
  store: ObjectStore;
} {
  const base = new MemoryObjectStore();
  const putKeys: string[] = [];
  const deleteKeys: string[] = [];
  return {
    putKeys,
    deleteKeys,
    store: {
      putObject(input: PutObjectInput) {
        putKeys.push(input.key);
        return base.putObject(input);
      },
      getObject(key: string) {
        return base.getObject(key);
      },
      deleteObject(key: string) {
        deleteKeys.push(key);
        return base.deleteObject(key);
      },
      createPresignedUpload(input) {
        return base.createPresignedUpload(input);
      },
    },
  };
}

function fakeLdapClient(options: {
  bind: (dn: string, password: string) => Promise<void>;
  search: (
    baseDn: string,
    options: LdapDirectorySearchOptions,
  ) => Promise<LdapDirectoryEntry[]>;
}): LdapDirectoryClient {
  return {
    bind: options.bind,
    search: options.search,
    async startTls() {},
    async unbind() {},
  };
}

function sha256ForTest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function runCreateSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["agents:run", "runs:create"],
    isAdmin: true,
  };
}

function dispatchFixture(suffix: string): {
  connector: ToolConnector;
  operation: ToolOperation;
} {
  const now = "2026-07-02T18:30:00.000Z";
  const connector: ToolConnector = {
    id: `tool_connector_${suffix}`,
    orgId: "org_default",
    type: "openapi",
    name: "Issue tracker",
    description: "Issue tracker dispatch fixture.",
    schema: { baseUrl: "https://api.example.com" },
    authConfig: { type: "none", configured: false },
    networkPolicy: {
      mode: "allow_hosts",
      allowedHosts: ["api.example.com"],
      allowPrivateNetwork: false,
    },
    riskLevel: "medium",
    approvalPolicy: "external_side_effects",
    visibility: "org",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
  const operation: ToolOperation = {
    id: `tool_operation_${suffix}`,
    orgId: "org_default",
    connectorId: connector.id,
    operationId: "create-ticket",
    method: "post",
    path: "/issues/{issueId}",
    name: "Create ticket note",
    description: "Create a ticket note.",
    inputSchema: {
      parameters: [
        {
          name: "issueId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        contentType: "application/json",
        schema: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
        },
      },
    },
    outputSchema: {},
    riskLevel: "medium",
    approvalPolicy: "external_side_effects",
    enabled: true,
    createdAt: now,
  };
  return { connector, operation };
}

function supportAdminSubject(id = "user_dev_admin"): AuthSubject {
  return {
    id,
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["admin:read", "admin:write"],
    isAdmin: true,
  };
}

function supportApproverSubject(id: string): AuthSubject {
  return supportAdminSubject(id);
}

function workflowAdminSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["agents:run", "runs:create"],
    isAdmin: true,
  };
}

function governanceAdminSubject(): AuthSubject {
  return {
    id: "user_dev_admin",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["admin:write"],
    isAdmin: true,
  };
}
