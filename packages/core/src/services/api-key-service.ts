import {
  AuthorizationError,
  assertScope,
  createApiKeyToken,
  hashApiKey,
  type AuthSubject,
  type Scope,
} from "@romeo/auth";

import type { ApiKey } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { canManageServiceAccount } from "./service-account-access";
import {
  type BulkActionResult,
  bulkErrorMessage,
  dedupeIds,
} from "./bulk-action-result";

export type ApiKeySummary = Omit<ApiKey, "hashedToken">;

export interface CreatedApiKey {
  apiKey: ApiKeySummary;
  token: string;
}

export class ApiKeyService {
  constructor(private readonly repository: RomeoRepository) {}

  async list(subject: AuthSubject): Promise<ApiKeySummary[]> {
    assertScope(subject, "admin:read");
    const apiKeys = await this.repository.listApiKeys(subject.orgId);
    return apiKeys.map(toSummary);
  }

  async create(input: {
    subject: AuthSubject;
    name: string;
    scopes: Scope[];
  }): Promise<CreatedApiKey> {
    assertScope(input.subject, "admin:write");
    const token = createApiKeyToken();
    const hashedToken = await hashApiKey(token);
    const apiKey = await this.repository.transaction(async (repository) => {
      const created = await repository.createApiKey({
        id: createId("api_key"),
        orgId: input.subject.orgId,
        userId: input.subject.id,
        name: input.name,
        hashedToken,
        scopes: input.scopes,
        createdAt: new Date().toISOString(),
      });
      await this.audit(
        repository,
        input.subject,
        "api_key.create",
        created.id,
        "success",
      );
      return created;
    });
    return { apiKey: toSummary(apiKey), token };
  }

  async createForServiceAccount(input: {
    subject: AuthSubject;
    serviceAccountId: string;
    name: string;
    scopes: Scope[];
  }): Promise<CreatedApiKey> {
    assertScope(input.subject, "admin:write");
    const token = createApiKeyToken();
    const hashedToken = await hashApiKey(token);
    const apiKey = await this.repository.transaction(async (repository) => {
      const serviceAccount = await this.getServiceAccountForApiKeyCreation(
        repository,
        input.subject,
        input.serviceAccountId,
        input.scopes,
      );
      const created = await repository.createApiKey({
        id: createId("api_key"),
        orgId: input.subject.orgId,
        serviceAccountId: serviceAccount.id,
        name: input.name,
        hashedToken,
        scopes: input.scopes,
        createdAt: new Date().toISOString(),
      });
      await this.audit(
        repository,
        input.subject,
        "api_key.create",
        created.id,
        "success",
      );
      return created;
    });
    return { apiKey: toSummary(apiKey), token };
  }

  async revoke(input: {
    subject: AuthSubject;
    apiKeyId: string;
  }): Promise<ApiKeySummary> {
    assertScope(input.subject, "admin:write");
    return this.revokeOwned(input.subject, input.apiKeyId);
  }

  async bulkRevoke(input: {
    subject: AuthSubject;
    apiKeyIds: string[];
  }): Promise<BulkActionResult> {
    assertScope(input.subject, "admin:write");
    const results: BulkActionResult["results"] = [];
    for (const apiKeyId of dedupeIds(input.apiKeyIds)) {
      try {
        await this.revokeOwned(input.subject, apiKeyId);
        results.push({ id: apiKeyId, status: "success" });
      } catch (error) {
        results.push({
          id: apiKeyId,
          status: "failure",
          error: bulkErrorMessage(error),
        });
      }
    }
    return { results };
  }

  private async revokeOwned(
    subject: AuthSubject,
    apiKeyId: string,
  ): Promise<ApiKeySummary> {
    return this.repository.transaction(async (repository) => {
      const apiKey = await repository.getApiKey(apiKeyId);
      if (!apiKey || apiKey.orgId !== subject.orgId) throw notFound("API key");

      const revoked = await repository.updateApiKey({
        ...apiKey,
        revokedAt: apiKey.revokedAt ?? new Date().toISOString(),
      });
      await this.audit(
        repository,
        subject,
        "api_key.revoke",
        apiKey.id,
        "success",
      );
      return toSummary(revoked);
    });
  }

