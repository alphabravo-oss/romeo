import { assertScope, type AuthSubject, type Scope } from "@romeo/auth";

import type { CreatedApiKey } from "./api-key-service";
import type { ServiceAccount } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { ApiKeyService } from "./api-key-service";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import {
  canManageServiceAccount,
  filterVisibleServiceAccounts,
} from "./service-account-access";
import {
  type BulkActionResult,
  bulkErrorMessage,
  dedupeIds,
} from "./bulk-action-result";

export class ServiceAccountService {
  private readonly apiKeys: ApiKeyService;

  constructor(private readonly repository: RomeoRepository) {
    this.apiKeys = new ApiKeyService(repository);
  }

  async list(subject: AuthSubject): Promise<ServiceAccount[]> {
    assertScope(subject, "admin:read");
    return filterVisibleServiceAccounts(
      subject,
      await this.repository.listServiceAccounts(subject.orgId),
    );
  }

  async create(input: {
    subject: AuthSubject;
    name: string;
    scopes: Scope[];
  }): Promise<ServiceAccount> {
    assertScope(input.subject, "admin:write");
    this.assertScopesAllowed(input.subject, input.scopes);
    return this.repository.transaction(async (repository) => {
      const serviceAccount = await repository.createServiceAccount({
        id: createId("service_account"),
        orgId: input.subject.orgId,
        name: input.name,
        scopes: input.scopes,
        createdBy: input.subject.id,
        createdAt: new Date().toISOString(),
      });
      await this.audit(
        repository,
        input.subject,
        "service_account.create",
        serviceAccount.id,
        "success",
      );
      return serviceAccount;
    });
  }

  async disable(input: {
    subject: AuthSubject;
    serviceAccountId: string;
  }): Promise<ServiceAccount> {
    assertScope(input.subject, "admin:write");
    return this.disableManageable(input.subject, input.serviceAccountId);
  }

  async bulkDisable(input: {
    subject: AuthSubject;
    serviceAccountIds: string[];
  }): Promise<BulkActionResult> {
    assertScope(input.subject, "admin:write");
    const results: BulkActionResult["results"] = [];
    for (const serviceAccountId of dedupeIds(input.serviceAccountIds)) {
      try {
        await this.disableManageable(input.subject, serviceAccountId);
        results.push({ id: serviceAccountId, status: "success" });
      } catch (error) {
        results.push({
          id: serviceAccountId,
          status: "failure",
          error: bulkErrorMessage(error),
        });
      }
    }
    return { results };
  }

  private async disableManageable(
    subject: AuthSubject,
    serviceAccountId: string,
  ): Promise<ServiceAccount> {
    return this.repository.transaction(async (repository) => {
      const serviceAccount = await this.getManageableServiceAccount(
        repository,
        subject,
        serviceAccountId,
      );
      if (serviceAccount.disabledAt !== undefined) return serviceAccount;
      const disabledAt = new Date().toISOString();
      const disabled = await repository.updateServiceAccount({
        ...serviceAccount,
        disabledAt,
      });
      await this.revokeServiceAccountApiKeys(
        repository,
        serviceAccount.orgId,
        serviceAccount.id,
        disabledAt,
      );
      await this.audit(
        repository,
        subject,
        "service_account.disable",
        serviceAccount.id,
        "success",
      );
      return disabled;
    });
  }

  async createApiKey(input: {
    subject: AuthSubject;
    serviceAccountId: string;
    name: string;
    scopes: Scope[];
  }): Promise<CreatedApiKey> {
    return this.apiKeys.createForServiceAccount(input);
  }

  private async getManageableServiceAccount(
    repository: RomeoRepository,
    subject: AuthSubject,
    serviceAccountId: string,
  ): Promise<ServiceAccount> {
    const serviceAccount = await repository.getServiceAccount(serviceAccountId);
    if (!serviceAccount || serviceAccount.orgId !== subject.orgId)
      throw notFound("Service account");
    if (!canManageServiceAccount(subject, serviceAccount))
      throw notFound("Service account");
    return serviceAccount;
  }

  private assertScopesAllowed(subject: AuthSubject, scopes: Scope[]): void {
    if (subject.isAdmin === true) return;
    const disallowed = scopes.filter(
      (scope) => !subject.scopes.includes(scope),
    );
    if (disallowed.length > 0) {
      throw new ApiError(
        "service_account_scope_exceeded",
        "Service account scopes exceed the caller scopes.",
        400,
        { scopes: disallowed },
      );
    }
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
      resourceType: "service_account",
      resourceId,
      outcome,
      metadata: {},
    });
  }

  private async revokeServiceAccountApiKeys(
    repository: RomeoRepository,
    orgId: string,
    serviceAccountId: string,
    revokedAt: string,
  ): Promise<void> {
    const apiKeys = await repository.listApiKeys(orgId);
    for (const apiKey of apiKeys) {
      if (
        apiKey.serviceAccountId !== serviceAccountId ||
        apiKey.revokedAt !== undefined
      )
        continue;
      await repository.updateApiKey({
        ...apiKey,
        revokedAt,
      });
    }
  }
}
