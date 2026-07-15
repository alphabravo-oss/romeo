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
import { writeAuditLog } from "./audit-log";
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
  normalizeOAuthScopes,
  normalizeOAuthTokenUrl,
  readOAuthClientAuthMethod,
  type OAuthClientAuthMethod,
} from "./tool-oauth-client-credentials";
import {
  cancelToolOperationDispatchRequest,
  claimToolOperationDispatchRequest,
  completeToolOperationDispatchRequest,
  expireToolOperationDispatchRequests,
  failToolOperationDispatchRequest,
  readToolOperationDispatchRequestPayload,
  renewToolOperationDispatchRequestLease,
} from "./tool-operation-dispatch-requests";
import {
  dispatchToolOperation,
  enqueueToolOperationDispatch,
} from "./tool-operation-dispatch";
import type { ToolOperationDispatchReadbackResponse } from "../domain/tools";
import {
  buildToolOperationTestPreview,
  type ToolOperationTestInput,
} from "./tool-operation-test";
import type { ToolDispatchPayloadStore } from "./tool-dispatch-payload-store";

export class ToolConnectorService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly secretResolver: SecretResolver = disabledSecretResolver,
    private readonly options: {
      dispatchPayloadStore?: ToolDispatchPayloadStore;
      externalOperationExecutionEnabled?: boolean;
      fetchImpl?: typeof fetch;
      maxBytes?: number;
      timeoutMs?: number;
    } = {},
  ) {}

  async list(subject: AuthSubject): Promise<ToolConnector[]> {
    assertScope(subject, "tools:manage");
    return this.repository.listToolConnectors(subject.orgId);
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
    oauthClientAuthMethod?: OAuthClientAuthMethod;
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

  async dispatchOperation(input: {
    approvalRequestId?: string;
    approved?: boolean;
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
    return dispatchToolOperation({
      repository: this.repository,
      secretResolver: this.secretResolver,
      externalExecutionEnabled:
        this.options.externalOperationExecutionEnabled === true,
      fetchImpl: this.options.fetchImpl ?? fetch,
      timeoutMs: this.options.timeoutMs ?? 10_000,
      maxBytes: this.options.maxBytes ?? 1_000_000,
      subject: input.subject,
      connector,
      operation,
      ...(input.approved === undefined ? {} : { approved: input.approved }),
      ...(input.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: input.approvalRequestId }),
      ...(input.parameters === undefined
        ? {}
        : { parameters: input.parameters }),
      ...(input.body === undefined ? {} : { body: input.body }),
    });
  }

  async enqueueDispatchOperation(input: {
    approvalRequestId?: string;
    approved?: boolean;
    idempotencyKey?: string;
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
    return enqueueToolOperationDispatch({
      repository: this.repository,
      secretResolver: this.secretResolver,
      externalExecutionEnabled:
        this.options.externalOperationExecutionEnabled === true,
      fetchImpl: this.options.fetchImpl ?? fetch,
      timeoutMs: this.options.timeoutMs ?? 10_000,
      maxBytes: this.options.maxBytes ?? 1_000_000,
      subject: input.subject,
      connector,
      operation,
      ...(this.options.dispatchPayloadStore === undefined
        ? {}
        : { dispatchPayloadStore: this.options.dispatchPayloadStore }),
      ...(input.approved === undefined ? {} : { approved: input.approved }),
      ...(input.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: input.approvalRequestId }),
      ...(input.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: input.idempotencyKey }),
      ...(input.parameters === undefined
        ? {}
        : { parameters: input.parameters }),
      ...(input.body === undefined ? {} : { body: input.body }),
    });
  }

  async claimDispatchRequest(input: {
    leaseSeconds: number;
    payloadStorage?:
      | "external_worker_secret_store_required"
      | "managed_encrypted_object_store";
    subject: AuthSubject;
  }) {
    return claimToolOperationDispatchRequest({
      repository: this.repository,
      subject: input.subject,
      leaseSeconds: input.leaseSeconds,
      ...(input.payloadStorage === undefined
        ? {}
        : { payloadStorage: input.payloadStorage }),
      ...(this.options.dispatchPayloadStore === undefined
        ? {}
        : { dispatchPayloadStore: this.options.dispatchPayloadStore }),
    });
  }

  async readDispatchRequestPayload(input: {
    subject: AuthSubject;
    jobId: string;
  }) {
    return readToolOperationDispatchRequestPayload({
      repository: this.repository,
      subject: input.subject,
      jobId: input.jobId,
      ...(this.options.dispatchPayloadStore === undefined
        ? {}
        : { dispatchPayloadStore: this.options.dispatchPayloadStore }),
    });
  }

  async renewDispatchRequestLease(input: {
    subject: AuthSubject;
    jobId: string;
    leaseSeconds: number;
  }) {
    return renewToolOperationDispatchRequestLease({
      repository: this.repository,
      subject: input.subject,
      jobId: input.jobId,
      leaseSeconds: input.leaseSeconds,
    });
  }

  async completeDispatchRequest(input: {
    subject: AuthSubject;
    jobId: string;
    response: ToolOperationDispatchReadbackResponse;
  }) {
    return completeToolOperationDispatchRequest({
      repository: this.repository,
      subject: input.subject,
      jobId: input.jobId,
      response: input.response,
      ...(this.options.dispatchPayloadStore === undefined
        ? {}
        : { dispatchPayloadStore: this.options.dispatchPayloadStore }),
    });
  }

  async failDispatchRequest(input: {
    subject: AuthSubject;
    jobId: string;
    errorCode: string;
  }) {
    return failToolOperationDispatchRequest({
      repository: this.repository,
      subject: input.subject,
      jobId: input.jobId,
      errorCode: input.errorCode,
      ...(this.options.dispatchPayloadStore === undefined
        ? {}
        : { dispatchPayloadStore: this.options.dispatchPayloadStore }),
    });
  }

  async cancelDispatchRequest(input: {
    subject: AuthSubject;
    jobId: string;
    reasonCode?: string;
  }) {
    return cancelToolOperationDispatchRequest({
      repository: this.repository,
      subject: input.subject,
      jobId: input.jobId,
      ...(this.options.dispatchPayloadStore === undefined
        ? {}
        : { dispatchPayloadStore: this.options.dispatchPayloadStore }),
      ...(input.reasonCode === undefined
        ? {}
        : { reasonCode: input.reasonCode }),
    });
  }

  async expireDispatchRequests(input: {
    subject: AuthSubject;
    queuedTimeoutSeconds: number;
    runningTimeoutSeconds: number;
    limit: number;
  }) {
    return expireToolOperationDispatchRequests({
      repository: this.repository,
      subject: input.subject,
      queuedTimeoutSeconds: input.queuedTimeoutSeconds,
      runningTimeoutSeconds: input.runningTimeoutSeconds,
      limit: input.limit,
      ...(this.options.dispatchPayloadStore === undefined
        ? {}
        : { dispatchPayloadStore: this.options.dispatchPayloadStore }),
    });
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

  private async auditConfigurationUpdate(
    repository: RomeoRepository,
    subject: AuthSubject,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>,
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

function authMetadataForConnector(
  connector: ToolConnector,
  input: {
    apiKeyIn?: "header" | "query";
    apiKeyName?: string;
    oauthClientAuthMethod?: OAuthClientAuthMethod;
    oauthScopes?: string[];
    oauthTokenUrl?: string;
    type: "none" | "api_key" | "bearer" | "oauth2_client_credentials";
  },
): Record<string, unknown> {
  if (input.type === "api_key") {
    if (
      input.oauthTokenUrl !== undefined ||
      input.oauthScopes !== undefined ||
      input.oauthClientAuthMethod !== undefined
    ) {
      throw new ApiError(
        "invalid_tool_auth_config",
        "OAuth metadata applies only to oauth2_client_credentials auth.",
        400,
      );
    }
    const hint = readApiKeyAuthHint(connector);
    const apiKeyIn = input.apiKeyIn ?? hint?.apiKeyIn ?? "header";
    const apiKeyName = input.apiKeyName ?? hint?.apiKeyName ?? "x-api-key";
    if (!isSafeApiKeyPlacement(apiKeyIn, apiKeyName)) {
      throw new ApiError(
        "invalid_tool_auth_config",
        "API key auth placement must use a safe header or query name.",
        400,
      );
    }
    return { apiKeyIn, apiKeyName };
  }
  if (input.apiKeyIn !== undefined || input.apiKeyName !== undefined) {
    throw new ApiError(
      "invalid_tool_auth_config",
      "API key placement applies only to api_key auth.",
      400,
    );
  }
  if (input.type === "oauth2_client_credentials") {
    const hint = readOAuthClientCredentialsAuthHint(connector);
    const tokenUrl = input.oauthTokenUrl ?? hint?.oauthTokenUrl;
    if (tokenUrl === undefined) {
      throw new ApiError(
        "invalid_tool_auth_config",
        "OAuth client credentials auth requires a safe token URL.",
        400,
      );
    }
    return {
      oauthTokenUrl: normalizeOAuthTokenUrl(tokenUrl),
      oauthScopes: normalizeOAuthScopes(
        input.oauthScopes ?? hint?.oauthScopes ?? [],
      ),
      oauthClientAuthMethod: readOAuthClientAuthMethod(
        input.oauthClientAuthMethod,
      ),
    };
  }
  if (
    input.oauthTokenUrl !== undefined ||
    input.oauthScopes !== undefined ||
    input.oauthClientAuthMethod !== undefined
  ) {
    throw new ApiError(
      "invalid_tool_auth_config",
      "OAuth metadata applies only to oauth2_client_credentials auth.",
      400,
    );
  }
  return {};
}

function readOAuthClientCredentialsAuthHint(
  connector: ToolConnector,
): { oauthScopes: string[]; oauthTokenUrl: string } | undefined {
  const hints = Array.isArray(connector.schema.authHints)
    ? connector.schema.authHints
    : [];
  for (const hint of hints) {
    if (!isRecord(hint) || hint.type !== "oauth2_client_credentials") continue;
    const tokenUrl = hint.oauthTokenUrl;
    if (typeof tokenUrl !== "string") continue;
    try {
      return {
        oauthTokenUrl: normalizeOAuthTokenUrl(tokenUrl),
        oauthScopes: normalizeOAuthScopes(hint.oauthScopes),
      };
    } catch {
      continue;
    }
  }
  return undefined;
}

function readApiKeyAuthHint(
  connector: ToolConnector,
): { apiKeyIn: "header" | "query"; apiKeyName: string } | undefined {
  const hints = Array.isArray(connector.schema.authHints)
    ? connector.schema.authHints
    : [];
  for (const hint of hints) {
    if (!isRecord(hint) || hint.type !== "api_key") continue;
    const apiKeyIn = hint.apiKeyIn;
    const apiKeyName = hint.apiKeyName;
    if (
      (apiKeyIn === "header" || apiKeyIn === "query") &&
      typeof apiKeyName === "string" &&
      isSafeApiKeyPlacement(apiKeyIn, apiKeyName)
    ) {
      return { apiKeyIn, apiKeyName };
    }
  }
  return undefined;
}

function isSafeApiKeyPlacement(
  apiKeyIn: "header" | "query",
  apiKeyName: string,
): boolean {
  return (
    (apiKeyIn === "header" || apiKeyIn === "query") &&
    /^[A-Za-z0-9_.-]{1,80}$/u.test(apiKeyName)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