  async authenticate(token: string): Promise<AuthSubject> {
    const apiKey = await this.repository.getApiKeyByHash(
      await hashApiKey(token),
    );
    if (!apiKey || apiKey.revokedAt)
      throw new AuthorizationError("API key is invalid or revoked.");

    if (apiKey.serviceAccountId !== undefined)
      return this.authenticateServiceAccount(apiKey);
    if (apiKey.userId === undefined)
      throw new AuthorizationError("API key owner was not found.");
    const user = await this.repository.getCurrentUser(apiKey.userId);
    if (!user) throw new AuthorizationError("API key owner was not found.");
    if (user.disabledAt !== undefined)
      throw new AuthorizationError("API key owner is disabled.");

    const [workspaces, memberships] = await Promise.all([
      this.repository.listWorkspaces(apiKey.orgId),
      this.repository.listGroupMemberships(apiKey.orgId, undefined, user.id),
    ]);
    const groupIds = new Set(
      memberships.map((membership) => membership.groupId),
    );
    if (user.id === "user_dev_admin") groupIds.add("group_admins");
    return {
      id: user.id,
      type: "user",
      apiKeyId: apiKey.id,
      orgId: apiKey.orgId,
      workspaceIds: workspaces.map((workspace) => workspace.id),
      groupIds: [...groupIds].sort(),
      scopes: apiKey.scopes,
      isAdmin: false,
    };
  }

  private async authenticateServiceAccount(
    apiKey: ApiKey,
  ): Promise<AuthSubject> {
    const serviceAccount = await this.repository.getServiceAccount(
      apiKey.serviceAccountId!,
    );
    if (!serviceAccount || serviceAccount.orgId !== apiKey.orgId)
      throw new AuthorizationError("API key owner was not found.");
    if (serviceAccount.disabledAt !== undefined)
      throw new AuthorizationError("API key owner is disabled.");
    const workspaces = await this.repository.listWorkspaces(apiKey.orgId);
    return {
      id: serviceAccount.id,
      type: "service_account",
      apiKeyId: apiKey.id,
      orgId: apiKey.orgId,
      workspaceIds: workspaces.map((workspace) => workspace.id),
      groupIds: [],
      scopes: apiKey.scopes.filter((scope) =>
        serviceAccount.scopes.includes(scope),
      ),
      isAdmin: false,
    };
  }

  private async audit(
    repository: RomeoRepository,
    subject: AuthSubject,
    action: string,
    resourceId: string,
    outcome: "success" | "failure",
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType: "api_key",
      resourceId,
      outcome,
      metadata: {},
    });
  }

  private async getServiceAccountForApiKeyCreation(
    repository: RomeoRepository,
    subject: AuthSubject,
    serviceAccountId: string,
    scopes: Scope[],
  ) {
    const serviceAccount = await repository.getServiceAccount(serviceAccountId);
    if (!serviceAccount || serviceAccount.orgId !== subject.orgId)
      throw notFound("Service account");
    if (!canManageServiceAccount(subject, serviceAccount))
      throw notFound("Service account");
    if (serviceAccount.disabledAt !== undefined)
      throw new ApiError(
        "service_account_disabled",
        "Service account is disabled.",
        409,
      );
    const disallowed = scopes.filter(
      (scope) => !serviceAccount.scopes.includes(scope),
    );
    if (disallowed.length > 0)
      throw new ApiError(
        "service_account_scope_exceeded",
        "API key scopes exceed the service account scopes.",
        400,
        { scopes: disallowed },
      );
    return serviceAccount;
  }
}

function toSummary(apiKey: ApiKey): ApiKeySummary {
  const { hashedToken: _hashedToken, ...summary } = apiKey;
  return summary;
}
