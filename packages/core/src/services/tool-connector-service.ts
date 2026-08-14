import { assertScope, type AuthSubject } from "@romeo/auth";
import type { ToolApprovalPolicy, ToolRiskLevel } from "@romeo/tools";

import type {
  ToolConnector,
  ToolConnectorAuthCheck,
  ToolNetworkPolicy,
  ToolOperation,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import {
  type AuditAction,
  type AuditMetadata,
  writeAuditLog,
} from "./audit-log";
import { parseManagedSecretRef } from "./secret-refs";
import { disabledSecretResolver, type SecretResolver } from "./secret-resolver";
import { normalizeToolNetworkPolicy } from "./tool-network-policy";
import {
  importOpenApiToolConnector,
  type ImportedToolConnector,
} from "./tool-openapi-import";
import {
  createWebhookToolConnector,
  type CreatedWebhookToolConnector,
} from "./tool-webhook-connector";
import {
  createMcpToolConnector,
  type CreatedMcpToolConnector,
  type McpToolManifestEntry,
} from "./tool-mcp-connector";
import {
  toolConnectorCatalogReport,
  type ToolConnectorCatalogReport,
} from "../domain/tool-connector-catalog";
import {
  authMetadataForConnector,
  type ToolConnectorAuthUpdate,
} from "./tool-connector-auth";
import {
  ToolConnectorDispatchService,
  type ToolConnectorDispatchOptions,
} from "./tool-connector-dispatch-service";
import {
  buildToolOperationTestPreview,
  type ToolOperationTestInput,
} from "./tool-operation-test";
import { listToolOperationsByConnector } from "./tool-operation-catalog";

export class ToolConnectorService extends ToolConnectorDispatchService {
  constructor(
    repository: RomeoRepository,
    secretResolver: SecretResolver = disabledSecretResolver,
    private readonly options: ToolConnectorDispatchOptions = {},
  ) {
    super(repository, secretResolver, options);
  }

  async list(subject: AuthSubject): Promise<ToolConnector[]> {
    assertScope(subject, "tools:manage");
    const connectors = await this.repository.listToolConnectors(subject.orgId);
    const [operationMap, agentsByWorkspace] = await Promise.all([
      listToolOperationsByConnector(this.repository, connectors),
      Promise.all(
        subject.workspaceIds.map((workspaceId) =>
          this.repository.listAgents(workspaceId),
        ),
      ),
    ]);
    const agents = agentsByWorkspace.flat();
    const bindingsByAgent = await Promise.all(
      agents.map(
        async (agent) =>
          [
            agent.id,
            await this.repository.listAgentToolBindings(agent.id),
          ] as const,
      ),
    );
    const agentBindings = new Map(bindingsByAgent);
    return connectors.map((connector) => {
      const operationIds = new Set(
        (operationMap.get(connector.id) ?? []).map((operation) => operation.id),
      );
      const dependentAgents = agents.filter((agent) =>
        (agentBindings.get(agent.id) ?? []).some(
          (binding) => binding.enabled && operationIds.has(binding.toolId),
        ),
      );
      const dependentOperationIds = new Set(
        dependentAgents.flatMap((agent) =>
          (agentBindings.get(agent.id) ?? [])
            .filter(
              (binding) => binding.enabled && operationIds.has(binding.toolId),
            )
            .map((binding) => binding.toolId),
        ),
      );
      return {
        ...connector,
        dependentAgentCount: dependentAgents.length,
        dependentOperationCount: dependentOperationIds.size,
      };
    });
  }

  catalog(subject: AuthSubject): ToolConnectorCatalogReport {
    assertScope(subject, "tools:manage");
    return toolConnectorCatalogReport();
  }

  async importOpenApi(input: {
    subject: AuthSubject;
    name: string;
    description?: string;
    spec: Record<string, unknown>;
    riskLevel?: ToolRiskLevel;
    approvalPolicy?: ToolApprovalPolicy;
  }): Promise<ImportedToolConnector> {
    assertScope(input.subject, "tools:manage");
    return importOpenApiToolConnector(this.repository, input.subject, input);
  }

  async createWebhook(input: {
    subject: AuthSubject;
    name: string;
    url: string;
    bodySchema?: Record<string, unknown>;
    description?: string;
    operationName?: string;
    riskLevel?: ToolRiskLevel;
    approvalPolicy?: ToolApprovalPolicy;
  }): Promise<CreatedWebhookToolConnector> {
    assertScope(input.subject, "tools:manage");
    return createWebhookToolConnector(this.repository, input.subject, input);
  }

  async createMcp(input: {
    subject: AuthSubject;
    name: string;
    serverUrl: string;
    description?: string;
    protocolVersion?: string;
    tools: McpToolManifestEntry[];
    riskLevel?: ToolRiskLevel;
    approvalPolicy?: ToolApprovalPolicy;
  }): Promise<CreatedMcpToolConnector> {
    assertScope(input.subject, "tools:manage");
    return createMcpToolConnector(this.repository, input.subject, input);
  }

  async updateAuth(input: {
    subject: AuthSubject;
    connectorId: string;
    type: "none" | "api_key" | "bearer" | "oauth2_client_credentials";
    secretRef?: string;
    apiKeyIn?: "header" | "query";
    apiKeyName?: string;
    oauthClientAuthMethod?: ToolConnectorAuthUpdate["oauthClientAuthMethod"];
    oauthScopes?: string[];
    oauthTokenUrl?: string;
  }): Promise<ToolConnector> {
    assertScope(input.subject, "tools:manage");
    if (input.type !== "none" && input.secretRef === undefined) {
      throw new ApiError(
        "invalid_tool_auth_config",
        "Connector auth requires a secret reference.",
        400,
      );
    }
    const secretRefScheme =
      input.secretRef === undefined
        ? undefined
        : parseManagedSecretRef(input.secretRef).scheme;
    return this.repository.transaction(async (repository) => {
      const currentConnector = await this.getForSubjectInRepository(
        repository,
        input.subject,
        input.connectorId,
      );
      const authConfig =
        input.type === "none"
          ? { type: "none", configured: false }
          : {
              type: input.type,
              configured: true,
              secretRef: input.secretRef,
              ...authMetadataForConnector(currentConnector, input),
            };
      const updated = await repository.updateToolConnector({
        ...currentConnector,
        authConfig,
        updatedAt: new Date().toISOString(),
      });
      await this.auditConfigurationUpdate(
        repository,
        input.subject,
        "tool.connector.auth.update",
        "tool_connector",
        updated.id,
        {
          authType: input.type,
          configured: updated.authConfig.configured === true,
          ...(secretRefScheme === undefined ? {} : { secretRefScheme }),
          oauthScopesCount:
            input.oauthScopes === undefined ? 0 : input.oauthScopes.length,
          oauthTokenUrlConfigured: input.oauthTokenUrl !== undefined,
        },
      );
      return updated;
    });
  }

  async updateConnector(input: {
    subject: AuthSubject;
    connectorId: string;
    enabled: boolean;
  }): Promise<ToolConnector> {
    assertScope(input.subject, "tools:manage");
    return this.repository.transaction(async (repository) => {
      const currentConnector = await this.getForSubjectInRepository(
        repository,
        input.subject,
        input.connectorId,
      );
      const updated = await repository.updateToolConnector({
        ...currentConnector,
        enabled: input.enabled,
        updatedAt: new Date().toISOString(),
      });
      await this.auditConfigurationUpdate(
        repository,
        input.subject,
        "tool.connector.update",
        "tool_connector",
        updated.id,
        { enabled: updated.enabled },
      );
      return updated;
    });
  }

  async checkAuth(
    subject: AuthSubject,
    connectorId: string,
  ): Promise<ToolConnectorAuthCheck> {
    assertScope(subject, "tools:manage");
    const connector = await this.getForSubject(subject, connectorId);
    const now = new Date().toISOString();
    const secretRef =
      typeof connector.authConfig.secretRef === "string"
        ? connector.authConfig.secretRef
        : undefined;
    const configured =
      connector.authConfig.configured === true && secretRef !== undefined;
    const parsed =
      secretRef === undefined ? undefined : parseManagedSecretRef(secretRef);
    const resolution = configured
      ? await this.secretResolver.check(secretRef)
      : undefined;
    const check: ToolConnectorAuthCheck = {
      connectorId: connector.id,
      configured,
      available: resolution?.available ?? false,
      checkedAt: now,
      ...(parsed === undefined ? {} : { secretRefScheme: parsed.scheme }),
      ...(configured && resolution?.failureCode !== undefined
        ? { failureCode: resolution.failureCode }
        : {}),
      ...(!configured ? { failureCode: "auth_not_configured" } : {}),
    };
    await writeAuditLog(this.repository, {
      subject,
      action: "tool.connector.auth.check",
      resourceType: "tool_connector",
      resourceId: connector.id,
      metadata: {
        connectorId: connector.id,
        configured: check.configured,
        available: check.available,
        secretRefScheme: check.secretRefScheme,
        failureCode: check.failureCode,
      },
    });
    return check;
  }

  async updateNetworkPolicy(input: {
    subject: AuthSubject;
    connectorId: string;
    policy: ToolNetworkPolicy;
  }): Promise<ToolConnector> {
    assertScope(input.subject, "tools:manage");
    const networkPolicy = normalizeToolNetworkPolicy(input.policy);
    return this.repository.transaction(async (repository) => {
      const currentConnector = await this.getForSubjectInRepository(
        repository,
        input.subject,
        input.connectorId,
      );
      const updated = await repository.updateToolConnector({
        ...currentConnector,
        networkPolicy,
        updatedAt: new Date().toISOString(),
      });
      await this.auditConfigurationUpdate(
        repository,
        input.subject,
        "tool.connector.network_policy.update",
        "tool_connector",
        updated.id,
        {
          allowPrivateNetwork: networkPolicy.allowPrivateNetwork,
          allowedHostCount: networkPolicy.allowedHosts.length,
          mode: networkPolicy.mode,
        },
      );
      return updated;
    });
  }

  async listOperations(
    subject: AuthSubject,
    connectorId: string,
  ): Promise<ToolOperation[]> {
    assertScope(subject, "tools:manage");
    await this.getForSubject(subject, connectorId);
    return this.repository.listToolOperations(connectorId);
  }

  async updateOperation(input: {
    subject: AuthSubject;
    connectorId: string;
    operationId: string;
    enabled: boolean;
  }): Promise<ToolOperation> {
    assertScope(input.subject, "tools:manage");
    return this.repository.transaction(async (repository) => {
      await this.getForSubjectInRepository(
        repository,
        input.subject,
        input.connectorId,
      );
      const operation = (
        await repository.listToolOperations(input.connectorId)
      ).find((item) => item.operationId === input.operationId);
      if (!operation) throw notFound("Tool operation");
      const updated = await repository.updateToolOperation({
        ...operation,
        enabled: input.enabled,
      });
      await this.auditConfigurationUpdate(
        repository,
        input.subject,
        "tool.operation.update",
        "tool_operation",
        updated.id,
        {
          connectorId: input.connectorId,
          operationId: updated.operationId,
          enabled: updated.enabled,
        },
      );
      return updated;
    });
  }

  async testOperation(input: {
    subject: AuthSubject;
    connectorId: string;
    operationId: string;
    parameters?: Record<string, unknown>;
    body?: Record<string, unknown>;
  }) {
    assertScope(input.subject, "tools:manage");
    const connector = await this.getForSubject(
      input.subject,
      input.connectorId,
    );
    const operation = (
      await this.repository.listToolOperations(connector.id)
    ).find((item) => item.operationId === input.operationId);
    if (!operation) throw notFound("Tool operation");
    const previewInput: ToolOperationTestInput = {};
    if (input.parameters !== undefined)
      previewInput.parameters = input.parameters;
    if (input.body !== undefined) previewInput.body = input.body;
    const preview = buildToolOperationTestPreview(
      connector,
      operation,
      previewInput,
      {
        externalExecutionEnabled:
          this.options.externalOperationExecutionEnabled === true,
      },
    );
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action: "tool.operation.test",
      resourceType: "tool_operation",
      resourceId: operation.id,
      metadata: {
        connectorId: connector.id,
        operationId: operation.operationId,
        method: operation.method,
        path: operation.path,
        parameterKeys: preview.requestPreview.parameterKeys,
        bodyKeys: preview.requestPreview.bodyKeys,
        disabledReasons: preview.disabledReasons,
      },
    });
    return preview;
  }

  private async getForSubject(
    subject: AuthSubject,
    connectorId: string,
  ): Promise<ToolConnector> {
    return this.getForSubjectInRepository(
      this.repository,
      subject,
      connectorId,
    );
  }

  private async getForSubjectInRepository(
    repository: RomeoRepository,
    subject: AuthSubject,
    connectorId: string,
  ): Promise<ToolConnector> {
    const connector = (await repository.listToolConnectors(subject.orgId)).find(
      (item) => item.id === connectorId,
    );
    if (!connector) throw notFound("Tool connector");
    return connector;
  }

  private async auditConfigurationUpdate<A extends AuditAction>(
    repository: RomeoRepository,
    subject: AuthSubject,
    action: A,
    resourceType: string,
    resourceId: string,
    metadata: AuditMetadata<A>,
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType,
      resourceId,
      metadata,
    });
  }
}
